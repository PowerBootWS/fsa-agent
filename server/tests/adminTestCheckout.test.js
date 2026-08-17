const request = require('supertest');
const express = require('express');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'admintest%@example.com';

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: { create: jest.fn().mockResolvedValue({ id: 'cus_test_e2e' }) },
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test-mode-session', id: 'cs_test_e2e123' }),
      },
    },
  }));
});

const adminRouter = require('../src/routes/admin');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

async function createUser(email) {
  const result = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name) VALUES ($1, 'Test', 'User') RETURNING id`,
    [email]
  );
  return result.rows[0].id;
}

describe('POST /api/admin/credits/test-checkout', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ADMIN_API_KEY: 'test-admin-key',
      STRIPE_TEST_PRICE_SPARK_ID: 'price_test_spark',
      STRIPE_TEST_SECRET_KEY: 'sk_test_fake',
    };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('rejects without the correct x-admin-api-key', async () => {
    const userId = await createUser('admintest1@example.com');
    const app = buildTestApp();
    const res = await request(app).post('/api/admin/credits/test-checkout').send({ userId });
    expect(res.status).toBe(403);
  });

  it('rejects an unknown userId with 404', async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post('/api/admin/credits/test-checkout')
      .set('x-admin-api-key', 'test-admin-key')
      .send({ userId: 999999 });
    expect(res.status).toBe(404);
  });

  it('rejects a missing userId with 400', async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post('/api/admin/credits/test-checkout')
      .set('x-admin-api-key', 'test-admin-key')
      .send({});
    expect(res.status).toBe(400);
  });

  it('creates a test-mode checkout session and returns the url', async () => {
    const userId = await createUser('admintest2@example.com');
    const app = buildTestApp();
    const res = await request(app)
      .post('/api/admin/credits/test-checkout')
      .set('x-admin-api-key', 'test-admin-key')
      .send({ userId });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: 'https://checkout.stripe.com/test-mode-session', sessionId: 'cs_test_e2e123' });
  });
});
