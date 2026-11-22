-- 040: leveled practice exam engine (Plan 3, 2026-11-22, backlog #147).
-- student_topic_levels: each student's level per paper topic group (default 2 = Core).
-- leveled_exam_sittings: one row per leveled sitting with its per-topic record; abandoned
-- sittings simply stay 'in_progress' and never move levels.
-- platform_users.exam_engine: NULL = follow LEVELED_PAPERS; 'adaptive' = the student's
-- fallback to the previous adaptive exam. Replay-safe.
CREATE TABLE IF NOT EXISTS student_topic_levels (
  user_email  text        NOT NULL,
  paper_code  varchar(10) NOT NULL,
  topic_key   varchar(60) NOT NULL,
  level       smallint    NOT NULL DEFAULT 2 CHECK (level BETWEEN 1 AND 4),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_email, paper_code, topic_key)
);

CREATE TABLE IF NOT EXISTS leveled_exam_sittings (
  id             bigserial    PRIMARY KEY,
  user_email     text         NOT NULL,
  paper_code     varchar(10)  NOT NULL,
  length         smallint     NOT NULL CHECK (length IN (50, 100)),
  lead_magnet    boolean      NOT NULL DEFAULT false,
  attempt_id     bigint       REFERENCES assessment_attempts(id) ON DELETE SET NULL,
  status         text         NOT NULL DEFAULT 'in_progress'
                              CHECK (status IN ('in_progress', 'completed', 'timed_out')),
  round_up_first boolean      NOT NULL,
  question_ids   integer[]    NOT NULL,
  topics         jsonb,
  level_changes  jsonb,
  predicted_pct  numeric(5,2),
  verdict_band   text,
  started_at     timestamptz  NOT NULL DEFAULT now(),
  completed_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_leveled_sittings_user
  ON leveled_exam_sittings (user_email, paper_code, completed_at DESC);

ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS exam_engine text;
ALTER TABLE platform_users DROP CONSTRAINT IF EXISTS platform_users_exam_engine_check;
ALTER TABLE platform_users ADD CONSTRAINT platform_users_exam_engine_check
  CHECK (exam_engine IS NULL OR exam_engine IN ('adaptive', 'leveled'));
