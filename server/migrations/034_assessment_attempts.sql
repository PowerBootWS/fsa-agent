-- 034: Practice exam / chapter quiz attempt history (plan
-- docs/superpowers/plans/2026-11-08-practice-attempt-history.md, Phase A).
-- One assessment_attempts row per sitting; each answer links to its attempt
-- and carries a snapshot of the question exactly as it was shown, so later
-- in-place question edits (#138 cutovers) never change a past attempt.
-- Not named practice_exam_attempts: that table belongs to the free practice
-- exam lead magnet. Replay-safe; one transaction so the FK swap is atomic.

BEGIN;

CREATE TABLE IF NOT EXISTS assessment_attempts (
  id                BIGSERIAL PRIMARY KEY,
  user_email        VARCHAR(255) NOT NULL,
  course_id         VARCHAR(10)  NOT NULL,
  chapter_id        VARCHAR(20),
  kind              VARCHAR(20)  NOT NULL
                    CHECK (kind IN ('practice_exam', 'chapter_quiz', 'retry_wrong')),
  parent_attempt_id BIGINT REFERENCES assessment_attempts(id) ON DELETE SET NULL,
  started_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  question_count    SMALLINT,
  score             SMALLINT,
  score_pct         SMALLINT,
  chapter_stats     JSONB,
  source            VARCHAR(20)  NOT NULL DEFAULT 'live'
                    CHECK (source IN ('live', 'pre_history'))
);
CREATE INDEX IF NOT EXISTS idx_aa_user_course
  ON assessment_attempts (user_email, course_id, started_at DESC);

ALTER TABLE question_responses
  ADD COLUMN IF NOT EXISTS attempt_id BIGINT REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS position SMALLINT,
  ADD COLUMN IF NOT EXISTS question_snapshot JSONB;
CREATE INDEX IF NOT EXISTS idx_qr_attempt ON question_responses (attempt_id, position);

-- Deleting a question (or a lesson, which cascades to its questions) used to
-- delete every student's answers to it. Keep the answer; drop the link.
ALTER TABLE question_responses ALTER COLUMN question_id DROP NOT NULL;
ALTER TABLE question_responses DROP CONSTRAINT IF EXISTS question_responses_question_id_fkey;
ALTER TABLE question_responses ADD CONSTRAINT question_responses_question_id_fkey
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE SET NULL;
COMMIT;
