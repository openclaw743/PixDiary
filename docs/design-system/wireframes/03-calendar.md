# Wireframe — Calendar

Route: `/calendar` (and `/`).

## Purpose

A month view of the user's diary. At-a-glance: which days have entries, which are empty, today highlighted. Clicking a day → that entry (or the upload screen if empty).

## States

### A. Default (current month, has entries)

```
┌──────────────────────────────────────────────────────────────┐
│  PixDiary                            [+ New entry]  [⚙]      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   May 2026                                       ‹  ›        │
│                                                              │
│   Mon  Tue  Wed  Thu  Fri  Sat  Sun                          │
│   ───  ───  ───  ───  ───  ───  ───                          │
│         ·     ·    ·   [1]   2    3   4                      │
│   [5]  [6]   7    8   [9]  [10] [11] 12                      │
│   13  [14]  [15] 16  17   18   19   20                       │
│   ...                                                        │
│                                                              │
│   ─── Recent ───                                             │
│                                                              │
│   • Fri May 8   Café Nero, Vesterbro · 5 photos              │
│     "Slept in. Walked to Vesterbro…"                         │
│                                                              │
│   • Wed May 6   Home · 2 photos                              │
│     "Quiet day. Books, tea, the cat in the…"                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Notes:
- Each tile is 56×56 (desktop) or 44×44 (mobile).
- Tile with an entry: shows a small thumbnail of the first photo as the tile background, with date number overlaid (high contrast text shadow).
- Tile without an entry: cream surface, ink.500 number.
- Today: thin terracotta border (2px `accent.500`).
- Selected: solid terracotta background, `surface.page` text.

### B. Empty month

```
   May 2026                                       ‹  ›

   Mon  Tue  Wed  Thu  Fri  Sat  Sun
   1    2    3    4   [5]   6    7    8
   ...

   ─── Nothing here yet ───

           Start with today's photos.
           [  + New entry  ]
```

### C. Hovering a tile (desktop)

Tooltip below the tile: "Fri May 8 · 5 photos · Café Nero".

## Interactions

| Action | Result |
|---|---|
| Click tile with entry | → `/entries/:id` |
| Click tile without entry, future date | disabled (gray, cursor not-allowed) |
| Click tile without entry, today or past | → `/upload?date=YYYY-MM-DD` |
| ‹ / › | navigate months |
| Cmd/Ctrl+T | jump to today |
| `[+ New entry]` | → `/upload` (today) |

Recent list below the calendar: 5 most recent entries with location + first 60 chars.

## A11y

- Calendar grid is `<table role="grid">` with proper headers (`<th scope="col">Mon</th>` etc.).
- Each tile is a `<button>` (not a `<div>`).
- Today and selected day have `aria-current="date"` and `aria-current="true"` respectively.
- Arrow keys move focus between days; Home/End jump to start/end of week; PageUp/PageDown move months.
- Disabled future tiles are `<button disabled aria-disabled="true">`.
- Recent list is a `<nav aria-label="Recent entries">`.
