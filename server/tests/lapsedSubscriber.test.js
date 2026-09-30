// A cancelled or lapsed subscriber keeps their account: they can still log in,
// reach Jobs/Profile, and open the Stripe portal for invoices (employer
// reimbursement) — they just lose the course itself.
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');

const mockRetrieve = jest.fn();
const mockPortalCreate = jest.fn();
jest.mock('stripe', () => () => ({
  subscriptions: { retrieve: mockRetrieve },
  billingPortal: { sessions: { create: mockPortalCreate } },
}));

const authRouter = require('../src/routes/auth');
const platformRouter = require('../src/routes/platform');
const requireAuth = require('../src/middleware/requireAuth');
const requireActiveSubscription = require('../src/middleware/requireActiveSubscription');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'lapsedsub-%@example.com';
const PASSWORD = 'longenoughpassword';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use('/api/platform', platformRouter);
  app.get('/api/paid-content', requireAuth, requireActiveSubscription, (req, res) => res.json({ ok: true }));
  return app;
}

async function createUser(email, { status, stripeSubId = null, stripeCustomerId = null } = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const { rows } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash, stripe_customer_id)
     VALUES ($1, 'Test', 'User', $2, $3) RETURNING id`,
    [email, hash, stripeCustomerId]
  );
  if (status) {
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper, stripe_subscription_id)
       VALUES ($1, 'second', $2, '2B3', $3)`,
      [rows[0].id, status, stripeSubId]
    );
  }
  return rows[0].id;
}

async function login(app, email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = (res.headers['set-cookie'] || []).find(c => c.startsWith('fsa_session='));
  return { res, cookie: cookie && cookie.split(';')[0] };
}

describe('cancelled subscriber keeps their account', () => {
  beforeEach(() => {
    mockRetrieve.mockReset();
    mockPortalCreate.mockReset();
  });
  afterEach(async () => {
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('logs in with no course attached', async () => {
    const app = buildTestApp();
    await createUser('lapsedsub-login@example.com', { status: 'inactive', stripeSubId: 'sub_lapsed' });
    const { res } = await login(app, 'lapsedsub-login@example.com');
    expect(res.status).toBe(200);
    expect(res.body.user.class_code).toBeNull();
    expect(res.body.user.active_paper).toBeNull();
  });

  it('still rejects a wrong password', async () => {
    const app = buildTestApp();
    await createUser('lapsedsub-badpw@example.com', { status: 'inactive' });
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'lapsedsub-badpw@example.com', password: 'wrongpassword1' });
    expect(res.status).toBe(401);
  });

  it('is still refused paid course content', async () => {
    const app = buildTestApp();
    await createUser('lapsedsub-content@example.com', { status: 'inactive', stripeSubId: 'sub_lapsed' });
    const { cookie } = await login(app, 'lapsedsub-content@example.com');
    const res = await request(app).get('/api/paid-content').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('reports billing history on /me', async () => {
    const app = buildTestApp();
    await createUser('lapsedsub-me@example.com', { status: 'inactive', stripeSubId: 'sub_lapsed' });
    const { cookie } = await login(app, 'lapsedsub-me@example.com');
    const res = await request(app).get('/api/platform/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.class_code).toBeNull();
    expect(res.body.has_billing_history).toBe(true);
    expect(res.body.had_subscription).toBe(true);
  });

  it('opens the Stripe portal from the lapsed subscription', async () => {
    const app = buildTestApp();
    await createUser('lapsedsub-portal@example.com', { status: 'inactive', stripeSubId: 'sub_lapsed' });
    mockRetrieve.mockResolvedValue({ customer: 'cus_lapsed' });
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/test' });
    const { cookie } = await login(app, 'lapsedsub-portal@example.com');
    const res = await request(app).post('/api/platform/billing-portal').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(mockRetrieve).toHaveBeenCalledWith('sub_lapsed');
    expect(mockPortalCreate).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_lapsed' }));
  });

  it('job-only account has no billing history and no portal', async () => {
    const app = buildTestApp();
    await createUser('lapsedsub-jobonly@example.com');
    const { cookie } = await login(app, 'lapsedsub-jobonly@example.com');
    const me = await request(app).get('/api/platform/me').set('Cookie', cookie);
    expect(me.body.has_billing_history).toBe(false);
    expect(me.body.had_subscription).toBe(false);
    const res = await request(app).post('/api/platform/billing-portal').set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(mockPortalCreate).not.toHaveBeenCalled();
  });
});
