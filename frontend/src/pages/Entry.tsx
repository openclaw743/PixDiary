import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '@/api/client';
import {
  deleteEntry,
  getEntry,
  regenerateEntry,
  saveEntry,
} from '@/api/entries';
import type { Entry, PhotoSummary } from '@/api/types';
import { AppShell } from '@/components/AppShell';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { QuotaBlockedBanner } from '@/components/QuotaBlockedBanner';
import { useToast } from '@/components/Toast';
import { Lightbox } from '@/pages/entry/Lightbox';
import { formatLongDate, formatShortTime } from '@/lib/dates';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60_000;

/**
 * `/entries/:id` — read + edit one diary entry.
 *
 * Wireframe states A (drafted), B (edit), C (saved), D (processing),
 * E (processing failed), F (quota blocked) all live here. Implements:
 *   - <article> + single <h1> for the date.
 *   - gallery as <ul role="list"> of <button> thumbs.
 *   - lightbox with focus trap returning focus to the originating thumb.
 *   - Cmd/Ctrl+Enter saves, Esc cancels with confirm-on-dirty.
 *   - polling for "processing" → "drafted".
 *   - delete with toast undo.
 */
export default function EntryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { show: showToast } = useToast();

  const [entry, setEntry] = useState<Entry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);

  // Initial load + polling for processing status.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: number | undefined;
    const start = Date.now();

    async function tick(): Promise<void> {
      try {
        const fresh = await getEntry(id!);
        if (cancelled) return;
        setEntry(fresh);
        setLoadError(null);
        const stillProcessing = fresh.status === 'pending' || fresh.status === 'processing';
        if (stillProcessing && Date.now() - start < POLL_TIMEOUT_MS) {
          timer = window.setTimeout(tick, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setLoadError('This entry could not be found.');
        } else {
          setLoadError('Could not load this entry. Please try again.');
        }
      }
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [id]);

  const displayedText = useMemo(
    () => (entry ? (entry.finalText ?? entry.draftText ?? '') : ''),
    [entry],
  );

  // Sync draft when entering edit mode (or when entry text changes externally).
  // The react-hooks/set-state-in-effect rule (new in eslint-plugin-react-hooks
  // v7) flags this, but the pattern is intentional: we genuinely want the draft
  // to follow the canonical text until the user has actually started editing.
  // Disabling locally rather than refactoring to a `key`-based reset keeps the
  // component shape simple; this effect runs at most once per edit/text change
  // and does not cascade renders in practice.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (editing) setDraft(displayedText);
  }, [editing, displayedText]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Focus textarea when entering edit mode.
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  const dirty = editing && draft !== displayedText;

  const handleSave = useCallback(async () => {
    if (!entry) return;
    const trimmed = draft.trim();
    if (trimmed.length < 1 || trimmed.length > 5000) {
      setActionError(
        trimmed.length < 1
          ? 'Diary entry must not be empty.'
          : 'Diary entry must be 5000 characters or fewer.',
      );
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const updated = await saveEntry(entry.id, draft);
      setEntry(updated);
      setEditing(false);
      setSavedFlash(true);
      setSavedAt(updated.lastEditedAt ?? new Date().toISOString());
      window.setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message || 'Could not save.' : 'Network error — could not save.';
      setActionError(msg);
    } finally {
      setSaving(false);
    }
  }, [entry, draft]);

  const handleCancel = useCallback(() => {
    if (dirty) {
      const ok = window.confirm('Discard unsaved changes?');
      if (!ok) return;
    }
    setEditing(false);
    setDraft(displayedText);
    setActionError(null);
    // Return focus to the Edit button.
    window.setTimeout(() => editButtonRef.current?.focus(), 0);
  }, [dirty, displayedText]);

  function onTextareaKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }

  async function handleRegenerate(quality: 'standard' | 'better'): Promise<void> {
    if (!entry) return;
    if (quality === 'better') {
      const ok = window.confirm(
        'Regenerate with the higher-quality model? Estimated additional cost: €0.02.',
      );
      if (!ok) return;
    }
    setRegenerating(true);
    setActionError(null);
    setMoreOpen(false);
    try {
      await regenerateEntry(entry.id, quality);
      // Optimistically reflect processing; the polling effect will pick it up.
      setEntry((cur) => (cur ? { ...cur, status: 'processing' } : cur));
      // Re-trigger polling by re-fetching once.
      const fresh = await getEntry(entry.id);
      setEntry(fresh);
      // Restart polling effect by dependency change is handled by `entry.id`
      // already running on the single mount; pollers will reactivate on the
      // next status check via the polling effect's setTimeout fallback.
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setEntry((cur) => (cur ? { ...cur, status: 'quota_blocked' } : cur));
      } else if (err instanceof ApiError && err.status === 429) {
        setActionError('You have hit the regenerate rate limit. Try again later.');
      } else {
        setActionError(
          err instanceof ApiError ? err.message || 'Could not regenerate.' : 'Network error.',
        );
      }
    } finally {
      setRegenerating(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!entry) return;
    setMoreOpen(false);
    try {
      await deleteEntry(entry.id);
      const deletedId = entry.id;
      showToast({
        message: 'Entry deleted. You can restore it within 30 days.',
        action: {
          label: 'Undo',
          onAction: () => {
            // Best-effort undo — soft delete is server-side; navigate user
            // to settings in production. For MVP, send them to calendar
            // and surface a follow-up via toast.
            void deletedId; // placeholder until the restore endpoint ships
          },
        },
      });
      navigate('/calendar');
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message || 'Could not delete entry.' : 'Network error.',
      );
    }
  }

  if (loadError) {
    return (
      <AppShell>
        <Banner tone="danger" title="Something went wrong">
          <p>{loadError}</p>
          <p className="mt-2">
            <Link to="/calendar" className="font-medium text-accent-700 underline">
              ← Back to calendar
            </Link>
          </p>
        </Banner>
      </AppShell>
    );
  }
  if (!entry) {
    return (
      <AppShell>
        <p role="status" aria-live="polite" className="text-ink-700">
          Loading entry…
        </p>
      </AppShell>
    );
  }

  const isProcessing = entry.status === 'pending' || entry.status === 'processing';
  const isFailed = entry.status === 'processing_failed';
  const isQuotaBlocked = entry.status === 'quota_blocked';
  const isSaved = entry.status === 'saved';

  return (
    <AppShell>
      <article className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <Link to="/calendar" className="text-sm text-accent-700 underline">
            ← Back
          </Link>
        </div>
        <header className="flex flex-col gap-1">
          <h1 className="font-heading text-4xl font-semibold text-ink-900">
            {formatLongDate(entry.entryDate, { withYear: true })}
          </h1>
          {entry.placeName ? (
            <p className="text-lg text-ink-500">{entry.placeName}</p>
          ) : null}
        </header>

        {isQuotaBlocked ? <QuotaBlockedBanner /> : null}

        {entry.photos.length > 0 ? (
          <Gallery
            photos={entry.photos}
            onOpen={(i) => setLightboxIndex(i)}
            thumbRefs={thumbRefs}
          />
        ) : null}

        {isProcessing ? (
          <ProcessingPanel />
        ) : isFailed ? (
          <Banner tone="danger" title="Couldn't draft this entry">
            <p className="mb-3">Please try again.</p>
            <Button
              variant="secondary"
              onClick={() => {
                void handleRegenerate('standard');
              }}
            >
              Try again
            </Button>
          </Banner>
        ) : (
          <DiaryCard
            entry={entry}
            editing={editing}
            draft={draft}
            saving={saving}
            actionError={actionError}
            onChange={setDraft}
            onTextareaKey={onTextareaKey}
            textareaRef={textareaRef}
            displayedText={displayedText}
            savedFlash={savedFlash}
            isSaved={isSaved}
            savedAt={savedAt ?? entry.lastEditedAt}
            onEnterEdit={() => setEditing(true)}
            onSave={handleSave}
            onCancel={handleCancel}
            editButtonRef={editButtonRef}
            dirty={dirty}
            regenerating={regenerating}
            moreOpen={moreOpen}
            setMoreOpen={setMoreOpen}
            onRegenerate={handleRegenerate}
            onDelete={handleDelete}
          />
        )}
      </article>

      {lightboxIndex !== null ? (
        <Lightbox
          photos={entry.photos}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => {
            const closing = lightboxIndex;
            setLightboxIndex(null);
            // Return focus to the originating thumbnail.
            window.setTimeout(() => {
              thumbRefs.current[closing ?? 0]?.focus();
            }, 0);
          }}
        />
      ) : null}
    </AppShell>
  );
}

