# Wireframe — Upload screen

Route: `/upload` (also reachable from `/` when there's no entry for today).

## Purpose

Let the user drop today's (or any date's) photos and get a diary draft generated. This is the primary user action — it must be one screen, no friction.

## States

### A. Empty (default)

```
┌──────────────────────────────────────────────────────────────┐
│  PixDiary                                  [📅 Calendar] [⚙] │   ← top nav
├──────────────────────────────────────────────────────────────┤
│                                                              │
│        Today  ▾                          ← date picker       │
│        Friday, May 8                                         │
│                                                              │
│   ┌────────────────────────────────────────────────────┐     │
│   │                                                    │     │
│   │              ⬇  drag photos here                   │     │
│   │                                                    │     │
│   │              or  [  Browse files  ]                │     │
│   │                                                    │     │
│   │      JPEG · PNG · HEIC · WebP, up to 25 MB each    │     │
│   │      Up to 25 photos per day                       │     │
│   │                                                    │     │
│   └────────────────────────────────────────────────────┘     │
│                                                              │
│   Daily AI quota: €0.00 / €0.50  ─────────────────           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Copy:
- Heading: "Today" (or selected date) in 4xl Fraunces.
- Subhead: full date in lg ink.500.
- Drop zone: dashed border-strong, radius-lg, 320px min-height.
- Browse button: secondary.

### B. Drag-active (dragging files over the page)

Drop zone border becomes solid `accent.500`, background `accent.200/40` overlay, helper text changes to **"Drop to upload"**.

### C. Uploading

```
   ┌────────────────────────────────────────────────────┐
   │  IMG_3092.jpg     ▓▓▓▓▓▓▓░░░░  68%                 │
   │  IMG_3093.jpg     ▓▓▓▓▓▓▓▓▓▓  done ✓               │
   │  IMG_3094.heic    ▓▓▓░░░░░░░  31%                  │
   │                                                    │
   │  3 of 5 uploaded                                   │
   └────────────────────────────────────────────────────┘
                        [  Cancel  ]
```

Each row: thumbnail (40×40 from local FileReader URL), filename, progress bar, status icon.

### D. Drafting (after upload completes)

```
   ┌────────────────────────────────────────────────────┐
   │   ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐                    │
   │   │   │ │   │ │   │ │   │ │   │   ← thumb strip    │
   │   └───┘ └───┘ └───┘ └───┘ └───┘                    │
   │                                                    │
   │   ✨  Drafting your entry…                         │
   │   This usually takes 10–20 seconds.                │
   │                                                    │
   │   ────  ────  ────  ────                           │
   │                                                    │
   │   AI quota used: €0.001                            │
   └────────────────────────────────────────────────────┘
```

Animated dots (respect reduced-motion → static "Drafting…").

### E. Quota blocked

Banner above the drop zone:

```
⚠️  Daily AI quota reached (€0.50). New entries pause until tomorrow.
    [ Raise limit in Settings → ]
```

Drop zone disabled (visually faded, drag handlers detached).

## Interactions

| Action | Result |
|---|---|
| Drop files | Validate (mime, size, count) → request SAS URLs → upload concurrently (max 3) → POST `/entries/draft` |
| Click date pill | Date picker opens; selecting a past date moves to that date's draft view |
| Click "Calendar" in nav | → `/calendar` |
| Click ⚙ | → `/settings` |
| Cancel during upload | abort all pending PUTs; orphaned `pending` photos GC'd server-side after 1h |

## Copy rules

- Single-sentence guidance only.
- Numbers (limits, quota) always shown — no surprises.
- Errors are specific: "IMG_3094.heic is 28 MB, max is 25 MB" not "Upload failed".

## A11y (per screen — full doc in `../accessibility.md`)

- Drop zone is a `<button>` (also a drop target). Pressing Enter opens the file picker.
- Drag-active state announces `<div role="status" aria-live="polite">` "Drop to upload".
- Progress bar: `<progress>` with explicit `aria-label="<filename> upload"`.
- "Drafting your entry…" is `aria-live="polite"`.
- Quota number is in a labelled region: `aria-label="Daily AI quota used"`.
- Date picker is keyboard-navigable; ESC closes.
