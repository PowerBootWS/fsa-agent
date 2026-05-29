-- fsa-agent/server/migrations/001_lesson_player.sql

ALTER TABLE lesson_chunks
  ADD COLUMN IF NOT EXISTS audio_url        TEXT,
  ADD COLUMN IF NOT EXISTS image_url        TEXT,
  ADD COLUMN IF NOT EXISTS narration_timing JSONB,
  ADD COLUMN IF NOT EXISTS checkpoint_after BOOLEAN;

CREATE TABLE IF NOT EXISTS learner_sessions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id       TEXT        NOT NULL,
  lesson_code      TEXT        NOT NULL,
  sections_viewed  INTEGER[]   NOT NULL DEFAULT '{}',
  checkpoint_log   JSONB       NOT NULL DEFAULT '[]',
  last_section     INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (learner_id, lesson_code)
);
