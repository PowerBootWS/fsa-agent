const { pool } = require('./testPool');

const EMAIL = 'leveled-engine-schema@test.invalid';

async function columnsOf(table) {
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`, [table]);
  return Object.fromEntries(rows.map((r) => [r.column_name, r]));
}

afterAll(async () => {
  await pool.query('DELETE FROM leveled_exam_sittings WHERE user_email = $1', [EMAIL]).catch(() => {});
  await pool.query('DELETE FROM student_topic_levels WHERE user_email = $1', [EMAIL]).catch(() => {});
  await pool.query('DELETE FROM platform_users WHERE email = $1', [EMAIL]);
  await pool.end();
});

describe('040_leveled_exam_engine schema', () => {
  it('creates student_topic_levels', async () => {
    const c = await columnsOf('student_topic_levels');
    expect(Object.keys(c).sort()).toEqual(['level', 'paper_code', 'topic_key', 'updated_at', 'user_email']);
    expect(c.level.data_type).toBe('smallint');
  });

  it('creates leveled_exam_sittings', async () => {
    const c = await columnsOf('leveled_exam_sittings');
    expect(Object.keys(c).sort()).toEqual([
      'attempt_id', 'completed_at', 'id', 'lead_magnet', 'length', 'level_changes', 'paper_code',
      'predicted_pct', 'question_ids', 'round_up_first', 'started_at', 'status', 'topics', 'user_email', 'verdict_band',
    ]);
    expect(c.question_ids.data_type).toBe('ARRAY');
    expect(c.topics.data_type).toBe('jsonb');
    expect(c.attempt_id.data_type).toBe('bigint');
  });

  it('adds a nullable platform_users.exam_engine', async () => {
    const c = await columnsOf('platform_users');
    expect(c.exam_engine.is_nullable).toBe('YES');
  });

  it('rejects level 5, length 25, a bad status and a bad engine', async () => {
    await expect(pool.query(
      `INSERT INTO student_topic_levels (user_email, paper_code, topic_key, level) VALUES ($1, 'ZZ9', 't', 5)`, [EMAIL]))
      .rejects.toThrow(/check constraint/);
    await expect(pool.query(
      `INSERT INTO leveled_exam_sittings (user_email, paper_code, length, round_up_first, question_ids)
       VALUES ($1, 'ZZ9', 25, true, '{}')`, [EMAIL])).rejects.toThrow(/check constraint/);
    await expect(pool.query(
      `INSERT INTO leveled_exam_sittings (user_email, paper_code, length, round_up_first, question_ids, status)
       VALUES ($1, 'ZZ9', 50, true, '{}', 'abandoned')`, [EMAIL])).rejects.toThrow(/check constraint/);
    await expect(pool.query(
      `INSERT INTO platform_users (email, first_name, last_name, exam_engine) VALUES ($1, 'T', 'T', 'other')`, [EMAIL]))
      .rejects.toThrow(/check constraint/);
  });

  it('defaults a topic level to 2 and a sitting to in_progress', async () => {
    const l = await pool.query(
      `INSERT INTO student_topic_levels (user_email, paper_code, topic_key) VALUES ($1, 'ZZ9', 'd') RETURNING level`, [EMAIL]);
    expect(l.rows[0].level).toBe(2);
    const s = await pool.query(
      `INSERT INTO leveled_exam_sittings (user_email, paper_code, length, round_up_first, question_ids)
       VALUES ($1, 'ZZ9', 100, false, '{1,2}') RETURNING status, lead_magnet`, [EMAIL]);
    expect(s.rows[0]).toEqual({ status: 'in_progress', lead_magnet: false });
  });
});
