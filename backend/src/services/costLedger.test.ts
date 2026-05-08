/**
 * Unit/integration tests for the AI cost ledger.
 *
 * Uses a real Postgres 16 (Docker) — the ledger's correctness depends on
 * Postgres-level atomic upsert (`ON CONFLICT … DO UPDATE`) so we don't try
 * to fake it with sqlite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { dockerAvailable, setupTestPg, type PgHarness } from '../../tests/helpers/docker';
import {
  estimateCostEur,
  recordUsage,
  refundReservation,
  reserveBudget,
  todayInTz,
  todaysSpend,
} from './costLedger';
import { QuotaExceededError } from '../errors';
import { resetConfigCache } from '../config';
import { setPool } from '../db/pool';

const skip = !dockerAvailable() && !process.env.PIXDIARY_TEST_DATABASE_URL;

let pg: PgHarness | undefined;
let pool: Pool;

async function makeUser(p: Pool, capEur = 0.5): Promise<string> {
  const r = await p.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, daily_cap_eur)
     VALUES ($1, 'x', $2) RETURNING id`,
    [`u-${randomUUID()}@example.com`, capEur],
  );
  return r.rows[0]!.id;
}

beforeAll(async () => {
  if (skip) return;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
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

describe.skipIf(skip)('costLedger pure helpers', () => {
  it('estimateCostEur uses the right pricing for gpt-4o-mini', () => {
    const eur = estimateCostEur('gpt-4o-mini', 1_000_000, 1_000_000);
    expect(eur).toBeCloseTo(0.14 + 0.55, 6);
  });

  it('estimateCostEur uses the right pricing for gpt-4o', () => {
    const eur = estimateCostEur('gpt-4o', 1_000_000, 1_000_000);
    expect(eur).toBeCloseTo(2.3 + 9.2, 6);
  });

  it('estimateCostEur returns 0 for unknown models', () => {
    expect(estimateCostEur('does-not-exist', 1000, 1000)).toBe(0);
  });

  it('estimateCostEur rejects negative tokens by clamping at 0', () => {
    expect(estimateCostEur('gpt-4o-mini', -100, -100)).toBe(0);
  });

  it('todayInTz returns YYYY-MM-DD in the requested zone', () => {
    const at = new Date('2026-05-08T22:30:00Z'); // 23:30 in CET
    expect(todayInTz(at, 'UTC')).toBe('2026-05-08');
    expect(todayInTz(at, 'Europe/Copenhagen')).toBe('2026-05-09'); // crossed midnight
  });
});

describe.skipIf(skip)('costLedger: reserve / record / refund', () => {
  it('reserveBudget creates rollup row and records under cap', async () => {
    const userId = await makeUser(pool, 0.5);
    const day = '2026-05-08';
    const r = await reserveBudget(
      {
        userId,
        entryId: null,
        purpose: 'vision',
        model: 'gpt-4o-mini',
        day,
        dailyCapEur: 0.5,
        estimatedTokensIn: 1_000_000,
        estimatedTokensOut: 0,
      },
      { pool },
    );
    expect(r.reservedEur).toBeCloseTo(0.14, 6);
    expect(r.newDailyTotalEur).toBeCloseTo(0.14, 6);
    const tot = await todaysSpend(userId, day, { pool });
    expect(tot).toBeCloseTo(0.14, 6);
  });

  it('reserveBudget throws QuotaExceededError when cap is hit; rolls back upsert', async () => {
    const userId = await makeUser(pool, 0.1);
    const day = '2026-05-08';
    let err: unknown;
    try {
      await reserveBudget(
        {
          userId,
          entryId: null,
          purpose: 'draft',
          model: 'gpt-4o-mini',
          day,
          dailyCapEur: 0.1,
          // 2_000_000 in tokens at 0.14 €/M = 0.28€ → over the 0.10 cap.
          estimatedTokensIn: 2_000_000,
          estimatedTokensOut: 0,
        },
        { pool },
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(QuotaExceededError);
    // rollup must be rolled back
    const tot = await todaysSpend(userId, day, { pool });
    expect(tot).toBe(0);
  });

  it('recordUsage corrects the rollup by (actual - reserved)', async () => {
    const userId = await makeUser(pool, 1.0);
    const day = '2026-05-08';
    const reservation = await reserveBudget(
      {
        userId,
        entryId: null,
        purpose: 'draft',
        model: 'gpt-4o-mini',
        day,
        dailyCapEur: 1.0,
        // reserve 0.14
        estimatedTokensIn: 1_000_000,
        estimatedTokensOut: 0,
      },
      { pool },
    );
    expect(reservation.reservedEur).toBeCloseTo(0.14, 6);
    // actual: only half the input tokens, no output
    await recordUsage(
      {
        userId,
        entryId: null,
        purpose: 'draft',
        model: 'gpt-4o-mini',
        tokensIn: 500_000,
        tokensOut: 0,
        day,
        dailyCapEur: 1.0,
        reservedEur: reservation.reservedEur,
      },
      { pool },
    );
    const tot = await todaysSpend(userId, day, { pool });
    expect(tot).toBeCloseTo(0.07, 6);
  });

  it('refundReservation reduces rollup but never below zero', async () => {
    const userId = await makeUser(pool, 0.5);
    const day = '2026-05-08';
    await reserveBudget(
      {
        userId,
        entryId: null,
        purpose: 'vision',
        model: 'gpt-4o-mini',
        day,
        dailyCapEur: 0.5,
        estimatedTokensIn: 100_000,
        estimatedTokensOut: 0,
      },
      { pool },
    );
    await refundReservation({ userId, day, reservedEur: 0.014 }, { pool });
    const tot = await todaysSpend(userId, day, { pool });
    expect(tot).toBeCloseTo(0, 6);
    // refund again — must clamp at 0, not go negative
    await refundReservation({ userId, day, reservedEur: 1.0 }, { pool });
    const tot2 = await todaysSpend(userId, day, { pool });
    expect(tot2).toBeCloseTo(0, 6);
  });
});

describe.skipIf(skip)('costLedger: concurrency / quota race', () => {
  it('concurrent reservations against a 0.20€ cap stop at the cap', async () => {
    const userId = await makeUser(pool, 0.2);
    const day = '2026-05-09';

    // Each reservation tries to spend 0.07€ (500k tok input on gpt-4o-mini).
    // With cap at 0.20€, only the first 2 should succeed (0.14€); the 3rd
    // would push to 0.21€ → must throw.
    const tasks = Array.from({ length: 8 }).map(() =>
      reserveBudget(
        {
          userId,
          entryId: null,
          purpose: 'vision',
          model: 'gpt-4o-mini',
          day,
          dailyCapEur: 0.2,
          estimatedTokensIn: 500_000,
          estimatedTokensOut: 0,
        },
        { pool },
      ).then(
        () => 'ok' as const,
        (e) => (e instanceof QuotaExceededError ? ('quota' as const) : Promise.reject(e)),
      ),
    );
    const results = await Promise.all(tasks);
    const ok = results.filter((r) => r === 'ok').length;
    const blocked = results.filter((r) => r === 'quota').length;
    expect(ok).toBe(2);
    expect(blocked).toBe(6);
    const tot = await todaysSpend(userId, day, { pool });
    // exactly two reservations of 0.07€ remain in the rollup
    expect(tot).toBeCloseTo(0.14, 6);
  });
});
