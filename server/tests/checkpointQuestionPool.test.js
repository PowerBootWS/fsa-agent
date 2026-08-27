/**
 * Backlog #102 — the checkpoint pool ignored lesson progress.
 *
 * `getCheckpointQuestionPool` returned every standalone objective_practice
 * question for the lesson, ordered by id, and the route took the first one the
 * learner had not seen. Nothing in either path knew which slides had been
 * shown, so on 2A2-1-1 a student five slides in — having seen only the
 * conceptual energy-forms slides — was asked question 13022, a sensible-heat
 * calculation needing Q = m·c·ΔT from around slide 15.
 */
const { pool } = require('./testPool');
const db = require('../src/services/database');

const LESSON = '2A2-1-1-fixture102';

async function insertQuestion({ id, earliestSlide, standalone = true, type = 'objective_practice' }) {
  await pool.query(
    `INSERT INTO questions
       (id, lesson_code, question_text, options, correct_answer, question_type, standalone, earliest_slide)
     VALUES ($1, $2, $3, $4::jsonb, 0, $5, $6, $7)`,
    [id, LESSON, `fixture question ${id}`, JSON.stringify(['a', 'b']), type, standalone, earliestSlide]
  );
}

beforeEach(async () => {
  await pool.query('DELETE FROM questions WHERE lesson_code = $1', [LESSON]);
});
afterAll(async () => {
  await pool.query('DELETE FROM questions WHERE lesson_code = $1', [LESSON]);
  await pool.end();
});

describe('getCheckpointQuestionPool', () => {
  it('excludes a question the lesson has not reached yet', async () => {
    await insertQuestion({ id: 990001, earliestSlide: 2 });   // energy forms
    await insertQuestion({ id: 990002, earliestSlide: 15 });  // sensible heat calc

    const pooled = await db.getCheckpointQuestionPool(LESSON, 5);

    expect(pooled.map(q => q.id)).toEqual([990001]);
  });

  it('includes it once the lesson has taught it', async () => {
    await insertQuestion({ id: 990001, earliestSlide: 2 });
    await insertQuestion({ id: 990002, earliestSlide: 15 });

    const pooled = await db.getCheckpointQuestionPool(LESSON, 16);

    expect(pooled.map(q => q.id)).toEqual([990001, 990002]);
  });

  it('treats an unplaced question as unrestricted', async () => {
    // NULL means "we could not place it", not "it is premature" — the column
    // fills in gradually and nothing may become unreachable in the meantime.
    await insertQuestion({ id: 990003, earliestSlide: null });

    const pooled = await db.getCheckpointQuestionPool(LESSON, 1);

    expect(pooled.map(q => q.id)).toEqual([990003]);
  });

  it('falls back to the whole pool rather than returning nothing', async () => {
    // A checkpoint that renders no question is its own bad experience — that
    // exact failure was fixed on 2026-08-25 and must not come back to enforce
    // a nicety about timing.
    await insertQuestion({ id: 990002, earliestSlide: 15 });

    const pooled = await db.getCheckpointQuestionPool(LESSON, 3);

    expect(pooled.map(q => q.id)).toEqual([990002]);
  });

  it('still returns everything when no slide is given', async () => {
    await insertQuestion({ id: 990001, earliestSlide: 2 });
    await insertQuestion({ id: 990002, earliestSlide: 15 });

    const pooled = await db.getCheckpointQuestionPool(LESSON);

    expect(pooled.map(q => q.id)).toEqual([990001, 990002]);
  });

  it('keeps the existing standalone and question_type filters', async () => {
    await insertQuestion({ id: 990001, earliestSlide: 2 });
    await insertQuestion({ id: 990004, earliestSlide: 2, standalone: false });
    await insertQuestion({ id: 990005, earliestSlide: 2, type: 'chapter_quiz' });

    const pooled = await db.getCheckpointQuestionPool(LESSON, 20);

    expect(pooled.map(q => q.id)).toEqual([990001]);
  });

  it('regression: 2A2-1-1 at slide 5 does not offer the sensible-heat calculation', async () => {
    await insertQuestion({ id: 990010, earliestSlide: 2 });   // energy_forms
    await insertQuestion({ id: 990011, earliestSlide: 6 });   // power_vs_energy
    await insertQuestion({ id: 990012, earliestSlide: 12 });  // sensible_heat_calculation
    await insertQuestion({ id: 990013, earliestSlide: 25 });  // mixture_specific_heat

    const pooled = await db.getCheckpointQuestionPool(LESSON, 5);

    expect(pooled.map(q => q.id)).toEqual([990010]);
  });
});
