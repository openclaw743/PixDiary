# PixDiary — Accessibility (WCAG 2.1 AA)

Target: WCAG 2.1 AA. Most diary readers will not be using assistive tech, but the ones who do are deeply invested in journaling and deserve full access. Also: a11y improves the product for everyone.

## Principles

1. **Keyboard-only must work end-to-end.** Sign up, upload (with file dialog), edit, save, navigate calendar.
2. **Visible focus, always.** A 3px terracotta ring is the default; no `outline: none` without a replacement.
3. **Semantic HTML first.** Buttons are `<button>`. Headings are real headings. Forms have labels. Lists are lists.
4. **Live regions for async state.** Drafting, uploading, saving — every async UI change is announced.
5. **Reduced motion respected.** Photos still fade in (subtle), but no parallax, no animated illustrations.
6. **Color is never the only signal.** Status uses an icon + label, not just a color.

## Color contrast (verified)

| Token pair | Ratio | Use |
|---|---|---|
| `ink.900` on `surface.page` (#1A1714 on #FAF6EF) | 14.4 : 1 | Body text — AAA |
| `ink.700` on `surface.page` | 9.5 : 1 | Secondary text — AAA |
| `ink.500` on `surface.page` | 4.6 : 1 | Tertiary text — AA, do not use for ≤14px |
| `surface.page` on `accent.500` (#FAF6EF on #D98548) | 3.2 : 1 | Accent button text — fails AA. Use `surface.card` (#FFFFFF) on `accent.700` (#A0521A) for primary buttons → 5.5:1 ✓ |
| `accent.700` (focus ring) on `surface.page` | 4.7 : 1 | Focus ring | 

**Action item:** primary button background is `accent.700` not `accent.500`. The lighter accent is for hover/decoration only.

## Per-screen notes

### Upload (`01-upload.md`)
- File dialog opened by Enter on the drop zone (also a button).
- `aria-live="polite"` region announces "Drop to upload" / "5 of 5 uploaded" / "Drafting your entry".
- Filename, size, and progress in each row — screen readers get the full state.

### Entry (`02-entry.md`)
- Single `<h1>` per page (the date). Subtitle is `<p>`.
- Gallery thumbs are `<button>` triggers for the lightbox; each has `aria-label="Photo 3 of 5: a flat white on a wooden table"` (alt from AI scene description).
- Lightbox is a focus trap. ESC closes and returns focus to the originating thumbnail.
- Edit textarea has explicit `<label class="sr-only">Diary entry</label>`.
- Cmd/Ctrl+Enter saves; advertised via `aria-keyshortcuts`.
- Toolbar buttons have visible icons + `aria-label`.

### Calendar (`03-calendar.md`)
- `<table role="grid">` with `<th scope="col">` weekday headers.
- Arrow-key navigation between days. Home/End/PgUp/PgDn supported.
- Today: `aria-current="date"`. Selected: `aria-current="true"`.
- Disabled future days: `<button disabled aria-disabled="true">`.

## Forms

- Every input has a visible `<label>`. Placeholder is **not** a label.
- Errors:
  - Inline, below the field, in `text-danger` + ⚠ icon.
  - Field gets `aria-invalid="true"` and `aria-describedby="<errorId>"`.
  - Form submit failures focus the first invalid field.
- Password rules visible up-front (not after-the-fact).

## Images & media

- Photo `alt` defaults to AI-generated scene description (e.g. "Flat white on a wooden table, morning light").
- User can override per photo from the lightbox ("Edit description").
- Decorative iconography (e.g. emoji in copy) marked `aria-hidden="true"`.

## Motion

- `@media (prefers-reduced-motion: reduce)` disables: drafting dots animation, save toast slide-in, lightbox zoom. Fades remain (≤200ms, opacity only).

## Testing

- **Manual checklist** per screen, run by QA in Phase 9.
- **Automated:** axe-core via Playwright. Target: 0 critical issues, ≤2 serious issues at MVP launch.
- **Lighthouse a11y** target ≥ 95.
