/**
 * Entries service: create draft, read, update, delete, regenerate.
 */
import type { Pool } from 'pg';
import { getPool } from '../db/pool';
import { getBlobBackend, type BlobBackend } from './blob';
import { Errors } from '../errors';

export type EntryStatus =
  | 'pending'
  | 'processing'
  | 'drafted'
  | 'saved'
  | 'processing_failed'
  | 'quota_blocked'
  | 'soft_deleted';

export interface PhotoSummary {
  id: string;
  readUrl: string;
  readUrlExpiresAt: string;
  width: number | null;
  height: number | null;
  takenAt: string | null;
}

export interface PublicEntry {
  id: string;
  entryDate: string;
  status: EntryStatus;
  draftText: string | null;
  finalText: string | null;
  photos: PhotoSummary[];
  createdAt: string;
  lastEditedAt: string | null;
}

export interface PublicEntrySummary {
  id: string;
  entryDate: string;
  status: EntryStatus;
  thumbnailUrl: string | null;
  excerpt: string | null;
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

interface EntryRow {
  id: string;
  entry_date: string;
  status: EntryStatus;
  draft_md: string | null;
  final_md: string | null;
  created_at: Date;
  last_edited_at: Date | null;
}

interface PhotoRowMin {
  id: string;
  blob_path: string;
  width: number | null;
  height: number | null;
  taken_at: Date | null;
}

/**
 * Create or replace today's entry draft.
 *
 * - Verifies the photoIds belong to the user.
 * - Verifies the matching blobs exist (uploaded ≠ "pending" only).
 * - Creates an `entries` row (or reuses the existing one for the date) with
 *   `status='pending'`, links photos, and returns the entryId. The caller
 *   is responsible for kicking off the async pipeline.
 */
export async function createOrReplaceDraft(
  userId: string,
  entryDate: string,
  photoIds: string[],
  deps?: ServiceDeps,
): Promise<{ entryId: string; status: EntryStatus }> {
  if (photoIds.length === 0) {
    throw Errors.validationFailed({ photoIds: 'must be non-empty' });
  }
  const pool = poolOf(deps);
  const blob = blobOf(deps);

  // Verify ownership + collect blob paths
  const r = await pool.query<{ id: string; blob_path: string; status: string }>(
    `SELECT id, blob_path, status FROM photos
     WHERE user_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
    [userId, photoIds],
  );
  if (r.rowCount !== photoIds.length) {
    throw Errors.notFound('one or more photo IDs not found');
  }

  // Verify blobs exist and mark as 'uploaded'
  for (const row of r.rows) {
    const exists = await blob.exists(row.blob_path);
    if (!exists) {
      throw Errors.validationFailed({
        photoId: row.id,
        message: 'blob not yet uploaded',
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Mark photos as uploaded
    await client.query(
      `UPDATE photos SET status = 'uploaded'
       WHERE id = ANY($1::uuid[]) AND status = 'pending'`,
      [photoIds],
    );
    // Upsert entry: one active entry per (user, date). The unique index is
    // partial (`WHERE deleted_at IS NULL`), so we use ON CONFLICT (cols) and
    // wrap with WHERE to be explicit.
    const e = await client.query<{ id: string }>(
      `INSERT INTO entries (user_id, entry_date, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (user_id, entry_date) WHERE deleted_at IS NULL
       DO UPDATE SET status = 'pending', draft_md = NULL
       RETURNING id`,
      [userId, entryDate],
    );
    if (!e.rows[0]) throw Errors.internal('entry upsert failed');
    const entryId: string = e.rows[0].id;
    // Reset photo links (works for both insert and conflict-update; harmless if empty).
    await client.query(`DELETE FROM entry_photos WHERE entry_id = $1`, [entryId]);
    // Link photos
    let pos = 0;
    for (const id of photoIds) {
      await client.query(
        `INSERT INTO entry_photos (entry_id, photo_id, position) VALUES ($1, $2, $3)
         ON CONFLICT (entry_id, photo_id) DO UPDATE SET position = EXCLUDED.position`,
        [entryId, id, pos++],
      );
    }
    await client.query('COMMIT');
    return { entryId, status: 'pending' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fetch a single entry with photos + SAS read URLs.
 * Throws notFound if missing or owned by another user.
 *
 * NOTE: GPS / camera / EXIF GPS are NEVER included here. Only width/height
 * and takenAt make it to the wire.
 */
export async function getEntry(
  userId: string,
  entryId: string,
  deps?: ServiceDeps,
): Promise<PublicEntry> {
  const pool = poolOf(deps);
  const blob = blobOf(deps);
  const e = await pool.query<EntryRow>(
    `SELECT id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
            status, draft_md, final_md, created_at, last_edited_at
     FROM entries
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [entryId, userId],
  );
  if (!e.rows[0]) throw Errors.notFound('entry not found');
  const row = e.rows[0];
  const ph = await pool.query<PhotoRowMin>(
    `SELECT p.id, p.blob_path, p.width, p.height, p.taken_at
     FROM photos p
     JOIN entry_photos ep ON ep.photo_id = p.id
     WHERE ep.entry_id = $1 AND p.deleted_at IS NULL
     ORDER BY ep.position ASC, p.created_at ASC`,
    [entryId],
  );
  const photos: PhotoSummary[] = [];
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
  return {
    id: row.id,
    entryDate: row.entry_date,
    status: row.status,
    draftText: row.draft_md,
    finalText: row.final_md,
    photos,
    createdAt: row.created_at.toISOString(),
    lastEditedAt: row.last_edited_at ? row.last_edited_at.toISOString() : null,
  };
}

export interface ListEntriesOpts {
  limit?: number;
  cursor?: string | null;
  from?: string | null;
  to?: string | null;
}

/**
 * List entries newest-first with cursor pagination on (entry_date, id).
 */
export async function listEntries(
  userId: string,
  opts: ListEntriesOpts,
  deps?: ServiceDeps,
): Promise<{ items: PublicEntrySummary[]; nextCursor: string | null }> {
  const pool = poolOf(deps);
  const blob = blobOf(deps);
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 30)));
  const params: unknown[] = [userId];
  const where: string[] = [`e.user_id = $1`, `e.deleted_at IS NULL`];
  if (opts.from) {
    params.push(opts.from);
    where.push(`e.entry_date >= $${params.length}`);
  }
  if (opts.to) {
    params.push(opts.to);
    where.push(`e.entry_date <= $${params.length}`);
  }
  if (opts.cursor) {
    const parsed = parseCursor(opts.cursor);
    if (parsed) {
      params.push(parsed.entryDate);
      params.push(parsed.id);
      where.push(
        `(e.entry_date < $${params.length - 1} OR (e.entry_date = $${params.length - 1} AND e.id < $${params.length}))`,
      );
    }
  }
  params.push(limit + 1);
  const rows = await pool.query<{
    id: string;
    entry_date: string;
    status: EntryStatus;
    draft_md: string | null;
    final_md: string | null;
    thumb_blob: string | null;
  }>(
    `SELECT e.id, to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date, e.status,
            e.draft_md, e.final_md,
            (SELECT p.blob_path FROM entry_photos ep
              JOIN photos p ON p.id = ep.photo_id
              WHERE ep.entry_id = e.id AND p.deleted_at IS NULL
              ORDER BY ep.position ASC, p.created_at ASC LIMIT 1) AS thumb_blob
     FROM entries e
     WHERE ${where.join(' AND ')}
     ORDER BY e.entry_date DESC, e.id DESC
     LIMIT $${params.length}`,
    params,
  );
  const slice = rows.rows.slice(0, limit);
  const nextCursor =
    rows.rows.length > limit
      ? makeCursor(slice[slice.length - 1]!.entry_date, slice[slice.length - 1]!.id)
      : null;
  const out: PublicEntrySummary[] = [];
  for (const r of slice) {
    const text = r.final_md ?? r.draft_md ?? null;
    let thumbnailUrl: string | null = null;
    if (r.thumb_blob) {
      const sas = await blob.issueReadSas(r.thumb_blob);
      thumbnailUrl = sas.url;
    }
    out.push({
      id: r.id,
      entryDate: r.entry_date,
      status: r.status,
      thumbnailUrl,
      excerpt: text ? text.slice(0, 120) : null,
    });
  }
  return { items: out, nextCursor };
}

