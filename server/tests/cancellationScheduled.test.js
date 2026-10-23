// A cancellation scheduled in the Stripe portal is recorded for the CRM only,
// never in cancel_at (which cuts access and would get around the deactivation
// confirmation gate). 2026-10-22.
const express = require('express');
const request = require('supertest');

const mockQuery = jest.fn();
jest.mock('../src/services/database', () => ({
  pool: { query: (...args) => mockQuery(...args) },
  getCourseOutline: jest.fn(),
}));
jest.mock('axios');

const platformRouter = require('../src/routes/platform');
const SECRET = 'cs-secret';

function post(body, secret = SECRET) {
  const a = express();
  a.use(express.json());
  a.use('/api/platform', platformRouter);
  return request(a).post('/api/platform/cancellation-scheduled').set('x-internal-secret', secret).send(body);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.INTERNAL_SECRET = SECRET;
  mockQuery.mockResolvedValue({ rowCount: 1 });
});

it('needs the internal secret', async () => {
  expect((await post({ stripe_subscription_id: 'sub_1', cancel_at: 1793019967 }, 'nope')).status).toBe(401);
  expect(mockQuery).not.toHaveBeenCalled();
});

it('records the scheduled date and never touches cancel_at', async () => {
  const res = await post({ stripe_subscription_id: 'sub_1', cancel_at: 1793019967 });
  expect(res.status).toBe(200);
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toMatch(/SET cancel_scheduled_at = \$1/);
  expect(sql).not.toMatch(/SET cancel_at\b/);
  expect(params).toEqual([new Date(1793019967000), 'sub_1']);
});

it('clears it when the student undoes the cancellation', async () => {
  await post({ stripe_subscription_id: 'sub_1', cancel_at: null });
  expect(mockQuery.mock.calls[0][1]).toEqual([null, 'sub_1']);
});

it('rejects a missing subscription id or a bad time', async () => {
  expect((await post({ cancel_at: 1 })).status).toBe(400);
  expect((await post({ stripe_subscription_id: 'sub_1', cancel_at: 'not a date' })).status).toBe(400);
});
