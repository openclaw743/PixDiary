# PixDiary — Architecture

> Phase 3 design. Authored by TechLead acting as Architect. Decisions log at the bottom.

## Goals (recap)

Turn a user's daily photos into a coherent first-person diary entry — automatically — and keep that diary searchable, exportable, and private.

Non-functional anchors:
- **Privacy non-negotiable** — see `docs/PROJECT.md` §"Privacy & safety guarantees".
- **Cost ceiling** — ≤ €0.05 average AI cost per saved entry; hard daily cap per user.
- **Single region** — Azure `westeurope`. Single-AZ acceptable for MVP.
- **No mobile app** — web only.

## High-level architecture

```
                          ┌──────────────────────┐
                          │      Browser         │
                          │  React + Vite + TS   │
                          └──────────┬───────────┘
                                     │ HTTPS
                                     ▼
                  ┌──────────────────────────────────┐
                  │   Azure Static Web App (free)    │
                  │   serves frontend bundle         │
                  │   proxies /api/* to backend      │
                  └──────────┬───────────────────────┘
                             │  (CORS-locked, JWT in Authorization)
                             ▼
                  ┌──────────────────────────────────┐
                  │   Azure Container App (backend)  │
                  │   Node 22 + Express + TS         │
                  │   - auth, uploads, entries       │
                  │   - AI orchestrator              │
                  │   - cost ledger                  │
                  └─┬─────────────┬───────────────┬──┘
                    │             │               │
        ┌───────────▼──┐  ┌───────▼──────┐  ┌─────▼─────────────┐
        │ PostgreSQL   │  │ Blob Storage │  │ Azure AI Foundry  │
        │ Flexible     │  │ (private)    │  │ (OpenAI vision +  │
        │ Server B1ms  │  │ photos/orig  │  │  chat)            │
        └──────────────┘  └──────────────┘  └───────────────────┘
                                                    ▲
                                                    │
                                            ┌───────┴────────┐
                                            │ Azure Maps     │
                                            │ (reverse-geo)  │
                                            └────────────────┘
```

### Why these choices

| Layer | Choice | Why |
|---|---|---|
| Frontend hosting | Azure Static Web Apps | Free tier, custom domain, integrates with backend via /api proxy, matches past project pattern |
| Backend host | Azure Container Apps | Scale-to-zero MVP friendly, supports managed identity, single Dockerfile workflow, cheaper than App Service for low traffic |
| DB | Azure DB for PostgreSQL Flexible Server (B1ms, 32GB) | Lowest "production" tier, supports `pgcrypto` for `gen_random_uuid`, single AZ acceptable for MVP |
| Object storage | Azure Blob (private container, hierarchical namespace **off**) | Cheapest, SAS-token reads, server-side encryption by default |
| AI | Azure AI Foundry (OpenAI gpt-4o-mini for vision + chat, gpt-4o as fallback for low-quality drafts) | Foundry already chosen by product owner; gpt-4o-mini has multimodal vision and ~10× cheaper than gpt-4o |
| Geocoding | Azure Maps (S0 tier) | Stays inside Azure tenancy → no extra DPA. Free up to 5k transactions/month. |

## Trust boundaries

```
[Public internet] ──TLS──▶ [SWA edge] ──TLS──▶ [Container App] ──vnet──▶ [Postgres]
                                                       │
                                                       ├─ managed identity ─▶ [Blob]
                                                       ├─ managed identity ─▶ [Foundry]
                                                       └─ API key (Key Vault) ─▶ [Azure Maps]
```

- Browser **never** holds: Azure storage keys, AI keys, DB creds. Only a JWT.
- Backend **never** logs: photo bytes, raw EXIF, JWTs, Azure Maps queries with GPS.
- Blob URLs handed to the browser are **always** SAS-signed, **read-only**, scoped to the requesting user, ≤15-minute expiry.

## Auth flow

Email + password (MVP). No OAuth providers.

