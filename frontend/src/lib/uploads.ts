/**
 * Upload validation helpers.
 *
 * Source of truth for the four constraints from `docs/api-contracts/openapi.yaml`
 * and the wireframe:
 *  - mime ∈ { image/jpeg, image/png, image/heic, image/webp }
 *  - sizeBytes ≤ 25 MB (26_214_400)
 *  - 1..25 items per batch
 *  - concurrency cap is enforced at upload time, not here (see `runWithConcurrency`).
 */

export const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
] as const;

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_BATCH_SIZE = 25;
export const MAX_CONCURRENT_UPLOADS = 3;

export const ACCEPT_ATTR = ACCEPTED_MIME_TYPES.join(',');

export interface ValidationError {
  /** Optional file the error applies to. */
  filename?: string;
  message: string;
}

/**
 * Validate a list of files. Returns accepted files (in original order) and
 * any per-file or batch-level errors.
 */
export function validateFiles(files: File[]): {
  accepted: File[];
  errors: ValidationError[];
} {
  const errors: ValidationError[] = [];
  if (files.length === 0) {
    return { accepted: [], errors: [{ message: 'No files were selected.' }] };
  }
  if (files.length > MAX_BATCH_SIZE) {
    errors.push({
      message: `You can upload at most ${MAX_BATCH_SIZE} photos at a time. ${files.length} selected.`,
    });
  }
  const accepted: File[] = [];
  for (const f of files.slice(0, MAX_BATCH_SIZE)) {
    if (!ACCEPTED_MIME_TYPES.includes(f.type as AcceptedMimeType)) {
      errors.push({
        filename: f.name,
        message: `${f.name}: ${f.type || 'unknown type'} is not supported. Use JPEG, PNG, HEIC, or WebP.`,
      });
      continue;
    }
    if (f.size > MAX_FILE_BYTES) {
      errors.push({
        filename: f.name,
        message: `${f.name} is ${formatBytes(f.size)}, max is ${formatBytes(MAX_FILE_BYTES)}.`,
      });
      continue;
    }
    if (f.size <= 0) {
      errors.push({ filename: f.name, message: `${f.name} is empty.` });
      continue;
    }
    accepted.push(f);
  }
  return { accepted, errors };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Run `tasks` with at most `limit` running concurrently. Resolves with each
 * task's settled outcome in original order. Tasks may use the supplied signal
 * to abort if the parent cancels.
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<Array<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown }>> {
  const out: Array<
    | { status: 'fulfilled'; value: T }
    | { status: 'rejected'; reason: unknown }
  > = new Array(tasks.length);
  let cursor = 0;
  const cap = Math.max(1, Math.min(limit, tasks.length));
  const workers: Promise<void>[] = [];
  for (let w = 0; w < cap; w += 1) {
    workers.push(
      (async () => {
        for (;;) {
          const i = cursor;
          cursor += 1;
          if (i >= tasks.length) return;
          try {
            const value = await tasks[i]();
            out[i] = { status: 'fulfilled', value };
          } catch (reason) {
            out[i] = { status: 'rejected', reason };
          }
        }
      })(),
    );
  }
  await Promise.all(workers);
  return out;
}
