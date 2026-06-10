import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ApiError } from '@/api/client';
import {
  requestUploadUrls,
  startDraft,
} from '@/api/entries';
import type { UploadIssuedItem } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { AppShell } from '@/components/AppShell';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { QuotaBlockedBanner } from '@/components/QuotaBlockedBanner';
import { uploadToBlob } from '@/lib/blobUpload';
import { formatLongDate, parseIsoDate, toIsoDate } from '@/lib/dates';
import {
  ACCEPT_ATTR,
  MAX_BATCH_SIZE,
  MAX_CONCURRENT_UPLOADS,
  MAX_FILE_BYTES,
  formatBytes,
  runWithConcurrency,
  validateFiles,
} from '@/lib/uploads';

type RowStatus =
  | 'queued'
  | 'requesting'
  | 'uploading'
  | 'done'
  | 'error'
  | 'aborted';

interface UploadRow {
  localId: string;
  file: File;
  photoId?: string;
  loaded: number;
  total: number;
  status: RowStatus;
  error?: string;
}

type Phase =
  | 'idle'
  | 'uploading'
  | 'drafting'
  | 'quota_blocked'
  | 'error';

/**
 * `/upload` — the primary user action. Drag-drop multi-photo upload, then
 * kick off the AI draft and navigate to the entry view.
 *
 * Implements wireframe 01-upload.md states A–E and accessibility.md per-screen
 * notes (drop zone is a button, aria-live progress region, etc).
 */
