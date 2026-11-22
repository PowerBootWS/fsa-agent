jest.mock('../src/services/email');
jest.mock('../src/services/nurture', () => ({ enroll: jest.fn() }));

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const authRouter = require('../src/routes/auth');
const platformRouter = require('../src/routes/platform');

const LIKE = 'exam-engine-%@example.com';
const PASSWORD = 'longenoughpassword';

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/api/auth', authRouter);
  a.use('/api/platform', platformRouter);
  return a;
}

async function userWithPaper(addr, paper) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const { rows: [u] } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash) VALUES ($1, 'T', 'T', $2) RETURNING id`,
    [addr, hash]);
  await pool.query(`INSERT INTO subscriptions (user_id, class_code, status, active_paper) VALUES ($1, 'second', 'active', $2)`,
    [u.id, paper]);
  const res = await request(app()).post('/api/auth/login').send({ email: addr, password: PASSWORD });
  return res.headers['set-cookie'].find(c => c.startsWith('fsa_session=')).split(';')[0];
}

const OLD = process.env.LEVELED_PAPERS;
beforeEach(() => { process.env.LEVELED_PAPERS = '2B1'; });
afterEach(async () => { await deleteFixtureUsersByEmailLike(pool, LIKE); });
afterAll(async () => { process.env.LEVELED_PAPERS = OLD; await pool.end(); });

describe('exam engine', () => {
  it('/me reports leveled for an enabled paper by default', async () => {
    const c = await userWithPaper('exam-engine-a@example.com', '2B1');
    const res = await request(app()).get('/api/platform/me').set('Cookie', c).expect(200);
    expect(res.body.exam_engine).toBeNull();
    expect(res.body.exam_engine_effective).toBe('leveled');
    expect(res.body.leveled_available).toBe(true);
  });

  it('/me reports adaptive for a paper not enabled', async () => {
    const c = await userWithPaper('exam-engine-b@example.com', '2A1');
    const res = await request(app()).get('/api/platform/me').set('Cookie', c).expect(200);
    expect(res.body.exam_engine_effective).toBe('adaptive');
    expect(res.body.leveled_available).toBe(false);
  });

  it('PUT /exam-engine stores the fallback and /me reflects it', async () => {
    const c = await userWithPaper('exam-engine-c@example.com', '2B1');
    const put = await request(app()).put('/api/platform/exam-engine').set('Cookie', c).send({ engine: 'adaptive' });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ exam_engine: 'adaptive' });
    const res = await request(app()).get('/api/platform/me').set('Cookie', c).expect(200);
    expect(res.body.exam_engine).toBe('adaptive');
    expect(res.body.exam_engine_effective).toBe('adaptive');
  });

  it('rejects anything but leveled or adaptive', async () => {
    const c = await userWithPaper('exam-engine-d@example.com', '2B1');
    await request(app()).put('/api/platform/exam-engine').set('Cookie', c).send({ engine: 'other' }).expect(400);
  });

  it('needs a session', async () => {
    await request(app()).put('/api/platform/exam-engine').send({ engine: 'adaptive' }).expect(401);
  });
});
