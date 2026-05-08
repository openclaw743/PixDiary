/**
 * Integration test for the full auth flow against a real Postgres 16 instance.
 *
 * Requires Docker on the host. The test spawns a fresh `postgres:16-alpine`
 * container on a random port, waits for readiness, runs the migrations, and
 * exercises signup → login → refresh → /me → logout.
 *
 * If Docker is unavailable, set `PIXDIARY_TEST_DATABASE_URL` to point at a
 * pre-provisioned Postgres 16 instance (e.g. a host install) and the test will
 * use that instead.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pgLib from 'pg';
import type { Pool } from 'pg';

import { resetConfigCache } from '../../src/config';
import { resetLoggerCache } from '../../src/log';
import { closePool, setPool } from '../../src/db/pool';
import { migrateUp } from '../../src/db/migrate';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../database/migrations');
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
  throw new Error(
    `Postgres did not become ready in ${timeoutMs}ms: ${(lastErr as Error)?.message}`,
  );
}

async function startDockerPg(): Promise<TestPg> {
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
  if (r.status !== 0) {
    throw new Error(`docker run failed: ${r.stderr}`);
  }
  const url = `postgres://postgres:${password}@127.0.0.1:${port}/pixdiary`;
  try {
    await waitForPg(url, 60_000);
  } catch (err) {
    spawnSync('docker', ['rm', '-f', containerName]);
    throw err;
  }
  const cleanup = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      const c = spawn('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
      c.on('exit', () => resolve());
      c.on('error', () => resolve());
    });
  };
  return { url, cleanup };
}

let pg: TestPg | undefined;
let server: Server | undefined;
let baseUrl = '';
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
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
  process.env.JWT_ACCESS_TTL_SECONDS = '900';
  process.env.JWT_REFRESH_TTL_SECONDS = '604800';
  process.env.BCRYPT_COST = '4';
  process.env.LOG_LEVEL = 'silent';
  resetConfigCache();
  resetLoggerCache();

  testPool = new pgLib.Pool({ connectionString: pg.url });
  setPool(testPool);

  await migrateUp({ migrationsDir: MIGRATIONS_DIR, pool: testPool });

  // Build the app AFTER env + pool are wired.
  const { buildApp } = await import('../../src/app');
  const app = buildApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}, 180_000);

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  setPool(undefined);
  await closePool().catch(() => undefined);
  if (testPool) await testPool.end().catch(() => undefined);
  if (pg) await pg.cleanup();
}, 60_000);

interface AuthResp {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{
  status: number;
  body: unknown;
}> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

describe.skipIf(skip)('integration: auth flow', () => {
  it('healthz returns 200 always; readyz returns 200 with DB up', async () => {
    const h = await api('GET', '/healthz');
    expect(h.status).toBe(200);
    const r = await api('GET', '/readyz');
    expect(r.status).toBe(200);
  });

  it('signup → login → /me → refresh → logout', async () => {
    const email = `user-${Date.now()}@example.com`;
    const password = 'a-good-password-1';

    // signup
    const s = await api('POST', '/auth/signup', { email, password });
    expect(s.status).toBe(201);
    const signupBody = s.body as AuthResp;
    expect(signupBody.accessToken).toBeTruthy();
    expect(signupBody.refreshToken).toBeTruthy();
    expect(signupBody.user.email).toBe(email);

    // duplicate signup should 409
    const dup = await api('POST', '/auth/signup', { email, password });
    expect(dup.status).toBe(409);

    // login
    const li = await api('POST', '/auth/login', { email, password });
    expect(li.status).toBe(200);
    const loginBody = li.body as AuthResp;
    expect(loginBody.accessToken).toBeTruthy();

    // /me with access token
    const me = await api('GET', '/me', undefined, loginBody.accessToken);
    expect(me.status).toBe(200);
    expect((me.body as { email: string }).email).toBe(email);

    // /me without token → 401
    const noAuth = await api('GET', '/me');
    expect(noAuth.status).toBe(401);

    // refresh
    const rf = await api('POST', '/auth/refresh', { refreshToken: loginBody.refreshToken });
    expect(rf.status).toBe(200);
    const newPair = rf.body as { accessToken: string; refreshToken: string };
    expect(newPair.accessToken).toBeTruthy();
    expect(newPair.refreshToken).toBeTruthy();
    expect(newPair.refreshToken).not.toBe(loginBody.refreshToken);

    // reusing the old refresh token must fail (single-use)
    const reuse = await api('POST', '/auth/refresh', { refreshToken: loginBody.refreshToken });
    expect(reuse.status).toBe(401);

    // logout the new refresh token
    const out = await api('POST', '/auth/logout', { refreshToken: newPair.refreshToken });
    expect(out.status).toBe(204);

    // refresh after logout should fail
    const after = await api('POST', '/auth/refresh', { refreshToken: newPair.refreshToken });
    expect(after.status).toBe(401);
  });

  it('login with wrong password returns 401', async () => {
    const email = `wrong-${Date.now()}@example.com`;
    await api('POST', '/auth/signup', { email, password: 'a-good-password-1' });
    const r = await api('POST', '/auth/login', { email, password: 'totally-wrong-pwd' });
    expect(r.status).toBe(401);
  });

  it('signup validation rejects short passwords', async () => {
    const r = await api('POST', '/auth/signup', { email: 'x@example.com', password: 'short' });
    expect(r.status).toBe(400);
    expect((r.body as { error: { code: string } }).error.code).toBe('validation_failed');
  });

  it('returns 404 with envelope for unknown routes', async () => {
    const r = await api('GET', '/does-not-exist');
    expect(r.status).toBe(404);
    expect((r.body as { error: { code: string } }).error.code).toBe('not_found');
  });
});
