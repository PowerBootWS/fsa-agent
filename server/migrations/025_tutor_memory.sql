-- 025: Tutor memory (lesson tutor redesign, slice 1 — 2026-10-13).
-- One small record per student that the lesson tutor carries across
-- objectives and ai-service restarts: the name they asked to be called,
-- standing preferences about how it talks to them, and a few short notes.
-- Written by ai-service agents/memory.py; capped there (10 + 10 items).
-- Replay-safe.
CREATE TABLE IF NOT EXISTS tutor_memory (
  user_email     VARCHAR(255) PRIMARY KEY,
  preferred_name TEXT,
  preferences    JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes          JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
