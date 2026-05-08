# PixDiary Backend

Express + TypeScript service providing auth and health endpoints. Business endpoints (uploads, entries) ship in a later PR.

## Quick start

```bash
cd backend
cp .env.example .env          # then fill in JWT_SECRET, DATABASE_URL
npm install
npm run migrate:up
npm run dev                   # tsx watch on src/index.ts (port 3000)
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Hot-reloading dev server (`tsx watch`) |
| `npm run build` | Compile TS to `dist/` |
| `npm start` | Run compiled output |
| `npm run lint` | ESLint (strict, no `any`) |
| `npm run format` | Prettier write |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (unit + integration) |
| `npm run test:coverage` | Vitest with v8 coverage |
| `npm run migrate:up` | Apply pending migrations from `../database/migrations/` |
| `npm run migrate:down` | Roll back the most recent migration (`-- --steps N` for more) |

## Environment variables

All required env vars are documented in `.env.example`. Config is validated at startup with `zod` — missing or invalid values throw before the server binds a port.

| Var | Purpose |
|---|---|
| `NODE_ENV` | `development` \| `test` \| `production` |
| `PORT` | HTTP listen port (default 3000) |
| `LOG_LEVEL` | pino level (default `info`) |
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | HS256 signing secret (≥32 chars) |
| `JWT_ACCESS_TTL_SECONDS` | Access token lifetime (default 900) |
| `JWT_REFRESH_TTL_SECONDS` | Refresh token lifetime (default 604800) |
| `BCRYPT_COST` | bcrypt cost factor (default 12) |
| `CORS_ORIGINS` | Comma-separated list of allowed origins |
| `RATE_LIMIT_AUTH_PER_MIN` | Per-IP cap for `/auth/signup` & `/auth/login` |
| `RATE_LIMIT_GENERAL_PER_MIN` | Per-IP cap for everything else |

## Endpoints (this PR)

```
GET  /healthz       → 200 always (liveness)
GET  /readyz        → 200 if DB ping under 1s, else 503
POST /auth/signup   → 201 { accessToken, refreshToken, user }
POST /auth/login    → 200 { accessToken, refreshToken, user }
POST /auth/refresh  → 200 { accessToken, refreshToken } (rotating, single-use)
POST /auth/logout   → 204 (revokes the presented refresh token)
GET  /me            → 200 { id, email, timezone, dailyCapEur, createdAt }  (Bearer JWT)
```

Error envelope (all 4xx/5xx):

```json
{ "error": { "code": "validation_failed", "message": "...", "details": {} } }
```

## Tests

`npm test` runs:

- Unit tests next to source (`src/**/*.test.ts`) — pure helpers, error mapping, config loader.
- Integration test (`tests/integration/auth.test.ts`) which spawns a real Postgres 16 container via the local `docker` CLI, runs the migrations, and exercises the full auth flow end-to-end.

If Docker is unavailable, set `PIXDIARY_TEST_DATABASE_URL` to a pre-provisioned Postgres 16 instance and the integration test will use that. If neither is available the integration suite is skipped (unit tests still run).

## Migrations

Migration files live in `database/migrations/` (repo-root, owned by DataEngineer). The runner (`src/db/migrate.ts`):

- Discovers files matching `NNNN_name.up.sql` and `NNNN_name.down.sql`.
- Tracks applied migrations in `schema_migrations(version, name, applied_at)`.
- Applies each migration in a transaction.
- `migrate:down` rolls back the most recent (or `--steps N`).

## Logging

`pino` JSON logs to stdout. Sensitive fields are redacted automatically: `password`, `passwordHash`, `refreshToken`, `accessToken`, `token`, `tokenHash`, `gpsLat`, `gpsLng`, plus the `Authorization` and `Cookie` request headers.

## Docker

Multi-stage `Dockerfile` builds with the full toolchain, then copies the compiled output and pruned `node_modules` into a slim runtime image. Runs as non-root `app` user (uid 10001), exposes port 3000.
