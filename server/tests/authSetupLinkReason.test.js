// A setup link is single-use, and re-tapping the button in the welcome email is
// ordinary behaviour — on 2026-09-04 a new 2nd Class student did exactly that
// two minutes after successfully setting her password, got "Invalid or expired
// link. Please contact support", and emailed support. GET/POST /api/auth/setup
// used to answer a spent token, an expired token and a garbage token with the
// identical body, so the page had nothing to steer on. These tests pin the
// `reason` discriminator that lets it offer "sign in" instead of a dead end.
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const authRouter = require('../src/routes/auth');

const FIXTURE_EMAIL_LIKE = 'setupreason-%@example.com';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  return app;
}

// Creates a student with a magic_link token in one of the three failure states
// (or a good one), mirroring what provisionUser writes on checkout.
async function makeSetupToken(slug, { usedAt = null, expiresAt = "now() + interval '48 hours'" } = {}) {
  const email = `setupreason-${slug}@example.com`;
  const user = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name) VALUES ($1, 'Test', 'Student')
     RETURNING id`,
    [email]
  );
  const token = crypto.randomUUID();
  await pool.query(
    `INSERT INTO auth_tokens (user_id, token, type, expires_at, used_at)
     VALUES ($1, $2, 'magic_link', ${expiresAt}, $3)`,
    [user.rows[0].id, token, usedAt]
  );
  return { token, userId: user.rows[0].id, email };
}

// Top-level, so it runs after BOTH describes — a pool.end() inside the first
// one closes the pool while the second still needs it.
afterAll(async () => {
  await pool.end();
});

describe('GET /api/auth/setup — why the link failed', () => {
  afterEach(async () => {
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  it('accepts a fresh, unused token', async () => {
    const { token } = await makeSetupToken('fresh');
    const res = await request(buildTestApp()).get('/api/auth/setup').query({ token });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.first_name).toBe('Test');
  });

  it('reports already_used for a token whose password was already set', async () => {
    const { token } = await makeSetupToken('spent', { usedAt: new Date() });
    const res = await request(buildTestApp()).get('/api/auth/setup').query({ token });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('already_used');
  });

  it('reports expired for an unused token past its 48 hours', async () => {
    const { token } = await makeSetupToken('stale', { expiresAt: "now() - interval '1 hour'" });
    const res = await request(buildTestApp()).get('/api/auth/setup').query({ token });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('expired');
  });

  it('reports invalid for a token that was never issued', async () => {
    const res = await request(buildTestApp())
      .get('/api/auth/setup')
      .query({ token: crypto.randomUUID() });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('invalid');
  });

  it('reports invalid when no token is supplied at all', async () => {
    const res = await request(buildTestApp()).get('/api/auth/setup');
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('invalid');
  });

  // An expired token that was ALSO used reads as already_used, not expired:
  // the student finished setup and simply came back later, so "sign in" is the
  // right advice and "request a new link" would be wrong.
  it('prefers already_used over expired when a spent token has also lapsed', async () => {
    const { token } = await makeSetupToken('spentandstale', {
      usedAt: new Date(),
      expiresAt: "now() - interval '1 hour'",
    });
    const res = await request(buildTestApp()).get('/api/auth/setup').query({ token });
    expect(res.body.reason).toBe('already_used');
  });
});

describe('POST /api/auth/setup — why the link failed', () => {
  afterEach(async () => {
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  it('reports already_used when the token is spent between load and submit', async () => {
    const app = buildTestApp();
    const { token } = await makeSetupToken('doublesubmit');

    const first = await request(app).post('/api/auth/setup').send({ token, password: 'longenoughpassword' });
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/auth/setup').send({ token, password: 'longenoughpassword' });
    expect(second.status).toBe(400);
    expect(second.body.reason).toBe('already_used');
  });

  it('reports invalid for a token that was never issued', async () => {
    const res = await request(buildTestApp())
      .post('/api/auth/setup')
      .send({ token: crypto.randomUUID(), password: 'longenoughpassword' });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('invalid');
  });
});
