process.env.PRACTICE_EXAM_TOKEN_SECRET ||= 'test-secret';

const request = require('supertest');
const express = require('express');
const { pool } = require('./testPool');
const practiceExamRouter = require('../src/routes/practiceExam');

jest.mock('../src/services/email');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/practice-exam', practiceExamRouter);
  return app;
}

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'pxroute-%@example.com';

async function insertAttempt({ email, classCode, paperCode, completedAt = null }) {
  await pool.query(
    `INSERT INTO practice_exam_attempts
       (email, first_name, class_code, paper_code, verification_code, code_expires_at, completed_at)
     VALUES ($1, 'Test', $2, $3, '000000', NOW() + interval '10 minutes', $4)`,
    [email, classCode, paperCode, completedAt]
  );
}

describe('POST /api/practice-exam/request-code — 4th class + cross-class exclusivity', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM practice_exam_attempts WHERE email LIKE $1`, [FIXTURE_EMAIL_LIKE]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('accepts fourth_a/4A and creates an attempt row', async () => {
    const res = await request(buildTestApp())
      .post('/api/practice-exam/request-code')
      .send({ firstName: 'Jordan', email: 'pxroute-fourth-a@example.com', classCode: 'fourth_a', paperCode: '4A' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const row = await pool.query(
      `SELECT class_code, paper_code FROM practice_exam_attempts WHERE email = $1`,
      ['pxroute-fourth-a@example.com']
    );
    expect(row.rows[0]).toEqual({ class_code: 'fourth_a', paper_code: '4A' });
  });

  it('accepts fourth_b/4B and creates an attempt row', async () => {
    const res = await request(buildTestApp())
      .post('/api/practice-exam/request-code')
      .send({ firstName: 'Jordan', email: 'pxroute-fourth-b@example.com', classCode: 'fourth_b', paperCode: '4B' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('rejects a paperCode that does not belong to the given 4th-class classCode', async () => {
    const res = await request(buildTestApp())
      .post('/api/practice-exam/request-code')
      .send({ firstName: 'Jordan', email: 'pxroute-mismatch@example.com', classCode: 'fourth_a', paperCode: '4B' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid paperCode');
  });

  it('blocks a different paper/class if the email has ANY prior attempt, even uncompleted', async () => {
    await insertAttempt({ email: 'pxroute-switcher@example.com', classCode: 'second', paperCode: '2A1' });

    const res = await request(buildTestApp())
      .post('/api/practice-exam/request-code')
      .send({ firstName: 'Jordan', email: 'pxroute-switcher@example.com', classCode: 'fourth_a', paperCode: '4A' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, already_used: true, paper_code: '2A1' });
  });

  it('still allows requesting/resending a code for the SAME paper already started', async () => {
    await insertAttempt({ email: 'pxroute-resend@example.com', classCode: 'fourth_a', paperCode: '4A' });

    const res = await request(buildTestApp())
      .post('/api/practice-exam/request-code')
      .send({ firstName: 'Jordan', email: 'pxroute-resend@example.com', classCode: 'fourth_a', paperCode: '4A' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('still blocks a resend for a paper the SAME email already completed', async () => {
    await insertAttempt({ email: 'pxroute-completed@example.com', classCode: 'fourth_a', paperCode: '4A', completedAt: new Date() });

    const res = await request(buildTestApp())
      .post('/api/practice-exam/request-code')
      .send({ firstName: 'Jordan', email: 'pxroute-completed@example.com', classCode: 'fourth_a', paperCode: '4A' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, already_used: true, paper_code: '4A' });
  });

  it('a fresh email with no prior rows can pick any of second/third/fourth_a/fourth_b', async () => {
    const res = await request(buildTestApp())
      .post('/api/practice-exam/request-code')
      .send({ firstName: 'Jordan', email: 'pxroute-fresh@example.com', classCode: 'third', paperCode: '3A1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});
