/**
 * Thin domain-typed wrappers around the generic `api` client.
 *
 * Components import these named functions instead of building their own
 * URLs — keeps endpoint paths in exactly one place.
 */

import { api } from '@/api/client';
import type {
  DraftStartResponse,
  Entry,
  EntryListResponse,
  ExportPayload,
  RegenerateResponse,
  Settings,
  SettingsUpdate,
  UploadIssuedResponse,
  UploadManifestItem,
} from '@/api/types';

export function listEntries(params: {
  limit?: number;
  cursor?: string;
  from?: string;
  to?: string;
} = {}): Promise<EntryListResponse> {
  const search = new URLSearchParams();
  if (params.limit) search.set('limit', String(params.limit));
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  const qs = search.toString();
  return api.get<EntryListResponse>(`/entries${qs ? `?${qs}` : ''}`);
}

export function getEntry(entryId: string): Promise<Entry> {
  return api.get<Entry>(`/entries/${encodeURIComponent(entryId)}`);
}

export function saveEntry(entryId: string, text: string): Promise<Entry> {
  return api.put<Entry>(`/entries/${encodeURIComponent(entryId)}`, { text });
}

export function deleteEntry(entryId: string): Promise<void> {
  return api.delete<void>(`/entries/${encodeURIComponent(entryId)}`);
}

export function regenerateEntry(
  entryId: string,
  quality: 'standard' | 'better' = 'standard',
): Promise<RegenerateResponse> {
  return api.post<RegenerateResponse>(
    `/entries/${encodeURIComponent(entryId)}/regenerate`,
    { quality },
  );
}

export function requestUploadUrls(body: {
  entryDate: string;
  items: UploadManifestItem[];
  idempotencyKey?: string;
}): Promise<UploadIssuedResponse> {
  const headers: Record<string, string> = {};
  if (body.idempotencyKey) headers['Idempotency-Key'] = body.idempotencyKey;
  return api.post<UploadIssuedResponse>(
    '/uploads',
    { entryDate: body.entryDate, items: body.items },
    { headers },
  );
}

export function startDraft(body: {
  entryDate: string;
  photoIds: string[];
  idempotencyKey?: string;
}): Promise<DraftStartResponse> {
  const headers: Record<string, string> = {};
  if (body.idempotencyKey) headers['Idempotency-Key'] = body.idempotencyKey;
  return api.post<DraftStartResponse>(
    '/entries/draft',
    { entryDate: body.entryDate, photoIds: body.photoIds },
    { headers },
  );
}

export function getSettings(): Promise<Settings> {
  return api.get<Settings>('/settings');
}

export function updateSettings(body: SettingsUpdate): Promise<Settings> {
  return api.put<Settings>('/settings', body);
}

export function exportAccount(): Promise<ExportPayload> {
  return api.get<ExportPayload>('/export');
}

export function deleteAccount(body: {
  password: string;
  confirmation: string;
}): Promise<void> {
  return api.delete<void>('/account', { body });
}
