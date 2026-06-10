/**
 * Settings + account services: read/update settings, export data, hard-delete account.
 */
import type { Pool } from 'pg';
import { getPool } from '../db/pool';
import { getBlobBackend, type BlobBackend } from './blob';
import { Errors } from '../errors';
import { verifyPassword } from './auth';

export interface UserSettings {
  timezone: string;
  dailyCapEur: number;
}

interface ServiceDeps {
  pool?: Pool;
  blob?: BlobBackend;
}

function poolOf(deps?: ServiceDeps): Pool {
  return deps?.pool ?? getPool();
}

function blobOf(deps?: ServiceDeps): BlobBackend {
  return deps?.blob ?? getBlobBackend();
}

export async function getSettings(userId: string, deps?: ServiceDeps): Promise<UserSettings> {
  const pool = poolOf(deps);
  const r = await pool.query<{ timezone: string; daily_cap_eur: string }>(
    `SELECT timezone, daily_cap_eur FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) throw Errors.unauthorized('user not found');
  return { timezone: row.timezone, dailyCapEur: Number(row.daily_cap_eur) };
}

export async function updateSettings(
  userId: string,
  patch: Partial<UserSettings>,
  deps?: ServiceDeps,
): Promise<UserSettings> {
  const pool = poolOf(deps);
  const fields: string[] = [];
  const params: unknown[] = [userId];
  if (patch.timezone !== undefined) {
    if (!isValidTimezone(patch.timezone)) {
      throw Errors.validationFailed({ timezone: 'invalid IANA tz' });
    }
    params.push(patch.timezone);
    fields.push(`timezone = $${params.length}`);
  }
  if (patch.dailyCapEur !== undefined) {
    if (patch.dailyCapEur < 0.1 || patch.dailyCapEur > 5.0) {
      throw Errors.validationFailed({ dailyCapEur: 'must be in [0.10, 5.00]' });
    }
    params.push(patch.dailyCapEur);
    fields.push(`daily_cap_eur = $${params.length}`);
  }
  if (fields.length === 0) return getSettings(userId, deps);
  await pool.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $1 AND deleted_at IS NULL`,
    params,
  );
  return getSettings(userId, deps);
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Export every entry + photo reference for a user as a JSON blob.
 *
 * Photo entries include the read URL (≤15min) and key facts only — no GPS,
 * no raw EXIF, no AI scene blob (that's internal).
 */
export interface ExportPayload {
  exportedAt: string;
  user: {
    id: string;
    email: string;
    timezone: string;
    dailyCapEur: number;
    createdAt: string;
  };
  entries: Array<{
    id: string;
    entryDate: string;
    status: string;
    draftText: string | null;
    finalText: string | null;
    createdAt: string;
    lastEditedAt: string | null;
    photos: Array<{
      id: string;
      readUrl: string;
      readUrlExpiresAt: string;
      width: number | null;
      height: number | null;
      takenAt: string | null;
    }>;
  }>;
}

export async function exportData(userId: string, deps?: ServiceDeps): Promise<ExportPayload> {
  const pool = poolOf(deps);
  const blob = blobOf(deps);
  const u = await pool.query<{
    id: string;
    email: string;
    timezone: string;
    daily_cap_eur: string;
    created_at: Date;
  }>(
    `SELECT id, email, timezone, daily_cap_eur, created_at
     FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  if (!u.rows[0]) throw Errors.unauthorized('user not found');
  const userRow = u.rows[0];
  const entries = await pool.query<{
    id: string;
    entry_date: string;
    status: string;
    draft_md: string | null;
    final_md: string | null;
    created_at: Date;
    last_edited_at: Date | null;
  }>(
    `SELECT id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date, status,
            draft_md, final_md, created_at, last_edited_at
     FROM entries
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY entry_date ASC`,
    [userId],
  );
  const out: ExportPayload['entries'] = [];
  for (const er of entries.rows) {
    const ph = await pool.query<{
      id: string;
      blob_path: string;
      width: number | null;
      height: number | null;
      taken_at: Date | null;
    }>(
      `SELECT p.id, p.blob_path, p.width, p.height, p.taken_at
       FROM photos p
       JOIN entry_photos ep ON ep.photo_id = p.id
       WHERE ep.entry_id = $1 AND p.deleted_at IS NULL
       ORDER BY ep.position ASC`,
      [er.id],
    );
    const photos = [];
    for (const p of ph.rows) {
      const sas = await blob.issueReadSas(p.blob_path);
      photos.push({
        id: p.id,
        readUrl: sas.url,
        readUrlExpiresAt: sas.expiresAt.toISOString(),
        width: p.width,
        height: p.height,
        takenAt: p.taken_at ? p.taken_at.toISOString() : null,
      });
    }
    out.push({
      id: er.id,
      entryDate: er.entry_date,
      status: er.status,
      draftText: er.draft_md,
      finalText: er.final_md,
      createdAt: er.created_at.toISOString(),
      lastEditedAt: er.last_edited_at ? er.last_edited_at.toISOString() : null,
      photos,
    });
  }
  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: userRow.id,
      email: userRow.email,
      timezone: userRow.timezone,
      dailyCapEur: Number(userRow.daily_cap_eur),
      createdAt: userRow.created_at.toISOString(),
    },
    entries: out,
  };
}

/**
 * Hard-delete the user's account. Verifies password + literal confirmation.
 *
 * Sequence:
 *   1. Verify password.
 *   2. Collect all of the user's blob paths.
 *   3. DELETE the user row (cascades to all owned tables — see schema).
 *   4. Best-effort delete each blob (ignore individual failures; the row is gone).
 */
export async function hardDeleteAccount(
  userId: string,
  password: string,
  confirmation: string,
  deps?: ServiceDeps,
): Promise<{ deleted: true; blobsRemoved: number }> {
  if (confirmation !== 'DELETE MY ACCOUNT') {
    throw Errors.validationFailed({ confirmation: 'must be exactly "DELETE MY ACCOUNT"' });
  }
  const pool = poolOf(deps);
  const blob = blobOf(deps);
  const u = await pool.query<{ id: string; password_hash: string }>(
    `SELECT id, password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  if (!u.rows[0]) throw Errors.unauthorized('user not found');
  const ok = await verifyPassword(password, u.rows[0].password_hash);
  if (!ok) throw Errors.unauthorized('invalid password');

  const blobs = await pool.query<{ blob_path: string }>(
    `SELECT blob_path FROM photos WHERE user_id = $1`,
    [userId],
  );

  // The schema has `entry_photos.photo_id ON DELETE RESTRICT`, so the implicit
  // cascade from `users → photos` will fail if any photo is still referenced.
  // Drive the teardown in the dependency-safe order inside a single tx:
  //   1. DELETE entries  → cascades to entry_photos, entry_revisions.
  //   2. DELETE photos   → now unreferenced.
  //   3. DELETE users    → cascades to remaining refresh_tokens / ai_* rows.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM entries WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM photos WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  let removed = 0;
  for (const row of blobs.rows) {
    try {
      await blob.remove(row.blob_path);
      removed += 1;
    } catch {
      // ignored — DB row is already deleted; orphan blob will be GC'd by lifecycle policy
    }
  }
  return { deleted: true, blobsRemoved: removed };
}
