const request = require('supertest');
const express = require('express');
const { pool } = require('./testPool');

process.env.ADMIN_EMAILS = 'admin@test.example';
const adminRouter = require('../src/routes/admin');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', (req, res, next) => { if (user) req.user = user; next(); }, adminRouter);
  return app;
}

let userId;

beforeAll(async () => {
  const { rows } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash)
     VALUES ('admin-usage-test@test.example', 'Admin', 'Usage', 'x') RETURNING id`
  );
  userId = rows[0].id;
  await pool.query(
    `INSERT INTO usage_events (user_id, event_type, screen, action, occurred_at)
     VALUES ($1, 'screen_view', '/lobby', NULL, now()),
            ($1, 'screen_view', '/lobby', NULL, now()),
            ($1, 'screen_view', '/jobs',  NULL, now()),
            ($1, 'feature_use', NULL, 'paper_switched', now())`,
    [userId]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM usage_events WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM platform_users WHERE id = $1', [userId]);
  await pool.end();
});

describe('GET /api/admin/usage', () => {
  it('403s a non-admin', async () => {
    const res = await request(buildApp({ email: 'student@test.example' })).get('/api/admin/usage');
    expect(res.status).toBe(403);
  });

  it('returns screen and feature aggregates for an admin', async () => {
    const res = await request(buildApp({ email: 'admin@test.example' })).get('/api/admin/usage?days=7');
    expect(res.status).toBe(200);
    expect(res.body.window_days).toBe(7);

    const lobby = res.body.screens.find((s) => s.screen === '/lobby');
    expect(lobby.views).toBeGreaterThanOrEqual(2);
    expect(lobby.viewers).toBeGreaterThanOrEqual(1);

    const switched = res.body.features.find((f) => f.action === 'paper_switched');
    expect(switched.uses).toBeGreaterThanOrEqual(1);
  });

  it('clamps an absurd or non-numeric days parameter to the default', async () => {
    const app = buildApp({ email: 'admin@test.example' });

    const tooBig = await request(app).get('/api/admin/usage?days=9999');
    expect(tooBig.status).toBe(200);
    expect(tooBig.body.window_days).toBe(30);

    const nonsense = await request(app).get('/api/admin/usage?days=nonsense');
    expect(nonsense.status).toBe(200);
    expect(nonsense.body.window_days).toBe(30);
  });
});
