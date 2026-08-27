/**
 * Backlog #77 — the platform side of the invited-trial backstop.
 *
 * `subscriptions.cancel_at` is not enforced by a scheduled job: requireAuth
 * applies `AND (s.cancel_at IS NULL OR s.cancel_at > NOW())` on every
 * authenticated request, so setting it ends access the moment it passes and
 * clearing it restores access immediately. That makes both directions
 * load-bearing, and the clearing direction the dangerous one — a backstop left
 * behind after a genuine conversion locks out someone who just paid.
 */
const express = require('express');
const request = require('supertest');

const mockQuery = jest.fn();
jest.mock('../src/services/database', () => ({
  pool: { query: (...args) => mockQuery(...args) },
  getCourseOutline: jest.fn(),
}));
jest.mock('../src/services/gohighlevel', () => ({}));
jest.mock('axios');

const platformRouter = require('../src/routes/platform');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/platform', platformRouter);
  return a;
}

const SECRET = 'trial-backstop-secret';
const FUTURE = Math.floor(Date.now() / 1000) + 8 * 86400;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.INTERNAL_SECRET = SECRET;
  mockQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
});

function post(body) {
  return request(app()).post('/api/platform/trial-backstop')
    .set('x-internal-secret', SECRET).send(body);
}

describe('POST /api/platform/trial-backstop', () => {
  it('is refused without the internal secret', async () => {
    await request(app()).post('/api/platform/trial-backstop')
      .send({ stripe_subscription_id: 'sub_1', cancel_at: null }).expect(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('requires a subscription id', async () => {
    await post({ cancel_at: null }).expect(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('clears the backstop when cancel_at is null', async () => {
    await post({ stripe_subscription_id: 'sub_1', cancel_at: null }).expect(200);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE subscriptions/i);
    expect(sql).toMatch(/cancel_at\s*=\s*\$1/);
    expect(params[0]).toBeNull();
    expect(params[1]).toBe('sub_1');
  });

  it('sets a future backstop when one is given', async () => {
    await post({ stripe_subscription_id: 'sub_1', cancel_at: FUTURE }).expect(200);

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBeInstanceOf(Date);
    expect(Math.floor(params[0].getTime() / 1000)).toBe(FUTURE);
  });

  it('touches only cancel_at — never status, never deactivated_at', async () => {
    // This route exists instead of re-calling provision-user (which creates
    // users and sends magic links) or deactivate-user (which changes status).
    await post({ stripe_subscription_id: 'sub_1', cancel_at: null }).expect(200);

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toMatch(/status\s*=/i);
    expect(sql).not.toMatch(/deactivated_at\s*=/i);
    expect(sql).not.toMatch(/INSERT|DELETE/i);
  });

  it('reports when no subscription matched rather than claiming success', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await post({ stripe_subscription_id: 'sub_missing', cancel_at: null }).expect(200);

    expect(res.body.updated).toBe(0);
  });
});


describe('POST /api/platform/provision-user with a trial backstop', () => {
  beforeEach(() => {
    // provision-user blocks a new row when the user already has an active
    // subscription, so the existing-active lookup must come back empty or the
    // INSERT under test never runs.
    mockQuery.mockImplementation((sql) => {
      if (/SELECT class_code FROM subscriptions/i.test(sql)) return Promise.resolve({ rows: [], rowCount: 0 });
      return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 });
    });
  });

  function provision(body) {
    return request(app()).post('/api/platform/provision-user')
      .set('x-internal-secret', SECRET)
      .send({ email: 'trialist@example.com', first_name: 'Trial', class_code: 'second', ...body });
  }

  function subscriptionInsert() {
    return mockQuery.mock.calls.find(([sql]) => /INSERT INTO subscriptions/i.test(sql));
  }

  it('stores cancel_at on the new subscription when one is given', async () => {
    await provision({ stripe_subscription_id: 'sub_1', cancel_at: FUTURE });

    const call = subscriptionInsert();
    expect(call).toBeTruthy();
    const [sql, params] = call;
    expect(sql).toMatch(/cancel_at/);
    const stored = params.find((p) => p instanceof Date);
    expect(stored).toBeTruthy();
    expect(Math.floor(stored.getTime() / 1000)).toBe(FUTURE);
  });

  it('stores NULL when no backstop is given, which is every ordinary signup', async () => {
    await provision({ stripe_subscription_id: 'sub_1' });

    const [, params] = subscriptionInsert();
    expect(params.some((p) => p instanceof Date)).toBe(false);
  });

  it('ignores a backstop already in the past rather than locking the student out', async () => {
    // A clock skew or a replayed webhook must never provision someone who
    // cannot then log in — requireAuth would reject them from the first click.
    await provision({ stripe_subscription_id: 'sub_1', cancel_at: Math.floor(Date.now() / 1000) - 3600 });

    const [, params] = subscriptionInsert();
    expect(params.some((p) => p instanceof Date)).toBe(false);
  });
});
