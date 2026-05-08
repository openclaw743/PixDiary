# PixDiary Backend

Express + TypeScript service providing auth, uploads, entries, AI orchestration, settings, export, and account deletion.

## Quick start

```bash
cd backend
cp .env.example .env          # then fill in JWT_SECRET, DATABASE_URL
npm install
npm run migrate:up
npm run dev                   # tsx watch on src/index.ts (port 3000)
```

## Scripts

| Script                  | What it does                                                  |
| ----------------------- | ------------------------------------------------------------- |
| `npm run dev`           | Hot-reloading dev server (`tsx watch`)                        |
| `npm run build`         | Compile TS to `dist/`                                         |
| `npm start`             | Run compiled output                                           |
| `npm run lint`          | ESLint (strict, no `any`)                                     |
| `npm run format`        | Prettier write                                                |
| `npm run typecheck`     | `tsc --noEmit`                                                |
| `npm test`              | Vitest (unit + integration)                                   |
| `npm run test:coverage` | Vitest with v8 coverage                                       |
| `npm run migrate:up`    | Apply pending migrations from `../database/migrations/`       |
| `npm run migrate:down`  | Roll back the most recent migration (`-- --steps N` for more) |

## Environment variables

All required env vars are documented in `.env.example`. Config is validated at startup with `zod` — missing or invalid values throw before the server binds a port.

| Var                               | Purpose                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                        | `development` \| `test` \| `production`                                                          |
| `PORT`                            | HTTP listen port (default 3000)                                                                  |
| `LOG_LEVEL`                       | pino level (default `info`)                                                                      |
| `DATABASE_URL`                    | Postgres connection string                                                                       |
| `JWT_SECRET`                      | HS256 signing secret (≥32 chars)                                                                 |
| `JWT_ACCESS_TTL_SECONDS`          | Access token lifetime (default 900)                                                              |
| `JWT_REFRESH_TTL_SECONDS`         | Refresh token lifetime (default 604800)                                                          |
| `BCRYPT_COST`                     | bcrypt cost factor (default 12)                                                                  |
| `CORS_ORIGINS`                    | Comma-separated list of allowed origins                                                          |
| `RATE_LIMIT_AUTH_PER_MIN`         | Per-IP cap for `/auth/signup` & `/auth/login`                                                    |
| `RATE_LIMIT_GENERAL_PER_MIN`      | Per-IP cap for everything else                                                                   |
| `AZURE_STORAGE_CONNECTION_STRING` | Azurite (dev/CI) connection string. Mutually exclusive with `AZURE_STORAGE_ACCOUNT_NAME` (prod). |
| `AZURE_STORAGE_ACCOUNT_NAME`      | Prod blob account; auth via `DefaultAzureCredential` (managed identity).                         |
| `AZURE_STORAGE_ACCOUNT_KEY`       | Optional shared-key override (avoid in prod).                                                    |
| `AZURE_STORAGE_CONTAINER`         | Container name (default `photos`).                                                               |
| `AZURE_BLOB_PUBLIC_BASE_URL`      | Override base URL for SAS responses (e.g. CDN or Azurite host).                                  |
| `UPLOAD_SAS_TTL_SECONDS`          | Upload SAS lifetime (≤600s, write+create only).                                                  |
| `READ_SAS_TTL_SECONDS`            | Read SAS lifetime (≤900s).                                                                       |
| `AZURE_OPENAI_ENDPOINT`           | Foundry endpoint (e.g. `https://my-resource.openai.azure.com`).                                  |
| `AZURE_OPENAI_API_KEY`            | API key.                                                                                         |
| `AZURE_OPENAI_DEPLOYMENT_MINI`    | Vision + standard-quality deployment (default `gpt-4o-mini`).                                    |
| `AZURE_OPENAI_DEPLOYMENT_BETTER`  | Higher-quality deployment used by `quality=better` (default `gpt-4o`).                           |
| `AZURE_MAPS_KEY`                  | Azure Maps subscription key for reverse geocoding (optional).                                    |
| `PIXDIARY_AI_FIXTURE_MODE`        | `off` (live), `replay` (read recorded JSON, CI default).                                         |
| `PIXDIARY_AI_FIXTURE_DIR`         | Directory of recorded AI fixtures keyed by sha256 of the request.                                |

## Endpoints (this PR)

