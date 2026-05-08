/**
 * Shared helpers to spin up a Dockerized Postgres 16 + Azurite blob for tests.
 *
 * Each test file that needs them imports `setupTestPg()` and/or `setupAzurite()`
 * in a `beforeAll`, and tears down in `afterAll`.
 *
 * If Docker isn't reachable AND env overrides aren't set, the harness signals
 * skip via the returned `skip` flag — the calling test should `describe.skipIf`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pgLib from 'pg';
import type { Pool } from 'pg';
import { migrateUp } from '../../src/db/migrate';

const PG_IMAGE = 'postgres:16-alpine';
const AZURITE_IMAGE = 'mcr.microsoft.com/azure-storage/azurite:3.33.0';
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../database/migrations');
const AZURITE_DEFAULT_KEY =
  'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

export interface PgHarness {
  url: string;
  pool: Pool;
  cleanup: () => Promise<void>;
}

export interface AzuriteHarness {
  connStr: string;
  cleanup: () => Promise<void>;
}

export function dockerAvailable(): boolean {
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
  throw new Error(`Postgres not ready in ${timeoutMs}ms: ${(lastErr as Error)?.message}`);
}

export async function setupTestPg(): Promise<PgHarness> {
  let url: string;
  let cleanup: () => Promise<void>;
  if (process.env.PIXDIARY_TEST_DATABASE_URL) {
    url = process.env.PIXDIARY_TEST_DATABASE_URL;
    cleanup = async () => undefined;
  } else {
    const containerName = `pixdiary-test-pg-${randomUUID().slice(0, 8)}`;
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
    if (r.status !== 0) throw new Error(`docker run pg failed: ${r.stderr}`);
    url = `postgres://postgres:${password}@127.0.0.1:${port}/pixdiary`;
    try {
      await waitForPg(url, 60_000);
    } catch (err) {
      spawnSync('docker', ['rm', '-f', containerName]);
      throw err;
    }
    cleanup = async () =>
      new Promise<void>((resolve) => {
        const c = spawn('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
        c.on('exit', () => resolve());
        c.on('error', () => resolve());
      });
  }
  const pool = new pgLib.Pool({ connectionString: url });
  await migrateUp({ migrationsDir: MIGRATIONS_DIR, pool });
  return {
    url,
    pool,
    cleanup: async () => {
      await pool.end().catch(() => undefined);
      await cleanup();
    },
  };
}

export async function setupAzurite(): Promise<AzuriteHarness> {
  if (process.env.PIXDIARY_TEST_AZURITE_CONN_STRING) {
    return {
      connStr: process.env.PIXDIARY_TEST_AZURITE_CONN_STRING,
      cleanup: async () => undefined,
    };
  }
  const name = `pixdiary-test-azurite-${randomUUID().slice(0, 8)}`;
  const port = 30000 + Math.floor(Math.random() * 20000);
  const args = [
    'run',
    '--rm',
    '-d',
    '--name',
    name,
    '-p',
    `${port}:10000`,
    AZURITE_IMAGE,
    'azurite-blob',
    '--blobHost',
    '0.0.0.0',
    '--skipApiVersionCheck',
  ];
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`docker run azurite failed: ${r.stderr}`);
  const connStr =
    `DefaultEndpointsProtocol=http;` +
    `AccountName=devstoreaccount1;` +
    `AccountKey=${AZURITE_DEFAULT_KEY};` +
    `BlobEndpoint=http://127.0.0.1:${port}/devstoreaccount1;`;
  const deadline = Date.now() + 30_000;
  let ok = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/devstoreaccount1?comp=list&restype=service`,
      );
      if (res.status === 400 || res.status === 200 || res.status === 403) {
        ok = true;
        break;
      }
    } catch {
      // not ready
    }
    await delay(250);
  }
  if (!ok) {
    spawnSync('docker', ['rm', '-f', name]);
    throw new Error('Azurite did not become reachable');
  }
  return {
    connStr,
    cleanup: async () =>
      new Promise<void>((resolve) => {
        const c = spawn('docker', ['rm', '-f', name], { stdio: 'ignore' });
        c.on('exit', () => resolve());
        c.on('error', () => resolve());
      }),
  };
}
