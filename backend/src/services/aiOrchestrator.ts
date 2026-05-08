/**
 * AI orchestrator.
 *
 * Single chokepoint that runs the full pipeline for an entry:
 *   1. Load photos + their EXIF + bytes from blob.
 *   2. For each photo: run a vision call (gpt-4o-mini) and reverse-geocode.
 *   3. Pull voice samples (last 5 saved entries).
 *   4. Generate the diary draft (gpt-4o-mini default; gpt-4o on `quality=better`).
 *   5. Persist draft + status + photo ai_scene + cost ledger.
 *
 * Runs in-process per entry. The route returns 202 immediately; the caller
 * polls `GET /entries/:id` for status to flip from `processing` → `drafted`.
 */
import type { Pool, PoolClient } from 'pg';
import { getLogger } from '../log';
import { getPool } from '../db/pool';
import { QuotaExceededError } from '../errors';
import { extractExif, type ExifData } from './exif';
import { reverseGeocode } from './geocode';
import { getBlobBackend, type BlobBackend } from './blob';
import {
  generateDraft,
  modelNameForTier,
  visionDescribePhoto,
  type ModelTier,
  type VisionResult,
} from './aiClient';
import {
  recordUsage,
  refundReservation,
  reserveBudget,
  todayInTz,
} from './costLedger';
import { formatVoicePrompt, getVoiceSamples } from './voiceCapture';

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

interface PhotoRow {
  id: string;
  user_id: string;
  blob_path: string;
  mime_type: string;
  taken_at: Date | null;
  taken_on: string | null;
  gps_lat: string | null;
  gps_lng: string | null;
  camera_make: string | null;
  camera_model: string | null;
  width: number | null;
  height: number | null;
  ai_scene: Record<string, unknown> | null;
  status: string;
}

interface UserRow {
  id: string;
  timezone: string;
  daily_cap_eur: string;
}

async function loadEntryContext(
  pool: Pool,
  entryId: string,
): Promise<{ user: UserRow; entryDate: string; photos: PhotoRow[] } | null> {
  const e = await pool.query<{
    user_id: string;
    entry_date: string;
    timezone: string;
    daily_cap_eur: string;
  }>(
    `SELECT e.user_id, to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date,
            u.timezone, u.daily_cap_eur
     FROM entries e JOIN users u ON u.id = e.user_id
     WHERE e.id = $1 AND e.deleted_at IS NULL`,
    [entryId],
  );
  if (!e.rows[0]) return null;
  const row = e.rows[0];
  const photos = await pool.query<PhotoRow>(
    `SELECT p.id, p.user_id, p.blob_path, p.mime_type, p.taken_at,
            to_char(p.taken_on, 'YYYY-MM-DD') AS taken_on,
            p.gps_lat::text AS gps_lat, p.gps_lng::text AS gps_lng,
            p.camera_make, p.camera_model, p.width, p.height, p.ai_scene, p.status
     FROM photos p
     JOIN entry_photos ep ON ep.photo_id = p.id
     WHERE ep.entry_id = $1 AND p.deleted_at IS NULL
     ORDER BY ep.position ASC, p.created_at ASC`,
    [entryId],
  );
  return {
    user: { id: row.user_id, timezone: row.timezone, daily_cap_eur: row.daily_cap_eur },
    entryDate: row.entry_date,
    photos: photos.rows,
  };
}

async function setEntryStatus(
  pool: Pool,
  entryId: string,
  status: string,
  extra: { draft_md?: string; model_used?: string; drafted_at?: Date | null } = {},
): Promise<void> {
  const fields: string[] = ['status = $2'];
  const params: unknown[] = [entryId, status];
  let i = 3;
  if (extra.draft_md !== undefined) {
    fields.push(`draft_md = $${i++}`);
    params.push(extra.draft_md);
  }
  if (extra.model_used !== undefined) {
    fields.push(`model_used = $${i++}`);
    params.push(extra.model_used);
  }
  if (extra.drafted_at !== undefined) {
    fields.push(`drafted_at = $${i++}`);
    params.push(extra.drafted_at);
  }
  await pool.query(`UPDATE entries SET ${fields.join(', ')} WHERE id = $1`, params);
}

