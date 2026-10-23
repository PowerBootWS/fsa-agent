-- 031: Text-message coaching through GHL (backlog #139 phase 4, 2026-10-22).
-- Students opt in with their mobile number; texts go through GHL (the only
-- reason GHL is used here), and every message in or out is copied into
-- coaching_texts, which is the official record. Replay-safe.

ALTER TABLE coaching_profiles ADD COLUMN IF NOT EXISTS phone TEXT;                  -- +1XXXXXXXXXX
ALTER TABLE coaching_profiles ADD COLUMN IF NOT EXISTS text_opt_in_at TIMESTAMPTZ;
ALTER TABLE coaching_profiles ADD COLUMN IF NOT EXISTS text_consent TEXT;           -- the exact wording they agreed to
ALTER TABLE coaching_profiles ADD COLUMN IF NOT EXISTS text_opt_out_at TIMESTAMPTZ;
ALTER TABLE coaching_profiles ADD COLUMN IF NOT EXISTS text_offer_declined_at TIMESTAMPTZ;
ALTER TABLE coaching_profiles ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT;
ALTER TABLE coaching_profiles ADD COLUMN IF NOT EXISTS ghl_conversation_id TEXT;
-- Conversation state for the reply timer:
--   text_pending_since       first student text not yet answered
--   text_russ_active_until   Russ texted from the GHL app; the coach stays out until then
--   text_coach_active_until  the coach is looking after this conversation (short wait)
ALTER TABLE coaching_profiles ADD COLUMN IF NOT EXISTS text_pending_since TIMESTAMPTZ;
ALTER TABLE coaching_profiles ADD COLUMN IF NOT EXISTS text_russ_active_until TIMESTAMPTZ;
ALTER TABLE coaching_profiles ADD COLUMN IF NOT EXISTS text_coach_active_until TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_coaching_profiles_ghl_contact
  ON coaching_profiles (ghl_contact_id) WHERE ghl_contact_id IS NOT NULL;

-- Every text in or out. sent_by: student | russ (typed in the GHL app) |
-- coach (a draft Russ approved) | system (the opt-in welcome).
CREATE TABLE IF NOT EXISTS coaching_texts (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  direction      TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  sent_by        TEXT NOT NULL CHECK (sent_by IN ('student', 'russ', 'coach', 'system')),
  body           TEXT NOT NULL,
  ghl_message_id TEXT UNIQUE,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_coaching_texts_user ON coaching_texts (user_id, sent_at DESC);

-- Drafts waiting on Russ's tap (Send / Skip) on the coach bot.
CREATE TABLE IF NOT EXISTS coaching_text_drafts (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  reason              TEXT NOT NULL CHECK (reason IN ('reply', 'commitment')),
  commitment_id       INTEGER REFERENCES coaching_commitments(id) ON DELETE SET NULL,
  body                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'scheduled', 'sent', 'skipped', 'superseded', 'failed')),
  send_after          TIMESTAMPTZ,
  telegram_message_id BIGINT,
  telegram_text       TEXT,
  meta                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_coaching_text_drafts_open
  ON coaching_text_drafts (user_id) WHERE status IN ('pending', 'scheduled');

-- Small key/value state for the poller (GHL cursor, heartbeat).
CREATE TABLE IF NOT EXISTS coaching_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Commitments can now come from a text conversation.
ALTER TABLE coaching_commitments DROP CONSTRAINT IF EXISTS coaching_commitments_source_check;
ALTER TABLE coaching_commitments ADD CONSTRAINT coaching_commitments_source_check
  CHECK (source IN ('goal_form', 'email_reply', 'russ', 'text'));
