/**
 * AI cost ledger.
 *
 * Two tables:
 *   - `ai_usage_ledger` — append-only audit log per call.
 *   - `ai_daily_cost`   — pre-aggregated rollup, hot path for the pre-call gate.
 *
 * Pricing constants (€/M tokens, May 2026 list — see ARCHITECTURE.md "Decisions
 * log"). When you change a price, also update the test that pins the math.
 */
import type { Pool, PoolClient } from 'pg';
import { QuotaExceededError } from '../errors';
import { getPool } from '../db/pool';

export interface ModelPricing {
  inputEurPerMTok: number;
  outputEurPerMTok: number;
}

export const PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': { inputEurPerMTok: 0.14, outputEurPerMTok: 0.55 },
  'gpt-4o': { inputEurPerMTok: 2.3, outputEurPerMTok: 9.2 },
};

export type AiPurpose = 'vision' | 'draft' | 'regenerate';

export interface DebitArgs {
  userId: string;
  entryId: string | null;
  purpose: AiPurpose;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** User's local day (YYYY-MM-DD). Caller computes from user's tz. */
  day: string;
  /** User's daily cap (€). Used for the post-debit cap check. */
  dailyCapEur: number;
}

export interface DebitResult {
  costEur: number;
  newDailyTotalEur: number;
}

/**
 * Calculate the € cost of a model call.
 * Returns 0 if model is unknown (we still log it; never throw on unknown model).
 */
export function estimateCostEur(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (
    (Math.max(0, tokensIn) * p.inputEurPerMTok + Math.max(0, tokensOut) * p.outputEurPerMTok) /
    1_000_000
  );
}

interface ServiceDeps {
  pool?: Pool;
}

function poolOf(deps?: ServiceDeps): Pool {
  return deps?.pool ?? getPool();
}

/**
 * Pre-call gate. Reserves the *estimated* cost atomically in `ai_daily_cost`
 * and the post-update total. If that total would exceed the user's cap, the
 * tx is rolled back and `QuotaExceededError` is thrown — the AI call must NOT
 * happen.
 *
 * Use-pattern:
 *   await reserveBudget({ ... estimatedTokensIn, estimatedTokensOut ... });
 *   const result = await callTheModel(...);
 *   await recordUsage({ ... actualTokensIn, actualTokensOut ... });
 *
 * `reserveBudget` debits the *estimated* cost.
 * `recordUsage` adjusts the rollup by `(actual - estimate)` (delta), so the
 * daily total is always exact and the quota check always uses real data when
 * it matters most (under load / at the edge of the cap).
 */
