import pg from 'pg';
import type { Pool, PoolConfig } from 'pg';
import { getConfig } from '../config';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const cfg = getConfig();
    const opts: PoolConfig = {
      connectionString: cfg.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    };
    pool = new pg.Pool(opts);
  }
  return pool;
}

/** Close the pool (used by graceful shutdown and tests). */
export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}

/** Test helper: replace the pool (for integration tests that build their own). */
export function setPool(replacement: Pool | undefined): void {
  pool = replacement;
}
