-- 036: "Retry the ones I got wrong" answers get their own session_type
-- (attempt history Phase D, 2026-11-10). Recording them as 'chapter_quiz'
-- would count them toward chapter-quiz pass gates and lobby quiz stats (all
-- filter session_type = 'chapter_quiz'), and Russ decided retries must not
-- feed adaptive exam weighting either. Numbered 036 because 035 is taken by
-- the mini-lessons branch. Replay-safe.
ALTER TABLE question_responses DROP CONSTRAINT IF EXISTS question_responses_session_type_check;
ALTER TABLE question_responses ADD CONSTRAINT question_responses_session_type_check
  CHECK (session_type IN ('lesson', 'chapter_quiz', 'practice_exam', 'diagnostic', 'retry_wrong'));