```
GET  /healthz       → 200 always (liveness)
GET  /readyz        → 200 if DB ping under 1s, else 503
POST /auth/signup   → 201 { accessToken, refreshToken, user }
POST /auth/login    → 200 { accessToken, refreshToken, user }
POST /auth/refresh  → 200 { accessToken, refreshToken } (rotating, single-use)
POST /auth/logout   → 204 (revokes the presented refresh token)
GET  /me            → 200 { id, email, timezone, dailyCapEur, createdAt }  (Bearer JWT)
POST /uploads                        → 200 { items: [{ photoId, sasUrl, blobPath, expiresAt }] }
POST /entries/draft                  → 202 { entryId, status }            (kicks off async AI pipeline)
GET  /entries                        → 200 { items: [...], nextCursor }   (cursor pagination, from/to filters)
GET  /entries/:id                    → 200 { id, status, draftText, finalText, photos[] }
PUT  /entries/:id                    → 200 (saves final text, writes entry_revisions row)
DELETE /entries/:id                  → 204 (soft delete)
POST /entries/:id/regenerate         → 202 (quality: standard|better)
GET  /settings                       → 200 { timezone, dailyCapEur }
PUT  /settings                       → 200
GET  /export                         → 200 (full JSON dump of user + entries + photo refs)
DELETE /account                      → 202 (verifies password + literal `"DELETE MY ACCOUNT"`)
```

Error envelope (all 4xx/5xx):

```json
{ "error": { "code": "validation_failed", "message": "...", "details": {} } }
```

## Tests

`npm test` runs:

- Unit tests next to source (`src/**/*.test.ts`) — pure helpers, error mapping, config loader, EXIF extraction, voice-capture few-shot rendering, geocode cache, blob SAS issuance.
- Cost-ledger tests against a real Postgres 16 container, including a concurrent quota-race assertion.
- Integration tests (`tests/integration/`) that spawn a real Postgres 16 + Azurite via the local `docker` CLI, run migrations, and exercise the full backend including the AI orchestrator (auth, uploads, entries, settings, export, account deletion).

### AI fixtures

The AI client supports three modes:

- `PIXDIARY_AI_FIXTURE_MODE=off` — live calls to Azure Foundry (dev only).
- `PIXDIARY_AI_FIXTURE_MODE=replay` — reads recorded JSON from `PIXDIARY_AI_FIXTURE_DIR`, falling back to a deterministic synthetic response when no fixture matches the request hash. CI default.
- `record` — reserved for a future tool that will write live responses out to `PIXDIARY_AI_FIXTURE_DIR/<sha256>.json` (16-char prefix). Manual re-record steps:

  1. Set `PIXDIARY_AI_FIXTURE_MODE=off` and provide real Azure credentials.
  2. Run the integration test you want to capture (e.g. `npx vitest run tests/integration/entries.test.ts`).
  3. Capture the request/response from the OpenAI SDK debug logs and write it as JSON `{ text, tokensIn, tokensOut, parsedJson? }` to `tests/fixtures/ai/<key>.json` where `<key>` is the first 16 chars of `sha256(JSON.stringify({purpose, model, msgs}))`.

If Docker is unavailable, set `PIXDIARY_TEST_DATABASE_URL` (pre-provisioned Postgres 16) and `PIXDIARY_TEST_AZURITE_CONN` (pre-provisioned Azurite) to skip the docker spawn. If neither is available the integration suites are skipped automatically.

## Migrations

Migration files live in `database/migrations/` (repo-root, owned by DataEngineer). The runner (`src/db/migrate.ts`):

- Discovers files matching `NNNN_name.up.sql` and `NNNN_name.down.sql`.
- Tracks applied migrations in `schema_migrations(version, name, applied_at)`.
- Applies each migration in a transaction.
- `migrate:down` rolls back the most recent (or `--steps N`).

## Logging

`pino` JSON logs to stdout. Sensitive fields are redacted automatically: `password`, `passwordHash`, `refreshToken`, `accessToken`, `token`, `tokenHash`, `gpsLat`, `gpsLng`, plus the `Authorization` and `Cookie` request headers.

**Privacy:** EXIF GPS coordinates are read server-side for reverse geocoding and stored in `photos.gps_lat`/`gps_lng`, but they are never serialized into any user-facing API response. Only the cached `place_name` (`locations` table) is exposed. See `docs/ARCHITECTURE.md` for trust boundaries.

## Docker

Multi-stage `Dockerfile` builds with the full toolchain, then copies the compiled output and pruned `node_modules` into a slim runtime image. Runs as non-root `app` user (uid 10001), exposes port 3000.
