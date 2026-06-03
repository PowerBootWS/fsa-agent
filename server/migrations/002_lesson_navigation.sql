CREATE TABLE IF NOT EXISTS chapters (
  course_id    TEXT    NOT NULL,
  chapter_num  INTEGER NOT NULL,
  title        TEXT,
  PRIMARY KEY (course_id, chapter_num)
);

CREATE TABLE IF NOT EXISTS course_progress (
  learner_id        TEXT        NOT NULL,
  course_id         TEXT        NOT NULL,
  last_lesson_code  TEXT        NOT NULL,
  last_slide        INTEGER     NOT NULL DEFAULT 1,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id, course_id)
);
