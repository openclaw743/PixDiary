/**
 * Azure Blob storage service.
 *
 * - Issues short-lived SAS upload URLs (≤10 min, write+create, exact path).
 * - Issues short-lived SAS read URLs (≤15 min) for diary photo display.
 * - Streams blob bytes server-side for AI processing.
 *
 * Auth modes:
 *   - Dev/CI:   AZURE_STORAGE_CONNECTION_STRING (Azurite or real acct key).
 *   - Prod:     AZURE_STORAGE_ACCOUNT_NAME + DefaultAzureCredential
 *               (managed identity → user-delegation SAS).
 *
 * The path scheme is `<userId>/<entryDate>/<photoId>.<ext>` and is enforced
 * at the call site (see services/uploads.ts).
 */
import {
  BlobSASPermissions,
  BlobServiceClient,
  ContainerClient,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
  SASProtocol,
  type UserDelegationKey,
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { getConfig } from '../config';

export interface BlobBackend {
  /** Container client with the configured photos container ensured. */
  getContainerClient(): Promise<ContainerClient>;
  /** Issue an upload SAS for the given blob path. */
  issueUploadSas(blobPath: string, contentType: string): Promise<{ url: string; expiresAt: Date }>;
  /** Issue a read SAS for the given blob path. */
  issueReadSas(blobPath: string): Promise<{ url: string; expiresAt: Date }>;
  /** True if blob exists. */
  exists(blobPath: string): Promise<boolean>;
  /** Delete a blob. Idempotent — ignores not-found. */
  remove(blobPath: string): Promise<void>;
  /** Download bytes for AI processing. */
  download(blobPath: string): Promise<Buffer>;
  /** Test/teardown helper. */
  close?(): Promise<void>;
}

interface ConnStrParts {
  accountName: string;
  accountKey: string;
}

function parseAccountKeyFromConnString(s: string): ConnStrParts | null {
  const map = new Map<string, string>();
  for (const seg of s.split(';')) {
    const i = seg.indexOf('=');
    if (i <= 0) continue;
    map.set(seg.slice(0, i).trim(), seg.slice(i + 1).trim());
  }
  const name = map.get('AccountName');
  const key = map.get('AccountKey');
  if (!name || !key) return null;
  return { accountName: name, accountKey: key };
}

class SharedKeyBackend implements BlobBackend {
  private readonly cred: StorageSharedKeyCredential;
  private readonly service: BlobServiceClient;
  private readonly container: ContainerClient;
  private ensured = false;

  constructor(connectionString: string, parts: ConnStrParts, containerName: string) {
    this.cred = new StorageSharedKeyCredential(parts.accountName, parts.accountKey);
    this.service = BlobServiceClient.fromConnectionString(connectionString);
    this.container = this.service.getContainerClient(containerName);
  }

  async getContainerClient(): Promise<ContainerClient> {
    if (!this.ensured) {
      await this.container.createIfNotExists();
      this.ensured = true;
    }
    return this.container;
  }

  async issueUploadSas(
    blobPath: string,
    contentType: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    await this.getContainerClient();
    const cfg = getConfig();
    const expiresAt = new Date(Date.now() + cfg.AZURE_STORAGE_SAS_UPLOAD_TTL_SECONDS * 1000);
    const startsOn = new Date(Date.now() - 60_000);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.container.containerName,
        blobName: blobPath,
        permissions: BlobSASPermissions.parse('cw'),
        startsOn,
        expiresOn: expiresAt,
        protocol: SASProtocol.HttpsAndHttp,
        contentType,
      },
      this.cred,
    ).toString();
    const blob = this.container.getBlockBlobClient(blobPath);
    return { url: `${blob.url}?${sas}`, expiresAt };
  }

  async issueReadSas(blobPath: string): Promise<{ url: string; expiresAt: Date }> {
    await this.getContainerClient();
    const cfg = getConfig();
    const expiresAt = new Date(Date.now() + cfg.AZURE_STORAGE_SAS_READ_TTL_SECONDS * 1000);
    const startsOn = new Date(Date.now() - 60_000);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.container.containerName,
        blobName: blobPath,
        permissions: BlobSASPermissions.parse('r'),
        startsOn,
        expiresOn: expiresAt,
        protocol: SASProtocol.HttpsAndHttp,
      },
      this.cred,
    ).toString();
    const blob = this.container.getBlockBlobClient(blobPath);
    return { url: `${blob.url}?${sas}`, expiresAt };
  }

  async exists(blobPath: string): Promise<boolean> {
    const c = await this.getContainerClient();
    return c.getBlockBlobClient(blobPath).exists();
  }

  async remove(blobPath: string): Promise<void> {
    const c = await this.getContainerClient();
    await c.getBlockBlobClient(blobPath).deleteIfExists();
  }

  async download(blobPath: string): Promise<Buffer> {
    const c = await this.getContainerClient();
    return c.getBlockBlobClient(blobPath).downloadToBuffer();
  }
}

class UserDelegationBackend implements BlobBackend {
  private readonly service: BlobServiceClient;
  private readonly container: ContainerClient;
  private readonly accountName: string;
  private udk: UserDelegationKey | null = null;
  private udkExpiresAt = 0;
  private ensured = false;

