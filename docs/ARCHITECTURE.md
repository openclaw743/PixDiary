# PixDiary — Architecture

> **Status:** skeleton. Architect agent fills in the details in Phase 3.
>
> See `docs/PROJECT.md` for vision and scope. This file describes **how** we build it.

## High-level shape (proposed — Architect to confirm or revise)

```
[Browser]
   │  HTTPS
   ▼
[Azure Static Web App]  (frontend, React/Vite)
   │  /api/*  (CORS-locked)
   ▼
[Azure Container App or App Service]  (backend, Node/Express)
   ├── PostgreSQL (Azure Database for PostgreSQL Flexible Server)
   ├── Azure Blob Storage  (private container, SAS reads)
   ├── Azure AI Foundry  (vision + chat completions)
   └── Geocoding provider  (Azure Maps? Mapbox? Architect to decide)
```

## Key flows (to be expanded)

### Upload → Diary entry

1. User drops photos in the upload UI.
2. Frontend requests a SAS upload URL per photo from the backend (`POST /uploads`).
3. Browser uploads directly to Blob (avoids backend proxy).
4. Frontend tells backend "these blobs are ready" (`POST /entries/draft`).
5. Backend, async per blob:
   - Read EXIF (timestamp, GPS, camera).
   - Send image to vision model → scenes/objects/captions.
   - Reverse-geocode GPS → human place names.
6. Backend bundles all photo descriptions for the same calendar day → one LLM call → one diary draft.
7. Backend persists the draft, returns the entry to the frontend.
8. User edits, hits Save → entry stored as final.

### Cost ceiling enforcement

Every AI call is preceded by a check against `users.daily_ai_cost_used` for today. If the next call would exceed the cap, the call is rejected and surfaced to the user as "daily AI quota reached — try again tomorrow or raise your limit in Settings."

## Components — to be designed

| Component | Owner | Status |
|---|---|---|
| Auth (signup / login / refresh) | Architect | TBD |
| Upload service (SAS issuance, blob lifecycle) | Architect | TBD |
| EXIF service | Architect | TBD |
| Vision pipeline (Azure AI Foundry) | Architect | TBD |
| Geocoding service | Architect | TBD |
| Diary draft service (LLM) | Architect | TBD |
| Cost ledger | Architect | TBD |
| Database schema | DataEngineer | TBD |
| API surface (OpenAPI) | Architect | TBD |
| CI/CD | InfraGuy | TBD |
| Terraform modules | InfraGuy | TBD |

## Open architectural questions

See `docs/PROJECT.md` → "Open questions for design phase".

## Decisions log

(Architect: append decisions here with date, decision, alternatives considered, and rationale.)

— TechLead (skeleton, Architect to fill)
