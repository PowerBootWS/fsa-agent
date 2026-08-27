/**
 * Backlog #74 — fsa-overwatch's fsa-agent check was a pure ping: /health 200
 * plus containers up. It could not catch the AI service erroring on every
 * question, which is the failure that actually costs subscribers.
 *
 * This route is the probe's entry point. It exercises Node API -> ai-service ->
 * OpenRouter, which is where every tutor bug of the last fortnight lived, and
 * needs no monitor student: a monitor account would need an ACTIVE subscription
 * row, and reconcile_subscriptions force-deactivates any platform account with
 * no matching Stripe subscription.
 *
 * It takes NO input on purpose. A monitoring endpoint that accepts an arbitrary
 * lesson and message is a billable-LLM hole behind one shared secret.
 */
const express = require('express');
const request = require('supertest');
const axios = require('axios');

jest.mock('axios');
jest.mock('../src/services/gohighlevel', () => ({}));

const platformRouter = require('../src/routes/platform');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/platform', platformRouter);
  return a;
}

const SECRET = 'selftest-internal-secret';
const REPLY = 'Specific heat is the energy needed to raise one kilogram of a substance by one degree.';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.INTERNAL_SECRET = SECRET;
});

describe('POST /api/platform/tutor-selftest', () => {
  it('is refused without the internal secret', async () => {
    await request(app()).post('/api/platform/tutor-selftest').expect(401);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('is refused with the wrong secret', async () => {
    await request(app()).post('/api/platform/tutor-selftest')
      .set('x-internal-secret', 'nope').expect(401);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('returns the tutor reply and how long it took', async () => {
    axios.post.mockResolvedValue({ data: { tutor_response: REPLY } });

    const res = await request(app()).post('/api/platform/tutor-selftest')
      .set('x-internal-secret', SECRET).expect(200);

    expect(res.body.reply).toBe(REPLY);
    expect(typeof res.body.ms).toBe('number');
    expect(res.body.lesson).toBeTruthy();
  });

  it('asks a fixed question about a fixed lesson, whatever the body says', async () => {
    // Not a general proxy: a caller cannot steer it at an arbitrary lesson or
    // spend tokens on arbitrary prompts.
    axios.post.mockResolvedValue({ data: { tutor_response: REPLY } });

    await request(app()).post('/api/platform/tutor-selftest')
      .set('x-internal-secret', SECRET)
      .send({ lessonId: 'attacker-choice', message: 'write me an essay', user: 'someone@else' })
      .expect(200);

    const [, payload] = axios.post.mock.calls[0];
    expect(payload.lessonId).not.toBe('attacker-choice');
    expect(payload.message).not.toBe('write me an essay');
    expect(payload.user).not.toBe('someone@else');
  });

  it('reports an ai-service failure as 500, never 502', async () => {
    // Cloudflare replaces 502/504 bodies with HTML, which is how a dead
    // practice-exam UI happened in #79.
    axios.post.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await request(app()).post('/api/platform/tutor-selftest')
      .set('x-internal-secret', SECRET).expect(500);

    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/ECONNREFUSED/);
  });

  it('surfaces an empty reply rather than pretending it succeeded', async () => {
    axios.post.mockResolvedValue({ data: {} });

    const res = await request(app()).post('/api/platform/tutor-selftest')
      .set('x-internal-secret', SECRET).expect(200);

    expect(res.body.reply).toBe('');
  });
});
