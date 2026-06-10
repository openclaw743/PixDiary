/**
 * Shared HTTP + auth helpers for integration tests.
 *
 * Each integration test file that needs a full Express stack imports
 * `startTestServer()` from here. It centralises the env setup, app build,
 * and ephemeral HTTP server bind that used to be copy-pasted across files.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import { resetConfigCache } from '../../src/config';
import { resetLoggerCache } from '../../src/log';
import { closePool, setPool } from '../../src/db/pool';
import { setBlobBackend, type BlobBackend } from '../../src/services/blob';
import type { PgHarness } from './docker';
import { makeFakeBlob } from './fakeBlob';

export interface TestServer {
  baseUrl: string;
  pool: Pool;
  /** Stop the HTTP server and detach the global pool / blob backend. */
  close(): Promise<void>;
}

export interface StartTestServerOpts {
  /** PG harness from setupTestPg(). The pool is registered as the global one. */
  pg: PgHarness;
  /** Custom blob backend; defaults to the in-memory fake. */
  blob?: BlobBackend;
  /** Extra env to set before resetting config. */
  env?: Record<string, string>;
}

/**
 * Spin up an Express app bound to an ephemeral port. Returns `baseUrl` for
 * `fetch()` and a `close()` to call from `afterAll`.
 *
 * The caller is responsible for calling `pg.cleanup()` afterwards.
 */
export async function startTestServer(opts: StartTestServerOpts): Promise<TestServer> {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = opts.pg.url;
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
  process.env.JWT_ACCESS_TTL_SECONDS = process.env.JWT_ACCESS_TTL_SECONDS ?? '900';
  process.env.JWT_REFRESH_TTL_SECONDS = process.env.JWT_REFRESH_TTL_SECONDS ?? '604800';
  process.env.BCRYPT_COST = process.env.BCRYPT_COST ?? '4';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
  // Lift rate limits high enough that test sequences don't trip them.
  process.env.RATE_LIMIT_GENERAL_PER_MIN = process.env.RATE_LIMIT_GENERAL_PER_MIN ?? '10000';
  process.env.RATE_LIMIT_UPLOADS_PER_10MIN = process.env.RATE_LIMIT_UPLOADS_PER_10MIN ?? '10000';
  process.env.RATE_LIMIT_DRAFTS_PER_HOUR = process.env.RATE_LIMIT_DRAFTS_PER_HOUR ?? '10000';
  process.env.RATE_LIMIT_REGEN_PER_DAY = process.env.RATE_LIMIT_REGEN_PER_DAY ?? '10000';
  process.env.RATE_LIMIT_AUTH_PER_MIN = process.env.RATE_LIMIT_AUTH_PER_MIN ?? '10000';
  process.env.AI_DISABLED = process.env.AI_DISABLED ?? 'true';
  process.env.AZURE_OPENAI_ENDPOINT =
    process.env.AZURE_OPENAI_ENDPOINT ?? 'https://example.invalid';
  process.env.AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY ?? 'test-key';
  process.env.AZURE_OPENAI_DEPLOYMENT_DEFAULT =
    process.env.AZURE_OPENAI_DEPLOYMENT_DEFAULT ?? 'gpt-4o-mini';
  process.env.AZURE_OPENAI_DEPLOYMENT_BETTER =
    process.env.AZURE_OPENAI_DEPLOYMENT_BETTER ?? 'gpt-4o';
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      process.env[k] = v;
    }
  }
  resetConfigCache();
  resetLoggerCache();

  setPool(opts.pg.pool);
  setBlobBackend(opts.blob ?? makeFakeBlob());

  const { buildApp } = await import('../../src/app');
  const app = buildApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    pool: opts.pg.pool,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      setBlobBackend(undefined);
      setPool(undefined);
      await closePool().catch(() => undefined);
    },
  };
}

/** Body shape returned by /auth/signup and /auth/login. */
export interface AuthResp {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; timezone: string; dailyCapEur: number };
}

/** Generic JSON `fetch()` wrapper that always returns `{ status, body }`. */
export async function api(
  baseUrl: string,
  method: string,
  apiPath: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${apiPath}`, {
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

/** Signup helper. Returns the bearer token and the new user's id/email/password. */
export async function signupTestUser(
  baseUrl: string,
  overrides: { email?: string; password?: string } = {},
): Promise<{ token: string; refreshToken: string; userId: string; email: string; password: string }> {
  const email =
    overrides.email ?? `u-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
  const password = overrides.password ?? 'a-good-password-1';
  const r = await api(baseUrl, 'POST', '/auth/signup', { email, password });
  if (r.status !== 201) {
    throw new Error(`signup failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  const body = r.body as AuthResp;
  return {
    token: body.accessToken,
    refreshToken: body.refreshToken,
    userId: body.user.id,
    email,
    password,
  };
}
