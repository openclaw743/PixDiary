-- PixDiary dev seed — minimal demo user, no photos.
-- Password "demo-password-1" hashed with bcrypt cost 12 (replace before use; this is dev only).

INSERT INTO users (id, email, password_hash, timezone, daily_cap_eur)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'demo@pixdiary.local',
  '$2b$12$abcdefghijklmnopqrstuuJpvJP4xCcQ8wQjQ6Yw3Y6Y3a5q1lXf6q', -- placeholder; backend sets a real hash on first run
  'Europe/Copenhagen',
  0.50
)
ON CONFLICT DO NOTHING;
