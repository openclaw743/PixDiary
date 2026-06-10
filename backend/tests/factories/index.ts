/**
 * Test data factories.
 *
 * Each factory inserts directly into Postgres using a real Pool and returns
 * the row(s). Factories take a `Pool` so the same helper works against the
 * shared global pool (integration tests) or a scoped pool (race-condition
 * tests that connect twice).
 *
 * Convention: every factory accepts an `overrides` object — anything you
 * pass overrides the default. Anything you don't pass gets a sensible
 * deterministic-ish default.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import { hashPassword } from '../../src/services/auth';

export interface MakeUserOpts {
  email?: string;
  password?: string;
  timezone?: string;
  dailyCapEur?: number;
}

export interface MadeUser {
  id: string;
  email: string;
  password: string;
  passwordHash: string;
  timezone: string;
  dailyCapEur: number;
}

/** Insert a user. Password is hashed with the configured cost (lowered in tests). */
export async function makeUser(pool: Pool, opts: MakeUserOpts = {}): Promise<MadeUser> {
  const email = opts.email ?? `u-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
  const password = opts.password ?? 'a-good-password-1';
  const passwordHash = await hashPassword(password);
  const timezone = opts.timezone ?? 'UTC';
  const dailyCapEur = opts.dailyCapEur ?? 0.5;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, timezone, daily_cap_eur)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [email, passwordHash, timezone, dailyCapEur],
  );
  return {
    id: r.rows[0]!.id,
    email,
    password,
    passwordHash,
    timezone,
    dailyCapEur,
  };
}

export interface MakePhotoOpts {
  userId: string;
  blobPath?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  takenAt?: Date | null;
  status?: 'pending' | 'uploaded' | 'processed' | 'failed';
  sizeBytes?: number;
}

export interface MadePhoto {
  id: string;
  userId: string;
  blobPath: string;
}

/** Insert a photo row with no blob bytes attached. */
export async function makePhoto(pool: Pool, opts: MakePhotoOpts): Promise<MadePhoto> {
  const blobPath = opts.blobPath ?? `u/${opts.userId}/p/${randomUUID()}.jpg`;
  const mimeType = opts.mimeType ?? 'image/jpeg';
  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;
  const takenAt = opts.takenAt === undefined ? new Date('2025-05-08T10:00:00Z') : opts.takenAt;
  const status = opts.status ?? 'uploaded';
  const sizeBytes = opts.sizeBytes ?? 12345;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO photos
       (user_id, blob_path, mime_type, width, height, taken_at, status, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [opts.userId, blobPath, mimeType, width, height, takenAt, status, sizeBytes],
  );
  return { id: r.rows[0]!.id, userId: opts.userId, blobPath };
}

export interface MakeEntryOpts {
  userId: string;
  entryDate?: string;
  status?:
    | 'pending'
    | 'processing'
    | 'drafted'
    | 'saved'
    | 'processing_failed'
    | 'quota_blocked'
    | 'soft_deleted';
  draftMd?: string | null;
  finalMd?: string | null;
  photoIds?: string[];
}

export interface MadeEntry {
  id: string;
  userId: string;
  entryDate: string;
  status: string;
}

/** Insert an entry, optionally with attached photos via `entry_photos`. */
export async function makeEntry(pool: Pool, opts: MakeEntryOpts): Promise<MadeEntry> {
  const entryDate = opts.entryDate ?? '2025-05-08';
  const status = opts.status ?? 'drafted';
  const draftMd = opts.draftMd === undefined ? '# Test draft\n\nbody' : opts.draftMd;
  const finalMd = opts.finalMd ?? null;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO entries (user_id, entry_date, status, draft_md, final_md)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [opts.userId, entryDate, status, draftMd, finalMd],
  );
  const entryId = r.rows[0]!.id;
  if (opts.photoIds && opts.photoIds.length > 0) {
    for (let i = 0; i < opts.photoIds.length; i++) {
      await pool.query(
        `INSERT INTO entry_photos (entry_id, photo_id, position) VALUES ($1, $2, $3)`,
        [entryId, opts.photoIds[i], i],
      );
    }
  }
  return { id: entryId, userId: opts.userId, entryDate, status };
}

/**
 * Insert a row directly into `ai_daily_cost`. Used by the cost-ledger tests
 * to set up a starting balance before exercising reserve/refund.
 */
export async function seedDailyCost(
  pool: Pool,
  args: { userId: string; day: string; totalEur: number },
): Promise<void> {
  await pool.query(
    `INSERT INTO ai_daily_cost (user_id, day, total_eur, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, day)
     DO UPDATE SET total_eur = EXCLUDED.total_eur, updated_at = now()`,
    [args.userId, args.day, args.totalEur],
  );
}
