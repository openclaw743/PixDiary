# PixDiary — ERD

```mermaid
erDiagram
    USERS ||--o{ REFRESH_TOKENS : has
    USERS ||--o{ PHOTOS : owns
    USERS ||--o{ ENTRIES : owns
    USERS ||--o{ AI_USAGE_LEDGER : incurs
    USERS ||--o{ AI_DAILY_COST : tallies

    ENTRIES ||--o{ ENTRY_PHOTOS : contains
    PHOTOS  ||--o{ ENTRY_PHOTOS : appears_in

    ENTRIES ||--o{ ENTRY_REVISIONS : versions

    PHOTOS }o--|| LOCATIONS : geocoded_at

    USERS {
        uuid id PK
        text email UK "lowercased"
        text password_hash "bcrypt cost 12"
        text timezone "IANA, e.g. Europe/Copenhagen"
        numeric daily_cap_eur "default 0.50"
        timestamptz created_at
        timestamptz deleted_at "nullable"
    }

    REFRESH_TOKENS {
        uuid id PK
        uuid user_id FK
        text token_hash UK "sha256 hex"
        timestamptz issued_at
        timestamptz expires_at
        timestamptz used_at "nullable; once set the token is revoked"
        text replaced_by_token_hash "nullable"
    }

    PHOTOS {
        uuid id PK
        uuid user_id FK
        text blob_path UK "<userId>/<entryDate>/<photoId>.<ext>"
        text mime_type
        bigint size_bytes
        integer width "nullable"
        integer height "nullable"
        timestamptz taken_at "EXIF DateTimeOriginal or fallback"
        date taken_on "denormalized for indexing"
        decimal gps_lat "9,6 nullable"
        decimal gps_lng "9,6 nullable"
        text camera_make "nullable"
        text camera_model "nullable"
        uuid location_id FK "nullable"
        text status "pending|uploaded|processing|processed|failed"
        jsonb ai_scene "nullable; vision-model output"
        timestamptz created_at
        timestamptz deleted_at
    }

    ENTRIES {
        uuid id PK
        uuid user_id FK
        date entry_date "user-tz local date"
        text status "pending|processing|drafted|saved|processing_failed|quota_blocked|soft_deleted"
        text draft_md "nullable"
        text final_md "nullable"
        text model_used "nullable"
        timestamptz drafted_at "nullable"
        timestamptz last_edited_at "nullable"
        timestamptz created_at
        timestamptz deleted_at
    }

    ENTRY_PHOTOS {
        uuid entry_id FK
        uuid photo_id FK
        integer position
    }

    ENTRY_REVISIONS {
        uuid id PK
        uuid entry_id FK
        text final_md
        timestamptz saved_at
    }

    LOCATIONS {
        uuid id PK
        decimal lat_4dp "9,4 ~11m precision"
        decimal lng_4dp "9,4"
        text place_name "Café Nero, Vesterbro, Copenhagen"
        text country
        text region
        jsonb raw "raw geocoder response"
        timestamptz cached_at
    }

    AI_USAGE_LEDGER {
        uuid id PK
        uuid user_id FK
        uuid entry_id FK "nullable"
        text purpose "vision|draft|regenerate"
        text model
        integer tokens_in
        integer tokens_out
        numeric cost_eur "12,6"
        timestamptz called_at
    }

    AI_DAILY_COST {
        uuid user_id FK
        date day "user-tz local date"
        numeric total_eur "12,6"
        timestamptz updated_at
    }
```

## Notes

- Composite PK on `ENTRY_PHOTOS (entry_id, photo_id)` and on `AI_DAILY_COST (user_id, day)`.
- `ENTRIES UNIQUE (user_id, entry_date) WHERE deleted_at IS NULL` — prevents two active entries per day.
- `PHOTOS UNIQUE (user_id, blob_path)` — defensive (blob path is already unique by construction).
- `LOCATIONS UNIQUE (lat_4dp, lng_4dp)` — geocode cache keyed at ~11m precision.
- `ON DELETE`:
  - `users` cascade → refresh_tokens, photos, entries, ai_*, entry_revisions (only on **hard delete**, which is initiated by the account-deletion job).
  - `entries` cascade → entry_photos, entry_revisions.
  - `photos` restrict — orphans must not happen because we delete the entry first.
