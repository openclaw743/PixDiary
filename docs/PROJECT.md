# PixDiary — Project Brief

## Vision

People take photos every day but rarely write a diary. PixDiary turns the photos they already capture into a coherent, first-person diary entry — automatically. The app reads what's in the picture, where it was taken, and when, then drafts a paragraph in the user's voice. The user edits, the app saves. Over months and years, the diary writes itself.

## Why this

- **Passive input:** photos already exist on every phone. No new habit required.
- **Rich signal:** photo content + EXIF (timestamp, camera) + GPS coordinates → reverse-geocoded place names, weather lookup, scene/object detection — far more grounded than a text prompt.
- **High-emotion output:** memories. Worth re-reading in 5 years.
- **AI is finally good enough:** vision models can describe a scene; chat models can write in a personal tone.

## Differentiation vs. existing players

| Player | What they do | What we do differently |
|---|---|---|
| Day One / Journey | Manual diary, attach photos | We invert it — photos first, AI writes prose |
| Apple Journal | iOS-only, Apple ecosystem | Cross-platform, web-first |
| Google Photos Memories | Auto-collages, one-line captions | Full diary paragraph in the user's voice, editable, exportable |

**Our moat is narrative quality**, not the timeline UI. If the daily entry isn't good enough to read, nothing else matters.

## Target user (MVP)

- Personal user, 25–45, takes photos regularly, has fallen off journaling at least once.
- Web/desktop friendly. Uploads in batches (evening recap), not real-time.
- English-language MVP. Other languages v2.

## MVP scope (4–6 weeks)

In:
1. Email/password auth (single-user accounts).
2. Drag-drop multi-photo upload for "today" or any past date.
3. AI pipeline: EXIF extract → vision analysis → reverse geocode → LLM draft entry.
4. Entry view with inline edit + save.
5. Calendar view of past entries.
6. Account settings: cost ceiling, delete account & data, export all entries as JSON.

Out (v2+):
- Mobile apps (iOS/Android).
- Voice input.
- Multi-user / sharing / social.
- "Book" PDF export.
- Mood tracking, weekly recaps.
- Auto-import from Google Photos / iCloud.
- Face recognition / who's in the photo.
- Multilingual.

## Success metrics

- **Activation:** % of signups that upload ≥1 photo on day 0 (target ≥60%).
- **Quality:** % of AI-drafted entries the user saves with ≤25% edits (target ≥50%).
- **Retention:** % of users who write ≥3 entries in their first 7 days (target ≥30%).
- **Cost ceiling:** AI cost per saved entry ≤ €0.05 average.

## Non-goals (explicit)

- Not a generic photo gallery. We don't compete with Google Photos for storage.
- Not a social network. No followers, no public feeds.
- Not real-time. Diary is reflective, not live.
- Not a replacement for therapy or memory care.

## Privacy & safety guarantees

These are non-negotiable.

1. **Photo storage:** private Azure Blob container. No public URLs. All reads via short-lived SAS tokens scoped to the owner.
2. **EXIF in URLs:** never. Original EXIF kept server-side only; URLs we expose contain no GPS or device data.
3. **AI processing:** images sent to Azure AI Foundry (Microsoft data-processing terms apply, no training on inputs). No third-party AI.
4. **Analytics:** product analytics (counters, page views) only. No analytics SDK touches image bytes.
5. **Encryption:** at rest (Azure-managed keys MVP, customer-managed keys v2) and in transit (TLS).
6. **User data rights:** one-click export of everything (entries + photos), one-click hard delete (24h purge from blob + DB + AI provider cache).
7. **No face recognition** in MVP. Even when added, default off, opt-in only.
8. **Cost ceiling per user per day:** hard limit, configurable, defaults to €0.50/day so a runaway upload can't drain the account.

## Constraints

- **Region:** Azure westeurope (matches MrLi's CET timezone, no SWA in swedencentral per past lessons).
- **Resource group:** `rg-Sandbox`.
- **Subscription:** Sub-LiShuo-MSFT.
- **CI account:** all agents share `openclaw743` GitHub account; PR self-approval is blocked → comment review then squash merge.

## Open questions for design phase

- Reverse geocoding: Azure Maps vs Mapbox vs OSM Nominatim? (Architect to decide based on cost + privacy.)
- Vision model: gpt-4o vs gpt-4.1-mini? (Architect + cost ceiling math.)
- LLM tone: how do we capture "user's voice" without per-user fine-tuning? (Few-shot from past edits — DataEngineer to design the schema for that.)
- Mobile photo upload UX on web: progressive enhancement or fail-gracefully? (Designer.)

## Phase plan

| Phase | Owner | Deliverable |
|---|---|---|
| 3 — Design | Architect, DataEngineer | `docs/ARCHITECTURE.md`, OpenAPI in `docs/api-contracts/`, ERD in `database/schema/ERD.md` |
| 4 — UX | Designer | Wireframes for Upload, Entry view/edit, Calendar; tokens.json |
| 5 — Implementation | Developer, DataEngineer, InfraGuy | Frontend + Backend + DB + Infra |
| 6 — Test | Tester | Unit, integration, E2E |
| 7 — Quality gate | TechLead | Reviews + merges |
| 8 — Deploy | InfraGuy | Live on Azure |
| 9 — QA | QA | Acceptance, perf, security, a11y |

— TechLead (Bob)
