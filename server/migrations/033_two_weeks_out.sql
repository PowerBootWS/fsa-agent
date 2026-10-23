-- 033: Two-weeks-out reminder (backlog #139, 2026-10-23). Students with an
-- exact exam date get Russ's final-stretch plan (fullsteamahead.ca/two-weeks-out)
-- fourteen days before it. Notes on Home can now carry a link. Replay-safe.
ALTER TABLE coaching_commitments DROP CONSTRAINT IF EXISTS coaching_commitments_kind_check;
ALTER TABLE coaching_commitments ADD CONSTRAINT coaching_commitments_kind_check
  CHECK (kind IN ('book_exam', 'exam_date', 'weekly_sessions', 'custom', 'two_weeks_out'));
ALTER TABLE coaching_messages ADD COLUMN IF NOT EXISTS link_url TEXT;
ALTER TABLE coaching_messages ADD COLUMN IF NOT EXISTS link_label TEXT;