  constructor(accountName: string, containerName: string) {
    this.accountName = accountName;
    this.service = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      new DefaultAzureCredential(),
    );
    this.container = this.service.getContainerClient(containerName);
  }

  async getContainerClient(): Promise<ContainerClient> {
    if (!this.ensured) {
      await this.container.createIfNotExists();
      this.ensured = true;
    }
    return this.container;
  }

  /* c8 ignore start */
  private async getUserDelegationKey(): Promise<UserDelegationKey> {
    // Refresh ~10min before expiry.
    const now = Date.now();
    if (this.udk && this.udkExpiresAt > now + 10 * 60_000) return this.udk;
    const startsOn = new Date(now - 60_000);
    const expiresOn = new Date(now + 6 * 60 * 60_000); // 6h delegation key
    this.udk = await this.service.getUserDelegationKey(startsOn, expiresOn);
    this.udkExpiresAt = expiresOn.getTime();
    return this.udk;
  }

  async issueUploadSas(
    blobPath: string,
    contentType: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    await this.getContainerClient();
    const cfg = getConfig();
    const expiresAt = new Date(Date.now() + cfg.AZURE_STORAGE_SAS_UPLOAD_TTL_SECONDS * 1000);
    const startsOn = new Date(Date.now() - 60_000);
    const udk = await this.getUserDelegationKey();
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.container.containerName,
        blobName: blobPath,
        permissions: BlobSASPermissions.parse('cw'),
        startsOn,
        expiresOn: expiresAt,
        protocol: SASProtocol.Https,
        contentType,
      },
      udk,
      this.accountName,
    ).toString();
    const blob = this.container.getBlockBlobClient(blobPath);
    return { url: `${blob.url}?${sas}`, expiresAt };
  }

  async issueReadSas(blobPath: string): Promise<{ url: string; expiresAt: Date }> {
    await this.getContainerClient();
    const cfg = getConfig();
    const expiresAt = new Date(Date.now() + cfg.AZURE_STORAGE_SAS_READ_TTL_SECONDS * 1000);
    const startsOn = new Date(Date.now() - 60_000);
    const udk = await this.getUserDelegationKey();
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.container.containerName,
        blobName: blobPath,
        permissions: BlobSASPermissions.parse('r'),
        startsOn,
        expiresOn: expiresAt,
        protocol: SASProtocol.Https,
      },
      udk,
      this.accountName,
    ).toString();
    const blob = this.container.getBlockBlobClient(blobPath);
    return { url: `${blob.url}?${sas}`, expiresAt };
  }
  /* c8 ignore stop */

  async exists(blobPath: string): Promise<boolean> {
    const c = await this.getContainerClient();
    return c.getBlockBlobClient(blobPath).exists();
  }

  async remove(blobPath: string): Promise<void> {
    const c = await this.getContainerClient();
    await c.getBlockBlobClient(blobPath).deleteIfExists();
  }

  async download(blobPath: string): Promise<Buffer> {
    const c = await this.getContainerClient();
    return c.getBlockBlobClient(blobPath).downloadToBuffer();
  }
}

let cached: BlobBackend | undefined;

export function getBlobBackend(): BlobBackend {
  if (cached) return cached;
  const cfg = getConfig();
  if (cfg.AZURE_STORAGE_CONNECTION_STRING) {
    const parts = parseAccountKeyFromConnString(cfg.AZURE_STORAGE_CONNECTION_STRING);
    if (!parts) {
      throw new Error('AZURE_STORAGE_CONNECTION_STRING missing AccountName/AccountKey');
    }
    cached = new SharedKeyBackend(
      cfg.AZURE_STORAGE_CONNECTION_STRING,
      parts,
      cfg.AZURE_STORAGE_CONTAINER,
    );
    return cached;
  }
  /* c8 ignore start */
  if (!cfg.AZURE_STORAGE_ACCOUNT_NAME) {
    throw new Error(
      'Blob storage not configured: set AZURE_STORAGE_CONNECTION_STRING (dev/CI) or AZURE_STORAGE_ACCOUNT_NAME (prod, with managed identity)',
    );
  }
  cached = new UserDelegationBackend(cfg.AZURE_STORAGE_ACCOUNT_NAME, cfg.AZURE_STORAGE_CONTAINER);
  return cached;
  /* c8 ignore stop */
}

/** Test helper: replace or clear the cached backend. */
export function setBlobBackend(replacement: BlobBackend | undefined): void {
  cached = replacement;
}

/* ---------- Path utilities ---------- */

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
};

export const SUPPORTED_MIME_TYPES = Object.keys(MIME_TO_EXT);

export function extForMime(mime: string): string | null {
  return MIME_TO_EXT[mime] ?? null;
}

/**
 * Construct the canonical blob path: `<userId>/<entryDate>/<photoId>.<ext>`.
 * `entryDate` must be `YYYY-MM-DD`.
 */
export function makeBlobPath(
  userId: string,
  entryDate: string,
  photoId: string,
  mimeType: string,
): string {
  const ext = extForMime(mimeType);
  if (!ext) throw new Error(`unsupported mime type: ${mimeType}`);
  return `${userId}/${entryDate}/${photoId}.${ext}`;
}
