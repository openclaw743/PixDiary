# PixDiary — Design System

Visual tone: **warm, personal, paper-like**. Not a SaaS dashboard.

PixDiary is a diary, so the surface should feel closer to a notebook than a control panel. Cream backgrounds, terracotta accents, serif headings paired with humanist sans body. Photos do the heavy visual lifting — UI gets out of the way.

## Tokens

`tokens.json` is the source of truth. Tailwind theme extension reads from it (frontend wires this up in Phase 5).

### Palette

- **Ink scale (`ink.50` → `ink.900`)** — neutrals tinted warm beige rather than cool gray. `ink.900` is body text on cream; `ink.500` is muted/secondary.
- **Accent (`accent.500` ≈ #D98548)** — terracotta. Used sparingly: focus ring, primary button background, save action, "today" pill on calendar.
- **Surface** — `surface.page` (cream) for the app background, `surface.card` (white) for editable areas, `surface.raised` (light beige) for hover/secondary.
- **Status** — `success`, `warning`, `danger` reserved for system states only (saved, quota warning, error). Not for decoration.

### Typography

- Headings: **Fraunces** (variable serif). High contrast, slightly literary; suits a diary.
- Body: **Inter**. Self-hosted via `@fontsource`. No Google Fonts CDN at runtime (privacy + perf).
- Mono: system stack (only used in error/debug surfaces).

### Spacing & rhythm

- 4px base. Generous vertical rhythm — diary entries should breathe.
- Default content max-width on entry view: `680px`. Reading width.
- Grid breakpoints: 640 / 768 / 1024 / 1280.

### Components (built later by Developer)

| Component | States |
|---|---|
| Button (primary, secondary, ghost, danger) | default, hover, active, focus, disabled, loading |
| Input (text, password, email) | default, focus, error, disabled |
| Photo card | thumb, full, drag-active |
| Drop zone | empty, hovering, dragging, uploading, success, error |
| Banner (info, warning, error, success) | dismissable |
| Calendar tile | empty day, has-entry, today, hovered, focused |
| Modal | open/closed, small/medium |
| Toast | info, success, error, auto-dismiss timer |

## When to use what

- **Use accent only for primary action affordances.** A page should have at most one accent surface visible at rest (the primary CTA). Quota banners and error states stay in their semantic colors.
- **Photos are the hero.** Cards have soft shadow (`shadow.md`), no bright borders. No photo cropping in the entry view — letterbox if needed; never crop a person out.
- **Edit affordance must be obvious.** The diary text uses a "paper" surface (`surface.card`, `radius.lg`, `shadow.sm`); clicking anywhere in the text reveals the editing toolbar at the bottom.
- **Empty states are friendly, not chirpy.** "No entries yet — start with today's photos" rather than "Welcome to your AI journey!".
- **Motion is restrained.** 200ms standard duration. No bounces. No big page transitions. Photos can fade in.

## Accessibility (summary; full notes in `accessibility.md`)

- WCAG 2.1 AA across the board.
- Keyboard navigation through every screen. Visible focus ring (3px, accent).
- Color contrast: body ≥ 7:1 (AAA — easy with ink.900 on cream), UI controls ≥ 4.5:1.
- Screen reader landmarks on every page. AI-generated photo alt text on by default; user can override per photo.
- Reduced-motion respected (`prefers-reduced-motion: reduce` disables non-essential animation).
- Forms: labels always present (no placeholder-as-label).

— Designer (Bob, doubling)
