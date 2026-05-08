/**
 * Integration test for the AI orchestrator pipeline.
 *
 * Drives the real `runEntryPipeline` against:
 *   - a real Postgres (Docker or PIXDIARY_TEST_DATABASE_URL)
 *   - an in-memory fake blob backend (returns a real EXIF-bearing JPEG)
 *   - AI_DISABLED=true so vision + draft return deterministic placeholders
 *
 * This exercises: photo loading, EXIF extraction, geocode short-circuit,
 * cost ledger reserve/record paths, and the final draft persistence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import pgLib from 'pg';
import type { Pool } from 'pg';

import { resetConfigCache } from '../../src/config';
import { resetLoggerCache } from '../../src/log';
import { closePool, setPool } from '../../src/db/pool';
import { migrateUp } from '../../src/db/migrate';
import { setBlobBackend, type BlobBackend } from '../../src/services/blob';
import { runEntryPipeline } from '../../src/services/aiOrchestrator';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../database/migrations');
const FIXTURE_JPEG = path.resolve(__dirname, '../fixtures/exif-canon-2003.jpg');
const PG_IMAGE = 'postgres:16-alpine';

interface TestPg {
  url: string;
  cleanup: () => Promise<void>;
}

function dockerAvailable(): boolean {
  if (process.env.PIXDIARY_TEST_DATABASE_URL) return false;
  const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  return r.status === 0;
}

async function waitForPg(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    const probe = new pgLib.Pool({ connectionString: url, connectionTimeoutMillis: 1000 });
    try {
      await probe.query('SELECT 1');
      await probe.end();
      return;
    } catch (err) {
      lastErr = err;
      await probe.end().catch(() => undefined);
      await delay(500);
    }
  }
  throw new Error(`Postgres did not become ready in ${timeoutMs}ms: ${(lastErr as Error)?.message}`);
}

async function startDockerPg(): Promise<TestPg> {
  const containerName = `pixdiary-orch-pg-${randomUUID().slice(0, 8)}`;
  const password = 'pixdiary-test';
  const port = 30000 + Math.floor(Math.random() * 20000);
  const args = [
    'run',
    '--rm',
    '-d',
    '--name',
    containerName,
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    'POSTGRES_DB=pixdiary',
    '-p',
    `${port}:5432`,
    PG_IMAGE,
  ];
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`docker run failed: ${r.stderr}`);
  const url = `postgres://postgres:${password}@127.0.0.1:${port}/pixdiary`;
  try {
    await waitForPg(url, 60_000);
  } catch (err) {
    spawnSync('docker', ['rm', '-f', containerName]);
    throw err;
  }
  return {
    url,
    cleanup: async () =>
      new Promise<void>((resolve) => {
        const c = spawn('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
        c.on('exit', () => resolve());
        c.on('error', () => resolve());
      }),
  };
}

function makeFakeBlob(jpegBytes: Buffer): BlobBackend {
  const present = new Set<string>();
  return {
    getContainerClient: async () => ({}) as never,
    issueUploadSas: async (blobPath: string) => {
      present.add(blobPath);
      return { url: `https://fake/${blobPath}`, expiresAt: new Date(Date.now() + 600_000) };
    },
    issueReadSas: async (blobPath: string) => ({
      url: `https://fake/${blobPath}`,
      expiresAt: new Date(Date.now() + 600_000),
    }),
    exists: async (blobPath: string) => {
      present.add(blobPath);
      return true;
    },
    remove: async () => undefined,
    download: async () => jpegBytes,
  };
}

let pg: TestPg | undefined;
let testPool: Pool | undefined;
const skip = !dockerAvailable() && !process.env.PIXDIARY_TEST_DATABASE_URL;

beforeAll(async () => {
  if (skip) return;
  if (process.env.PIXDIARY_TEST_DATABASE_URL) {
    pg = { url: process.env.PIXDIARY_TEST_DATABASE_URL, cleanup: async () => undefined };
  } else {
    pg = await startDockerPg();
  }

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = pg.url;
  process.env.JWT_SECRET = 'orch-secret-orch-secret-orch-secret-orch-secret';
  process.env.BCRYPT_COST = '4';
  process.env.LOG_LEVEL = 'silent';
  process.env.AI_DISABLED = 'true';
  delete process.env.AZURE_MAPS_KEY;
  resetConfigCache();
  resetLoggerCache();

  testPool = new pgLib.Pool({ connectionString: pg.url });
  setPool(testPool);
  setBlobBackend(makeFakeBlob(fs.readFileSync(FIXTURE_JPEG)));
  await migrateUp({ migrationsDir: MIGRATIONS_DIR, pool: testPool });
}, 180_000);

afterAll(async () => {
  setBlobBackend(undefined);
  setPool(undefined);
  await closePool().catch(() => undefined);
  if (testPool) await testPool.end().catch(() => undefined);
  if (pg) await pg.cleanup();
}, 60_000);

async function seedUserEntryWithPhoto(pool: Pool): Promise<{ userId: string; entryId: string; photoId: string }> {
  const userId = randomUUID();
  const entryId = randomUUID();
  const photoId = randomUUID();
  const email = `orch-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
  await pool.query(
    `INSERT INTO users (id, email, password_hash, timezone, daily_cap_eur)
     VALUES ($1, $2, 'unused', 'Europe/Copenhagen', 1.00)`,
    [userId, email],
  );
  await pool.query(
    `INSERT INTO photos (id, user_id, blob_path, mime_type, size_bytes, status)
     VALUES ($1, $2, $3, 'image/jpeg', 100000, 'uploaded')`,
    [photoId, userId, `users/${userId}/2025-05-08/${photoId}.jpg`],
  );
  await pool.query(
    `INSERT INTO entries (id, user_id, entry_date, status)
     VALUES ($1, $2, '2025-05-08', 'pending')`,
    [entryId, userId],
  );
  await pool.query(
    `INSERT INTO entry_photos (entry_id, photo_id, position) VALUES ($1, $2, 0)`,
    [entryId, photoId],
  );
  return { userId, entryId, photoId };
}

describe.skipIf(skip)('orchestrator: pipeline e2e (AI_DISABLED, fake blob)', () => {
  it('runs the full pipeline and writes a draft', async () => {
    const pool = testPool!;
    const { entryId } = await seedUserEntryWithPhoto(pool);

    await runEntryPipeline(entryId);

    const r = await pool.query<{
      status: string;
      draft_md: string | null;
      model_used: string | null;
    }>(`SELECT status, draft_md, model_used FROM entries WHERE id = $1`, [entryId]);
    const row = r.rows[0]!;
    expect(row.status).toBe('drafted');
    expect(row.draft_md).toContain('ai disabled');
    expect(row.model_used).toBe('gpt-4o-mini');

    // Cost ledger should have at least one rollup entry for the day.
    const usage = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ai_daily_cost`,
    );
    expect(Number(usage.rows[0]!.count)).toBeGreaterThan(0);
  }, 30_000);

  it('quality=better tier records a draft with the better model', async () => {
    const pool = testPool!;
    const { entryId } = await seedUserEntryWithPhoto(pool);
    await runEntryPipeline(entryId, { tier: 'better' });
    const r = await pool.query<{ status: string; model_used: string | null }>(
      `SELECT status, model_used FROM entries WHERE id = $1`,
      [entryId],
    );
    expect(r.rows[0]!.status).toBe('drafted');
    expect(r.rows[0]!.model_used).toBe('gpt-4o');
  }, 30_000);

  it('marks entry processing_failed when there are no photos', async () => {
    const pool = testPool!;
    const userId = randomUUID();
    const entryId = randomUUID();
    const email = `orch-empty-${Date.now()}@example.com`;
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, daily_cap_eur)
       VALUES ($1, $2, 'unused', 'UTC', 1.00)`,
      [userId, email],
    );
    await pool.query(
      `INSERT INTO entries (id, user_id, entry_date, status)
       VALUES ($1, $2, '2025-05-09', 'pending')`,
      [entryId, userId],
    );
    await runEntryPipeline(entryId);
    const r = await pool.query<{ status: string }>(
      `SELECT status FROM entries WHERE id = $1`,
      [entryId],
    );
    expect(r.rows[0]!.status).toBe('processing_failed');
  }, 15_000);

  it('returns silently when the entry id does not exist', async () => {
    await expect(runEntryPipeline(randomUUID())).resolves.toBeUndefined();
  });

  it('quota_blocked when dailyCapEur is 0 (every reservation rejects)', async () => {
    const pool = testPool!;
    const userId = randomUUID();
    const entryId = randomUUID();
    const photoId = randomUUID();
    const email = `orch-quota-${Date.now()}@example.com`;
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, daily_cap_eur)
       VALUES ($1, $2, 'unused', 'UTC', 0.10)`,
      [userId, email],
    );
    // Pre-fill rollup so reservation rejects immediately.
    await pool.query(
      `INSERT INTO ai_daily_cost (user_id, day, total_eur)
       VALUES ($1, current_date, 99.0)`,
      [userId],
    );
    await pool.query(
      `INSERT INTO photos (id, user_id, blob_path, mime_type, size_bytes, status)
       VALUES ($1, $2, $3, 'image/jpeg', 100000, 'uploaded')`,
      [photoId, userId, `users/${userId}/q/${photoId}.jpg`],
    );
    await pool.query(
      `INSERT INTO entries (id, user_id, entry_date, status)
       VALUES ($1, $2, current_date, 'pending')`,
      [entryId, userId],
    );
    await pool.query(
      `INSERT INTO entry_photos (entry_id, photo_id, position) VALUES ($1, $2, 0)`,
      [entryId, photoId],
    );
    await runEntryPipeline(entryId);
    const r = await pool.query<{ status: string }>(
      `SELECT status FROM entries WHERE id = $1`,
      [entryId],
    );
    expect(r.rows[0]!.status).toBe('quota_blocked');
  }, 15_000);
});
