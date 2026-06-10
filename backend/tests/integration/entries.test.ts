/**
 * Focused integration tests for the /entries routes (list, get, save, delete,
 * regenerate). The orchestrator pipeline is mocked at the module boundary so
 * these tests run without Azure OpenAI credentials.
 *
 * The full happy-path (upload → draft → poll → save) lives in
 * `uploads-entries.test.ts`. This file targets the edge cases and
 * cross-tenant isolation, which deserve their own dedicated suite.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import { dockerAvailable, setupTestPg, type PgHarness } from '../helpers/docker';
import { api, signupTestUser, startTestServer, type TestServer } from '../helpers/testServer';
import { makeEntry, makePhoto, makeUser } from '../factories';

// Mock the orchestrator so POST /entries/draft doesn't fan out to Azure.
vi.mock('../../src/services/aiOrchestrator', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/services/aiOrchestrator')>(
      '../../src/services/aiOrchestrator',
    );
  return {
    ...actual,
    startEntryPipeline: vi.fn(async (entryId: string) => {
      const { getPool } = await import('../../src/db/pool');
      await getPool().query(
        `UPDATE entries SET status = 'drafted', draft_md = $2 WHERE id = $1`,
        [entryId, '# Mocked\n\nbody'],
      );
    }),
  };
});

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

describe.skipIf(skip)('GET /entries (list)', () => {
  it('401 unauthenticated', async () => {
    const r = await api(baseUrl, 'GET', '/entries');
    expect(r.status).toBe(401);
  });

  it('returns empty list for a brand-new user', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(baseUrl, 'GET', '/entries', undefined, token);
    expect(r.status).toBe(200);
    const body = r.body as { items: unknown[]; nextCursor: string | null };
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('returns entries in descending entry_date order', async () => {
    const u = await makeUser(pool);
    await makeEntry(pool, { userId: u.id, entryDate: '2025-04-01', status: 'saved' });
    await makeEntry(pool, { userId: u.id, entryDate: '2025-05-08', status: 'drafted' });
    await makeEntry(pool, { userId: u.id, entryDate: '2025-03-15', status: 'saved' });
    const login = await api(baseUrl, 'POST', '/auth/login', {
      email: u.email,
      password: u.password,
    });
    const token = (login.body as { accessToken: string }).accessToken;
    const r = await api(baseUrl, 'GET', '/entries', undefined, token);
    expect(r.status).toBe(200);
    const body = r.body as { items: Array<{ entryDate: string }> };
    expect(body.items.map((x) => x.entryDate)).toEqual(['2025-05-08', '2025-04-01', '2025-03-15']);
  });

  it('respects the limit param', async () => {
    const u = await makeUser(pool);
    for (let i = 0; i < 5; i++) {
      await makeEntry(pool, {
        userId: u.id,
        entryDate: `2025-04-${String(i + 1).padStart(2, '0')}`,
        status: 'saved',
      });
    }
    const login = await api(baseUrl, 'POST', '/auth/login', {
      email: u.email,
      password: u.password,
    });
    const token = (login.body as { accessToken: string }).accessToken;
    const r = await api(baseUrl, 'GET', '/entries?limit=2', undefined, token);
    expect(r.status).toBe(200);
    const body = r.body as { items: unknown[]; nextCursor: string | null };
    expect(body.items.length).toBe(2);
    expect(body.nextCursor).not.toBeNull();
  });

  it('400 if limit is not an integer', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(baseUrl, 'GET', '/entries?limit=abc', undefined, token);
    expect(r.status).toBe(400);
  });

  it('400 if from is not YYYY-MM-DD', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(baseUrl, 'GET', '/entries?from=yesterday', undefined, token);
    expect(r.status).toBe(400);
  });
});

describe.skipIf(skip)('GET /entries/:id', () => {
  it('401 unauthenticated', async () => {
    const r = await api(baseUrl, 'GET', '/entries/00000000-0000-0000-0000-000000000000');
    expect(r.status).toBe(401);
  });

  it('400 on non-uuid id', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(baseUrl, 'GET', '/entries/not-a-uuid', undefined, token);
    expect(r.status).toBe(400);
  });

  it('404 on a uuid that does not exist', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(
      baseUrl,
      'GET',
      '/entries/11111111-1111-1111-1111-111111111111',
      undefined,
      token,
    );
    expect(r.status).toBe(404);
  });

  it('404 on an entry owned by a different user (no cross-tenant leakage)', async () => {
    const owner = await makeUser(pool);
    const e = await makeEntry(pool, { userId: owner.id });
    const { token } = await signupTestUser(baseUrl);
    const r = await api(baseUrl, 'GET', `/entries/${e.id}`, undefined, token);
    expect(r.status).toBe(404);
  });

  it('200 with the expected shape for the owner', async () => {
    const u = await makeUser(pool);
    const photo = await makePhoto(pool, { userId: u.id });
    const e = await makeEntry(pool, {
      userId: u.id,
      entryDate: '2025-05-08',
      status: 'drafted',
      draftMd: 'body',
      photoIds: [photo.id],
    });
    const login = await api(baseUrl, 'POST', '/auth/login', {
      email: u.email,
      password: u.password,
    });
    const token = (login.body as { accessToken: string }).accessToken;
    const r = await api(baseUrl, 'GET', `/entries/${e.id}`, undefined, token);
    expect(r.status).toBe(200);
    const body = r.body as {
      id: string;
      entryDate: string;
      status: string;
      draftText: string | null;
      photos: Array<{ id: string; readUrl: string }>;
    };
    expect(body.id).toBe(e.id);
    expect(body.entryDate).toBe('2025-05-08');
    expect(body.status).toBe('drafted');
    expect(body.draftText).toBe('body');
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0]!.id).toBe(photo.id);
  });
});

describe.skipIf(skip)('PUT /entries/:id (save)', () => {
  it('400 on empty text', async () => {
    const u = await makeUser(pool);
    const e = await makeEntry(pool, { userId: u.id });
    const login = await api(baseUrl, 'POST', '/auth/login', {
      email: u.email,
      password: u.password,
    });
    const token = (login.body as { accessToken: string }).accessToken;
    const r = await api(baseUrl, 'PUT', `/entries/${e.id}`, { text: '' }, token);
    expect(r.status).toBe(400);
  });

  it('400 on text > 5000 chars', async () => {
    const u = await makeUser(pool);
    const e = await makeEntry(pool, { userId: u.id });
    const login = await api(baseUrl, 'POST', '/auth/login', {
      email: u.email,
      password: u.password,
    });
    const token = (login.body as { accessToken: string }).accessToken;
    const r = await api(
      baseUrl,
      'PUT',
      `/entries/${e.id}`,
      { text: 'x'.repeat(5001) },
      token,
    );
    expect(r.status).toBe(400);
  });

  it('404 if the entry is owned by a different user', async () => {
    const owner = await makeUser(pool);
    const e = await makeEntry(pool, { userId: owner.id });
    const { token } = await signupTestUser(baseUrl);
    const r = await api(
      baseUrl,
      'PUT',
      `/entries/${e.id}`,
      { text: 'mine now' },
      token,
    );
    expect(r.status).toBe(404);
  });

  it('200 and the entry flips status to "saved" with the new text', async () => {
    const u = await makeUser(pool);
    const e = await makeEntry(pool, { userId: u.id, status: 'drafted', draftMd: 'old' });
    const login = await api(baseUrl, 'POST', '/auth/login', {
      email: u.email,
      password: u.password,
    });
    const token = (login.body as { accessToken: string }).accessToken;
    const r = await api(
      baseUrl,
      'PUT',
      `/entries/${e.id}`,
      { text: 'this is the saved text' },
      token,
    );
    expect(r.status).toBe(200);
    const body = r.body as { status: string; finalText: string };
    expect(body.status).toBe('saved');
    expect(body.finalText).toBe('this is the saved text');
  });
});

describe.skipIf(skip)('DELETE /entries/:id (soft delete)', () => {
  it('204 on owner, entry is soft-deleted (list no longer shows it)', async () => {
    const u = await makeUser(pool);
    const e = await makeEntry(pool, { userId: u.id, entryDate: '2025-05-08', status: 'saved' });
    const login = await api(baseUrl, 'POST', '/auth/login', {
      email: u.email,
      password: u.password,
    });
    const token = (login.body as { accessToken: string }).accessToken;

    const del = await api(baseUrl, 'DELETE', `/entries/${e.id}`, undefined, token);
    expect(del.status).toBe(204);

    // List excludes soft-deleted.
    const list = await api(baseUrl, 'GET', '/entries', undefined, token);
    const items = (list.body as { items: Array<{ id: string }> }).items;
    expect(items.find((x) => x.id === e.id)).toBeUndefined();

    // DB-level: deleted_at IS NOT NULL.
    const row = await pool.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM entries WHERE id = $1`,
      [e.id],
    );
    expect(row.rows[0]!.deleted_at).not.toBeNull();
  });

  it('404 when deleting another user\'s entry', async () => {
    const owner = await makeUser(pool);
    const e = await makeEntry(pool, { userId: owner.id });
    const { token } = await signupTestUser(baseUrl);
    const r = await api(baseUrl, 'DELETE', `/entries/${e.id}`, undefined, token);
    expect(r.status).toBe(404);
  });
});

describe.skipIf(skip)('POST /entries/draft', () => {
  it('400 if entryDate is missing', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(baseUrl, 'POST', '/entries/draft', { photoIds: [] }, token);
    expect(r.status).toBe(400);
  });

  it('400 if photoIds is empty', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(
      baseUrl,
      'POST',
      '/entries/draft',
      { entryDate: '2025-05-08', photoIds: [] },
      token,
    );
    expect(r.status).toBe(400);
  });

  it('400 if a photoId is not a uuid', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(
      baseUrl,
      'POST',
      '/entries/draft',
      { entryDate: '2025-05-08', photoIds: ['not-a-uuid'] },
      token,
    );
    expect(r.status).toBe(400);
  });

  it('400 with more than 25 photo ids', async () => {
    const { token } = await signupTestUser(baseUrl);
    const ids = Array.from(
      { length: 26 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );
    const r = await api(
      baseUrl,
      'POST',
      '/entries/draft',
      { entryDate: '2025-05-08', photoIds: ids },
      token,
    );
    expect(r.status).toBe(400);
  });

  it('404/400 if photoIds reference photos owned by someone else', async () => {
    const owner = await makeUser(pool);
    const p = await makePhoto(pool, { userId: owner.id });
    const { token } = await signupTestUser(baseUrl);
    const r = await api(
      baseUrl,
      'POST',
      '/entries/draft',
      { entryDate: '2025-05-08', photoIds: [p.id] },
      token,
    );
    // The service rejects cross-user photo attachment.
    expect([400, 403, 404]).toContain(r.status);
  });
});