async function processPhoto(
  client: PoolClient,
  blob: BlobBackend,
  photo: PhotoRow,
): Promise<{ exif: ExifData; bytes: Buffer; placeName: string | null; locationId: string | null }> {
  const bytes = await blob.download(photo.blob_path);
  const exif = await extractExif(bytes);
  // Persist extracted EXIF — but if the photo row already has values, prefer it.
  const takenAt = photo.taken_at ?? exif.takenAt;
  const takenOn =
    photo.taken_on ??
    (exif.takenAt ? exif.takenAt.toISOString().slice(0, 10) : null);
  const cameraMake = photo.camera_make ?? exif.cameraMake;
  const cameraModel = photo.camera_model ?? exif.cameraModel;
  const width = photo.width ?? exif.width;
  const height = photo.height ?? exif.height;
  const lat = photo.gps_lat !== null ? Number(photo.gps_lat) : exif.gpsLat;
  const lng = photo.gps_lng !== null ? Number(photo.gps_lng) : exif.gpsLng;

  let placeName: string | null = null;
  let locationId: string | null = null;
  if (lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng)) {
    const geo = await reverseGeocode(lat, lng);
    if (geo) {
      placeName = geo.placeName;
      locationId = geo.locationId;
    }
  }

  await client.query(
    `UPDATE photos
     SET taken_at = COALESCE($2, taken_at),
         taken_on = COALESCE($3::date, taken_on),
         camera_make = COALESCE($4, camera_make),
         camera_model = COALESCE($5, camera_model),
         width = COALESCE($6, width),
         height = COALESCE($7, height),
         gps_lat = COALESCE($8::numeric, gps_lat),
         gps_lng = COALESCE($9::numeric, gps_lng),
         location_id = COALESCE($10, location_id),
         status = 'processing'
     WHERE id = $1`,
    [
      photo.id,
      takenAt,
      takenOn,
      cameraMake,
      cameraModel,
      width,
      height,
      lat,
      lng,
      locationId,
    ],
  );

  return { exif, bytes, placeName, locationId };
}

interface OrchestratorOpts {
  tier?: ModelTier;
  /** Seed for vision call estimates (per photo). Defaults to 800 in / 200 out. */
  visionEstimate?: { tokensIn: number; tokensOut: number };
  /** Seed for draft call estimates. Defaults vary by tier. */
  draftEstimate?: { tokensIn: number; tokensOut: number };
}

const DEFAULT_VISION_ESTIMATE = { tokensIn: 800, tokensOut: 200 };
const DEFAULT_DRAFT_ESTIMATE = { tokensIn: 2000, tokensOut: 400 };

/**
 * Run the full pipeline for one entry. Updates entry status as it goes.
 * Returns nothing — the caller polls GET /entries/:id.
 */
