// Backlog #127: NPS survey eligibility, answers, detractor ping, promoter follow-up.
jest.mock('fsa-common', () => ({
  telegram: { notifyOwner: jest.fn().mockResolvedValue(undefined) },
  email: { sendEmail: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/services/affiliateClient');

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { telegram } = require('fsa-common');
const affiliateClient = require('../src/services/affiliateClient');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const authRouter = require('../src/routes/auth');
const npsRouter = require('../src/routes/nps');

const FIXTURE_EMAIL_LIKE = 'nps-%@example.com';
const PASSWORD = 'longenoughpassword';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use('/api/platform', npsRouter);
  return app;
}

// A student with an active subscription activated `days` ago and `events`
// usage events spread over 4 sessions.
async function student(app, tag, { days = 30, events = 12, classCode = 'fourth_a' } = {}) {
  const addr = `nps-${tag}@example.com`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  const { rows: [u] } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash, created_at)
     VALUES ($1, 'Pat', 'Promoter', $2, now() - interval '60 days') RETURNING id`, [addr, hash]);
  await pool.query(
    `INSERT INTO subscriptions (user_id, class_code, status, activated_at)
     VALUES ($1, $2, 'active', now() - make_interval(days => $3))`, [u.id, classCode, days]);
  for (let i = 0; i < events; i++) {
    await pool.query(
      `INSERT INTO usage_events (user_id, event_type, screen, client_session_id, occurred_at)
       VALUES ($1, 'screen_view', '/home', $2, now() - interval '1 day')`, [u.id, `s${i % 4}`]);
  }
  const res = await request(app).post('/api/auth/login').send({ email: addr, password: PASSWORD });
  const cookie = (res.headers['set-cookie'] || []).find(c => c.startsWith('fsa_session=')).split(';')[0];
  return { id: u.id, cookie };
}

afterAll(async () => { await pool.end(); });

describe('NPS', () => {
  let app;
  beforeEach(() => {
    app = buildApp();
    telegram.notifyOwner.mockClear();
    affiliateClient.getSummary.mockResolvedValue({ is_affiliate: true, code: 'PAT1234', referral_url: 'https://fullsteamahead.ca/?am_id=PAT1234' });
  });
  afterEach(async () => {
    await pool.query(`DELETE FROM usage_events WHERE user_id IN (SELECT id FROM platform_users WHERE email LIKE $1)`, [FIXTURE_EMAIL_LIKE]);
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  const next = (s) => request(app).get('/api/platform/nps/next').set('Cookie', s.cookie);

  it('asks an active, 21-day-old, active-on-platform student, 4th Class included', async () => {
    const s = await student(app, 'ok');
    expect((await next(s)).body).toEqual({ ask: true });
  });

  it('does not ask before 21 days or without activity', async () => {
    expect((await next(await student(app, 'new', { days: 10 }))).body.ask).toBe(false);
    expect((await next(await student(app, 'idle', { events: 2 }))).body.ask).toBe(false);
  });

  it('a detractor answer is stored, pings Russ, and stops re-asking for 90 days', async () => {
    const s = await student(app, 'det');
    const res = await request(app).post('/api/platform/nps').set('Cookie', s.cookie).send({ score: 4, reason: 'Too slow' });
    expect(res.status).toBe(201);
    expect(res.body.promoter).toBe(false);
    expect(telegram.notifyOwner).toHaveBeenCalledWith(expect.stringMatching(/NPS 4\/10[\s\S]*Too slow/));
    expect((await next(s)).body.ask).toBe(false);
    await pool.query(`UPDATE nps_responses SET created_at = now() - interval '91 days' WHERE user_id = $1`, [s.id]);
    expect((await next(s)).body.ask).toBe(true);
  });

  it('a promoter gets their affiliate link back and can record whether they had it', async () => {
    const s = await student(app, 'pro');
    const res = await request(app).post('/api/platform/nps').set('Cookie', s.cookie).send({ score: 10 });
    expect(res.body).toMatchObject({ promoter: true, affiliate: { code: 'PAT1234' } });
    expect(telegram.notifyOwner).not.toHaveBeenCalled();
    const upd = await request(app).post(`/api/platform/nps/${res.body.id}/affiliate-link`).set('Cookie', s.cookie).send({ had_link: false });
    expect(upd.status).toBe(204);
    const { rows } = await pool.query(`SELECT had_affiliate_link FROM nps_responses WHERE id = $1`, [res.body.id]);
    expect(rows[0].had_affiliate_link).toBe(false);
  });

  it('dismissing backs off for 14 days', async () => {
    const s = await student(app, 'dis');
    await request(app).post('/api/platform/nps/dismiss').set('Cookie', s.cookie).expect(204);
    expect((await next(s)).body.ask).toBe(false);
    await pool.query(`UPDATE nps_responses SET created_at = now() - interval '15 days' WHERE user_id = $1`, [s.id]);
    expect((await next(s)).body.ask).toBe(true);
  });

  it('rejects an out-of-range score', async () => {
    const s = await student(app, 'bad');
    await request(app).post('/api/platform/nps').set('Cookie', s.cookie).send({ score: 11 }).expect(400);
  });
});
