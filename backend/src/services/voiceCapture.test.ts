import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { dockerAvailable, setupTestPg, type PgHarness } from '../../tests/helpers/docker';
import { formatVoicePrompt, getVoiceSamples } from './voiceCapture';
import { resetConfigCache } from '../config';
import { setPool } from '../db/pool';

const skip = !dockerAvailable() && !process.env.PIXDIARY_TEST_DATABASE_URL;

let pg: PgHarness | undefined;
let pool: Pool;

async function makeUser(p: Pool): Promise<string> {
  const r = await p.query<{ id: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`,
    [`u-${randomUUID()}@example.com`],
  );
  return r.rows[0]!.id;
}

async function makeEntryWithRevisions(
  p: Pool,
  userId: string,
  entryDate: string,
  revisions: { text: string; saved_at: Date }[],
): Promise<string> {
  const e = await p.query<{ id: string }>(
    `INSERT INTO entries (user_id, entry_date, status, final_md, last_edited_at)
     VALUES ($1, $2, 'saved', $3, $4) RETURNING id`,
    [
      userId,
      entryDate,
      revisions[revisions.length - 1]?.text ?? '',
      revisions[revisions.length - 1]?.saved_at ?? new Date(),
    ],
  );
  const entryId = e.rows[0]!.id;
  for (const rev of revisions) {
    await p.query(
      `INSERT INTO entry_revisions (entry_id, final_md, saved_at) VALUES ($1, $2, $3)`,
      [entryId, rev.text, rev.saved_at],
    );
  }
  return entryId;
}

beforeAll(async () => {
  if (skip) return;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
  pg = await setupTestPg();
  process.env.DATABASE_URL = pg.url;
  resetConfigCache();
  setPool(pg.pool);
  pool = pg.pool;
}, 180_000);

afterAll(async () => {
  setPool(undefined);
  if (pg) await pg.cleanup();
}, 60_000);

describe.skipIf(skip)('voiceCapture: getVoiceSamples', () => {
  it('returns empty list when user has no saved entries', async () => {
    const u = await makeUser(pool);
    const out = await getVoiceSamples(u, 5, { pool });
    expect(out).toEqual([]);
  });

  it('returns the most recent revision per entry, newest-first, capped at limit', async () => {
    const u = await makeUser(pool);
    const t = (offset: number): Date => new Date(Date.now() - offset * 60_000);

    await makeEntryWithRevisions(pool, u, '2026-05-01', [
      { text: 'Day 1 first draft', saved_at: t(100) },
      { text: 'Day 1 final', saved_at: t(50) },
    ]);
    await makeEntryWithRevisions(pool, u, '2026-05-02', [
      { text: 'Day 2 v1', saved_at: t(40) },
    ]);
    await makeEntryWithRevisions(pool, u, '2026-05-03', [
      { text: 'Day 3 v1', saved_at: t(30) },
    ]);

    const out = await getVoiceSamples(u, 2, { pool });
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toBe('Day 3 v1');
    expect(out[1]!.text).toBe('Day 2 v1');

    const out5 = await getVoiceSamples(u, 5, { pool });
    expect(out5).toHaveLength(3);
    // Day 1 picks the LATEST revision ("Day 1 final"), not the first
    expect(out5[2]!.text).toBe('Day 1 final');
  });

  it('skips soft-deleted entries', async () => {
    const u = await makeUser(pool);
    const id = await makeEntryWithRevisions(pool, u, '2026-04-01', [
      { text: 'visible', saved_at: new Date() },
    ]);
    await makeEntryWithRevisions(pool, u, '2026-04-02', [
      { text: 'gone', saved_at: new Date() },
    ]);
    await pool.query(`UPDATE entries SET deleted_at = now() WHERE entry_date = '2026-04-02' AND user_id = $1`, [u]);
    void id;
    const out = await getVoiceSamples(u, 5, { pool });
    expect(out.map((s) => s.text)).toEqual(['visible']);
  });

  it("scopes by user (does not bleed across users)", async () => {
    const a = await makeUser(pool);
    const b = await makeUser(pool);
    await makeEntryWithRevisions(pool, a, '2026-03-01', [
      { text: 'A entry', saved_at: new Date() },
    ]);
    await makeEntryWithRevisions(pool, b, '2026-03-01', [
      { text: 'B entry', saved_at: new Date() },
    ]);
    const out = await getVoiceSamples(a, 5, { pool });
    expect(out.map((s) => s.text)).toEqual(['A entry']);
  });

  it('limit is clamped to [1, 20]', async () => {
    const u = await makeUser(pool);
    expect(await getVoiceSamples(u, -1, { pool })).toEqual([]);
    expect(await getVoiceSamples(u, 9999, { pool })).toEqual([]);
  });
});

describe('voiceCapture: formatVoicePrompt', () => {
  it('returns empty string for no samples', () => {
    expect(formatVoicePrompt([])).toBe('');
  });

  it('formats samples with numbered blocks', () => {
    const out = formatVoicePrompt([
      { text: 'first', savedAt: new Date() },
      { text: 'second', savedAt: new Date() },
    ]);
    expect(out).toContain('Sample 1:');
    expect(out).toContain('Sample 2:');
    expect(out).toContain('first');
    expect(out).toContain('second');
    expect(out).toMatch(/Match this tone/);
  });
});