export async function reserveBudget(
  args: Omit<DebitArgs, 'tokensIn' | 'tokensOut'> & {
    estimatedTokensIn: number;
    estimatedTokensOut: number;
  },
  deps?: ServiceDeps,
): Promise<{ reservedEur: number; newDailyTotalEur: number }> {
  const pool = poolOf(deps);
  const reservedEur = estimateCostEur(
    args.model,
    args.estimatedTokensIn,
    args.estimatedTokensOut,
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Atomic upsert + RETURNING — single statement, isolation-safe.
    const r = await client.query<{ total_eur: string }>(
      `INSERT INTO ai_daily_cost (user_id, day, total_eur, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, day)
       DO UPDATE SET total_eur = ai_daily_cost.total_eur + EXCLUDED.total_eur,
                     updated_at = now()
       RETURNING total_eur`,
      [args.userId, args.day, reservedEur],
    );
    const newTotal = Number(r.rows[0]?.total_eur ?? '0');
    if (newTotal > args.dailyCapEur) {
      await client.query('ROLLBACK');
      throw new QuotaExceededError(
        `Daily AI quota exceeded (cap €${args.dailyCapEur.toFixed(2)})`,
        { cap: args.dailyCapEur, attempted: newTotal },
      );
    }
    await client.query('COMMIT');
    return { reservedEur, newDailyTotalEur: newTotal };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Record actual usage after a model call. Inserts a ledger row and adjusts
 * the daily rollup by `(actualCost - reservedCost)` — which may be negative.
 */
export async function recordUsage(
  args: DebitArgs & { reservedEur: number },
  deps?: ServiceDeps,
): Promise<DebitResult> {
  const pool = poolOf(deps);
  const actualEur = estimateCostEur(args.model, args.tokensIn, args.tokensOut);
  const delta = actualEur - args.reservedEur;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO ai_usage_ledger
         (user_id, entry_id, purpose, model, tokens_in, tokens_out, cost_eur)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        args.userId,
        args.entryId,
        args.purpose,
        args.model,
        args.tokensIn,
        args.tokensOut,
        actualEur,
      ],
    );
    let newTotal = 0;
    if (delta !== 0) {
      const r = await client.query<{ total_eur: string }>(
        `INSERT INTO ai_daily_cost (user_id, day, total_eur, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id, day)
         DO UPDATE SET total_eur = ai_daily_cost.total_eur + EXCLUDED.total_eur,
                       updated_at = now()
         RETURNING total_eur`,
        [args.userId, args.day, delta],
      );
      newTotal = Number(r.rows[0]?.total_eur ?? '0');
    } else {
      const r = await client.query<{ total_eur: string }>(
        `SELECT total_eur FROM ai_daily_cost WHERE user_id = $1 AND day = $2`,
        [args.userId, args.day],
      );
      newTotal = Number(r.rows[0]?.total_eur ?? '0');
    }
    await client.query('COMMIT');
    return { costEur: actualEur, newDailyTotalEur: newTotal };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Refund a previously reserved budget when the AI call fails before it
 * actually consumed tokens. This is the cleanup path after a thrown call.
 */
export async function refundReservation(
  args: { userId: string; day: string; reservedEur: number },
  deps?: ServiceDeps,
): Promise<void> {
  if (args.reservedEur <= 0) return;
  const pool = poolOf(deps);
  await pool.query(
    `UPDATE ai_daily_cost
     SET total_eur = GREATEST(0, total_eur - $3), updated_at = now()
     WHERE user_id = $1 AND day = $2`,
    [args.userId, args.day, args.reservedEur],
  );
}

/** Return today's spend for a user. Used by tests. */
export async function todaysSpend(
  userId: string,
  day: string,
  deps?: ServiceDeps,
): Promise<number> {
  const pool = poolOf(deps);
  const r = await pool.query<{ total_eur: string }>(
    `SELECT total_eur FROM ai_daily_cost WHERE user_id = $1 AND day = $2`,
    [userId, day],
  );
  return Number(r.rows[0]?.total_eur ?? '0');
}

/** Compute the user's local-tz date as YYYY-MM-DD. */
export function todayInTz(now: Date, tz: string): string {
  // Intl.DateTimeFormat with a calendar-day formatter, en-CA → ISO YYYY-MM-DD.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

/* c8 ignore start */
/** Convenience: run reserveBudget → fn → recordUsage with refund-on-throw. */
export async function callWithBudget<T>(
  args: {
    userId: string;
    entryId: string | null;
    purpose: AiPurpose;
    model: string;
    day: string;
    dailyCapEur: number;
    estimatedTokensIn: number;
    estimatedTokensOut: number;
  },
  fn: (client: PoolClient | null) => Promise<{ result: T; tokensIn: number; tokensOut: number }>,
  deps?: ServiceDeps,
): Promise<{ result: T; costEur: number }> {
  const reservation = await reserveBudget(args, deps);
  try {
    const out = await fn(null);
    const usage = await recordUsage(
      {
        userId: args.userId,
        entryId: args.entryId,
        purpose: args.purpose,
        model: args.model,
        tokensIn: out.tokensIn,
        tokensOut: out.tokensOut,
        day: args.day,
        dailyCapEur: args.dailyCapEur,
        reservedEur: reservation.reservedEur,
      },
      deps,
    );
    return { result: out.result, costEur: usage.costEur };
  } catch (err) {
    await refundReservation(
      { userId: args.userId, day: args.day, reservedEur: reservation.reservedEur },
      deps,
    ).catch(() => undefined);
    throw err;
  }
}
/* c8 ignore stop */
