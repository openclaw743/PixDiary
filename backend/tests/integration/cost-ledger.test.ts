/**
 * Cost ledger integration tests — focus on the concurrency contract.
 *
 * The pre-call gate (`reserveBudget`) is the single point that enforces the
 * daily €-cap. It must hold the cap atomically even when several pipelines
 * fan out in parallel for the same user. This file covers:
 *
 *   1. Two concurrent `reserveBudget` calls that would together exceed the
 *      cap — exactly one must succeed and exactly one must throw
 *      `QuotaExceededError`. Neither outcome may leave the rollup over cap.
 *   2. Concurrent calls that fit under the cap — both succeed and the rollup
 *      equals the sum.
 *   3. `reserveBudget` immediately under the cap is allowed.
 *   4. Refund after a failed AI call restores headroom for a follow-up call.
 *   5. Mixed concurrent reserve + refund — the rollup never goes negative.
 *
 * Uses real Postgres because the contract relies on Postgres-level atomic
 * upsert (`ON CONFLICT … DO UPDATE`); SQLite can't model it faithfully.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import { dockerAvailable, setupTestPg, type PgHarness } from '../helpers/docker';
import { makeUser, seedDailyCost } from '../factories';
import {
  estimateCostEur,
  recordUsage,
  refundReservation,
  reserveBudget,
  todayInTz,
  todaysSpend,
} from '../../src/services/costLedger';
import { QuotaExceededError } from '../../src/errors';
import { resetConfigCache } from '../../src/config';
import { setPool } from '../../src/db/pool';

const skip = !dockerAvailable() && !process.env.PIXDIARY_TEST_DATABASE_URL;
const DAY = '2025-05-08';

let pg: PgHarness | undefined;
let pool: Pool;

beforeAll(async () => {
  if (skip) return;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
  process.env.DATABASE_URL = 'pending';
  process.env.BCRYPT_COST = '4';
  process.env.LOG_LEVEL = 'silent';
  pg = await setupTestPg();
  process.env.DATABASE_URL = pg.url;
  resetConfigCache();
  setPool(pg.pool);
  pool = pg.pool;
}, 180_000);

afterAll(async () => {
  setPool(undefined);
  if (pg) await pg.cleanup();
}, 60_000);

/** A "big" call that consumes ~€0.30 against gpt-4o-mini. */
function bigCallArgs(userId: string) {
  return {
    userId,
    entryId: null,
    purpose: 'draft' as const,
    model: 'gpt-4o-mini',
    day: DAY,
    dailyCapEur: 0.5,
    estimatedTokensIn: 700_000, // 700k * 0.14/M = 0.098
    estimatedTokensOut: 360_000, // 360k * 0.55/M = 0.198 → total 0.296
  };
}

