const { pool } = require('./testPool');

async function columnsOf(table) {
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return Object.fromEntries(rows.map((r) => [r.column_name, r]));
}

const FIXTURE_TEXT = 'leveledSchema.test fixture question';

async function insertQuestion(examLevel) {
  return pool.query(
    `INSERT INTO questions (course_id, chapter_id, question_text, options, correct_answer, exam_level)
     VALUES ('ZZ1', 'ZZ1-1', $1, '["a","b","c","d"]'::jsonb, 0, $2) RETURNING id`,
    [FIXTURE_TEXT, examLevel]
  );
}

afterAll(async () => {
  await pool.query('DELETE FROM questions WHERE question_text = $1', [FIXTURE_TEXT]);
  await pool.end();
});

describe('038_leveled_exam_levels schema', () => {
  it('creates exam_topic_groups with the expected columns', async () => {
    const cols = await columnsOf('exam_topic_groups');
    expect(Object.keys(cols).sort()).toEqual([
      'chapter_ids', 'display_name', 'exam_questions', 'paper_code', 'sort_order', 'topic_key',
    ]);
    expect(cols.chapter_ids.data_type).toBe('ARRAY');
    expect(cols.display_name.is_nullable).toBe('NO');
  });

  it('adds nullable exam_level and level_scores to questions', async () => {
    const cols = await columnsOf('questions');
    expect(cols.exam_level.data_type).toBe('smallint');
    expect(cols.exam_level.is_nullable).toBe('YES');
    expect(cols.level_scores.data_type).toBe('jsonb');
  });

  it('rejects exam_level 5', async () => {
    await expect(insertQuestion(5)).rejects.toThrow(/violates check constraint "questions_exam_level_check"/);
  });

  it('accepts exam_level 4 and NULL', async () => {
    await expect(insertQuestion(4)).resolves.toBeTruthy();
    await expect(insertQuestion(null)).resolves.toBeTruthy();
  });
});