export default function UploadPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const queryDate = params.get('date');
  const initialDate = useMemo(() => {
    if (queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate)) return queryDate;
    return toIsoDate(new Date(), user?.timezone);
  }, [queryDate, user?.timezone]);
  const [entryDate, setEntryDate] = useState(initialDate);

  const [rows, setRows] = useState<UploadRow[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessages, setErrorMessages] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const dailyCap = user?.dailyCapEur ?? 0.5;

  function patchRow(localId: string, patch: Partial<UploadRow>): void {
    setRows((cur) =>
      cur.map((r) => (r.localId === localId ? { ...r, ...patch } : r)),
    );
  }

  const startUpload = useCallback(
    async (files: File[]) => {
      const { accepted, errors } = validateFiles(files);
      setErrorMessages(errors.map((e) => e.message));
      if (accepted.length === 0) return;

      // Build initial rows
      const initialRows: UploadRow[] = accepted.map((file, idx) => ({
        localId: `${Date.now()}-${idx}-${file.name}`,
        file,
        loaded: 0,
        total: file.size,
        status: 'queued',
      }));
      setRows(initialRows);
      setPhase('uploading');
      const controller = new AbortController();
      abortRef.current = controller;

      // 1) Request SAS URLs in one batch.
      let issued: UploadIssuedItem[];
      try {
        const resp = await requestUploadUrls({
          entryDate,
          items: accepted.map((f) => ({
            filename: f.name,
            mimeType: f.type,
            sizeBytes: f.size,
          })),
        });
        issued = resp.items;
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) {
          setPhase('quota_blocked');
          return;
        }
        if (err instanceof ApiError) {
          setPhase('error');
          setErrorMessages([err.message || 'Could not start upload.']);
        } else {
          setPhase('error');
          setErrorMessages(['Network error — could not start upload.']);
        }
        return;
      }

      // Match issued URLs to rows by index.
      setRows((cur) =>
        cur.map((r, i) =>
          issued[i] ? { ...r, photoId: issued[i].photoId, status: 'uploading' } : r,
        ),
      );

      // 2) Upload concurrently (≤ MAX_CONCURRENT_UPLOADS).
      const tasks = initialRows.map((row, i) => async () => {
        const target = issued[i];
        if (!target) throw new Error('Missing SAS URL for row');
        await uploadToBlob(target.sasUrl, row.file, {
          signal: controller.signal,
          onProgress: (loaded, total) => {
            patchRow(row.localId, { loaded, total });
          },
        });
        patchRow(row.localId, {
          status: 'done',
          loaded: row.file.size,
          total: row.file.size,
        });
      });

      const results = await runWithConcurrency(tasks, MAX_CONCURRENT_UPLOADS);
      if (controller.signal.aborted) {
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            patchRow(initialRows[i].localId, { status: 'aborted' });
          }
        });
        setPhase('idle');
        return;
      }
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const reason =
            r.reason instanceof Error ? r.reason.message : 'Upload failed';
          patchRow(initialRows[i].localId, { status: 'error', error: reason });
        }
      });
      const okPhotoIds = issued.filter((_, i) => results[i].status === 'fulfilled').map((it) => it.photoId);
      if (okPhotoIds.length === 0) {
        setPhase('error');
        setErrorMessages(['All uploads failed. Please try again.']);
        return;
      }

      // 3) Kick off the draft and navigate.
      setPhase('drafting');
      try {
        const draft = await startDraft({ entryDate, photoIds: okPhotoIds });
        if (draft.status === 'quota_blocked') {
          setPhase('quota_blocked');
          return;
        }
        navigate(`/entries/${draft.entryId}`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) {
          setPhase('quota_blocked');
          return;
        }
        const msg =
          err instanceof ApiError
            ? err.message || 'Could not start drafting.'
            : 'Network error — could not start drafting.';
        setPhase('error');
        setErrorMessages([msg]);
      }
    },
    [entryDate, navigate],
  );

  function onFilesChosen(list: FileList | null): void {
    if (!list) return;
    const files = Array.from(list);
    void startUpload(files);
  }

  function openPicker(): void {
    fileInputRef.current?.click();
  }

  function onDropZoneKey(e: KeyboardEvent<HTMLButtonElement>): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPicker();
    }
  }

  function onDragOver(e: DragEvent): void {
    e.preventDefault();
    if (phase === 'quota_blocked') return;
    setDragActive(true);
  }
  function onDragLeave(e: DragEvent): void {
    e.preventDefault();
    setDragActive(false);
  }
  function onDrop(e: DragEvent): void {
    e.preventDefault();
    setDragActive(false);
    if (phase === 'quota_blocked') return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    void startUpload(files);
  }

  function cancelUpload(): void {
    abortRef.current?.abort();
    setPhase('idle');
  }

  // Cleanup AbortController on unmount.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const isBusy = phase === 'uploading' || phase === 'drafting';
  const liveStatus = useMemo(() => buildLiveStatus(phase, rows, dragActive), [phase, rows, dragActive]);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <label htmlFor="entry-date" className="text-sm font-medium text-ink-700">
            Date
          </label>
          <input
            id="entry-date"
            type="date"
            value={entryDate}
            max={toIsoDate(new Date(), user?.timezone)}
            onChange={(e) => setEntryDate(e.target.value)}
            className="w-fit rounded-sm border border-border-strong bg-surface-card px-3 py-2 text-base text-ink-900"
          />
          <h1 className="font-heading text-4xl font-semibold text-ink-900">
            {entryDate === toIsoDate(new Date(), user?.timezone)
              ? 'Today'
              : formatLongDate(entryDate, { withYear: false, timeZone: user?.timezone })}
          </h1>
          <p className="text-lg text-ink-500">
            {formatLongDate(parseIsoDate(entryDate).toISOString().slice(0, 10), {
              withYear: true,
            })}
          </p>
        </header>

        {phase === 'quota_blocked' ? <QuotaBlockedBanner capEur={dailyCap} /> : null}

        {errorMessages.length > 0 ? (
          <Banner tone="danger" title="Some files were skipped">
            <ul className="list-disc pl-5">
              {errorMessages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </Banner>
        ) : null}

        <DropZone
          dragActive={dragActive}
          disabled={phase === 'quota_blocked' || isBusy}
          onClick={openPicker}
          onKeyDown={onDropZoneKey}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        />

        <input
          ref={fileInputRef}
          data-testid="file-input"
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          aria-label="Choose photos to upload"
          className="sr-only"
          onChange={(e) => {
            onFilesChosen(e.target.files);
            // reset so picking the same files again still fires onChange
            e.target.value = '';
          }}
        />

        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {liveStatus}
        </div>

        {rows.length > 0 ? <UploadList rows={rows} onCancel={cancelUpload} isBusy={isBusy} /> : null}

        {phase === 'drafting' ? <DraftingPanel rows={rows} /> : null}

        <p
          className="text-sm text-ink-700"
          aria-label="Daily AI quota used"
        >
          Daily AI quota: <strong>€0.00 / €{dailyCap.toFixed(2)}</strong>
        </p>
      </div>
    </AppShell>
  );
}

