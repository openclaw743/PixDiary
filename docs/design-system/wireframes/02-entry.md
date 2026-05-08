# Wireframe — Entry view + edit

Route: `/entries/:id` (also `/entries/today` shorthand).

## Purpose

Display the photos, the AI-drafted (or saved) diary text, and let the user edit and save. The single most-read screen — long-form readability matters.

## States

### A. Drafted (AI just finished, user hasn't edited)

```
┌──────────────────────────────────────────────────────────────┐
│  ← Back                                       [📅] [⚙]       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│           Friday, May 8 2026                                 │
│           Café Nero, Vesterbro · Copenhagen                  │
│                                                              │
│   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐               │
│   │ pic  │ │ pic  │ │ pic  │ │ pic  │ │ pic  │   ← gallery   │
│   │  1   │ │  2   │ │  3   │ │  4   │ │  5   │               │
│   └──────┘ └──────┘ └──────┘ └──────┘ └──────┘               │
│                                                              │
│   ┌────────────────────────────────────────────────────┐     │
│   │                                                    │     │
│   │  Slept in. Walked to Vesterbro for a flat white    │     │
│   │  at the corner café — the morning was bright       │     │
│   │  and the streets still empty. ...                  │     │
│   │                                                    │     │
│   │                                                    │     │
│   │  AI draft · gpt-4o-mini · 14:23                    │     │
│   └────────────────────────────────────────────────────┘     │
│                                                              │
│   [  Edit  ]                                  [  Save  ]     │
│                                                              │
│   ▾ More: Regenerate · Higher quality (€0.02) · Delete       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

- Date heading: 4xl Fraunces ink.900.
- Place: lg ink.500.
- Gallery: 5-column on desktop, 2-column on mobile, square thumbs (object-fit: cover). Click → lightbox.
- Diary surface: `surface.card` paper, max-width 680px, 24/40 padding, `radius.lg`, `shadow.sm`. Body in 18px Fraunces or Inter (test both, pick the more readable for prose at length — default Inter, override token if Fraunces wins).
- Footer micro-text: model used + draft time (so the user knows what the AI is).
- Save button: primary (accent). Becomes enabled only when text changed.

### B. Edit mode (clicked "Edit", or clicked into the text)

The card becomes a `<textarea>` (auto-resizes), same typography, with a thin toolbar above:

```
   ┌──────────────────  Edit toolbar  ──────────────────┐
   │  [B]  [I]  [↩ undo]                                │
   └────────────────────────────────────────────────────┘
   ┌────────────────────────────────────────────────────┐
   │                                                    │
   │  [textarea — same paper feel, blinking cursor]     │
   │                                                    │
   └────────────────────────────────────────────────────┘
   [  Cancel  ]                              [  Save  ]
```

Cancel → revert to last saved (or last draft if never saved). Confirm-on-discard if there are unsaved changes.

### C. Saved (after Save)

Toolbar fades. Footer text changes:

```
   Saved · last edited 14:31
```

The "Save" button becomes a quiet "Saved ✓" pill for 2s, then re-disables until next change.

### D. Processing (entry was just created, AI hasn't finished)

```
   ┌────────────────────────────────────────────────────┐
   │   ✨  Drafting your entry…                         │
   │   ────  ────  ────                                 │
   └────────────────────────────────────────────────────┘
```

Polls the entry every 2s up to 60s, exponential beyond.

### E. Processing failed

Card shows error tone:

```
   ⚠ Couldn't draft this entry.
     [ Try again ]
```

### F. Quota blocked

Banner: same as upload screen.

## Interactions

| Action | Result |
|---|---|
| Click photo | Lightbox (keyboard nav, ESC to close) |
| Click into diary text | Switch to edit mode (preserves cursor position) |
| Cmd/Ctrl+Enter in edit mode | Save |
| Esc in edit mode | Cancel (with confirm if dirty) |
| "More → Regenerate" | POST `/entries/:id/regenerate` (standard) |
| "More → Higher quality" | POST regenerate `quality=better`. Confirms with cost preview. |
| "More → Delete" | Soft-delete with toast "Deleted. Undo for 30 days." |

## Copy rules

- Date and place are not editable — they come from EXIF + reverse geocode.
- Footer always shows what model produced the text.
- Cost preview ("€0.02") uses the same units as Settings.

## A11y

- Diary surface is `<article>` with `<h1>` for the date.
- Photo gallery: `<ul role="list">` with `<button>` triggers; alt text from `photo.ai_scene.scene` (AI-generated, user-overridable per photo from lightbox).
- Lightbox: focus trap, ESC returns focus to the originating thumbnail.
- Edit mode: textarea has `aria-label="Diary entry"`, save shortcut announced via `aria-keyshortcuts="Meta+Enter"`.
- Toolbar buttons have `aria-label` (icons only).