function makeCursor(entryDate: string, id: string): string {
  return Buffer.from(`${entryDate}|${id}`).toString('base64url');
}

function parseCursor(cursor: string): { entryDate: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const [d, id] = decoded.split('|');
    if (!d || !id || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    return { entryDate: d, id };
  } catch {
    return null;
  }
}

/**
 * Save the final entry text, write a revision, set status='saved'.
 */
export async function saveEntry(
  userId: string,
  entryId: string,
  text: string,
  deps?: ServiceDeps,
): Promise<PublicEntry> {
  const pool = poolOf(deps);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const e = await client.query<{ id: string }>(
      `SELECT id FROM entries
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [entryId, userId],
    );
    if (!e.rows[0]) {
      await client.query('ROLLBACK');
      throw Errors.notFound('entry not found');
    }
    await client.query(
      `UPDATE entries SET final_md = $2, status = 'saved', last_edited_at = now()
       WHERE id = $1`,
      [entryId, text],
    );
    await client.query(
      `INSERT INTO entry_revisions (entry_id, final_md) VALUES ($1, $2)`,
      [entryId, text],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return getEntry(userId, entryId, deps);
}

/**
 * Soft-delete an entry. Idempotent.
 */
export async function softDeleteEntry(
  userId: string,
  entryId: string,
  deps?: ServiceDeps,
): Promise<void> {
  const pool = poolOf(deps);
  const r = await pool.query(
    `UPDATE entries SET deleted_at = now(), status = 'soft_deleted'
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [entryId, userId],
  );
  if (r.rowCount === 0) throw Errors.notFound('entry not found');
}

/**
 * Reset an entry's status to 'pending' for the orchestrator to pick up.
 */
export async function markEntryForRegenerate(
  userId: string,
  entryId: string,
  deps?: ServiceDeps,
): Promise<void> {
  const pool = poolOf(deps);
  const r = await pool.query(
    `UPDATE entries SET status = 'pending'
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [entryId, userId],
  );
  if (r.rowCount === 0) throw Errors.notFound('entry not found');
}
