jest.mock('../src/services/email');

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const platformRouter = require('../src/routes/platform');

const FIXTURE_EMAIL_LIKE = 'provcredit-%@example.com';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/platform', platformRouter);
  return app;
}

async function creditState(email) {
  const { rows: [u] } = await pool.query(`SELECT id FROM platform_users WHERE email = $1`, [email]);
  const bal = await pool.query(`SELECT balance FROM credit_balances WHERE user_id = $1`, [u.id]);
  const tx = await pool.query(
    `SELECT delta FROM credit_transactions WHERE user_id = $1 AND reason = 'signup_grant'`, [u.id]);
  return { balance: bal.rows[0]?.balance ?? null, grants: tx.rows.length };
}

describe('paid enrollment gets the free custom-resume credit', () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv, INTERNAL_SECRET: 'test-internal-secret' }; });
  afterEach(async () => {
    process.env = originalEnv;
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });
  afterAll(async () => { await pool.end(); });

  const provision = (app, email, class_code = 'second') => request(app)
    .post('/api/platform/provision-user')
    .set('x-internal-secret', 'test-internal-secret')
    .send({ email, first_name: 'Paid', last_name: 'Student', class_code });

  it('grants exactly 1 credit when provision-user creates a new account', async () => {
    const app = buildTestApp();
    const email = 'provcredit-new@example.com';
    expect((await provision(app, email)).status).toBe(200);
    expect(await creditState(email)).toEqual({ balance: 1, grants: 1 });
  });

  it('does not grant again on a Stripe re-delivery or a second purchase', async () => {
    const app = buildTestApp();
    const email = 'provcredit-redeliver@example.com';
    await provision(app, email);
    await provision(app, email);
    expect(await creditState(email)).toEqual({ balance: 1, grants: 1 });
  });

  it('a signup-credit failure does not fail paid provisioning', async () => {
    const signupCredit = require('../src/services/signupCredit');
    const spy = jest.spyOn(signupCredit, 'grantSignupCredit').mockRejectedValue(new Error('boom'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = buildTestApp();
      const email = 'provcredit-fail@example.com';
      expect((await provision(app, email)).status).toBe(200);
      const { rows } = await pool.query(
        `SELECT s.id FROM subscriptions s JOIN platform_users u ON u.id = s.user_id WHERE u.email = $1`, [email]);
      expect(rows.length).toBeGreaterThan(0);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('backfill migration grants only accounts that never had a signup_grant', async () => {
    const { rows: [bare] } = await pool.query(
      `INSERT INTO platform_users (email, first_name, last_name) VALUES ('provcredit-bare@example.com', 'Bare', 'Fixture') RETURNING id`);
    const { rows: [granted] } = await pool.query(
      `INSERT INTO platform_users (email, first_name, last_name) VALUES ('provcredit-had@example.com', 'Had', 'Fixture') RETURNING id`);
    await pool.query(`INSERT INTO credit_balances (user_id, balance) VALUES ($1, 0)`, [granted.id]);
    await pool.query(
      `INSERT INTO credit_transactions (user_id, delta, reason) VALUES ($1, 1, 'signup_grant')`, [granted.id]);

    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '021_paid_enrollment_signup_credit.sql'), 'utf8');
    await pool.query(sql);
    await pool.query(sql); // replay must be a no-op

    expect(await creditState('provcredit-bare@example.com')).toEqual({ balance: 1, grants: 1 });
    // Already had a grant and spent it: untouched.
    expect(await creditState('provcredit-had@example.com')).toEqual({ balance: 0, grants: 1 });
    void bare;
  });
});
