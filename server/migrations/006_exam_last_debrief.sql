-- 006_exam_last_debrief.sql
-- Durable cache of the most recent completed practice-exam debrief, so the
-- lobby "Review most recent results" button and page refreshes can restore the
-- full feedback (results + next-exam allocation + teaching tips + tutor summary)
-- even after the AI service restarts. One row per (user, course), upserted on
-- each completed exam.

CREATE TABLE IF NOT EXISTS exam_last_debrief (
    user_email  TEXT        NOT NULL,
    course_id   TEXT        NOT NULL,
    debrief     JSONB       NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_email, course_id)
);
