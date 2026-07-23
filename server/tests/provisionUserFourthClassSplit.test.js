jest.mock('../src/services/email');

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const platformRouter = require('../src/routes/platform');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/platform', platformRouter);
  return app;
}

async function activeCodes(email) {
  const rows = await pool.query(
    `SELECT s.class_code FROM subscriptions s
     JOIN platform_users u ON u.id = s.user_id
     WHERE u.email = $1 AND s.status = 'active'
     ORDER BY s.class_code`,
    [email]
  );
  return rows.rows.map(r => r.class_code);
}

describe('provision-user — 4th Class split (fourth_a / fourth_b)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, INTERNAL_SECRET: 'test-internal-secret' };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.query(`DELETE FROM auth_tokens`);
    await pool.query(`DELETE FROM subscriptions`);
    await pool.query(`DELETE FROM platform_users`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('buying fourth_b after fourth_a leaves both active — the one new case', async () => {
    const app = buildTestApp();
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'both-papers@example.com', first_name: 'Both', last_name: 'Papers', class_code: 'fourth_a' });
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'both-papers@example.com', first_name: 'Both', last_name: 'Papers', class_code: 'fourth_b' });

    expect(await activeCodes('both-papers@example.com')).toEqual(['fourth_a', 'fourth_b']);
  });

  it('buying fourth_a twice does not create a duplicate row', async () => {
    const app = buildTestApp();
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'repeat-buyer@example.com', first_name: 'Repeat', last_name: 'Buyer', class_code: 'fourth_a' });
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'repeat-buyer@example.com', first_name: 'Repeat', last_name: 'Buyer', class_code: 'fourth_a' });

    expect(await activeCodes('repeat-buyer@example.com')).toEqual(['fourth_a']);
  });

  it('buying fourth_a while second is active is blocked (cross-tier)', async () => {
    const app = buildTestApp();
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'cross-tier-1@example.com', first_name: 'Cross', last_name: 'Tier', class_code: 'second' });
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'cross-tier-1@example.com', first_name: 'Cross', last_name: 'Tier', class_code: 'fourth_a' });

    expect(await activeCodes('cross-tier-1@example.com')).toEqual(['second']);
  });

  it('buying second while fourth_a is active is blocked (cross-tier, reverse direction)', async () => {
    const app = buildTestApp();
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'cross-tier-2@example.com', first_name: 'Cross', last_name: 'Tier', class_code: 'fourth_a' });
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'cross-tier-2@example.com', first_name: 'Cross', last_name: 'Tier', class_code: 'second' });

    expect(await activeCodes('cross-tier-2@example.com')).toEqual(['fourth_a']);
  });

  it('DB allows a raw fourth_a + fourth_b active pair for the same user', async () => {
    const userResult = await pool.query(
      `INSERT INTO platform_users (email, first_name, last_name) VALUES ('raw-both@example.com', 'Raw', 'Both') RETURNING id`
    );
    const userId = userResult.rows[0].id;
    await pool.query(`INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, 'fourth_a', 'active')`, [userId]);

    await expect(
      pool.query(`INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, 'fourth_b', 'active')`, [userId])
    ).resolves.toBeDefined();
  });

  it('DB still rejects two active rows with the exact same class_code', async () => {
    const userResult = await pool.query(
      `INSERT INTO platform_users (email, first_name, last_name) VALUES ('raw-dup@example.com', 'Raw', 'Dup') RETURNING id`
    );
    const userId = userResult.rows[0].id;
    await pool.query(`INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, 'fourth_a', 'active')`, [userId]);

    await expect(
      pool.query(`INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, 'fourth_a', 'active')`, [userId])
    ).rejects.toMatchObject({ code: '23505' });
  });
});
