const request = require('supertest');
const express = require('express');

function buildApp(user) {
  // Re-require per test so ADMIN_EMAILS is read fresh.
  jest.resetModules();
  const requireAdminUser = require('../src/middleware/requireAdminUser');
  const app = express();
  app.get('/x', (req, res, next) => { if (user) req.user = user; next(); }, requireAdminUser, (req, res) =>
    res.json({ ok: true })
  );
  return app;
}

const ORIGINAL = process.env.ADMIN_EMAILS;
afterAll(() => { process.env.ADMIN_EMAILS = ORIGINAL; });

describe('requireAdminUser', () => {
  it('allows an allowlisted address', async () => {
    process.env.ADMIN_EMAILS = 'russ@fullsteamahead.ca,sysadmin@powerboot.ca';
    const res = await request(buildApp({ email: 'russ@fullsteamahead.ca' })).get('/x');
    expect(res.status).toBe(200);
  });

  it('is case- and whitespace-insensitive', async () => {
    process.env.ADMIN_EMAILS = ' Russ@FullSteamAhead.ca ';
    const res = await request(buildApp({ email: 'russ@fullsteamahead.ca' })).get('/x');
    expect(res.status).toBe(200);
  });

  it('403s a non-allowlisted student', async () => {
    process.env.ADMIN_EMAILS = 'russ@fullsteamahead.ca';
    const res = await request(buildApp({ email: 'student@test.example' })).get('/x');
    expect(res.status).toBe(403);
  });

  it('403s when there is no authenticated user', async () => {
    process.env.ADMIN_EMAILS = 'russ@fullsteamahead.ca';
    const res = await request(buildApp(null)).get('/x');
    expect(res.status).toBe(403);
  });

  it('403s everyone when ADMIN_EMAILS is unset — fails closed', async () => {
    delete process.env.ADMIN_EMAILS;
    const res = await request(buildApp({ email: 'russ@fullsteamahead.ca' })).get('/x');
    expect(res.status).toBe(403);
  });
});
