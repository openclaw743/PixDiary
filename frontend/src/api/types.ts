/**
 * Shared API types — mirror `docs/api-contracts/openapi.yaml` schemas.
 *
 * Only the fields the frontend reads are typed; extra fields are tolerated.
 * Keeping these in one place means components do not import from `@/api/client`
 * just to get a type.
 */

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
  width?: number;
  height?: number;
  takenAt?: string | null;
  /** AI-generated scene description used as default alt text (optional). */
  altText?: string | null;
}

export interface Entry {
  id: string;
  entryDate: string;
  status: EntryStatus;
  draftText: string | null;
  finalText: string | null;
  photos: PhotoSummary[];
  /** Place from reverse-geocode (optional — frontend just shows it if present). */
  placeName?: string | null;
  /** Model used for the active draft (e.g. "gpt-4o-mini"). */
  model?: string | null;
  createdAt: string;
  lastEditedAt: string | null;
}

export interface EntrySummary {
  id: string;
  entryDate: string;
  status: EntryStatus;
  thumbnailUrl: string | null;
  excerpt: string | null;
  placeName?: string | null;
  photoCount?: number;
}

export interface EntryListResponse {
  items: EntrySummary[];
  nextCursor: string | null;
}

export interface UploadManifestItem {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface UploadIssuedItem {
  photoId: string;
  sasUrl: string;
  blobPath: string;
  expiresAt: string;
}

export interface UploadIssuedResponse {
  items: UploadIssuedItem[];
}

export interface DraftStartResponse {
  entryId: string;
  status: EntryStatus;
}

export interface RegenerateResponse {
  status: 'processing';
}

export interface Settings {
  timezone: string;
  dailyCapEur: number;
}

export interface SettingsUpdate {
  timezone?: string;
  dailyCapEur?: number;
}

export interface ExportPayload {
  exportedAt: string;
  user: {
    id: string;
    email: string;
    timezone: string;
    dailyCapEur: number;
    createdAt: string;
  };
  entries: Entry[];
}
