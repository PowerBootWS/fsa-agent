const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');

const platformRouter = require('../src/routes/platform');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'grant%@example.com';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/platform', platformRouter);
  return app;
}

async function createUser(email) {
  const result = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name)
     VALUES ($1, 'Test', 'User') RETURNING id`,
    [email]
  );
  return result.rows[0].id;
}

describe('POST /api/platform/credits/grant-purchase', () => {
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

  it('rejects a request without the correct x-internal-secret', async () => {
    const userId = await createUser('grant1@example.com');
    const app = buildTestApp();
    const res = await request(app)
      .post('/api/platform/credits/grant-purchase')
      .send({ userId, packId: 'spark', stripeSessionId: 'cs_1' });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown packId with 400', async () => {
    const userId = await createUser('grant2@example.com');
    const app = buildTestApp();
    const res = await request(app)
      .post('/api/platform/credits/grant-purchase')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ userId, packId: 'not-real', stripeSessionId: 'cs_2' });
    expect(res.status).toBe(400);
  });

  it('grants the correct number of credits for the pack', async () => {
    const userId = await createUser('grant3@example.com');
    const app = buildTestApp();
    const res = await request(app)
      .post('/api/platform/credits/grant-purchase')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ userId, packId: 'locomotive', stripeSessionId: 'cs_3' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, alreadyProcessed: false });

    const balanceRow = await pool.query(`SELECT balance FROM credit_balances WHERE user_id = $1`, [userId]);
    expect(balanceRow.rows[0].balance).toBe(10);
  });

  it('is idempotent on a repeated stripeSessionId (webhook retry)', async () => {
    const userId = await createUser('grant4@example.com');
    const app = buildTestApp();
    await request(app)
      .post('/api/platform/credits/grant-purchase')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ userId, packId: 'full_steam', stripeSessionId: 'cs_4' });

    const res = await request(app)
      .post('/api/platform/credits/grant-purchase')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ userId, packId: 'full_steam', stripeSessionId: 'cs_4' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, alreadyProcessed: true });

    const balanceRow = await pool.query(`SELECT balance FROM credit_balances WHERE user_id = $1`, [userId]);
    expect(balanceRow.rows[0].balance).toBe(5); // not 10
  });
});