```
POST /auth/signup
  body: { email, password }
  → bcrypt(password, 12), insert users row, issue access (15m JWT) + refresh (7d, rotating, stored hashed in refresh_tokens)
  ← 201 { accessToken, refreshToken, user }

POST /auth/login
  body: { email, password }
  → verify, issue tokens
  ← 200 { accessToken, refreshToken, user }

POST /auth/refresh
  body: { refreshToken }
  → verify hash, mark used, issue new pair
  ← 200 { accessToken, refreshToken }

POST /auth/logout
  body: { refreshToken }
  → mark revoked
  ← 204
```

JWT payload: `{ sub: userId, iat, exp, jti }`. Signed with HS256; secret in Key Vault.
Authorization header: `Bearer <accessToken>`.

Rate limits on auth endpoints: 10/min per IP for `/auth/login` and `/auth/signup`.

## Upload → Diary entry flow

Detail per step:

1. **Frontend prepares manifest.** User drops N photos (N ≤ 25). Frontend reads each `File` (no parse client-side beyond size + mime check), POSTs `/uploads` with `[{ filename, mimeType, sizeBytes }]`.

2. **Backend issues SAS upload URLs.** For each item:
   - Validate mime ∈ {image/jpeg, image/png, image/heic, image/webp}, size ≤ 25 MB.
   - Insert `photos` row with `status='pending'`, blob path `<userId>/<entryDate>/<photoId>.<ext>`.
   - Generate Blob SAS write URL (10min, write+create, exact path).
   - Return `[{ photoId, sasUrl, blobPath }]`.

3. **Browser uploads direct to blob.** Concurrent (up to 3) PUTs.

4. **Frontend confirms.** POST `/entries/draft` with `{ entryDate, photoIds }`.

