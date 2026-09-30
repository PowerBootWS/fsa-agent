jest.mock('../src/services/email');
jest.mock('../src/services/affiliateClient');
jest.mock('../src/services/newJobsCount');

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const email = require('../src/services/email');
const affiliateClient = require('../src/services/affiliateClient');
const { getNewJobsCount } = require('../src/services/newJobsCount');
const authRouter = require('../src/routes/auth');
const homeRouter = require('../src/routes/home');

const FIXTURE_EMAIL_LIKE = 'homepage-%@example.com';
const PASSWORD = 'longenoughpassword';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use('/api/platform', homeRouter);
  return app;
}

async function createUser(addr, { firstName = 'Taylor', subs = [] } = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const { rows: [u] } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash)
     VALUES ($1, $2, 'Tester', $3) RETURNING id`, [addr, firstName, hash]);
  for (const s of subs) {
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper, cancel_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [u.id, s.class_code, s.status || 'active', s.active_paper || null, s.cancel_at || null]);
  }
  return u.id;
}

async function login(app, addr) {
  const res = await request(app).post('/api/auth/login').send({ email: addr, password: PASSWORD });
  const cookie = (res.headers['set-cookie'] || []).find(c => c.startsWith('fsa_session='));
  return cookie.split(';')[0];
}

// Top level, not inside a describe: a describe-scoped afterAll would end the
// pool before the second describe's tests run.
afterAll(async () => { await pool.end(); });

describe('GET /api/platform/home', () => {
  beforeEach(() => {
    affiliateClient.getSummary.mockResolvedValue({ is_affiliate: false });
    getNewJobsCount.mockResolvedValue(14);
  });
  afterEach(async () => {
    jest.resetAllMocks();
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  it('job-only account: course none, all other sections present', async () => {
    const app = buildTestApp();
    await createUser('homepage-jobonly@example.com');
    const cookie = await login(app, 'homepage-jobonly@example.com');
    const res = await request(app).get('/api/platform/home').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      first_name: 'Taylor',
      course: { state: 'none', subscriptions: [] },
      jobs: { saved_count: 0, custom_resumes_count: 0 },
      credits: { balance: 0 },
      resume_on_file: false,
      new_jobs_7d: 14,
      affiliate: { is_affiliate: false },
    });
  });

  it('active 2nd Class student on 2A3', async () => {
    const app = buildTestApp();
    await createUser('homepage-second@example.com', { subs: [{ class_code: 'second', active_paper: '2A3' }] });
    const cookie = await login(app, 'homepage-second@example.com');
    const res = await request(app).get('/api/platform/home').set('Cookie', cookie);
    expect(res.body.course.state).toBe('active');
    expect(res.body.course.subscriptions).toEqual([
      { class_code: 'second', paper: '2A3', pct_complete: expect.any(Number), last_exam_score: null, weakest_chapter: null },
    ]);
  });

  it('2nd Class student with no paper picked yet gets paper null, not an error', async () => {
    const app = buildTestApp();
    await createUser('homepage-nopaper@example.com', { subs: [{ class_code: 'third' }] });
    const cookie = await login(app, 'homepage-nopaper@example.com');
    const res = await request(app).get('/api/platform/home').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.course.subscriptions).toEqual([
      { class_code: 'third', paper: null, pct_complete: null, last_exam_score: null, weakest_chapter: null },
    ]);
  });

  it('4th Class A and B are both listed, with no lesson percentage', async () => {
    const app = buildTestApp();
    await createUser('homepage-fourth@example.com', {
      subs: [{ class_code: 'fourth_a' }, { class_code: 'fourth_b' }] });
    const cookie = await login(app, 'homepage-fourth@example.com');
    const res = await request(app).get('/api/platform/home').set('Cookie', cookie);
    expect(res.body.course.subscriptions.map(s => [s.paper, s.pct_complete])).toEqual([['4A', null], ['4B', null]]);
  });

  it('active status with cancel_at in the past counts as lapsed', async () => {
    const app = buildTestApp();
    await createUser('homepage-lapsed@example.com', {
      subs: [{ class_code: 'second', active_paper: '2B3', cancel_at: '2026-01-01T00:00:00Z' }] });
    const cookie = await login(app, 'homepage-lapsed@example.com');
    const res = await request(app).get('/api/platform/home').set('Cookie', cookie);
    expect(res.body.course).toEqual({ state: 'lapsed', subscriptions: [] });
  });

  it('affiliate and new-jobs failures come back as null, page still 200', async () => {
    affiliateClient.getSummary.mockResolvedValue(null);
    getNewJobsCount.mockResolvedValue(null);
    const app = buildTestApp();
    await createUser('homepage-degraded@example.com');
    const cookie = await login(app, 'homepage-degraded@example.com');
    const res = await request(app).get('/api/platform/home').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.affiliate).toBeNull();
    expect(res.body.new_jobs_7d).toBeNull();
  });

  it('401 without a session', async () => {
    const res = await request(buildTestApp()).get('/api/platform/home');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/platform/affiliate/join', () => {
  const stats = { is_affiliate: true, code: 'TAYLOR1234', referral_url: 'https://fullsteamahead.ca/?am_id=TAYLOR1234',
    referred_count: 0, enrolled_count: 0, earned_cents: 0 };
  afterEach(async () => {
    jest.resetAllMocks();
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  it('creates the affiliate, emails once, and returns the stats', async () => {
    affiliateClient.join.mockResolvedValue({ affiliate: { code: 'TAYLOR1234', status: 'active' }, created: true });
    affiliateClient.getSummary.mockResolvedValue(stats);
    const app = buildTestApp();
    await createUser('homepage-join@example.com');
    const cookie = await login(app, 'homepage-join@example.com');
    const res = await request(app).post('/api/platform/affiliate/join').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ affiliate: stats });
    expect(affiliateClient.join).toHaveBeenCalledWith({ name: 'Taylor Tester', email: 'homepage-join@example.com' });
    expect(email.sendAffiliateWelcome).toHaveBeenCalledWith('homepage-join@example.com', 'Taylor', 'TAYLOR1234');
  });

  it('an existing affiliate gets no second welcome email', async () => {
    affiliateClient.join.mockResolvedValue({ affiliate: { code: 'TAYLOR1234', status: 'active' }, created: false });
    affiliateClient.getSummary.mockResolvedValue(stats);
    const app = buildTestApp();
    await createUser('homepage-again@example.com');
    const cookie = await login(app, 'homepage-again@example.com');
    const res = await request(app).post('/api/platform/affiliate/join').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(email.sendAffiliateWelcome).not.toHaveBeenCalled();
  });

  it('a paused affiliate gets a 409 with a clear message', async () => {
    affiliateClient.join.mockResolvedValue({ affiliate: { code: 'OLD1234', status: 'inactive' }, created: false });
    const app = buildTestApp();
    await createUser('homepage-paused@example.com');
    const cookie = await login(app, 'homepage-paused@example.com');
    const res = await request(app).post('/api/platform/affiliate/join').set('Cookie', cookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/paused/i);
  });

  it('service failure returns 502 with a retry message', async () => {
    affiliateClient.join.mockRejectedValue(new Error('down'));
    const app = buildTestApp();
    await createUser('homepage-down@example.com');
    const cookie = await login(app, 'homepage-down@example.com');
    const res = await request(app).post('/api/platform/affiliate/join').set('Cookie', cookie);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Couldn't join right now, try again in a minute.");
  });

  it('2xx without an affiliate object returns 502, not an unhandled rejection', async () => {
    affiliateClient.join.mockResolvedValue({ created: true });
    const app = buildTestApp();
    await createUser('homepage-noaff@example.com');
    const cookie = await login(app, 'homepage-noaff@example.com');
    const res = await request(app).post('/api/platform/affiliate/join').set('Cookie', cookie);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Couldn't join right now, try again in a minute.");
  });

  it('falls back to the create result when the summary call fails after joining', async () => {
    affiliateClient.join.mockResolvedValue({ affiliate: { code: 'TAYLOR1234', status: 'active' }, created: true });
    affiliateClient.getSummary.mockResolvedValue(null);
    const app = buildTestApp();
    await createUser('homepage-fallback@example.com');
    const cookie = await login(app, 'homepage-fallback@example.com');
    const res = await request(app).post('/api/platform/affiliate/join').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.affiliate).toEqual(stats);
  });
});
