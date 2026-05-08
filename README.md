# PixDiary

AI-powered photo diary. Upload daily photos → automatic first-person narrative entry built from photo content, EXIF, and GPS. User edits, app keeps the diary.

**Status:** Phase 1 — design.
See [`docs/PROJECT.md`](docs/PROJECT.md) for vision, scope, and non-goals.

## Stack (planned)

- Frontend: React + Vite + TypeScript + Tailwind
- Backend: Node.js + Express + TypeScript
- DB: PostgreSQL (Azure Database for PostgreSQL)
- Storage: Azure Blob Storage (private container, SAS-issued reads)
- AI: Azure AI Foundry (OpenAI vision + chat completions)
- Geocoding: TBD by Architect
- Infra: Terraform → Azure (westeurope, resource group `rg-Sandbox`)
- CI: GitHub Actions

## Repo layout

```
docs/                 architecture, conventions, contracts, design system
frontend/             web app
backend/              API
database/             schema, migrations, ERD
infra/terraform/      cloud resources
.github/workflows/    CI/CD
tests/                E2E (per-app unit tests live next to source)
```

## License

Private — not yet decided.
