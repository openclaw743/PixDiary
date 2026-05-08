# PixDiary API — Overview

OpenAPI 3.1 spec lives in `openapi.yaml` next to this file.

## Base URL

- Local dev: `http://localhost:3000`
- Production: `https://<swa-host>/api` (Static Web App proxies `/api/*` to the Container App)

## Authentication

All endpoints except `POST /auth/signup`, `POST /auth/login`, `POST /auth/refresh`, and `GET /healthz` require a Bearer JWT access token.

```
Authorization: Bearer <accessToken>
```

Access tokens expire in 15 minutes. Use `POST /auth/refresh` with a refresh token (7-day expiry, single-use, rotates on each refresh) to obtain a new pair.

## Error model

All errors return a JSON body of the form:

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "Human-readable summary",
    "details": { "field": "..." }
  }
}
```

| HTTP | code | When |
|---|---|---|
| 400 | `validation_failed` | Body / params didn't pass schema |
| 401 | `unauthorized` | Missing or invalid token |
| 403 | `forbidden` | Token valid, action not allowed |
| 404 | `not_found` | Resource doesn't exist or doesn't belong to caller |
| 409 | `conflict` | e.g. signup with existing email |
| 413 | `payload_too_large` | Photo > 25 MB |
| 415 | `unsupported_media_type` | Non-image upload |
| 422 | `quota_exceeded` | Daily AI cost cap hit |
| 429 | `rate_limited` | Too many requests; `Retry-After` header set |
| 500 | `internal_error` | Server bug; correlation id in response for debugging |

## Pagination

Cursor-based, query params `?limit=` (default 30, max 100) and `?cursor=`. Responses include:

```json
{ "items": [...], "nextCursor": "opaque-string" | null }
```

## Idempotency

`POST /uploads` and `POST /entries/draft` accept an optional `Idempotency-Key` header (UUIDv4). The first request with a given key processes; subsequent identical requests return the cached response for 1 hour.

## Versioning

API is unversioned in path during MVP. Breaking changes will introduce `/api/v2/...` post-MVP.
