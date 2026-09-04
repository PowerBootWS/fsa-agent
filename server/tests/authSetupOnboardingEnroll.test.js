// The onboarding welcome is enrolled when a student actually sets a password,
// not when their checkout provisions them. Moved 2026-09-04 on owner decision.
//
// Sent at provision time it landed in the same second as the setup link, below
// it in the inbox — so a student reading top-down tapped the welcome's platform
// link before they had a password and hit a login page they had no credentials
// for. It also read as obviously automated, and it left no window for a failed
// signup to reach support before an automated welcome landed on top of it.
//
// These tests pin the three things that are easy to quietly break: it fires
// only after a successful password set, it is delayed rather than immediate,
// and a student with no active subscription is not enrolled at all.
jest.mock('../src/services/nurture', () => ({ enroll: jest.fn() }));

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const nurture = require('../src/services/nurture');
const authRouter = require('../src/routes/auth');

const FIXTURE_EMAIL_LIKE = 'setuponboarding-%@example.com';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  return app;
}

async function makeStudent(slug, { classCode = 'second', usedAt = null } = {}) {
  const email = `setuponboarding-${slug}@example.com`;
  const user = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name) VALUES ($1, 'Test', 'Student')
     RETURNING id`,
    [email]
  );
  const userId = user.rows[0].id;
  if (classCode) {
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, $2, 'active')`,
      [userId, classCode]
    );
  }
  const token = crypto.randomUUID();
  await pool.query(
    `INSERT INTO auth_tokens (user_id, token, type, expires_at, used_at)
     VALUES ($1, $2, 'magic_link', now() + interval '48 hours', $3)`,
    [userId, token, usedAt]
  );
  return { email, token, userId };
}

beforeEach(() => {
  nurture.enroll.mockReset();
  // The real helper is fire-and-forget; the route attaches .catch() to it, so a
  // mock returning undefined would throw "Cannot read properties of undefined".
  nurture.enroll.mockResolvedValue({ ok: true });
});

afterAll(async () => {
  await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  await pool.end();
});

describe('POST /api/auth/setup enrols the onboarding welcome', () => {
  test('a successful password set enrols the student with their class_code', async () => {
    const { email, token } = await makeStudent('ok', { classCode: 'second' });
    const res = await request(buildTestApp())
      .post('/api/auth/setup')
      .send({ token, password: 'a-good-password-1' });

    expect(res.status).toBe(200);
    expect(nurture.enroll).toHaveBeenCalledTimes(1);
    const arg = nurture.enroll.mock.calls[0][0];
    expect(arg).toMatchObject({
      email,
      sequence: 'onboarding',
      source: 'auth-setup',
      attrs: { class_code: 'second' },
    });
  });

  test('the send is delayed, and jittered rather than a fixed offset', async () => {
    // A fixed offset is as machine-obvious as a zero one. Drive it repeatedly
    // and require the delays to actually vary — a hardcoded constant would
    // satisfy a bounds check but not this.
    const delays = new Set();
    for (let i = 0; i < 12; i++) {
      const { token } = await makeStudent(`jitter${i}`);
      await request(buildTestApp())
        .post('/api/auth/setup')
        .send({ token, password: 'a-good-password-1' });
      const { delayMinutes } = nurture.enroll.mock.calls[nurture.enroll.mock.calls.length - 1][0];
      expect(delayMinutes).toBeGreaterThanOrEqual(10);
      expect(delayMinutes).toBeLessThanOrEqual(25);
      delays.add(delayMinutes);
    }
    expect(delays.size).toBeGreaterThan(1);
  });

  test('the 4th Class arms carry their own class_code, not a default', async () => {
    const { token } = await makeStudent('fourthb', { classCode: 'fourth_b' });
    await request(buildTestApp())
      .post('/api/auth/setup')
      .send({ token, password: 'a-good-password-1' });
    expect(nurture.enroll.mock.calls[0][0].attrs).toEqual({ class_code: 'fourth_b' });
  });

  test('a spent token sets no password and enrols nobody', async () => {
    const { token } = await makeStudent('spent', { usedAt: new Date() });
    const res = await request(buildTestApp())
      .post('/api/auth/setup')
      .send({ token, password: 'a-good-password-1' });

    expect(res.status).toBe(400);
    expect(nurture.enroll).not.toHaveBeenCalled();
  });

  test('a student who never sets a password is never enrolled', async () => {
    // Owner decision: no password means no welcome. The email is entirely about
    // using an account they cannot get into, so they are a support case rather
    // than a welcome case. Provisioning alone must not enrol them.
    await makeStudent('nopassword');
    expect(nurture.enroll).not.toHaveBeenCalled();
  });

  test('an account with no active subscription is not enrolled', async () => {
    // class_code gates it: no subscription means this is not a course student.
    const { token } = await makeStudent('nosub', { classCode: null });
    const res = await request(buildTestApp())
      .post('/api/auth/setup')
      .send({ token, password: 'a-good-password-1' });

    expect(res.status).toBe(200);
    expect(nurture.enroll).not.toHaveBeenCalled();
  });

  test('a nurture outage does not fail the account setup', async () => {
    // The student is mid-signup and their password is already written. Losing
    // the welcome is survivable; losing the signup is not.
    nurture.enroll.mockRejectedValue(new Error('nurture unreachable'));
    const { token } = await makeStudent('outage');
    const res = await request(buildTestApp())
      .post('/api/auth/setup')
      .send({ token, password: 'a-good-password-1' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
