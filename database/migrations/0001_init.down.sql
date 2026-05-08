-- PixDiary 0001_init — rollback

BEGIN;

DROP TABLE IF EXISTS ai_daily_cost;
DROP TABLE IF EXISTS ai_usage_ledger;
DROP TABLE IF EXISTS entry_revisions;
DROP TABLE IF EXISTS entry_photos;
DROP TABLE IF EXISTS entries;
DROP TABLE IF EXISTS photos;
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;

-- pgcrypto kept; harmless if other databases use it.

COMMIT;
