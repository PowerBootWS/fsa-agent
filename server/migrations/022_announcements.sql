-- 022: "What's new" announcements (spec docs/superpowers/specs/2026-09-30-announcements-design.md).
-- Written by Claude when a feature ships, approved by Russ, published by
-- src/scripts/publish_announcement.js. Replay-safe (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS announcements (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  cta_label   TEXT,
  cta_url     TEXT,
  audiences   TEXT[] NOT NULL CHECK (
                cardinality(audiences) > 0 AND
                audiences <@ ARRAY['everyone','students','second','third','fourth_a','fourth_b','affiliates','job_seekers']::text[]
              ),
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS announcement_views (
  announcement_id  INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  action           TEXT NOT NULL CHECK (action IN ('dismissed', 'cta', 'feedback')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS announcement_feedback (
  id               SERIAL PRIMARY KEY,
  announcement_id  INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  message          TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS announcement_feedback_announcement_idx ON announcement_feedback (announcement_id);
