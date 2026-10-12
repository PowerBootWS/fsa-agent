-- 024: NPS survey (backlog #127). One row per time a student was asked:
-- 'answered' carries the 0-10 score (and optional reason, and for promoters
-- whether they already had their affiliate link); 'dismissed' records a close
-- without answering so we back off for a while instead of asking every visit.
-- Replay-safe.
CREATE TABLE IF NOT EXISTS nps_responses (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  class_code         TEXT,
  outcome            TEXT NOT NULL CHECK (outcome IN ('answered', 'dismissed')),
  score              SMALLINT CHECK (score BETWEEN 0 AND 10),
  reason             TEXT,
  had_affiliate_link BOOLEAN,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((outcome = 'answered') = (score IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_nps_responses_user ON nps_responses (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nps_responses_created ON nps_responses (created_at);
