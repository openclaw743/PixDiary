/**
 * Focused integration tests for the /uploads route.
 *
 * `uploads-entries.test.ts` already exercises the upload → draft → save happy
 * path. This file targets the *route's* edge cases (validation, auth, size
 * cap, unsupported types) where regressions would be silent in a happy-path
 * test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { dockerAvailable, setupTestPg, type PgHarness } from '../helpers/docker';
import { api, signupTestUser, startTestServer, type TestServer } from '../helpers/testServer';

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

const TWENTY_FIVE_MB = 25 * 1024 * 1024;

function validItem(overrides: Partial<{ filename: string; mimeType: string; sizeBytes: number }> = {}) {
  return {
    filename: 'photo.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024 * 1024,
    ...overrides,
  };
}

describe.skipIf(skip)('POST /uploads — auth', () => {
  it('401 without bearer token', async () => {
    const r = await api(baseUrl, 'POST', '/uploads', {
      entryDate: '2025-05-08',
      items: [validItem()],
    });
    expect(r.status).toBe(401);
  });

  it('401 with garbage token', async () => {
    const r = await api(
      baseUrl,
      'POST',
      '/uploads',
      { entryDate: '2025-05-08', items: [validItem()] },
      'not-a-real-token',
    );
    expect(r.status).toBe(401);
  });
});

describe.skipIf(skip)('POST /uploads — body validation', () => {
  it('400 if entryDate is missing', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(
      baseUrl,
      'POST',
      '/uploads',
      { items: [validItem()] },
      token,
    );
    expect(r.status).toBe(400);
  });

  it('400 if entryDate is not YYYY-MM-DD', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(
      baseUrl,
      'POST',
      '/uploads',
      { entryDate: '08/05/2025', items: [validItem()] },
      token,
    );
    expect(r.status).toBe(400);
  });

  it('400 if items is empty', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(
      baseUrl,
      'POST',
      '/uploads',
      { entryDate: '2025-05-08', items: [] },
      token,
    );
    expect(r.status).toBe(400);
  });

  it('400 if items has more than 25 entries', async () => {
    const { token } = await signupTestUser(baseUrl);
    const items = Array.from({ length: 26 }, (_, i) =>
      validItem({ filename: `p${i}.jpg` }),
    );
    const r = await api(
      baseUrl,
      'POST',
      '/uploads',
      { entryDate: '2025-05-08', items },
      token,
    );
    expect(r.status).toBe(400);
  });

  it('400 if mimeType is not one of the supported image types', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(
      baseUrl,
      'POST',
      '/uploads',
      {
        entryDate: '2025-05-08',
        items: [validItem({ mimeType: 'application/octet-stream' })],
      },
      token,
    );
    expect(r.status).toBe(400);
  });

  it('400 if sizeBytes is zero or negative', async () => {
    const { token } = await signupTestUser(baseUrl);
    const zero = await api(
      baseUrl,
      'POST',
      '/uploads',
      { entryDate: '2025-05-08', items: [validItem({ sizeBytes: 0 })] },
      token,
    );
    expect(zero.status).toBe(400);
    const neg = await api(
      baseUrl,
      'POST',
      '/uploads',
      { entryDate: '2025-05-08', items: [validItem({ sizeBytes: -10 })] },
      token,
    );
    expect(neg.status).toBe(400);
  });

  it('400 if sizeBytes exceeds the 25MB cap', async () => {
    const { token } = await signupTestUser(baseUrl);
    const r = await api(
      baseUrl,
      'POST',
      '/uploads',
      {
        entryDate: '2025-05-08',
        items: [validItem({ sizeBytes: TWENTY_FIVE_MB + 1 })],
      },
      token,
    );
    expect(r.status).toBe(400);
  });
});

describe.skipIf(skip)('POST /uploads — happy path & shape', () => {
  it('issues SAS items, persists photo rows for the user, returns expected fields', async () => {
    const { token, userId } = await signupTestUser(baseUrl);
    const before = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM photos WHERE user_id = $1`,
      [userId],
    );
    expect(before.rows[0]!.n).toBe(0);

    const r = await api(
      baseUrl,
      'POST',
      '/uploads',
      {
        entryDate: '2025-05-08',
        items: [
          validItem({ filename: 'a.jpg' }),
          validItem({ filename: 'b.png', mimeType: 'image/png' }),
          validItem({ filename: 'c.jpg' }),
        ],
      },
      token,
    );
    expect(r.status).toBe(200);
    const body = r.body as { items: Array<{ photoId: string; sasUrl: string; blobPath: string; expiresAt: string }> };
    expect(body.items).toHaveLength(3);
    for (const it of body.items) {
      expect(it.photoId).toMatch(/^[0-9a-f-]{36}$/);
      expect(it.sasUrl).toMatch(/^https?:\/\//);
      expect(it.blobPath.length).toBeGreaterThan(0);
      expect(it.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }

    const after = await pool.query<{ n: number; mt: string }>(
      `SELECT count(*)::int AS n, string_agg(DISTINCT mime_type, ',' ORDER BY mime_type) AS mt
       FROM photos WHERE user_id = $1`,
      [userId],
    );
    expect(after.rows[0]!.n).toBe(3);
    expect(after.rows[0]!.mt).toBe('image/jpeg,image/png');
  });

  it('returned photoIds belong only to the requesting user', async () => {
    const { token: a, userId: aId } = await signupTestUser(baseUrl);
    const { userId: bId } = await signupTestUser(baseUrl);

    const r = await api(
      baseUrl,
      'POST',
      '/uploads',
      { entryDate: '2025-05-08', items: [validItem()] },
      a,
    );
    expect(r.status).toBe(200);
    const body = r.body as { items: Array<{ photoId: string }> };
    const ownership = await pool.query<{ uid: string }>(
      `SELECT user_id::text AS uid FROM photos WHERE id = $1`,
      [body.items[0]!.photoId],
    );
    expect(ownership.rows[0]!.uid).toBe(aId);
    expect(ownership.rows[0]!.uid).not.toBe(bId);
  });
});
