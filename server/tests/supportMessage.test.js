// Backlog #31: the in-platform "Contact support" form.
jest.mock('fsa-common', () => ({
  telegram: { notifyOwner: jest.fn().mockResolvedValue(undefined) },
  email: { sendEmail: jest.fn().mockResolvedValue({ messageId: 'm1' }) },
}));

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { telegram, email } = require('fsa-common');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const authRouter = require('../src/routes/auth');
const supportRouter = require('../src/routes/supportMessage');

const FIXTURE_EMAIL_LIKE = 'supmsg-%@example.com';
const PASSWORD = 'longenoughpassword';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use('/api/platform', supportRouter);
  return app;
}

async function login(app, tag) {
  const addr = `supmsg-${tag}@example.com`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash, created_at)
     VALUES ($1, 'Sam', 'Student', $2, now() - interval '1 day')`, [addr, hash]);
  const res = await request(app).post('/api/auth/login').send({ email: addr, password: PASSWORD });
  return (res.headers['set-cookie'] || []).find(c => c.startsWith('fsa_session=')).split(';')[0];
}

afterAll(async () => { await pool.end(); });

describe('POST /api/platform/support-message', () => {
  beforeEach(() => { email.sendEmail.mockClear(); telegram.notifyOwner.mockClear(); });
  afterEach(async () => { await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE); });

  it('rejects an anonymous caller', async () => {
    const res = await request(buildApp()).post('/api/platform/support-message').send({ message: 'hi' });
    expect(res.status).toBe(401);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('emails support@ with Reply-To the student and the page context, then pings Russ', async () => {
    const app = buildApp();
    const cookie = await login(app, 'ok');
    const res = await request(app).post('/api/platform/support-message').set('Cookie', cookie)
      .send({ category: 'content', message: 'Slide 4 says 3.2 mm\nshould be 3.5', page: '/lesson/2A1-1-3', lesson_code: '2A1-1-3' });
    expect(res.status).toBe(201);
    const sent = email.sendEmail.mock.calls[0][0];
    expect(sent.to).toBe('support@fullsteamahead.ca');
    expect(sent.from).toMatch(/support@fullsteamahead\.ca/);
    expect(sent.replyTo).toBe('Sam Student <supmsg-ok@example.com>');
    expect(sent.subject).toBe('[In-app] Error in the course material: Slide 4 says 3.2 mm');
    expect(sent.text).toMatch(/Lesson: 2A1-1-3/);
    expect(sent.text).toMatch(/Page: \/lesson\/2A1-1-3/);
    expect(telegram.notifyOwner).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty message and treats an unknown category as Other', async () => {
    const app = buildApp();
    const cookie = await login(app, 'cat');
    const empty = await request(app).post('/api/platform/support-message').set('Cookie', cookie).send({ message: '   ' });
    expect(empty.status).toBe(400);
    const res = await request(app).post('/api/platform/support-message').set('Cookie', cookie)
      .send({ category: '<script>', message: 'hello' });
    expect(res.status).toBe(201);
    expect(email.sendEmail.mock.calls[0][0].subject).toBe('[In-app] Other: hello');
  });

  it('tells the student when the send fails', async () => {
    const app = buildApp();
    const cookie = await login(app, 'fail');
    email.sendEmail.mockRejectedValueOnce(new Error('gmail down'));
    const res = await request(app).post('/api/platform/support-message').set('Cookie', cookie).send({ message: 'hello' });
    expect(res.status).toBe(502);
    expect(telegram.notifyOwner).not.toHaveBeenCalled();
  });
});
