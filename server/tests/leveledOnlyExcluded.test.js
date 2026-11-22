/**
 * Leveled-only questions (migration 039, leveled exams Plan 2, owner decision
 * 2026-11-21) are for the leveled practice exam only. The tutor checkpoint pool
 * and the free diagnostic quiz must never serve them.
 */
const express = require('express');
const request = require('supertest');
const { pool } = require('./testPool');
const db = require('../src/services/database');
const diagnosticRouter = require('../src/routes/diagnostic');

const LESSON = '2B1-1-1-fxlvl';
const IDS = { normal: 990101, leveled: 990102, normalQuiz: 990103, leveledQuiz: 990104 };

async function insertQuestion(id, { leveled, type = 'objective_practice', difficulty = 3 }) {
  await pool.query(
    `INSERT INTO questions
       (id, course_id, chapter_id, lesson_code, question_text, options, correct_answer,
        question_type, difficulty, standalone, leveled_only)
     VALUES ($1, '2B1', '2B1-1', $2, $3, $4::jsonb, 0, $5, $6, true, $7)`,
    [id, LESSON, `fixture question ${id}`, JSON.stringify(['a', 'b', 'c', 'd']), type, difficulty, leveled]
  );
}

beforeAll(async () => {
  await pool.query('DELETE FROM questions WHERE id = ANY($1::int[])', [Object.values(IDS)]);
  await insertQuestion(IDS.normal, { leveled: false });
  await insertQuestion(IDS.leveled, { leveled: true });
  await insertQuestion(IDS.normalQuiz, { leveled: false, type: 'chapter_quiz', difficulty: 1 });
  await insertQuestion(IDS.leveledQuiz, { leveled: true, type: 'chapter_quiz', difficulty: 1 });
});

afterAll(async () => {
  await pool.query('DELETE FROM questions WHERE id = ANY($1::int[])', [Object.values(IDS)]);
  await pool.end();
});

describe('leveled-only questions stay out of the existing pools', () => {
  it('checkpoint pool skips them', async () => {
    const pooled = await db.getCheckpointQuestionPool(LESSON, null);
    expect(pooled.map(q => q.id)).toEqual([IDS.normal]);
  });

  it('diagnostic quiz skips them (primary and fallback draws)', async () => {
    const app = express();
    app.use('/api/diagnostic', diagnosticRouter);
    const ids = new Set();
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/api/diagnostic/questions?count=60&class=second');
      expect(res.status).toBe(200);
      for (const q of res.body.questions || res.body) ids.add(q.id);
    }
    expect(ids.has(IDS.normal)).toBe(true);
    expect(ids.has(IDS.normalQuiz)).toBe(true);
    expect(ids.has(IDS.leveled)).toBe(false);
    expect(ids.has(IDS.leveledQuiz)).toBe(false);
  });
});
