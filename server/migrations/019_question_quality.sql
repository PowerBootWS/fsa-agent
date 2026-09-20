-- 019_question_quality.sql
--
-- Two changes, both prompted by a student (Kyle Dempster, 2026-09-19) reporting
-- that chapter 2B3-2 was marking the correct answer wrong. 20 of that chapter's
-- 30 questions carried a mis-keyed correct_answer.
--
-- Nothing in the system could have caught it:
--   * question_responses stored only a `correct` boolean, never which option the
--     student actually picked — so "every student picks B and we call it wrong"
--     was invisible in the data.
--   * there was no way for a student to say "this question is wrong". The only
--     reason we know is that one student went to the trouble of a Facebook
--     message. Most will simply conclude they were wrong and lose confidence.
--
-- Both call sites in orchestrator.py already computed selected_index and threw
-- it away; this makes somewhere for it to go.

BEGIN;

ALTER TABLE question_responses
  ADD COLUMN IF NOT EXISTS selected_index smallint;

COMMENT ON COLUMN question_responses.selected_index IS
  'Zero-based index of the option the student chose. NULL for rows written '
  'before 2026-09-19, and for free-text or multi-step answers with no single '
  'option. A question where most students converge on one wrong index is a '
  'mis-keyed answer until proven otherwise.';

CREATE TABLE IF NOT EXISTS question_flags (
  id              serial PRIMARY KEY,
  question_id     integer NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_email      varchar(255) NOT NULL,
  lesson_code     varchar(40),
  -- What the student said, if anything. Optional on purpose: requiring a
  -- written justification is enough friction to stop most people reporting.
  reason          text,
  -- Snapshot of the disputed state at flag time. The key may well be corrected
  -- before anyone reviews the flag, and without these the report becomes
  -- unreadable after the fix.
  selected_index  smallint,
  keyed_index     smallint,
  status          varchar(20) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'confirmed', 'dismissed', 'fixed')),
  created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at     timestamp,
  reviewed_note   text
);

CREATE INDEX IF NOT EXISTS idx_question_flags_status
  ON question_flags (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_question_flags_question
  ON question_flags (question_id);

-- One open flag per student per question: clicking twice is not two reports.
CREATE UNIQUE INDEX IF NOT EXISTS idx_question_flags_one_open
  ON question_flags (question_id, user_email)
  WHERE status = 'open';

COMMIT;