describe.skipIf(skip)('costLedger: concurrent reserveBudget race', () => {
  it('two parallel reserves that together exceed the cap: exactly one wins', async () => {
    const u = await makeUser(pool, { dailyCapEur: 0.5 });

    // Two pipelines both want to spend ~€0.30 — sum €0.60 > €0.50 cap.
    const args = bigCallArgs(u.id);
    const cost = estimateCostEur(args.model, args.estimatedTokensIn, args.estimatedTokensOut);
    expect(cost).toBeGreaterThan(0.25);
    expect(cost).toBeLessThan(args.dailyCapEur);

    const results = await Promise.allSettled([
      reserveBudget(args),
      reserveBudget(args),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(QuotaExceededError);

    // The rollup must NOT exceed cap, regardless of who won the race.
    const today = await todaysSpend(u.id, DAY);
    expect(today).toBeLessThanOrEqual(args.dailyCapEur + 1e-9);
    expect(today).toBeCloseTo(cost, 6);
  });

  it('stress: 20 parallel reserves against a tight cap, no oversell', async () => {
    const u = await makeUser(pool, { dailyCapEur: 1.0 });

    // Each call estimates €0.20 → 5 fit, the next 15 must be rejected.
    const oneArgs = {
      userId: u.id,
      entryId: null,
      purpose: 'draft' as const,
      model: 'gpt-4o-mini',
      day: DAY,
      dailyCapEur: 1.0,
      estimatedTokensIn: 700_000, // 700k * 0.14/M = 0.098
      estimatedTokensOut: 200_000, // 200k * 0.55/M = 0.110 → 0.208
    };
    const perCall = estimateCostEur(
      oneArgs.model,
      oneArgs.estimatedTokensIn,
      oneArgs.estimatedTokensOut,
    );
    const expectedFits = Math.floor(oneArgs.dailyCapEur / perCall); // 4

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => reserveBudget(oneArgs)),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;

    expect(fulfilled).toBe(expectedFits);
    expect(rejected).toBe(20 - expectedFits);

    // Spot-check that every rejection was the typed quota error.
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(QuotaExceededError);
      }
    }

    const total = await todaysSpend(u.id, DAY);
    expect(total).toBeLessThanOrEqual(oneArgs.dailyCapEur + 1e-9);
    expect(total).toBeCloseTo(perCall * expectedFits, 6);
  });

  it('concurrent reserves that fit under the cap: all succeed', async () => {
    const u = await makeUser(pool, { dailyCapEur: 1.0 });

    // 4 small calls @ ~€0.10 = €0.40 — well under cap.
    const small = {
      userId: u.id,
      entryId: null,
      purpose: 'vision' as const,
      model: 'gpt-4o-mini',
      day: DAY,
      dailyCapEur: 1.0,
      estimatedTokensIn: 300_000, // 0.042
      estimatedTokensOut: 100_000, // 0.055 → 0.097
    };
    const perCall = estimateCostEur(
      small.model,
      small.estimatedTokensIn,
      small.estimatedTokensOut,
    );

    const results = await Promise.allSettled([
      reserveBudget(small),
      reserveBudget(small),
      reserveBudget(small),
      reserveBudget(small),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const total = await todaysSpend(u.id, DAY);
    expect(total).toBeCloseTo(perCall * 4, 6);
  });

  it('reserve immediately at the cap is allowed (equality is OK)', async () => {
    const u = await makeUser(pool, { dailyCapEur: 0.5 });
    // Pre-seed to leave just €0.01 of headroom.
    await seedDailyCost(pool, { userId: u.id, day: DAY, totalEur: 0.49 });

    const args = {
      userId: u.id,
      entryId: null,
      purpose: 'vision' as const,
      model: 'gpt-4o-mini',
      day: DAY,
      dailyCapEur: 0.5,
      estimatedTokensIn: 50_000, // 0.007
      estimatedTokensOut: 5000, // 0.00275 → ~0.0098, well under headroom
    };
    const ok = await reserveBudget(args);
    expect(ok.newDailyTotalEur).toBeLessThanOrEqual(0.5 + 1e-9);

    // A second reserve that would now exceed must fail.
    await expect(reserveBudget(args)).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('refund after failed call frees budget for the next call', async () => {
    const u = await makeUser(pool, { dailyCapEur: 0.5 });
    const args = bigCallArgs(u.id);
    const cost = estimateCostEur(args.model, args.estimatedTokensIn, args.estimatedTokensOut);

    const r1 = await reserveBudget(args);
    expect(r1.newDailyTotalEur).toBeCloseTo(cost, 6);

    // A second reserve at this size would exceed cap — refund the first
    // (simulating a failed model call) and confirm headroom is restored.
    await refundReservation({ userId: u.id, day: DAY, reservedEur: r1.reservedEur });
    expect(await todaysSpend(u.id, DAY)).toBeCloseTo(0, 6);

    // Now the second reserve must succeed.
    const r2 = await reserveBudget(args);
    expect(r2.newDailyTotalEur).toBeCloseTo(cost, 6);
  });

  it('mixed concurrent reserve + refund cannot drive the rollup negative', async () => {
    const u = await makeUser(pool, { dailyCapEur: 5.0 });

    // Seed 2 reservations first so refund has something to undo.
    const args = {
      userId: u.id,
      entryId: null,
      purpose: 'draft' as const,
      model: 'gpt-4o-mini',
      day: DAY,
      dailyCapEur: 5.0,
      estimatedTokensIn: 700_000,
      estimatedTokensOut: 200_000,
    };
    const seed1 = await reserveBudget(args);
    const seed2 = await reserveBudget(args);

    // Now interleave: 3 more reserves and 2 refunds at the same time.
    const ops = [
      reserveBudget(args),
      refundReservation({ userId: u.id, day: DAY, reservedEur: seed1.reservedEur }),
      reserveBudget(args),
      refundReservation({ userId: u.id, day: DAY, reservedEur: seed2.reservedEur }),
      reserveBudget(args),
    ];
    const results = await Promise.allSettled(ops);
    // No throws expected — all under cap.
    for (const r of results) expect(r.status).toBe('fulfilled');

    const total = await todaysSpend(u.id, DAY);
    expect(total).toBeGreaterThanOrEqual(0);
  });
});

describe.skipIf(skip)('costLedger: recordUsage adjusts rollup by delta', () => {
  it('records exact spend, then post-reserve delta corrects the rollup', async () => {
    const u = await makeUser(pool, { dailyCapEur: 1.0 });
    const reserved = await reserveBudget({
      userId: u.id,
      entryId: null,
      purpose: 'draft',
      model: 'gpt-4o-mini',
      day: DAY,
      dailyCapEur: 1.0,
      estimatedTokensIn: 1_000_000,
      estimatedTokensOut: 500_000,
    });
    const estimate = reserved.reservedEur;

    // Actual call used HALF the estimated input tokens — delta negative.
    const actual = await recordUsage({
      userId: u.id,
      entryId: null,
      purpose: 'draft',
      model: 'gpt-4o-mini',
      day: DAY,
      dailyCapEur: 1.0,
      tokensIn: 500_000,
      tokensOut: 500_000,
      reservedEur: reserved.reservedEur,
    });

    const actualCost = estimateCostEur('gpt-4o-mini', 500_000, 500_000);
    expect(actual.costEur).toBeCloseTo(actualCost, 6);
    expect(actualCost).toBeLessThan(estimate);

    // Rollup must equal the actual cost, not the estimate.
    const today = await todaysSpend(u.id, DAY);
    expect(today).toBeCloseTo(actualCost, 6);
  });
});

describe.skipIf(skip)('costLedger: tz handling', () => {
  it('todayInTz returns the local-day YYYY-MM-DD respecting tz', () => {
    // 2026-05-08T22:30:00Z is 2026-05-08 in UTC but already 2026-05-09 in CET.
    const at = new Date('2026-05-08T22:30:00Z');
    expect(todayInTz(at, 'UTC')).toBe('2026-05-08');
    expect(todayInTz(at, 'Europe/Copenhagen')).toBe('2026-05-09');
    expect(todayInTz(at, 'America/Los_Angeles')).toBe('2026-05-08');
  });

  it('a user near midnight in a non-UTC zone uses the local day for their cap', async () => {
    const u = await makeUser(pool, { timezone: 'Europe/Copenhagen', dailyCapEur: 0.5 });
    const localDay = todayInTz(new Date('2026-05-08T22:30:00Z'), 'Europe/Copenhagen');
    expect(localDay).toBe('2026-05-09');

    await seedDailyCost(pool, { userId: u.id, day: localDay, totalEur: 0.45 });
    // A €0.10 call here would push above cap.
    const args = {
      userId: u.id,
      entryId: null,
      purpose: 'draft' as const,
      model: 'gpt-4o-mini',
      day: localDay,
      dailyCapEur: 0.5,
      estimatedTokensIn: 300_000, // 0.042
      estimatedTokensOut: 130_000, // ~0.0715 → 0.114
    };
    await expect(reserveBudget(args)).rejects.toBeInstanceOf(QuotaExceededError);
    // Seeded balance must not have been touched.
    expect(await todaysSpend(u.id, localDay)).toBeCloseTo(0.45, 6);
  });
});

describe.skipIf(skip)('costLedger: independence across users and days', () => {
  it('two users sharing the same day have independent rollups', async () => {
    const a = await makeUser(pool, { dailyCapEur: 0.5 });
    const b = await makeUser(pool, { dailyCapEur: 0.5 });
    const args = (uid: string) => ({
      userId: uid,
      entryId: null,
      purpose: 'draft' as const,
      model: 'gpt-4o-mini',
      day: DAY,
      dailyCapEur: 0.5,
      estimatedTokensIn: 600_000,
      estimatedTokensOut: 200_000,
    });
    await reserveBudget(args(a.id));
    await reserveBudget(args(b.id));
    const ta = await todaysSpend(a.id, DAY);
    const tb = await todaysSpend(b.id, DAY);
    expect(ta).toBeGreaterThan(0);
    expect(tb).toBeGreaterThan(0);
    expect(ta).toBeCloseTo(tb, 6);
  });

  it('one user across two days has independent rollups', async () => {
    const u = await makeUser(pool, { dailyCapEur: 0.5 });
    const args = (day: string) => ({
      userId: u.id,
      entryId: null,
      purpose: 'draft' as const,
      model: 'gpt-4o-mini',
      day,
      dailyCapEur: 0.5,
      estimatedTokensIn: 600_000,
      estimatedTokensOut: 200_000,
    });
    await reserveBudget(args('2025-05-08'));
    await reserveBudget(args('2025-05-09'));
    expect(await todaysSpend(u.id, '2025-05-08')).toBeGreaterThan(0);
    expect(await todaysSpend(u.id, '2025-05-09')).toBeGreaterThan(0);
  });
});

// Silence the linter on test-only imports.
void randomUUID;
