-- 038: leveled practice exams, groundwork (2026-11-17, backlog #147).
-- exam_topic_groups holds each paper's typical real-exam topic mix (loaded from
-- wiki/reference/sopeec-exam-breakdown.csv by scripts/load_topic_groups.py); a
-- question's topic group is resolved by joining its chapter_id against chapter_ids.
-- questions.exam_level is the NEW calibrated difficulty scale (1 building block,
-- 2 textbook, 3 typical exam question, 4 Max); NULL = not graded yet. The old
-- questions.difficulty (1-5) is untouched and still drives the tutor and chapter
-- tests. Design: docs/superpowers/specs/2026-11-17-leveled-practice-exams-design.md.
-- Replay-safe.
CREATE TABLE IF NOT EXISTS exam_topic_groups (
  paper_code     varchar(10) NOT NULL,
  topic_key      varchar(60) NOT NULL,
  display_name   text        NOT NULL,
  exam_questions smallint    NOT NULL CHECK (exam_questions >= 0),
  chapter_ids    text[]      NOT NULL,
  sort_order     smallint    NOT NULL,
  PRIMARY KEY (paper_code, topic_key)
);

ALTER TABLE questions ADD COLUMN IF NOT EXISTS exam_level smallint;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS level_scores jsonb;
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_exam_level_check;
ALTER TABLE questions ADD CONSTRAINT questions_exam_level_check
  CHECK (exam_level IS NULL OR exam_level BETWEEN 1 AND 4);

CREATE INDEX IF NOT EXISTS idx_questions_exam_level
  ON questions (course_id, exam_level) WHERE standalone;
