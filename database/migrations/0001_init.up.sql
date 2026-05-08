-- PixDiary 0001_init — initial schema
-- PostgreSQL 16. Idempotent extension creation; tables are not idempotent.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- USERS -----------------------------------------------------------------------

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  password_hash   text NOT NULL,
  timezone        text NOT NULL DEFAULT 'UTC',
  daily_cap_eur   numeric(6,2) NOT NULL DEFAULT 0.50
                  CHECK (daily_cap_eur >= 0.10 AND daily_cap_eur <= 5.00),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email)) WHERE deleted_at IS NULL;

-- REFRESH_TOKENS --------------------------------------------------------------

CREATE TABLE refresh_tokens (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash               text NOT NULL,
  issued_at                timestamptz NOT NULL DEFAULT now(),
  expires_at               timestamptz NOT NULL,
  used_at                  timestamptz,
  replaced_by_token_hash   text
);

CREATE UNIQUE INDEX refresh_tokens_token_hash_idx ON refresh_tokens (token_hash);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

-- LOCATIONS (geocode cache) ---------------------------------------------------

CREATE TABLE locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lat_4dp     numeric(9,4) NOT NULL,
  lng_4dp     numeric(9,4) NOT NULL,
  place_name  text NOT NULL,
  country     text,
  region      text,
  raw         jsonb,
  cached_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX locations_latlng_idx ON locations (lat_4dp, lng_4dp);

-- PHOTOS ----------------------------------------------------------------------

CREATE TABLE photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blob_path     text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    bigint NOT NULL,
  width         integer,
  height        integer,
  taken_at      timestamptz,
  taken_on      date,
  gps_lat       numeric(9,6),
  gps_lng       numeric(9,6),
  camera_make   text,
  camera_model  text,
  location_id   uuid REFERENCES locations(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','uploaded','processing','processed','failed')),
  ai_scene      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE UNIQUE INDEX photos_blob_path_idx ON photos (blob_path);
CREATE INDEX photos_user_taken_idx ON photos (user_id, taken_on) WHERE deleted_at IS NULL;

-- ENTRIES ---------------------------------------------------------------------

CREATE TABLE entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date      date NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','drafted','saved',
                                    'processing_failed','quota_blocked','soft_deleted')),
  draft_md        text,
  final_md        text,
  model_used      text,
  drafted_at      timestamptz,
  last_edited_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE UNIQUE INDEX entries_user_date_active_idx
  ON entries (user_id, entry_date)
  WHERE deleted_at IS NULL;

CREATE INDEX entries_user_date_desc_idx ON entries (user_id, entry_date DESC) WHERE deleted_at IS NULL;

-- ENTRY_PHOTOS (join) ---------------------------------------------------------

CREATE TABLE entry_photos (
  entry_id   uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  photo_id   uuid NOT NULL REFERENCES photos(id) ON DELETE RESTRICT,
  position   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (entry_id, photo_id)
);

CREATE INDEX entry_photos_photo_idx ON entry_photos (photo_id);

-- ENTRY_REVISIONS (for voice capture) -----------------------------------------

CREATE TABLE entry_revisions (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id  uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  final_md  text NOT NULL,
  saved_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX entry_revisions_entry_idx ON entry_revisions (entry_id, saved_at DESC);

-- AI_USAGE_LEDGER -------------------------------------------------------------

CREATE TABLE ai_usage_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id    uuid REFERENCES entries(id) ON DELETE SET NULL,
  purpose     text NOT NULL CHECK (purpose IN ('vision','draft','regenerate')),
  model       text NOT NULL,
  tokens_in   integer NOT NULL DEFAULT 0,
  tokens_out  integer NOT NULL DEFAULT 0,
  cost_eur    numeric(12,6) NOT NULL DEFAULT 0,
  called_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_user_called_idx ON ai_usage_ledger (user_id, called_at DESC);

-- AI_DAILY_COST (rollup) ------------------------------------------------------

CREATE TABLE ai_daily_cost (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         date NOT NULL,
  total_eur   numeric(12,6) NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

COMMIT;
