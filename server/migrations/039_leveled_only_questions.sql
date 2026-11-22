-- 039: leveled-only questions (2026-11-21, backlog #147, leveled exams Plan 2).
-- The bank fill adds thousands of new questions, mostly Exam-Level and Max. Owner
-- decision 2026-11-21: they are served by the leveled practice exam only. Chapter
-- tests, the current adaptive practice exam, the tutor and the free diagnostic keep
-- today's pool, so every one of those selections filters `NOT leveled_only`.
-- The leveled engine (Plan 3) selects `standalone AND exam_level IS NOT NULL`,
-- which covers both pools. Retire as usual with standalone = false; never delete.
-- Replay-safe.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS leveled_only boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_questions_leveled_pool
  ON questions (course_id, chapter_id, exam_level) WHERE standalone AND leveled_only;
