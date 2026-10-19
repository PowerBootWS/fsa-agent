const { pool } = require('./testPool');
const { getCourseOutline } = require('../src/services/database');

// Objective codes are '{COURSE}-{CH}-{OBJ}' with no zero-padding, so a text
// ORDER BY listed 2B1 chapter 1 as 1, 10, 11, 12, 2, 3 ... (2026-10-19).
// 'ZZORD' is not a paper, so these codes can never collide with real content.
const COURSE = 'ZZORD';
const CODES = ['1-1', '1-2', '1-10', '1-11', '1-3', '2-1', '10-1', '10-2'].map(c => `${COURSE}-${c}`);

describe('getCourseOutline ordering', () => {
  beforeAll(async () => {
    const existing = await pool.query(
      `SELECT lesson_code FROM lessons WHERE lesson_code LIKE $1`, [`${COURSE}-%`]
    );
    if (existing.rows.length > 0) {
      throw new Error(`Refusing to run: lessons already has ${COURSE} rows — not a disposable test database.`);
    }
    for (const code of CODES) {
      await pool.query(`INSERT INTO lessons (title, lesson_code) VALUES ($1, $2)`, [code, code]);
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM lessons WHERE lesson_code = ANY($1)`, [CODES]);
    await pool.end();
  });

  it('orders chapters and objectives numerically, not as text', async () => {
    const outline = await getCourseOutline(COURSE);
    expect(outline.chapters.map(c => c.chapter_num)).toEqual([1, 2, 10]);
    expect(outline.chapters[0].objectives.map(o => o.objective_num)).toEqual([1, 2, 3, 10, 11]);
    expect(outline.chapters[2].objectives.map(o => o.objective_num)).toEqual([1, 2]);
  });
});
