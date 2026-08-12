/**
 * Regression tests for the swallowed lead-capture failure (audit 2026-08-12).
 *
 * routes/practiceExam.js fired the fsa-lead-capture / affiliate-attribution POST
 * as `fetch(...).catch(err => console.error(...))`. `.catch()` only fires on a
 * network-level rejection — a resolved response carrying HTTP 400/401/500 is a
 * *successful* promise, so every rejected lead (bad affiliate code, wrong shared
 * secret, validation failure) was discarded in silence and the caller saw
 * `{ success: true }`. That is how an affiliate funnel ran blind for three weeks.
 *
 * The fix must log the status AND the response body — a bare status tells you
 * nothing about which field the downstream API rejected.
 */
process.env.PRACTICE_EXAM_TOKEN_SECRET ||= 'test-secret';

const request = require('supertest');
const express = require('express');
const { pool } = require('./testPool');
const practiceExamRouter = require('../src/routes/practiceExam');

jest.mock('../src/services/email');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/practice-exam', practiceExamRouter);
  return app;
}

/** Replaces global.fetch and resolves once the route has called it. */
function stubFetch(response) {
  let resolveCalled;
  const called = new Promise((r) => { resolveCalled = r; });
  const calls = [];
  global.fetch = jest.fn(async (url, opts) => {
    calls.push({ url, opts });
    // Let the route's .then/.catch chain run before the assertion.
    setTimeout(resolveCalled, 0);
    return response;
  });
  return { called, calls };
}

const OK_RESPONSE = { ok: true, status: 200, text: async () => '{"ok":true}' };

describe('practice-exam lead capture surfaces downstream HTTP failures', () => {
  const realFetch = global.fetch;
  const realUrl = process.env.LEAD_CAPTURE_URL;
  let errSpy;

  beforeEach(() => {
    process.env.LEAD_CAPTURE_URL = 'https://lead-capture.test';
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    errSpy.mockRestore();
    global.fetch = realFetch;
    if (realUrl === undefined) delete process.env.LEAD_CAPTURE_URL;
    else process.env.LEAD_CAPTURE_URL = realUrl;
    await pool.query(`DELETE FROM practice_exam_attempts`);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function requestCode(email) {
    return request(buildTestApp())
      .post('/api/practice-exam/request-code')
      .send({ firstName: 'Jordan', email, classCode: 'second', paperCode: '2A1', affiliateCode: 'AM123' });
  }

  it('logs the status when the lead-capture API returns 400', async () => {
    const { called } = stubFetch({
      ok: false,
      status: 400,
      text: async () => '{"error":"unknown affiliate code"}',
    });

    const res = await requestCode('lead-400@example.com');
    expect(res.status).toBe(200);
    await called;
    await new Promise((r) => setTimeout(r, 10));

    const logged = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(/400/);
  });

  it('logs the response body, not just the status', async () => {
    const { called } = stubFetch({
      ok: false,
      status: 400,
      text: async () => '{"error":"unknown affiliate code"}',
    });

    await requestCode('lead-body@example.com');
    await called;
    await new Promise((r) => setTimeout(r, 10));

    const logged = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(/unknown affiliate code/);
  });

  it('logs a 500 from the lead-capture API too', async () => {
    const { called } = stubFetch({ ok: false, status: 500, text: async () => 'upstream exploded' });

    await requestCode('lead-500@example.com');
    await called;
    await new Promise((r) => setTimeout(r, 10));

    const logged = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(/500/);
    expect(logged).toMatch(/upstream exploded/);
  });

  it('still logs a network-level rejection', async () => {
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });

    await requestCode('lead-net@example.com');
    await new Promise((r) => setTimeout(r, 10));

    const logged = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(/ECONNREFUSED/);
  });

  it('logs nothing when the lead-capture API succeeds', async () => {
    const { called, calls } = stubFetch(OK_RESPONSE);

    await requestCode('lead-ok@example.com');
    await called;
    await new Promise((r) => setTimeout(r, 10));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://lead-capture.test/practice-exam');
    const logged = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).not.toMatch(/lead-capture/i);
  });

  it('a lead-capture failure never fails the student-facing request', async () => {
    stubFetch({ ok: false, status: 400, text: async () => 'nope' });
    const res = await requestCode('lead-nonfatal@example.com');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});
