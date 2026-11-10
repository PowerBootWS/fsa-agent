process.env.USER_UPLOADS_DIR = process.env.USER_UPLOADS_DIR || '/tmp/fsa-test-user-uploads';
process.env.PRACTICE_EXAM_TOKEN_SECRET = process.env.PRACTICE_EXAM_TOKEN_SECRET || 'test-secret';
const fs = require('fs');
const os = require('os');
const path = require('path');
const EMPTY = fs.mkdtempSync(path.join(os.tmpdir(), 'fsa-og-empty-'));
process.env.CLIENT_V2_BUILD_DIR = EMPTY;
process.env.CLIENT_V1_BUILD_DIR = EMPTY;

const request = require('supertest');
const app = require('../src/index');

afterAll(async () => { await require('../src/services/database').pool.end(); });

test('no index.html at startup: /explained/x behaves exactly like any other SPA route (falls through)', async () => {
  const host = 'learn.fullsteamahead.ca';
  const other = await request(app).get('/some-spa-route').set('Host', host);
  const r = await request(app).get('/explained/test-mini-x').set('Host', host);
  expect(r.status).toBe(other.status); // existing catch-all behaviour, not a crash from our handler
  expect(r.text).not.toContain('og:title');
});
