-- 030: Russ's coaching rules (backlog #139 phase 3, 2026-10-22).
-- When Russ tells the coach bot "if someone asks this again, answer it like I
-- did", the rule is saved here. Phase 4 text drafts follow them. Replay-safe.
CREATE TABLE IF NOT EXISTS coaching_rules (
  id          SERIAL PRIMARY KEY,
  rule        TEXT NOT NULL,
  example     TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
