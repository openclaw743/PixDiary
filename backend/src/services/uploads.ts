/**
 * Uploads service — issues SAS upload URLs for a photo manifest.
 */
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { getPool } from '../db/pool';
import { getBlobBackend, makeBlobPath, SUPPORTED_MIME_TYPES, type BlobBackend } from './blob';
import { Errors } from '../errors';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

export interface UploadItemRequest {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface UploadItemResponse {
  photoId: string;
  sasUrl: string;
  blobPath: string;
  expiresAt: string;
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

/**
 * Insert pending photo rows + issue SAS upload URLs.
 *
 * Throws `Errors.unsupportedMedia` or `Errors.payloadTooLarge` on bad input.
 * Validates each item independently — the entire batch is atomic (BEGIN/COMMIT).
 */
export async function issueUploads(
  userId: string,
  entryDate: string,
  items: UploadItemRequest[],
  deps?: ServiceDeps,
): Promise<UploadItemResponse[]> {
  for (const it of items) {
    if (!SUPPORTED_MIME_TYPES.includes(it.mimeType)) {
      throw Errors.unsupportedMedia(`Unsupported mime type: ${it.mimeType}`);
    }
    if (it.sizeBytes <= 0 || it.sizeBytes > MAX_UPLOAD_BYTES) {
      throw Errors.payloadTooLarge(`Photo too large: ${it.sizeBytes} bytes`);
    }
  }
  const pool = poolOf(deps);
  const blob = blobOf(deps);
  await blob.getContainerClient(); // ensure container exists once
  const out: UploadItemResponse[] = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const it of items) {
      const photoId = randomUUID();
      const blobPath = makeBlobPath(userId, entryDate, photoId, it.mimeType);
      await client.query(
        `INSERT INTO photos
           (id, user_id, blob_path, mime_type, size_bytes, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [photoId, userId, blobPath, it.mimeType, it.sizeBytes],
      );
      const sas = await blob.issueUploadSas(blobPath, it.mimeType);
      out.push({
        photoId,
        sasUrl: sas.url,
        blobPath,
        expiresAt: sas.expiresAt.toISOString(),
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return out;
}
