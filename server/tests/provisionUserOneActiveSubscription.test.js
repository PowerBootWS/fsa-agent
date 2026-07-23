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

describe('provision-user — one active subscription per (user, class_code)', () => {
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

  it('does not create a second active subscription row under a different class_code for the same user (cross-tier, application-enforced)', async () => {
    const app = buildTestApp();

    const first = await request(app)
      .post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'dual-class@example.com', first_name: 'Dual', last_name: 'User', class_code: 'second' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'dual-class@example.com', first_name: 'Dual', last_name: 'User', class_code: 'fourth_a' });
    expect(second.status).toBe(200);

    const rows = await pool.query(
      `SELECT s.class_code FROM subscriptions s
       JOIN platform_users u ON u.id = s.user_id
       WHERE u.email = 'dual-class@example.com' AND s.status = 'active'`
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].class_code).toBe('second');
  });

  it('DB rejects a raw duplicate active subscription (same class_code) for the same user', async () => {
    const userResult = await pool.query(
      `INSERT INTO platform_users (email, first_name, last_name) VALUES ('raw-dual@example.com', 'Raw', 'User') RETURNING id`
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