function buildLiveStatus(phase: Phase, rows: UploadRow[], dragActive: boolean): string {
  if (phase === 'quota_blocked') return 'Daily AI quota reached. Uploads paused.';
  if (dragActive) return 'Drop to upload';
  if (phase === 'drafting') return 'Drafting your entry';
  if (phase === 'uploading') {
    const done = rows.filter((r) => r.status === 'done').length;
    return `${done} of ${rows.length} uploaded`;
  }
  return '';
}

function DropZone(props: {
  dragActive: boolean;
  disabled: boolean;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}) {
  const { dragActive, disabled, onClick, onKeyDown, onDragOver, onDragLeave, onDrop } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={onKeyDown}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      disabled={disabled}
      aria-label="Upload photos: drop files here or activate to browse"
      className={[
        'flex min-h-[320px] w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center',
        'transition-colors duration-base ease-standard',
        dragActive
          ? 'border-accent-500 bg-accent-200/40'
          : 'border-border-strong bg-surface-card',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-surface-raised',
      ].join(' ')}
    >
      <span aria-hidden="true" className="text-4xl">
        ⬇
      </span>
      <span className="font-heading text-2xl text-ink-900">
        {dragActive ? 'Drop to upload' : 'Drag photos here'}
      </span>
      <span className="text-base text-ink-700">
        or <span className="font-medium text-accent-700 underline">Browse files</span>
      </span>
      <span className="text-sm text-ink-500">
        JPEG · PNG · HEIC · WebP, up to {formatBytes(MAX_FILE_BYTES)} each
      </span>
      <span className="text-sm text-ink-500">
        Up to {MAX_BATCH_SIZE} photos per day
      </span>
    </button>
  );
}

function UploadList({
  rows,
  onCancel,
  isBusy,
}: {
  rows: UploadRow[];
  onCancel: () => void;
  isBusy: boolean;
}) {
  const done = rows.filter((r) => r.status === 'done').length;
  return (
    <section
      aria-label="Uploads in progress"
      className="rounded-md border border-border-subtle bg-surface-card p-4"
    >
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li
            key={r.localId}
            className="flex items-center gap-3 text-sm text-ink-900"
          >
            <span className="w-40 truncate" title={r.file.name}>
              {r.file.name}
            </span>
            <progress
              value={r.loaded}
              max={r.total || 1}
              aria-label={`${r.file.name} upload`}
              className="h-2 flex-1"
            />
            <span className="w-20 text-right text-ink-700">
              {r.status === 'done'
                ? 'done ✓'
                : r.status === 'error'
                  ? `error: ${r.error ?? 'failed'}`
                  : r.status === 'aborted'
                    ? 'cancelled'
                    : `${Math.floor((r.loaded / Math.max(1, r.total)) * 100)}%`}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between text-sm">
        <p className="text-ink-700">
          {done} of {rows.length} uploaded
        </p>
        {isBusy ? (
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function DraftingPanel({ rows }: { rows: UploadRow[] }) {
  return (
    <section
      aria-label="Drafting entry"
      className="rounded-lg border border-border-subtle bg-surface-card p-6 shadow-sm"
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {rows.map((r) => (
          <div
            key={r.localId}
            className="h-12 w-12 rounded-sm bg-surface-raised"
            aria-hidden="true"
          />
        ))}
      </div>
      <p
        className="font-heading text-2xl text-ink-900"
        role="status"
        aria-live="polite"
      >
        <span aria-hidden="true">✨ </span>
        Drafting your entry…
      </p>
      <p className="mt-1 text-base text-ink-700">
        This usually takes 10–20 seconds.
      </p>
    </section>
  );
}
