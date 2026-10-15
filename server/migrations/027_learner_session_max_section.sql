-- 027: Furthest slide reached per student per objective (2026-10-14).
-- The lesson player shows a check-in card every few slides. A student who goes
-- back to re-read an earlier slide and then steps forward again should not get
-- the same check-in a second time, so the player only shows one when it arrives
-- at a slide past this mark. Advanced only by Next (GREATEST on write), never by
-- Back or by jumping around the outline. No backfill: last_section predates the
-- check-in cards, so existing students see each card once more, then never again.
-- Replay-safe.
ALTER TABLE learner_sessions ADD COLUMN IF NOT EXISTS max_section INTEGER;
