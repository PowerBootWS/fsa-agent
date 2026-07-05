-- Patches production schema drift into the fsa_agent_test database. platform_users.phone
-- and platform_users.address exist in production but were never captured in a checked-in
-- migration file (added by hand at some point before this test harness existed). Run this
-- after applying the numbered migrations in server/migrations/ when (re)creating
-- fsa_agent_test, so requireAuth.js's query (which selects pu.phone, pu.address) works.
-- Safe to re-run.
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS phone character varying(50);
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS address text;
