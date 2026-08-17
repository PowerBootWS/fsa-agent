const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');

const platformRouter = require('../src/routes/platform');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'packs%@example.com';

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use('/api/platform', platformRouter);
  return app;
}

async function createUser(email) {
  const token = `test-token-${email}`;
  const result = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Test', 'User', $2) RETURNING id`,
    [email, token]
  );
  return { userId: result.rows[0].id, token };
}

describe('GET /api/platform/credits/packs', () => {
  afterEach(async () => {
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('lists all three packs in Single Shot, In the Game, All In order', async () => {
    const { token } = await createUser('packs1@example.com');
    const app = buildTestApp();
    const res = await request(app).get('/api/platform/credits/packs').set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.packs).toEqual([
      { id: 'spark', displayName: 'Single Shot', priceLabel: '$19', credits: 1 },
      { id: 'full_steam', displayName: 'In the Game', priceLabel: '$39', credits: 5 },
      { id: 'locomotive', displayName: 'All In', priceLabel: '$69', credits: 10 },
    ]);
  });
});
