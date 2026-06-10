/**
 * Account integration tests — settings, /export, DELETE /account.
 *
 * These flows are partially covered by `uploads-entries.test.ts`, but that
 * file is large and focused on the upload path. This file is the dedicated
 * surface for account-management routes, so future regressions on (for
 * example) export shape or hard-delete semantics fail in a targeted file.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import { dockerAvailable, setupTestPg, type PgHarness } from '../helpers/docker';
import { api, signupTestUser, startTestServer, type TestServer } from '../helpers/testServer';
import { makeEntry, makePhoto, makeUser } from '../factories';

const skip = !dockerAvailable() && !process.env.PIXDIARY_TEST_DATABASE_URL;

let pg: PgHarness | undefined;
let pool: Pool;
let server: TestServer | undefined;
let baseUrl = '';

beforeAll(async () => {
  if (skip) return;
  pg = await setupTestPg();
  server = await startTestServer({ pg });
  baseUrl = server.baseUrl;
  pool = pg.pool;
}, 180_000);

afterAll(async () => {
  if (server) await server.close();
  if (pg) await pg.cleanup();
}, 60_000);

interface SettingsBody {
  timezone: string;
  dailyCapEur: number;
}

describe.skipIf(skip)('GET/PUT /settings', () => {
  it('returns default settings for a fresh user', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(baseUrl, 'GET', '/settings', undefined, token);
    expect(r.status).toBe(200);
    const body = r.body as SettingsBody;
    expect(body.timezone).toBe('UTC');
    expect(body.dailyCapEur).toBeCloseTo(0.5, 2);
  });

  it('rejects unauthenticated GET /settings with 401', async () => {
    const r = await api(baseUrl, 'GET', '/settings');
    expect(r.status).toBe(401);
  });

  it('PUT /settings updates timezone + cap and persists', async () => {
    const { token } = await signupTestUser(baseUrl);
    const updated = await api(
      baseUrl,
      'PUT',
      '/settings',
      { timezone: 'Europe/Copenhagen', dailyCapEur: 1.25 },
      token,
    );
    expect(updated.status).toBe(200);
    const body = updated.body as SettingsBody;
    expect(body.timezone).toBe('Europe/Copenhagen');
    expect(body.dailyCapEur).toBeCloseTo(1.25, 2);

    const reread = await api(baseUrl, 'GET', '/settings', undefined, token);
    expect((reread.body as SettingsBody).timezone).toBe('Europe/Copenhagen');
    expect((reread.body as SettingsBody).dailyCapEur).toBeCloseTo(1.25, 2);
  });

  it('PUT /settings rejects bogus timezone', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(
      baseUrl,
      'PUT',
      '/settings',
      { timezone: 'Etc/Not-A-Zone' },
      token,
    );
    expect(r.status).toBe(400);
  });

  it('PUT /settings rejects negative cap', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(baseUrl, 'PUT', '/settings', { dailyCapEur: -1 }, token);
    expect(r.status).toBe(400);
  });
});

interface ExportBody {
  exportedAt: string;
  user: { id: string; email: string; timezone: string; dailyCapEur: number };
  entries: Array<{
    id: string;
    entryDate: string;
    status: string;
    photos: Array<{ id: string; readUrl: string }>;
  }>;
}

describe.skipIf(skip)('GET /export', () => {
  it('returns 401 unauthenticated', async () => {
    const r = await api(baseUrl, 'GET', '/export');
    expect(r.status).toBe(401);
  });

  it('returns just the empty shell for a brand-new user', async () => {
    const { token, userId, email } = await signupTestUser(baseUrl);
    const r = await api(baseUrl, 'GET', '/export', undefined, token);
    expect(r.status).toBe(200);
    const body = r.body as ExportBody;
    expect(body.user.id).toBe(userId);
    expect(body.user.email).toBe(email);
    expect(body.entries).toEqual([]);
    expect(typeof body.exportedAt).toBe('string');
  });

  it('includes seeded entries + photos with signed read URLs', async () => {
    // Use a factory user (skip the HTTP signup since we want to seed direct).
    const u = await makeUser(pool);
    const p1 = await makePhoto(pool, { userId: u.id });
    const p2 = await makePhoto(pool, { userId: u.id });
    const e1 = await makeEntry(pool, {
      userId: u.id,
      entryDate: '2025-04-01',
      status: 'saved',
      finalMd: 'Hello world',
      photoIds: [p1.id, p2.id],
    });
    const e2 = await makeEntry(pool, {
      userId: u.id,
      entryDate: '2025-05-08',
      status: 'drafted',
      draftMd: 'draft body',
      photoIds: [],
    });
    // Log this user in via the HTTP path so we exercise the real token path.
    const login = await api(baseUrl, 'POST', '/auth/login', {
      email: u.email,
      password: u.password,
    });
    expect(login.status).toBe(200);
    const token = (login.body as { accessToken: string }).accessToken;

    const r = await api(baseUrl, 'GET', '/export', undefined, token);
    expect(r.status).toBe(200);
    const body = r.body as ExportBody;
    expect(body.entries).toHaveLength(2);
    // entries are sorted ASCENDING by entry_date.
    expect(body.entries[0]?.id).toBe(e1.id);
    expect(body.entries[1]?.id).toBe(e2.id);
    expect(body.entries[0]?.photos).toHaveLength(2);
    expect(body.entries[0]?.photos[0]?.readUrl).toMatch(/^https?:\/\//);
    expect(body.entries[1]?.photos).toHaveLength(0);
  });

  it('emits content-disposition for download', async () => {
    const { token } = await signupTestUser(baseUrl);
    const res = await fetch(`${baseUrl}/export`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toMatch(/attachment/);
    expect(cd).toMatch(/pixdiary-export-\d{4}-\d{2}-\d{2}\.json/);
  });
});

describe.skipIf(skip)('DELETE /account', () => {
  it('401 unauthenticated', async () => {
    const r = await api(baseUrl, 'DELETE', '/account', {
      password: 'x',
      confirm: 'DELETE MY ACCOUNT',
    });
    expect(r.status).toBe(401);
  });

  it('400 if password is wrong but confirm string is right', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(
      baseUrl,
      'DELETE',
      '/account',
      { password: 'definitely-wrong', confirm: 'DELETE MY ACCOUNT' },
      token,
    );
    // The route rejects with 401 for invalid password (consistent with auth errors).
    expect(r.status).toBe(401);
  });

  it('400 if confirm string is wrong even with correct password', async () => {
    const { token, password } = await signupTestUser(baseUrl);
    const r = await api(
      baseUrl,
      'DELETE',
      '/account',
      { password, confirm: 'delete' },
      token,
    );
    expect(r.status).toBe(400);
  });

  it('200 and account is gone; subsequent /me returns 401', async () => {
    const { token, userId, password } = await signupTestUser(baseUrl);
    const r = await api(
      baseUrl,
      'DELETE',
      '/account',
      { password, confirm: 'DELETE MY ACCOUNT' },
      token,
    );
    // Route uses 204 No Content on success (HTTP convention).
    expect(r.status).toBe(204);

    // /me must now reject the token (user row gone).
    const me = await api(baseUrl, 'GET', '/me', undefined, token);
    expect(me.status).toBe(401);

    // DB-level: no row left for that user.
    const row = await pool.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
    expect(row.rowCount).toBe(0);
  });

  it('cascades to entries + photos + refresh_tokens', async () => {
    const u = await makeUser(pool);
    const p1 = await makePhoto(pool, { userId: u.id });
    await makeEntry(pool, { userId: u.id, photoIds: [p1.id] });
    // Real refresh token via /auth/login.
    const login = await api(baseUrl, 'POST', '/auth/login', {
      email: u.email,
      password: u.password,
    });
    expect(login.status).toBe(200);
    const { accessToken } = login.body as { accessToken: string };

    const r = await api(
      baseUrl,
      'DELETE',
      '/account',
      { password: u.password, confirm: 'DELETE MY ACCOUNT' },
      accessToken,
    );
    expect(r.status).toBe(204);

    const remaining = await pool.query<{ kind: string; n: number }>(
      `SELECT 'users' AS kind, count(*)::int AS n FROM users WHERE id = $1
       UNION ALL SELECT 'entries', count(*)::int FROM entries WHERE user_id = $1
       UNION ALL SELECT 'photos', count(*)::int FROM photos WHERE user_id = $1
       UNION ALL SELECT 'refresh_tokens', count(*)::int FROM refresh_tokens WHERE user_id = $1`,
      [u.id],
    );
    for (const row of remaining.rows) {
      expect({ table: row.kind, n: row.n }).toEqual({ table: row.kind, n: 0 });
    }
  });
});

// Silence the linter on test-only imports.
void randomUUID;
