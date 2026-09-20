-- 020_diagnostic_session_type.sql
--
-- routes/diagnostic.js inserts question_responses rows with
-- session_type = 'diagnostic', but the CHECK constraint only ever allowed
-- 'lesson', 'chapter_quiz' and 'practice_exam'. Every insert therefore threw,
-- the route's catch turned it into a 500, and the prospect taking the
-- lead-magnet diagnostic got "Failed to process results" instead of a score.
--
-- Confirmed 2026-09-19: question_responses holds 5334 practice_exam and 2499
-- chapter_quiz rows and not one diagnostic row, despite the route being live.

BEGIN;

ALTER TABLE question_responses
  DROP CONSTRAINT IF EXISTS question_responses_session_type_check;

ALTER TABLE question_responses
  ADD CONSTRAINT question_responses_session_type_check
  CHECK (session_type IN ('lesson', 'chapter_quiz', 'practice_exam', 'diagnostic'));

COMMIT;
