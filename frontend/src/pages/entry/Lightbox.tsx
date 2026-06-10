import { Dialog, DialogPanel } from '@headlessui/react';
import { useEffect, useState, type KeyboardEvent } from 'react';

import type { PhotoSummary } from '@/api/types';

/**
 * Photo lightbox — opens at `index` and lets the user navigate with arrows,
 * close with ESC, and edit the per-photo alt text.
 *
 * Per `accessibility.md`:
 *  - focus trap (handled by `<Dialog>`)
 *  - ESC closes and returns focus to the originating thumbnail (caller wires
 *    that up via the parent's `onClose` handler)
 *  - alt text editable per photo from this lightbox
 */
export function Lightbox({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: PhotoSummary[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const photo = photos[index];
  const [editingAlt, setEditingAlt] = useState(false);
  const [altDraft, setAltDraft] = useState(photo?.altText ?? '');
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // Keep alt input in sync when navigating between photos.
  // The react-hooks/set-state-in-effect rule (new in eslint-plugin-react-hooks
  // v7) flags these as cascading renders, but here they are a deliberate sync
  // of local UI state to a prop change — cleaner than re-keying the component
  // tree on every navigation. Disabling locally with a justification.

  useEffect(() => {
    setEditingAlt(false);
    setAltDraft(overrides[photo?.id ?? ''] ?? photo?.altText ?? '');
  }, [photo, overrides]);


  if (!photo) return null;

  const altText = overrides[photo.id] ?? photo.altText ?? `Photo ${index + 1} of ${photos.length}`;

  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (index < photos.length - 1) onIndexChange(index + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (index > 0) onIndexChange(index - 1);
    }
  }

  function saveAlt(): void {
    setOverrides((cur) => ({ ...cur, [photo.id]: altDraft.trim() }));
    setEditingAlt(false);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      className="relative z-modal"
      aria-label={`Photo ${index + 1} of ${photos.length}`}
    >
      <div className="fixed inset-0 bg-ink-900/80" aria-hidden="true" />
      <div
        className="fixed inset-0 flex items-center justify-center p-4"
        onKeyDown={onKey}
      >
        <DialogPanel className="relative flex max-h-[90vh] max-w-5xl flex-col gap-3 rounded-lg bg-surface-card p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink-700">
              Photo {index + 1} of {photos.length}
            </p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-sm px-2 py-1 text-ink-700 hover:bg-surface-raised"
            >
              ✕
            </button>
          </div>
          <img
            src={photo.readUrl}
            alt={altText}
            className="max-h-[70vh] w-full object-contain"
          />
          <div className="flex flex-col gap-2">
            {editingAlt ? (
              <>
                <label htmlFor="alt-text" className="text-sm font-medium text-ink-800">
                  Photo description
                </label>
                <textarea
                  id="alt-text"
                  value={altDraft}
                  onChange={(e) => setAltDraft(e.target.value)}
                  rows={2}
                  className="w-full rounded-sm border border-border-strong bg-surface-card px-2 py-1 text-sm text-ink-900"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={saveAlt}
                    className="rounded-sm border border-border-strong bg-accent-700 px-3 py-1 text-sm text-surface-card"
                  >
                    Save description
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingAlt(false)}
                    className="rounded-sm border border-border-strong bg-surface-card px-3 py-1 text-sm text-ink-900"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <p className="flex-1 text-sm text-ink-700">{altText}</p>
                <button
                  type="button"
                  onClick={() => setEditingAlt(true)}
                  className="text-sm font-medium text-accent-700 underline"
                >
                  Edit description
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => onIndexChange(Math.max(0, index - 1))}
              disabled={index === 0}
              aria-label="Previous photo"
              className="rounded-sm px-3 py-1 text-ink-700 hover:bg-surface-raised disabled:opacity-50"
            >
              ← Previous
            </button>
            <button
              type="button"
              onClick={() => onIndexChange(Math.min(photos.length - 1, index + 1))}
              disabled={index === photos.length - 1}
              aria-label="Next photo"
              className="rounded-sm px-3 py-1 text-ink-700 hover:bg-surface-raised disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
