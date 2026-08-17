const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'checkout%@example.com';

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: {
      create: jest.fn().mockResolvedValue({ id: 'cus_test_new' }),
    },
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test-session' }),
      },
    },
  }));
});

const platformRouter = require('../src/routes/platform');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/platform', platformRouter);
  return app;
}

async function createUser(email, { stripeCustomerId = null } = {}) {
  const token = `test-token-${email}`;
  const result = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token, stripe_customer_id)
     VALUES ($1, 'Test', 'User', $2, $3) RETURNING id`,
    [email, token, stripeCustomerId]
  );
  return { userId: result.rows[0].id, token };
}

describe('POST /api/platform/credits/checkout', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      STRIPE_PRICE_SPARK_ID: 'price_spark_test',
      STRIPE_PRICE_FULL_STEAM_ID: 'price_full_steam_test',
      STRIPE_PRICE_LOCOMOTIVE_ID: 'price_locomotive_test',
      STRIPE_SECRET_KEY: 'sk_test_fake',
      PLATFORM_BASE_URL: 'https://learn.fullsteamahead.ca',
    };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('rejects an unknown packId with 400', async () => {
    const { token } = await createUser('checkout1@example.com');
    const app = buildTestApp();
    const res = await request(app)
      .post('/api/platform/credits/checkout')
      .set('Cookie', `fsa_session=${token}`)
      .send({ packId: 'not-a-real-pack' });
    expect(res.status).toBe(400);
  });

  it('creates a Stripe customer for a first-time purchaser and returns the checkout URL', async () => {
    const { userId, token } = await createUser('checkout2@example.com');
    const app = buildTestApp();
    const res = await request(app)
      .post('/api/platform/credits/checkout')
      .set('Cookie', `fsa_session=${token}`)
      .send({ packId: 'full_steam' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ url: 'https://checkout.stripe.com/test-session' });

    const userRow = await pool.query(`SELECT stripe_customer_id FROM platform_users WHERE id = $1`, [userId]);
    expect(userRow.rows[0].stripe_customer_id).toBe('cus_test_new');
  });

  it('reuses an existing stripe_customer_id instead of creating a new one', async () => {
    const { token } = await createUser('checkout3@example.com', { stripeCustomerId: 'cus_existing_123' });
    const app = buildTestApp();
    const res = await request(app)
      .post('/api/platform/credits/checkout')
      .set('Cookie', `fsa_session=${token}`)
      .send({ packId: 'spark' });
    expect(res.status).toBe(201);
    // Stripe mock's customers.create was set up to always resolve cus_test_new — if the
    // route incorrectly created a new customer, the DB row would now show cus_test_new
    // instead of the pre-existing ID. Confirm it wasn't touched.
    const userRow = await pool.query(
      `SELECT stripe_customer_id FROM platform_users WHERE current_session_token = $1`,
      [token]
    );
    expect(userRow.rows[0].stripe_customer_id).toBe('cus_existing_123');
  });
});