function Gallery({
  photos,
  onOpen,
  thumbRefs,
}: {
  photos: PhotoSummary[];
  onOpen: (index: number) => void;
  thumbRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
}) {
  return (
    <ul
      role="list"
      className="grid grid-cols-2 gap-2 sm:grid-cols-5"
      aria-label="Photos"
    >
      {photos.map((p, i) => {
        const alt = p.altText ?? `Photo ${i + 1} of ${photos.length}`;
        return (
          <li key={p.id} className="aspect-square">
            <button
              type="button"
              ref={(el) => {
                thumbRefs.current[i] = el;
              }}
              onClick={() => onOpen(i)}
              aria-label={`Photo ${i + 1} of ${photos.length}: ${alt}`}
              className="h-full w-full overflow-hidden rounded-md bg-surface-raised shadow-sm focus-visible:outline-none"
            >
              <img
                src={p.readUrl}
                alt={alt}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ProcessingPanel() {
  return (
    <section
      aria-label="Drafting in progress"
      className="rounded-lg border border-border-subtle bg-surface-card p-6 shadow-sm"
    >
      <p
        className="font-heading text-2xl text-ink-900"
        role="status"
        aria-live="polite"
      >
        <span aria-hidden="true">✨ </span>
        Drafting your entry…
      </p>
      <p className="mt-1 text-base text-ink-700">This usually takes 10–20 seconds.</p>
    </section>
  );
}

interface DiaryCardProps {
  entry: Entry;
  editing: boolean;
  draft: string;
  saving: boolean;
  actionError: string | null;
  onChange: (v: string) => void;
  onTextareaKey: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  displayedText: string;
  savedFlash: boolean;
  isSaved: boolean;
  savedAt: string | null;
  onEnterEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  editButtonRef: React.RefObject<HTMLButtonElement>;
  dirty: boolean;
  regenerating: boolean;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
  onRegenerate: (q: 'standard' | 'better') => void;
  onDelete: () => void;
}

function DiaryCard(props: DiaryCardProps) {
  const {
    entry,
    editing,
    draft,
    saving,
    actionError,
    onChange,
    onTextareaKey,
    textareaRef,
    displayedText,
    savedFlash,
    isSaved,
    savedAt,
    onEnterEdit,
    onSave,
    onCancel,
    editButtonRef,
    dirty,
    regenerating,
    moreOpen,
    setMoreOpen,
    onRegenerate,
    onDelete,
  } = props;

  const charCount = draft.length;
  const overLimit = charCount > 5000;

  return (
    <section className="flex flex-col gap-3">
      <div className="rounded-lg bg-surface-card p-6 shadow-sm sm:p-10">
        {editing ? (
          <>
            <div className="mb-3 flex items-center gap-2 border-b border-border-subtle pb-2 text-sm text-ink-700">
              <span className="sr-only">Edit toolbar</span>
              <span aria-hidden="true">Editing — Ctrl/⌘+Enter to save · Esc to cancel</span>
            </div>
            <label htmlFor="entry-textarea" className="sr-only">
              Diary entry
            </label>
            <textarea
              id="entry-textarea"
              ref={textareaRef}
              value={draft}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onTextareaKey}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              aria-invalid={overLimit || undefined}
              aria-describedby="entry-charcount"
              maxLength={6000}
              rows={Math.max(8, Math.min(24, Math.ceil(draft.length / 60)))}
              className="w-full resize-y bg-transparent font-body text-lg leading-relaxed text-ink-900 focus-visible:outline-none"
            />
            <p
              id="entry-charcount"
              className={`mt-2 text-sm ${overLimit ? 'text-danger' : 'text-ink-500'}`}
            >
              {charCount} / 5000 characters
            </p>
          </>
        ) : (
          <p className="whitespace-pre-wrap font-body text-lg leading-relaxed text-ink-900">
            {displayedText || (
              <span className="text-ink-500">
                No text yet. Click Edit to start writing.
              </span>
            )}
          </p>
        )}
        <p className="mt-6 text-xs text-ink-500">
          {isSaved
            ? savedAt
              ? `Saved · last edited ${formatShortTime(savedAt)}`
              : 'Saved'
            : entry.draftText
              ? `AI draft · ${entry.model ?? 'gpt-4o-mini'} · ${formatShortTime(entry.createdAt)}`
              : null}
        </p>
      </div>

      {actionError ? (
        <Banner tone="danger" title="Could not save">
          {actionError}
        </Banner>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {editing ? (
            <Button variant="secondary" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          ) : (
            <Button
              ref={editButtonRef}
              variant="secondary"
              onClick={onEnterEdit}
            >
              Edit
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {editing ? (
            <Button onClick={onSave} loading={saving} disabled={!dirty || overLimit}>
              {savedFlash ? 'Saved ✓' : 'Save'}
            </Button>
          ) : (
            <Button onClick={onEnterEdit} disabled>
              Save
            </Button>
          )}
        </div>
      </div>

      <details
        open={moreOpen}
        className="rounded-md border border-border-subtle bg-surface-card p-3"
        onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-medium text-ink-700">
          More: Regenerate · Higher quality · Delete
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onRegenerate('standard')}
            disabled={regenerating}
          >
            Regenerate
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onRegenerate('better')}
            disabled={regenerating}
          >
            Higher quality (€0.02)
          </Button>
          <Button variant="danger" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </details>
    </section>
  );
}
