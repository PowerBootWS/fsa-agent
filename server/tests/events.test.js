const request = require('supertest');
const express = require('express');
const { pool } = require('./testPool');
const eventsRouter = require('../src/routes/events');

// A stand-in for requireAuth: the real middleware needs a session cookie and a
// platform_users row. What this route cares about is req.user.id, so the test
// app injects one directly and the auth middleware is tested in auth.test.js.
function buildTestApp(user) {
  const app = express();
  app.use(express.json());
  app.use('/api/events', (req, res, next) => {
    if (user) req.user = user;
    next();
  }, eventsRouter);
  return app;
}

let userId;

beforeAll(async () => {
  const { rows } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash)
     VALUES ('usage-events-test@test.example', 'Usage', 'Test', 'x')
     RETURNING id`
  );
  userId = rows[0].id;
});

afterAll(async () => {
  // Scoped to this test's own fixture — never a bare DELETE FROM (2026-08-12).
  await pool.query('DELETE FROM usage_events WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM platform_users WHERE id = $1', [userId]);
  await pool.end();
});

afterEach(async () => {
  await pool.query('DELETE FROM usage_events WHERE user_id = $1', [userId]);
});

describe('POST /api/events', () => {
  it('401s without an authenticated user', async () => {
    const res = await request(buildTestApp(null))
      .post('/api/events')
      .send({ events: [{ type: 'screen_view', screen: '/lobby' }] });
    expect(res.status).toBe(401);
  });

  it('inserts a valid batch against the authenticated user and returns 204', async () => {
    const res = await request(buildTestApp({ id: userId }))
      .post('/api/events')
      .send({
        events: [
          { type: 'screen_view', screen: '/lobby', session_id: 's1', at: new Date().toISOString() },
          {
            type: 'feature_use',
            action: 'paper_switched',
            props: { paper: '2A1' },
            session_id: 's1',
            at: new Date().toISOString(),
          },
        ],
      });
    expect(res.status).toBe(204);

    const { rows } = await pool.query(
      'SELECT event_type, screen, action, props, client_session_id FROM usage_events WHERE user_id = $1 ORDER BY id',
      [userId]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ event_type: 'screen_view', screen: '/lobby', action: null, client_session_id: 's1' });
    expect(rows[1]).toMatchObject({ event_type: 'feature_use', action: 'paper_switched', screen: null });
    // The object->jsonb path is otherwise only exercised with {} — a
    // serialisation regression here would make every insert fail while the
    // route still swallows the error and answers 204 (backlog #113 review).
    expect(rows[1].props).toEqual({ paper: '2A1' });
  });

  it('ignores a client-supplied user_id and uses the session owner', async () => {
    await request(buildTestApp({ id: userId }))
      .post('/api/events')
      .send({ events: [{ type: 'screen_view', screen: '/lobby', user_id: 999999 }] });

    const { rows } = await pool.query('SELECT user_id FROM usage_events WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(1);
  });

  it('drops off-allowlist events, keeps the rest, and still answers 204', async () => {
    const res = await request(buildTestApp({ id: userId }))
      .post('/api/events')
      .send({
        events: [
          { type: 'screen_view', screen: '/login' },
          { type: 'screen_view', screen: '/lobby' },
          { type: 'rage_click' },
        ],
      });
    expect(res.status).toBe(204);

    const { rows } = await pool.query('SELECT screen FROM usage_events WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].screen).toBe('/lobby');
  });

  it('400s a batch larger than 50', async () => {
    const events = Array.from({ length: 51 }, () => ({ type: 'screen_view', screen: '/lobby' }));
    const res = await request(buildTestApp({ id: userId })).post('/api/events').send({ events });
    expect(res.status).toBe(400);
  });

  it('400s a malformed envelope', async () => {
    const res = await request(buildTestApp({ id: userId })).post('/api/events').send({ events: 'nope' });
    expect(res.status).toBe(400);
  });

  it('204s an empty batch without inserting anything', async () => {
    const res = await request(buildTestApp({ id: userId })).post('/api/events').send({ events: [] });
    expect(res.status).toBe(204);
    const { rows } = await pool.query('SELECT 1 FROM usage_events WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(0);
  });

  it('clamps a wildly future occurred_at to received_at', async () => {
    await request(buildTestApp({ id: userId }))
      .post('/api/events')
      .send({ events: [{ type: 'screen_view', screen: '/lobby', at: '2030-01-01T00:00:00.000Z' }] });

    const { rows } = await pool.query(
      'SELECT occurred_at, received_at FROM usage_events WHERE user_id = $1',
      [userId]
    );
    const drift = Math.abs(new Date(rows[0].occurred_at) - new Date(rows[0].received_at));
    expect(drift).toBeLessThan(2000); // clamped to received_at, not stored as 2030
  });
});

// --- affiliate invite wiring ------------------------------------------------
// The threshold logic itself is covered in affiliateInvite.test.js. What this
// pins is that the beacon route still calls it at all, and that it calls it
// after the insert — the check counts the rows the batch just wrote, so
// hoisting it above the insert would make a student's qualifying batch look
// like it fell one short.
describe('POST /api/events — affiliate invite hook', () => {
  const affiliateInvite = require('../src/services/affiliateInvite');

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('offers the batch to the invite check', async () => {
    const spy = jest.spyOn(affiliateInvite, 'maybeInvite').mockResolvedValue(false);

    await request(buildTestApp({ id: userId, email: 'usage-events-test@test.example', subscription_id: 7 }))
      .post('/api/events')
      .send({ events: [{ type: 'screen_view', screen: '/lobby' }] });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toEqual(expect.objectContaining({ id: userId }));
  });

  it('sees the rows the batch just wrote', async () => {
    // The call is fire-and-forget, so the response can land before the check
    // has run. Hold the promise the route kicked off and await that, rather
    // than racing it.
    let checked;
    jest.spyOn(affiliateInvite, 'maybeInvite').mockImplementation((p, u) => {
      checked = p
        .query('SELECT count(*)::int AS n FROM usage_events WHERE user_id = $1', [u.id])
        .then(({ rows }) => rows[0].n);
      return checked.then(() => false);
    });

    await request(buildTestApp({ id: userId, subscription_id: 7 }))
      .post('/api/events')
      .send({ events: [{ type: 'screen_view', screen: '/lobby' }, { type: 'screen_view', screen: '/jobs' }] });

    await expect(checked).resolves.toBe(2);
  });

  it('still answers 204 when the invite check blows up', async () => {
    jest.spyOn(affiliateInvite, 'maybeInvite').mockRejectedValue(new Error('boom'));

    const res = await request(buildTestApp({ id: userId, subscription_id: 7 }))
      .post('/api/events')
      .send({ events: [{ type: 'screen_view', screen: '/lobby' }] });

    expect(res.status).toBe(204);
  });
});
