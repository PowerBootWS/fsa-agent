-- Patches production schema drift into the fsa_agent_test database. platform_users.phone
-- and platform_users.address exist in production but were never captured in a checked-in
-- migration file (added by hand at some point before this test harness existed). Run this
-- after applying the numbered migrations in server/migrations/ when (re)creating
-- fsa_agent_test, so requireAuth.js's query (which selects pu.phone, pu.address) works.
-- Safe to re-run.
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS phone character varying(50);
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS address text;

-- login_events: the base table itself was never captured in a checked-in migration
-- (only later ALTERs — 005_login_event_ip.sql, 007_login_event_device.sql — were).
-- Mirrors production's current shape so auth.js's recordLoginEvent() insert works
-- against fsa_agent_test. Safe to re-run.
CREATE TABLE IF NOT EXISTS login_events (
  id                        SERIAL PRIMARY KEY,
  user_id                   INTEGER NOT NULL REFERENCES platform_users(id),
  logged_in_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address                TEXT,
  user_agent                TEXT,
  device_type               TEXT,
  displaced_active_session  BOOLEAN
);
CREATE INDEX IF NOT EXISTS idx_login_events_logged_in_at ON login_events (logged_in_at);
CREATE INDEX IF NOT EXISTS idx_login_events_user_id ON login_events (user_id);
