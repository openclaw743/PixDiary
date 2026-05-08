import { describe, expect, it, vi } from 'vitest';

import { uploadToBlob, BlobUploadError } from '@/lib/blobUpload';

class FakeXhr {
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public ontimeout: (() => void) | null = null;
  public upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  public status = 0;
  public method = '';
  public url = '';
  public requestHeaders: Record<string, string> = {};
  public sentBody: unknown = null;
  public aborted = false;
  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string): void {
    this.requestHeaders[k] = v;
  }
  send(body: unknown): void {
    this.sentBody = body;
  }
  abort(): void {
    this.aborted = true;
  }
}

describe('uploadToBlob', () => {
  it('PUTs with x-ms-blob-type and reports progress + completion', async () => {
    const xhr = new FakeXhr();
    const onProgress = vi.fn();
    const file = new Blob(['hello'], { type: 'image/jpeg' });
    const promise = uploadToBlob('https://example/sas', file, {
      onProgress,
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
    });
    // Simulate progress + success
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 5 } as ProgressEvent);
    xhr.status = 201;
    xhr.onload?.();
    await expect(promise).resolves.toBeUndefined();
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('https://example/sas');
    expect(xhr.requestHeaders['x-ms-blob-type']).toBe('BlockBlob');
    expect(xhr.requestHeaders['Content-Type']).toBe('image/jpeg');
    expect(onProgress).toHaveBeenCalledWith(3, 5);
  });

  it('rejects with BlobUploadError on non-2xx status', async () => {
    const xhr = new FakeXhr();
    const promise = uploadToBlob('https://example/sas', new Blob(['x']), {
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
    });
    xhr.status = 500;
    xhr.onload?.();
    await expect(promise).rejects.toBeInstanceOf(BlobUploadError);
  });

  it('aborts when AbortSignal fires', async () => {
    const xhr = new FakeXhr();
    const ac = new AbortController();
    const promise = uploadToBlob('https://example/sas', new Blob(['x']), {
      signal: ac.signal,
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
    });
    ac.abort();
    await expect(promise).rejects.toBeInstanceOf(DOMException);
    expect(xhr.aborted).toBe(true);
  });
});
