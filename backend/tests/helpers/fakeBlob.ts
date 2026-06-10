/**
 * In-memory BlobBackend stub. Tracks which blob paths have had an upload
 * SAS issued so the draft endpoint's existence check passes deterministically.
 *
 * Use this in any integration test that doesn't need real blob bytes.
 */
import type { BlobBackend } from '../../src/services/blob';

export function makeFakeBlob(): BlobBackend {
  const issued = new Set<string>();
  return {
    getContainerClient: async () => ({}) as never,
    issueUploadSas: async (blobPath: string) => {
      issued.add(blobPath);
      return {
        url: `https://fake.blob.core.windows.net/photos/${blobPath}?sv=fake-upload`,
        expiresAt: new Date(Date.now() + 600_000),
      };
    },
    issueReadSas: async (blobPath: string) => ({
      url: `https://fake.blob.core.windows.net/photos/${blobPath}?sv=fake-read`,
      expiresAt: new Date(Date.now() + 600_000),
    }),
    exists: async (blobPath: string) => issued.has(blobPath),
    remove: async (blobPath: string) => {
      issued.delete(blobPath);
    },
    download: async () => Buffer.from(''),
  };
}