5. **Backend kicks off AI pipeline (in-process for MVP, async per-entry).**
   - Group photos by `entryDate` (always one entry per calendar day in user's tz).
   - For each photo:
     - Stream blob bytes server-side (managed identity).
     - Strip EXIF for any return value but keep extracted EXIF for AI:
       - `dateTaken` (Exif.DateTimeOriginal → fallback Exif.DateTime → fallback blob mtime)
       - `gpsLat`, `gpsLng` (signed decimal, from GPSLatitude/Longitude + Ref)
       - `cameraMake`, `cameraModel` (optional, hint only)
     - **Vision call** (Azure Foundry `gpt-4o-mini`):
       - System prompt: "Describe this photo for a personal diary. 2-3 sentences. Note: people, place, mood, activity, weather/light. Avoid speculation. Output JSON: {scene, subjects[], mood, weather, activity}."
       - Token budget: ~400 in / ~150 out.
     - **Geocode** (Azure Maps reverse address-search) only if GPS present:
       - Cache by rounded lat/lng (4 decimals, ~11m precision) in `locations` table.
       - Return canonical "Place name, Neighbourhood, City".
   - **Diary draft call** (Azure Foundry `gpt-4o-mini`, fall back to `gpt-4o` if quality flag set):
     - Inputs: ordered photo descriptions, place names, time-of-day, weather, the user's tone profile (recent saved entries — see "Voice capture" below).
     - System prompt: "Write a first-person diary entry in past tense for [date] in [location]. ~150–250 words. Match the user's tone (samples below). Be specific, not flowery. Don't invent feelings the photos don't support."
     - Output: plain text. Stored in `entries.draft_md`.

6. **Cost ledger debit.** Each AI call writes a row to `ai_usage_ledger` with model, in-tokens, out-tokens, computed €. The **daily rollup** in `ai_daily_cost` is upserted with `+= cost`. The **pre-call check** queries `ai_daily_cost` for today's total; if (current + estimated) > user's `daily_cap_eur`, the orchestrator returns a `429 quota_exceeded` and the entry stays in `status='quota_blocked'` — user sees a banner.

7. **Frontend shows draft.** Polls `GET /entries/:id` until `status='drafted'`. Then displays photos + draft text + "Edit / Save" controls.

8. **User edits, hits Save.** PUT `/entries/:id` with `{ text }`. Server stores final, sets `status='saved'`, updates `last_edited_at`. The `draft_md → final_md` diff is saved into `entry_revisions` for "voice capture".

### Voice capture (for tone matching, no fine-tuning)

We do **not** train a per-user model. Instead:
- On every save, compute the diff between draft and final.
- Store the **last 5 saved final entries** of the user as few-shot samples.
- Inject into the next draft's system prompt: "Here are 3 examples of how this user writes about their day: [...]. Match this voice."

This is cheap, fast, and gives the AI an anchor without privacy risk of fine-tuning shared.

## Cost ceiling enforcement

| Where | What |
|---|---|
| `users.daily_cap_eur` | Per-user setting (default €0.50). User-editable in Settings within bounds [€0.10, €5.00]. |
| `ai_daily_cost(user_id, day)` | Materialized daily total, upserted on every AI call. Indexed on `(user_id, day)`. |
| Pre-call gate (in `aiOrchestrator.callWithBudget`) | Reads today's row + this call's estimated cost. If over → throw `QuotaExceededError`. |
| User feedback | Frontend banner: "Daily AI quota reached (€0.50). Try again tomorrow or raise the limit in Settings." |
| Reset | UTC midnight, but billed per **user's local day**. Implementation: `day = (now AT TIME ZONE user.tz)::date`. |

Pricing (current Foundry list, May 2026, used to estimate before call):

| Model | Input €/M tok | Output €/M tok |
|---|---|---|
| gpt-4o-mini | 0.14 | 0.55 |
| gpt-4o      | 2.30 | 9.20 |

Per-entry expected cost (5 photos average):
- Vision: 5 × (~400 in + ~150 out) on `gpt-4o-mini` = ~2750 tok ≈ **€0.0008**
- Diary: ~1500 in + ~300 out on `gpt-4o-mini` ≈ **€0.0004**
- Total ≈ **€0.0012/entry** — well under the €0.05 target with ~40× headroom for prompt growth.

A €0.50 daily cap allows ~400 entries/day — no realistic user hits it; it exists to stop runaway loops.

## Image lifecycle

| State | Trigger | Effect |
|---|---|---|
| `pending` | Photo row created, blob not yet uploaded | SAS write URL valid 10min |
| `uploaded` | Blob exists (verified on `/entries/draft`) | Eligible for AI processing |
| `processing` | AI started | |
| `processed` | AI finished, results stored | |
| `failed` | AI threw | retry once after 30s, then mark `failed` |
| `soft_deleted` | User deleted the entry | row kept 30 days, blob retained |
| `hard_deleted` | After 30-day grace, OR user-triggered "delete forever" | DB row removed (cascading entry_photos), blob removed |

Soft-deleted blobs are excluded from any user-visible list, queries, or exports.
Account hard-delete is one-step: deletes all rows + blobs for the user, no grace.

## Rate limits

| Endpoint | Limit | Why |
|---|---|---|
| `POST /auth/signup`, `/auth/login` | 10/min/IP | brute-force defense |
| `POST /uploads` | 50 photos / 10 min / user | abuse cap; normal usage is far below |
| `POST /entries/draft` | 20/hr/user | abuse cap |
| `POST /entries/:id/regenerate` | 5/day/user | discourages prompt thrash |
| `GET /*` | 600/min/user | generous |

Implementation: `express-rate-limit` with Redis backing in v2; in-memory for MVP (single instance).

## Observability

- **Logs:** structured JSON (`pino`) → Container Apps stdout → Azure Log Analytics. Redact known sensitive fields (password, token, email[plaintext], gpsLat, gpsLng, blobBase64).
- **Metrics:** Container Apps built-in (CPU, RAM, replicas, requests). Custom: AI cost €/day, entries drafted, entries saved, quota_blocked count.
- **Tracing:** OpenTelemetry SDK present but no exporter in MVP (no APM cost). Hooks ready for v2.
- **Health:** `GET /healthz` (liveness, no DB) and `GET /readyz` (DB + blob + Foundry ping with 1s timeout).

## Scaling notes

- MVP target: 50 active users, 5 entries/day each → 250 entries/day → 250 AI orchestrations/day. Trivially served by a single Container App replica (0.5 vCPU, 1 GB).
- Hot path: `POST /entries/draft` is async (returns 202 immediately, polled via `GET /entries/:id`).
- Postgres B1ms handles ~10k IOPS; we'd need 100× users before this is the bottleneck.
- Image bandwidth bypasses backend (direct browser→blob via SAS), so backend egress stays small.

## Security posture

- **Bcrypt cost 12** for password hashing.
- **JWT** access (15m) + rotating refresh (7d). Refresh stored hashed (sha256) in DB, single-use.
- **CSRF:** not applicable (token-based auth, no cookies in MVP).
- **CORS:** allowlist only deployed SWA origin + `localhost:5173` in dev.
- **CSP** on the SWA: `default-src 'self'; img-src 'self' data: https://*.blob.core.windows.net; connect-src 'self' /api/`.
- **Secrets:** Azure Key Vault. Container App pulls via managed identity. No secrets in env vars in source control.
- **CodeQL:** enabled on every PR + weekly main scan.
- **Dependabot:** auto-PRs for vulnerable deps.

## Failure modes & responses

| Failure | Impact | Response |
|---|---|---|
| Foundry rate-limited | Drafting blocked | Retry with exponential backoff (1s, 4s, 16s); after 3 failures, mark entry `processing_failed`; user sees "Try again in a moment" |
| Foundry returns hallucinated facts | Quality | User edits before save (acceptable — they're the editor) |
| Azure Maps quota | No place names | Diary draft proceeds without place name; logged as `geocode_skipped` |
| Blob upload timeout | Photo missing | Frontend retries from manifest; backend cleans `pending` photos older than 1h |
| DB down | Hard outage | 5xx, alert on healthz fail; nothing user can do |
| User exceeds daily cap | Drafting blocked | Banner with "raise limit" link |
| Migration fails in prod | Pause deploys | InfraGuy runs down script, files critical bug |

## Decisions log

| Date | Decision | Alternatives | Why |
|---|---|---|---|
| 2026-05-08 | Vision model: `gpt-4o-mini` | gpt-4o, gpt-4-turbo | 10× cheaper, multimodal, quality sufficient for "describe this photo" task. gpt-4o reserved as escalation when user marks an entry "redo with better quality". |
| 2026-05-08 | Chat model: `gpt-4o-mini` (default), `gpt-4o` (regenerate-with-better) | Claude (not Foundry), gpt-4-turbo | Stays inside Foundry as required. Mini is enough for 200-word diary; 4o available on user request. |
| 2026-05-08 | Geocoder: Azure Maps | Mapbox, Nominatim (OSM) | Same Azure tenancy = no extra DPA + managed identity auth. Free tier covers MVP. Nominatim usage policy too restrictive at scale. |
| 2026-05-08 | Cost ceiling location: server-side, in AI orchestrator pre-call gate | Per-call wrapper at provider SDK, frontend cap | Single chokepoint, atomic against `ai_daily_cost` upsert. |
| 2026-05-08 | Image lifecycle: 30-day soft delete then auto-purge | Immediate hard delete; never delete | Privacy promise (PROJECT.md) requires bounded retention; 30 days lets users undo accidental deletes. |
| 2026-05-08 | Rate limit storage: in-memory MVP | Redis from day 1 | Single backend replica in MVP; in-memory fine. Redis is a v2 add when scaling out. |
| 2026-05-08 | Backend host: Azure Container Apps | App Service, AKS | Scale-to-zero, cheap idle, managed identity, single Dockerfile. AKS overkill at this size. |
| 2026-05-08 | DB: PostgreSQL Flexible Server B1ms | Cosmos DB, Supabase, SQLite | Schema fits relational well. Cosmos is overkill + JSON-heavy. Supabase is great but adds a vendor not on Azure. SQLite doesn't survive Container App restarts. |
| 2026-05-08 | Voice capture: few-shot from last 5 saved entries | Per-user fine-tune, embedding-based retrieval | Fine-tune cost + privacy concern; few-shot is good enough and trivially explainable. |
| 2026-05-08 | Async drafting: in-process, polled | Queue (Service Bus), webhooks, websockets | At MVP scale, in-process async with polling is the simplest viable. Service Bus is a v2 swap when we need horizontal workers. |

— TechLead (Bob)
