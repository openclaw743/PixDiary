# PixDiary — Database Schema

PostgreSQL 16. UUID primary keys (`gen_random_uuid()` from `pgcrypto`). All timestamps `timestamptz`, stored UTC.

See `ERD.md` for the diagram. Migrations in `../migrations/`. Dev seed in `../seed/`.

## Tables (overview)

| Table | Purpose | Owner row count target (MVP) |
|---|---|---|
| users | account record | 100s |
| refresh_tokens | rotating refresh tokens (hashed) | <10× users |
| photos | uploaded photos + extracted EXIF + AI scene | 100s × users |
| entries | one diary entry per (user, calendar date) | days × users |
| entry_photos | join: photos that belong to an entry | ≈ photos |
| entry_revisions | per-save snapshot of entry text (for voice capture) | ≈ saves |
| locations | reverse-geocode cache (rounded lat/lng) | 100s |
| ai_usage_ledger | per-call cost log | thousands |
| ai_daily_cost | daily rollup (used by cost-ceiling gate) | days × users |

## Hot paths & indexes

| Query | Index |
|---|---|
| List entries for a user, newest first | `entries (user_id, entry_date desc)` |
| Get user's entry for a specific date | `entries (user_id, entry_date) UNIQUE` (excludes soft-deleted) |
| Get photos for an entry | `entry_photos (entry_id)` |
| Get user's photos for a day (during draft) | `photos (user_id, taken_on)` |
| Cost ceiling check (today's spend) | `ai_daily_cost (user_id, day) PK` |
| Geocode cache lookup | `locations (lat_4dp, lng_4dp) UNIQUE` |
| Auth: find user by email | `users (lower(email)) UNIQUE` |
| Auth: find refresh token | `refresh_tokens (token_hash) UNIQUE` |

## Decisions log

| Date | Decision | Alternatives | Why |
|---|---|---|---|
| 2026-05-08 | UUID PKs, `gen_random_uuid()` | bigserial | Don't leak record counts in URLs; works across replicas without coordination. |
| 2026-05-08 | One entry per (user, date) — UNIQUE | Multiple entries per day | Product is "the diary writes itself"; one canonical entry per day matches the calendar UX. Adding photos later updates the existing entry. |
| 2026-05-08 | Soft delete via `deleted_at` on entries + photos | Hard delete only | Privacy promise (PROJECT.md): bounded retention, but allow undo within 30 days. Cron purges rows + blobs after 30 days. |
| 2026-05-08 | `photos.taken_on` (DATE) duplicates EXIF day | Compute on read each time | Single index; entries.photos lookup is a hot path. Worth the byte. |
| 2026-05-08 | `ai_daily_cost(user_id, day)` rollup | Aggregate from ai_usage_ledger on read | Pre-call gate must be O(1); rollup upsert via ON CONFLICT. |
| 2026-05-08 | EXIF GPS stored as DECIMAL(9,6) | NUMERIC, GIS POINT | Plain decimals are enough for diary; PostGIS overkill at MVP scale. |
| 2026-05-08 | Voice capture = raw final_text columns + ordering | Embeddings, fine-tune | Already covered in ARCHITECTURE.md; few-shot reads `entry_revisions` last 5. |
| 2026-05-08 | Day boundary uses user's TZ | UTC midnight | A user in CET writes their evening photos as "today"; UTC would cut the day at 01:00 CET. Compute `entry_date = (taken_at AT TIME ZONE users.timezone)::date`. |
| 2026-05-08 | Refresh tokens hashed with sha256 | bcrypt, plaintext | sha256 is fine for high-entropy random tokens (96 bits); bcrypt is overkill there and slow. Plaintext = no good. |

## Notes for implementers

- **Always** include `WHERE deleted_at IS NULL` on user-facing reads of `entries` and `photos`.
- The `users.email` UNIQUE index is on `lower(email)` — always lowercase before INSERT/UPDATE.
- Cost ceiling check (transaction-safe):
  ```sql
  -- inside a tx, before AI call
  INSERT INTO ai_daily_cost (user_id, day, total_eur)
  VALUES ($1, $2, $3)
  ON CONFLICT (user_id, day)
  DO UPDATE SET total_eur = ai_daily_cost.total_eur + EXCLUDED.total_eur
  RETURNING total_eur;
  -- if returned total_eur > users.daily_cap_eur → rollback and raise quota_exceeded
  ```
- Down migrations exist for every up migration. `0001_init.down.sql` drops everything except the `pgcrypto` extension.
