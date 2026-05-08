/**
 * PUT a file to an Azure Blob SAS URL with progress reporting.
 *
 * Uses XMLHttpRequest so we get an `upload.progress` stream — `fetch` cannot
 * report request-body progress in browsers. Aborts when the AbortSignal fires.
 *
 * Azure Blob expects:
 *   - method PUT
 *   - x-ms-blob-type: BlockBlob
 *   - Content-Type matching the blob mime type
 *
 * No JSON parsing is needed — a 201 means committed.
 */

export type BlobUploadProgress = (loaded: number, total: number) => void;

export class BlobUploadError extends Error {
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'BlobUploadError';
    this.status = status;
  }
}

export interface BlobUploadOptions {
  signal?: AbortSignal;
  onProgress?: BlobUploadProgress;
  /** Test seam — defaults to the global XMLHttpRequest. */
  xhrFactory?: () => XMLHttpRequest;
}

export function uploadToBlob(
  sasUrl: string,
  file: Blob,
  options: BlobUploadOptions = {},
): Promise<void> {
  const factory = options.xhrFactory ?? (() => new XMLHttpRequest());
  return new Promise<void>((resolve, reject) => {
    const xhr = factory();
    let aborted = false;
    function onAbort(): void {
      aborted = true;
      try {
        xhr.abort();
      } catch {
        // ignore
      }
      reject(new DOMException('Upload aborted', 'AbortError'));
    }
    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.open('PUT', sasUrl, true);
    xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);

    if (options.onProgress && xhr.upload) {
      xhr.upload.onprogress = (e: ProgressEvent): void => {
        if (e.lengthComputable) {
          options.onProgress!(e.loaded, e.total);
        }
      };
    }

    xhr.onload = (): void => {
      if (aborted) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        if (options.onProgress) options.onProgress(file.size, file.size);
        resolve();
      } else {
        reject(new BlobUploadError(`Blob upload failed with HTTP ${xhr.status}`, xhr.status));
      }
    };
    xhr.onerror = (): void => {
      if (aborted) return;
      reject(new BlobUploadError('Network error during blob upload', 0));
    };
    xhr.ontimeout = (): void => {
      if (aborted) return;
      reject(new BlobUploadError('Blob upload timed out', 0));
    };

    xhr.send(file);
  });
}
