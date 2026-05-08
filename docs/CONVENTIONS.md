# PixDiary — Conventions

Strict, enforced, non-negotiable for all agents.

## Languages & frameworks

- **Frontend:** React 18 + Vite + TypeScript (`strict: true`) + Tailwind CSS.
- **Backend:** Node.js 22 LTS + Express + TypeScript (`strict: true`).
- **DB:** PostgreSQL 16. SQL migrations (no ORM-generated migrations).
- **Tests:** Vitest (unit + integration), Playwright (E2E).
- **Infra:** Terraform 1.9+ targeting Azure providers.

## Code style

- **Formatter:** Prettier — single quotes, trailing commas, 100-char line width.
- **Linter:** ESLint flat config — strict TS rules, `no-explicit-any`, `no-unused-vars`.
- **Pre-commit:** husky + lint-staged → `eslint --fix` and `prettier --write` on staged files.
- **Commit style:** Conventional Commits (`feat(scope): subject`). Enforced via commitlint.

## Branching & PRs

- Branch name: `<role>/<issue-number>-<short-desc>` (e.g. `developer/12-photo-upload`).
- One PR per issue. Title: `<type>(<scope>): <issue title>`. Body must include `Closes #N`.
- Squash merge to `main`. Delete branch after merge.
- TechLead reviews every PR. QA reviews TechLead's PRs.
- Max 3 review cycles per PR; if still failing, decompose the issue.

## Testing

- **Coverage:** ≥80% backend, ≥70% frontend.
- **Unit tests** live next to source (`foo.ts` + `foo.test.ts`).
- **Integration tests** in `backend/tests/integration/`. Use a real test PostgreSQL (Docker container in CI).
- **E2E tests** in `tests/e2e/`. Cover happy path + top-3 error scenarios per feature.
- **No mocks for the AI pipeline in integration** — use a recorded fixture (VCR-style) tagged per test case. AI pipeline is too important to fake.

## Folder layout

```
docs/
  PROJECT.md
  ARCHITECTURE.md
  CONVENTIONS.md            ← you are here
  api-contracts/            OpenAPI specs
  design-system/            wireframes/, tokens.json, accessibility notes
frontend/
  src/
  src/components/
  src/pages/
  src/hooks/
  src/api/                  thin client for backend
  package.json
backend/
  src/
  src/routes/
  src/services/             ai pipeline, geocoding, exif, storage
  src/middleware/
  src/db/                   query helpers, no ORM
  tests/integration/
  package.json
database/
  schema/
    ERD.md
  migrations/
  seed/
infra/terraform/
  environments/dev/
  modules/
.github/workflows/
tests/
  e2e/
```

## Security

- **Secrets:** never in code. Local dev: `.env` files, gitignored. Cloud: Azure Key Vault, referenced by managed identity.
- **Photo URLs:** SAS-token reads only, scoped to the owning user, ≤15-minute expiry.
- **EXIF:** strip from any URL or response we expose. Originals kept blob-side only.
- **Auth:** bcrypt for password hashing (cost 12). JWT access tokens (15min) + refresh (7d, rotating).
- **CORS:** allowlist only the deployed frontend origin and `localhost:5173` in dev.
- **Rate limiting:** per-user upload endpoint capped (Architect to set numbers).
- **AI cost ceiling:** per-user per-day hard limit enforced in the AI service before any provider call.
- **Logging:** never log photo bytes, EXIF GPS, or auth tokens. Redact via middleware.

## Dependencies

- **Pin everything.** No `^` or `~` in `package.json` for production deps.
- **Dependabot enabled.** Auto-PR weekly.
- **CodeQL enabled.** Run on every PR + weekly on `main`.

## Documentation

- Every new public function: JSDoc with `@param` and `@returns`.
- Every new API endpoint: OpenAPI spec entry **before** implementation.
- Every schema change: ERD updated in the same PR.

## Boundaries (who owns what)

| Area | Owner |
|---|---|
| API contracts (OpenAPI) | Architect |
| DB schema, migrations, ERD, seed data | DataEngineer (exclusive) |
| Frontend code | Developer (frontend) |
| Backend code | Developer (backend) |
| Wireframes, tokens, a11y | Designer |
| Terraform, Dockerfiles, GitHub Actions | InfraGuy |
| Unit + integration + E2E tests | Tester |
| Performance, security, a11y audits | QA |
| PR review + merge | TechLead (QA reviews TechLead's own PRs) |

If your task requires changing files outside your area, **comment on the issue and stop** — TechLead will rescope or split.

## Failure handling

- **Migration:** every migration ships an up + down script.
- **Deploy fails:** InfraGuy rolls back to last good image tag, files a hotfix issue.
- **Main branch breaks CI:** TechLead reverts the merge immediately. No new PRs merge until main is green.

— TechLead (Bob)
