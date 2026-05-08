/**
 * Migration runner.
 *
 * Reads SQL files from `database/migrations/` (relative to the repo root) and
 * applies them in order. Tracks applied migrations in a `schema_migrations`
 * table.
 *
 * CLI:
 *   npm run migrate:up                       # apply all pending up migrations
 *   npm run migrate:down                     # roll back the most recent migration
 *   npm run migrate:down -- --steps 2        # roll back N migrations
 *
 * Naming: NNNN_name.up.sql / NNNN_name.down.sql, both lowercase, NNNN zero-padded.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import type { Pool } from 'pg';
import { getConfig } from '../config';

/**
 * Migrations live in `<repo>/database/migrations/`. The default below assumes
 * the runner is invoked from the `backend/` directory (which is what the npm
 * scripts do). For programmatic callers (tests), pass `migrationsDir` explicitly.
 */
const DEFAULT_MIGRATIONS_DIR = path.resolve(process.cwd(), '../database/migrations');

interface MigrationFile {
  version: string;
  name: string;
  upPath: string;
  downPath: string;
}

export interface MigrateOptions {
  migrationsDir?: string;
  pool?: Pool;
  /** For `down`: how many applied migrations to roll back (default 1). */
  steps?: number;
}

const FILE_RE = /^(\d{4,})_(.+)\.(up|down)\.sql$/;

async function discoverMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const grouped = new Map<string, { name: string; up?: string; down?: string }>();
  for (const entry of entries) {
    const m = entry.match(FILE_RE);
    if (!m) continue;
    const [, version, name, dir2] = m;
    if (!version || !name || !dir2) continue;
    const cur = grouped.get(version) ?? { name };
    if (dir2 === 'up') cur.up = path.join(dir, entry);
    else cur.down = path.join(dir, entry);
    cur.name = name;
    grouped.set(version, cur);
  }
  const out: MigrationFile[] = [];
  for (const [version, v] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!v.up || !v.down) {
      throw new Error(
        `Migration ${version}_${v.name} is missing ${!v.up ? 'an up' : 'a down'} script`,
      );
    }
    out.push({ version, name: v.name, upPath: v.up, downPath: v.down });
  }
  return out;
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedVersions(pool: Pool): Promise<string[]> {
  const r = await pool.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC',
  );
  return r.rows.map((row) => row.version);
}

export async function migrateUp(opts: MigrateOptions = {}): Promise<string[]> {
  const dir = opts.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const pool = opts.pool ?? new pg.Pool({ connectionString: getConfig().DATABASE_URL });
  const closeAfter = !opts.pool;
  const applied: string[] = [];
  try {
    await ensureMigrationsTable(pool);
    const migrations = await discoverMigrations(dir);
    const already = new Set(await appliedVersions(pool));
    for (const m of migrations) {
      if (already.has(m.version)) continue;
      const sql = await readFile(m.upPath, 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [m.version, m.name],
        );
        await client.query('COMMIT');
        applied.push(`${m.version}_${m.name}`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${m.version}_${m.name} (up) failed: ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }
    return applied;
  } finally {
    if (closeAfter) await pool.end();
  }
}

export async function migrateDown(opts: MigrateOptions = {}): Promise<string[]> {
  const dir = opts.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const steps = Math.max(1, opts.steps ?? 1);
  const pool = opts.pool ?? new pg.Pool({ connectionString: getConfig().DATABASE_URL });
  const closeAfter = !opts.pool;
  const reverted: string[] = [];
  try {
    await ensureMigrationsTable(pool);
    const migrations = await discoverMigrations(dir);
    const byVersion = new Map(migrations.map((m) => [m.version, m]));
    const applied = await appliedVersions(pool);
    const toRevert = applied.slice(-steps).reverse();
    for (const version of toRevert) {
      const m = byVersion.get(version);
      if (!m) {
        throw new Error(`No down script found for applied migration ${version}`);
      }
      const sql = await readFile(m.downPath, 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
        await client.query('COMMIT');
        reverted.push(`${m.version}_${m.name}`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${m.version}_${m.name} (down) failed: ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }
    return reverted;
  } finally {
    if (closeAfter) await pool.end();
  }
}

/* c8 ignore start */
async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'up' && cmd !== 'down') {
    // eslint-disable-next-line no-console
    console.error('Usage: migrate.ts <up|down> [--steps N]');
    process.exit(2);
  }
  const stepsIdx = rest.indexOf('--steps');
  const steps = stepsIdx >= 0 ? Number(rest[stepsIdx + 1] ?? '1') : 1;
  try {
    if (cmd === 'up') {
      const applied = await migrateUp();
      // eslint-disable-next-line no-console
      console.error(applied.length ? `Applied:\n  ${applied.join('\n  ')}` : 'No pending migrations.');
    } else {
      const reverted = await migrateDown({ steps });
      // eslint-disable-next-line no-console
      console.error(reverted.length ? `Reverted:\n  ${reverted.join('\n  ')}` : 'Nothing to revert.');
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error((err as Error).message);
    process.exit(1);
  }
}

// Run only when invoked directly (npm run migrate:up / migrate:down).
// Programmatic callers (tests) import migrateUp/migrateDown without arguments,
// so a missing first argv positional means "do not auto-run".
if (process.argv.slice(2).some((a) => a === 'up' || a === 'down')) {
  void main();
}
/* c8 ignore stop */
