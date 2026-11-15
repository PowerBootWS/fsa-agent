-- 037: announcements can target one paper (2026-11-14). A paper code such as
-- '2A3' is now a valid audience alongside the groups; who matches is decided
-- in src/services/announcements.js (current paper, or a lesson of that paper
-- opened in the last 30 days, with a live subscription). Keep this list in
-- step with src/config/papersForClass.js. Replay-safe.
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_audiences_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_audiences_check CHECK (
  cardinality(audiences) > 0 AND
  audiences <@ ARRAY['everyone','students','second','third','fourth_a','fourth_b','affiliates','job_seekers',
                     '2A1','2A2','2A3','2B1','2B2','2B3','3A1','3A2','3B1','3B2','4A','4B']::text[]
);
