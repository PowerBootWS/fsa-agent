const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const authRouter = require('../src/routes/auth');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  return app;
}

describe('POST /api/auth/signup', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM login_events`);
    await pool.query(`DELETE FROM platform_users`);
  });

  it('creates a job-only account with no subscription and sets a session cookie', async () => {
    const app = buildTestApp();
    const res = await request(app).post('/api/auth/signup').send({
      email: 'newjobseeker@example.com',
      password: 'longenoughpassword',
      first_name: 'Jamie',
      last_name: 'Lee',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.class_code).toBeNull();
    expect(res.body.user.active_paper).toBeNull();
    expect(res.headers['set-cookie'][0]).toMatch(/fsa_session=/);
  });

  it('rejects a duplicate email with 409', async () => {
    const app = buildTestApp();
    await request(app).post('/api/auth/signup').send({
      email: 'dupe@example.com', password: 'longenoughpassword', first_name: 'A', last_name: 'B',
    });
    const res = await request(app).post('/api/auth/signup').send({
      email: 'dupe@example.com', password: 'anotherlongpassword', first_name: 'C', last_name: 'D',
    });
    expect(res.status).toBe(409);
  });

  it('rejects a password under 8 characters', async () => {
    const app = buildTestApp();
    const res = await request(app).post('/api/auth/signup').send({
      email: 'short@example.com', password: 'short', first_name: 'A', last_name: 'B',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login — job-only account', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM login_events`);
    await pool.query(`DELETE FROM platform_users`);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('logs in a job-only account (no subscription row) with correct credentials', async () => {
    const app = buildTestApp();
    await request(app).post('/api/auth/signup').send({
      email: 'loginjobonly@example.com', password: 'longenoughpassword', first_name: 'A', last_name: 'B',
    });
    const res = await request(app).post('/api/auth/login').send({
      email: 'loginjobonly@example.com', password: 'longenoughpassword',
    });
    expect(res.status).toBe(200);
  });
});
