jest.mock('../src/services/email');

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const platformRouter = require('../src/routes/platform');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'provuser1-%@example.com';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/platform', platformRouter);
  return app;
}

describe('provision-user — one active subscription per (user, class_code)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, INTERNAL_SECRET: 'test-internal-secret' };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('does not create a second active subscription row under a different class_code for the same user (cross-tier, application-enforced)', async () => {
    const app = buildTestApp();

    const first = await request(app)
      .post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'provuser1-dual-class@example.com', first_name: 'Dual', last_name: 'User', class_code: 'second' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'provuser1-dual-class@example.com', first_name: 'Dual', last_name: 'User', class_code: 'fourth_a' });
    expect(second.status).toBe(200);
    // The customer has paid for this purchase and it granted nothing, so the
    // response must say so -- the webhook listener alerts Russ on it.
    expect(second.body.blocked).toBe(true);
    expect(second.body.blocking_class_codes).toEqual(['second']);
    expect(first.body.blocked).toBe(false);

    const rows = await pool.query(
      `SELECT s.class_code FROM subscriptions s
       JOIN platform_users u ON u.id = s.user_id
       WHERE u.email = 'provuser1-dual-class@example.com' AND s.status = 'active'`
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].class_code).toBe('second');
  });

  it('flags a second paid purchase of the same class (different Stripe subscription) as a duplicate, but not a webhook re-delivery', async () => {
    const app = buildTestApp();
    const send = (sub) => request(app)
      .post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'provuser1-dup@example.com', first_name: 'Dup', last_name: 'User', class_code: 'second', stripe_subscription_id: sub });
    const first = await send('sub_fixture_A');
    expect(first.body.duplicate_purchase).toBe(false);
    const redelivery = await send('sub_fixture_A');
    expect(redelivery.body.duplicate_purchase).toBe(false);
    expect(redelivery.body.blocked).toBe(false);
    const second = await send('sub_fixture_B');
    expect(second.body.duplicate_purchase).toBe(true);
  });

  it('DB rejects a raw duplicate active subscription (same class_code) for the same user', async () => {
    const userResult = await pool.query(
      `INSERT INTO platform_users (email, first_name, last_name) VALUES ('provuser1-raw-dual@example.com', 'Raw', 'User') RETURNING id`
    );
    const userId = userResult.rows[0].id;
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, 'second', 'active')`,
      [userId]
    );

    await expect(
      pool.query(
        `INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, 'second', 'active')`,
        [userId]
      )
    ).rejects.toMatchObject({ code: '23505' });
  });
});
