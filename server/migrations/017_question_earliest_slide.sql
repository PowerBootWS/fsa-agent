-- Backlog #102: in-lesson practice questions were served with no regard for
-- what the lesson had actually taught yet.
--
-- Checkpoints fired on slide count alone and then took any unasked question
-- from the lesson's pool, ordered by id. On 2A2-1-1 that put a sensible-heat
-- calculation needing Q = m·c·ΔT (taught around slide 15) in front of a student
-- five slides in, having seen only the conceptual energy-forms slides.
--
-- `earliest_slide` is the first slide at which a question becomes answerable.
-- NULL means "not placed" and is treated as unrestricted, so this column can be
-- filled in gradually without any question becoming unreachable in the meantime.
--
-- `earliest_slide_source` records HOW a value was placed, so a bad batch can be
-- reverted wholesale without disturbing the good one:
--   deterministic — matched from the question's `topic` against slide section
--                   titles and bodies, teaching slides only
--   llm           — placed by an offline model pass over the leftovers
--   manual        — set by hand
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS earliest_slide INTEGER,
  ADD COLUMN IF NOT EXISTS earliest_slide_source VARCHAR(20);

-- The checkpoint pool query filters on (lesson_code, question_type, standalone)
-- and now earliest_slide too.
CREATE INDEX IF NOT EXISTS idx_questions_checkpoint_pool
  ON questions (lesson_code, question_type, standalone, earliest_slide);

COMMENT ON COLUMN questions.earliest_slide IS
  'First slide_number at which this question is answerable; NULL = unrestricted (backlog #102)';
COMMENT ON COLUMN questions.earliest_slide_source IS
  'deterministic | llm | manual — how earliest_slide was placed, so a batch can be reverted';