export async function runEntryPipeline(
  entryId: string,
  opts: OrchestratorOpts = {},
  deps?: ServiceDeps,
): Promise<void> {
  const log = getLogger();
  const pool = poolOf(deps);
  const blob = blobOf(deps);
  const tier: ModelTier = opts.tier ?? 'default';

  const ctx = await loadEntryContext(pool, entryId);
  if (!ctx) {
    log.warn({ entryId }, 'orchestrator_entry_not_found');
    return;
  }
  if (ctx.photos.length === 0) {
    await setEntryStatus(pool, entryId, 'processing_failed');
    return;
  }

  await setEntryStatus(pool, entryId, 'processing');

  const day = todayInTz(new Date(), ctx.user.timezone);
  const dailyCapEur = Number(ctx.user.daily_cap_eur);
  const visionEstimate = opts.visionEstimate ?? DEFAULT_VISION_ESTIMATE;
  const draftEstimate = opts.draftEstimate ?? DEFAULT_DRAFT_ESTIMATE;

  // -------- vision per photo --------
  const visionResults: VisionResult[] = [];
  const placeNames: string[] = [];
  const seenPlaces = new Set<string>();
  const visionModel = modelNameForTier('default');

  for (const photo of ctx.photos) {
    const client = await pool.connect();
    let processed: { exif: ExifData; bytes: Buffer; placeName: string | null; locationId: string | null };
    try {
      await client.query('BEGIN');
      processed = await processPhoto(client, blob, photo);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      log.error(
        { err: (err as Error).message, photoId: photo.id, entryId },
        'orchestrator_photo_load_failed',
      );
      await pool
        .query(`UPDATE photos SET status = 'failed' WHERE id = $1`, [photo.id])
        .catch(() => undefined);
      continue;
    } finally {
      client.release();
    }

    if (processed.placeName && !seenPlaces.has(processed.placeName)) {
      seenPlaces.add(processed.placeName);
      placeNames.push(processed.placeName);
    }

    // Pre-call gate
    let reservation;
    try {
      reservation = await reserveBudget(
        {
          userId: ctx.user.id,
          entryId,
          purpose: 'vision',
          model: visionModel,
          day,
          dailyCapEur,
          estimatedTokensIn: visionEstimate.tokensIn,
          estimatedTokensOut: visionEstimate.tokensOut,
        },
        { pool },
      );
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        log.warn({ entryId }, 'orchestrator_quota_blocked_vision');
        await setEntryStatus(pool, entryId, 'quota_blocked');
        return;
      }
      throw err;
    }

    let visionResult: VisionResult;
    try {
      visionResult = await visionDescribePhoto({
        imageBase64: processed.bytes.toString('base64'),
        mimeType: photo.mime_type,
      });
    } catch (err) {
      log.error(
        { err: (err as Error).message, photoId: photo.id },
        'orchestrator_vision_call_failed',
      );
      await refundReservation(
        { userId: ctx.user.id, day, reservedEur: reservation.reservedEur },
        { pool },
      ).catch(() => undefined);
      await pool
        .query(`UPDATE photos SET status = 'failed' WHERE id = $1`, [photo.id])
        .catch(() => undefined);
      continue;
    }

    await recordUsage(
      {
        userId: ctx.user.id,
        entryId,
        purpose: 'vision',
        model: visionModel,
        tokensIn: visionResult.tokensIn,
        tokensOut: visionResult.tokensOut,
        day,
        dailyCapEur,
        reservedEur: reservation.reservedEur,
      },
      { pool },
    );
    await pool.query(
      `UPDATE photos SET ai_scene = $2::jsonb, status = 'processed' WHERE id = $1`,
      [photo.id, JSON.stringify(visionResult.raw)],
    );
    visionResults.push(visionResult);
  }

  if (visionResults.length === 0) {
    log.warn({ entryId }, 'orchestrator_no_vision_results');
    await setEntryStatus(pool, entryId, 'processing_failed');
    return;
  }

  // -------- draft --------
  const samples = await getVoiceSamples(ctx.user.id, 5, { pool });
  const voicePrompt = formatVoicePrompt(samples);
  const draftModel = modelNameForTier(tier);

  let draftReservation;
  try {
    draftReservation = await reserveBudget(
      {
        userId: ctx.user.id,
        entryId,
        purpose: tier === 'better' ? 'regenerate' : 'draft',
        model: draftModel,
        day,
        dailyCapEur,
        estimatedTokensIn: draftEstimate.tokensIn,
        estimatedTokensOut: draftEstimate.tokensOut,
      },
      { pool },
    );
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      log.warn({ entryId }, 'orchestrator_quota_blocked_draft');
      await setEntryStatus(pool, entryId, 'quota_blocked');
      return;
    }
    throw err;
  }

  let draftResult;
  try {
    draftResult = await generateDraft({
      entryDate: ctx.entryDate,
      placeNames,
      photoDescriptions: visionResults,
      voicePrompt,
      tier,
    });
  } catch (err) {
    log.error({ err: (err as Error).message, entryId }, 'orchestrator_draft_call_failed');
    await refundReservation(
      { userId: ctx.user.id, day, reservedEur: draftReservation.reservedEur },
      { pool },
    ).catch(() => undefined);
    await setEntryStatus(pool, entryId, 'processing_failed');
    return;
  }

  await recordUsage(
    {
      userId: ctx.user.id,
      entryId,
      purpose: tier === 'better' ? 'regenerate' : 'draft',
      model: draftModel,
      tokensIn: draftResult.tokensIn,
      tokensOut: draftResult.tokensOut,
      day,
      dailyCapEur,
      reservedEur: draftReservation.reservedEur,
    },
    { pool },
  );

  await setEntryStatus(pool, entryId, 'drafted', {
    draft_md: draftResult.text,
    model_used: draftResult.modelUsed,
    drafted_at: new Date(),
  });
  log.info({ entryId, tier, photos: visionResults.length }, 'orchestrator_done');
}

/**
 * Fire-and-forget runner used by routes.
 *
 * We catch and log unhandled rejections so an in-process AI failure can't
 * crash the request loop.
 */
export function startEntryPipeline(
  entryId: string,
  opts?: OrchestratorOpts,
  deps?: ServiceDeps,
): Promise<void> {
  return runEntryPipeline(entryId, opts ?? {}, deps).catch((err) => {
    const log = getLogger();
    log.error({ err: (err as Error).message, entryId }, 'orchestrator_unhandled');
    void getPool()
      .query(`UPDATE entries SET status = 'processing_failed' WHERE id = $1`, [entryId])
      .catch(() => undefined);
  });
}
