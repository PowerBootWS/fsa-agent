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
const announcementsRouter = require('../src/routes/announcements');

const FIXTURE_EMAIL_LIKE = 'annroute-%@example.com';
const PASSWORD = 'longenoughpassword';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use('/api/platform', announcementsRouter);
  return app;
}

async function login(app, tag) {
  const email = `annroute-${tag}@example.com`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash, created_at)
     VALUES ($1, 'Taylor', 'Tester', $2, now() - interval '1 day')`, [email, hash]);
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return (res.headers['set-cookie'] || []).find(c => c.startsWith('fsa_session=')).split(';')[0];
}

async function announce(slug, extra = {}) {
  const { rows: [a] } = await pool.query(
    `INSERT INTO announcements (slug, title, body, cta_label, cta_url, audiences, starts_at, ends_at)
     VALUES ($1, 'New Home', 'Body', $2, $3, '{everyone}', now(), now() + interval '30 days') RETURNING id`,
    [slug, extra.cta_label || null, extra.cta_url || null]);
  return a.id;
}

afterAll(async () => { await pool.end(); });

describe('announcement routes', () => {
  beforeEach(async () => {
    affiliateClient.getSummary.mockResolvedValue({ is_affiliate: false });
    telegram.notifyOwner.mockClear();
  });
  afterEach(async () => {
    await pool.query(`DELETE FROM announcements WHERE slug LIKE 'test-%'`);
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  it('GET next returns the announcement, then null once dismissed', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'next');
    const id = await announce('test-next', { cta_label: 'Check it out', cta_url: '/home' });
    const first = await request(app).get('/api/platform/announcements/next').set('Cookie', cookie);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ announcement: { id, title: 'New Home', body: 'Body', cta_label: 'Check it out', cta_url: '/home' } });

    const seen = await request(app).post(`/api/platform/announcements/${id}/seen`).set('Cookie', cookie).send({ action: 'dismissed' });
    expect(seen.status).toBe(204);
    const after = await request(app).get('/api/platform/announcements/next').set('Cookie', cookie);
    expect(after.body).toEqual({ announcement: null });
  });

  it('seen is idempotent and keeps the first action', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'idem');
    const id = await announce('test-idem');
    await request(app).post(`/api/platform/announcements/${id}/seen`).set('Cookie', cookie).send({ action: 'cta' });
    const again = await request(app).post(`/api/platform/announcements/${id}/seen`).set('Cookie', cookie).send({ action: 'dismissed' });
    expect(again.status).toBe(204);
    const { rows } = await pool.query(`SELECT action FROM announcement_views WHERE announcement_id = $1`, [id]);
    expect(rows).toEqual([{ action: 'cta' }]);
  });

  it('seen rejects a bad action and an unknown id', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'bad');
    const id = await announce('test-bad');
    expect((await request(app).post(`/api/platform/announcements/${id}/seen`).set('Cookie', cookie).send({ action: 'feedback' })).status).toBe(400);
    expect((await request(app).post(`/api/platform/announcements/999999/seen`).set('Cookie', cookie).send({ action: 'dismissed' })).status).toBe(404);
    expect((await request(app).post(`/api/platform/announcements/abc/seen`).set('Cookie', cookie).send({ action: 'dismissed' })).status).toBe(404);
    expect((await request(app).post(`/api/platform/announcements/12345678901234567890/seen`).set('Cookie', cookie).send({ action: 'dismissed' })).status).toBe(404);
  });

  it('feedback saves, marks seen, and notifies Russ', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'fb');
    const id = await announce('test-fb');
    const res = await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie)
      .send({ message: '  Love it. Add a dark mode?  ' });
    expect(res.status).toBe(201);
    const { rows: fb } = await pool.query(`SELECT message FROM announcement_feedback WHERE announcement_id = $1`, [id]);
    expect(fb).toEqual([{ message: 'Love it. Add a dark mode?' }]);
    const { rows: views } = await pool.query(`SELECT action FROM announcement_views WHERE announcement_id = $1`, [id]);
    expect(views).toEqual([{ action: 'feedback' }]);
    await new Promise(r => setImmediate(r));
    expect(telegram.notifyOwner).toHaveBeenCalledTimes(1);
    const text = telegram.notifyOwner.mock.calls[0][0];
    expect(text).toContain('New Home');
    expect(text).toContain('annroute-fb@example.com');
    expect(text).toContain('Love it. Add a dark mode?');
  });

  it('feedback after dismiss keeps the dismiss and still saves; a double send makes no duplicate view', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'after');
    const id = await announce('test-after');
    await request(app).post(`/api/platform/announcements/${id}/seen`).set('Cookie', cookie).send({ action: 'dismissed' });
    const a = await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie).send({ message: 'one' });
    const b = await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie).send({ message: 'two' });
    expect([a.status, b.status]).toEqual([201, 201]);
    const { rows } = await pool.query(`SELECT action FROM announcement_views WHERE announcement_id = $1`, [id]);
    expect(rows).toEqual([{ action: 'dismissed' }]);
    const { rows: fb } = await pool.query(`SELECT count(*)::int AS n FROM announcement_feedback WHERE announcement_id = $1`, [id]);
    expect(fb[0].n).toBe(2);
  });

  it('feedback validation: empty and over-long messages are 400', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'val');
    const id = await announce('test-val');
    expect((await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie).send({ message: '   ' })).status).toBe(400);
    expect((await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie).send({ message: 'x'.repeat(2001) })).status).toBe(400);
    expect((await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie).send({})).status).toBe(400);
  });

  it('feedback is rate limited to 5 per hour per user', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'rate');
    const id = await announce('test-rate');
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie).send({ message: `m${i}` })).status);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('a Telegram failure never fails the request', async () => {
    telegram.notifyOwner.mockRejectedValueOnce(new Error('telegram down'));
    const app = buildTestApp();
    const cookie = await login(app, 'tg');
    const id = await announce('test-tg');
    const res = await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie).send({ message: 'hi' });
    expect(res.status).toBe(201);
  });

  it('GET next answers null (not 500) when the lookup blows up', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'boom');
    await pool.query(
      `INSERT INTO announcements (slug, title, body, audiences, starts_at, ends_at)
       VALUES ('test-boom', 't', 'b', '{affiliates}', now(), now() + interval '1 day')`);
    affiliateClient.getSummary.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/platform/announcements/next').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ announcement: null });
  });

  it('requires a session', async () => {
    expect((await request(buildTestApp()).get('/api/platform/announcements/next')).status).toBe(401);
  });
});
