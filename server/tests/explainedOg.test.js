process.env.USER_UPLOADS_DIR = process.env.USER_UPLOADS_DIR || '/tmp/fsa-test-user-uploads';
process.env.PRACTICE_EXAM_TOKEN_SECRET = process.env.PRACTICE_EXAM_TOKEN_SECRET || 'test-secret';
const fs = require('fs');
const os = require('os');
const path = require('path');

// CLIENT_V2_BUILD_DIR / index.html are read at module load in src/index.js.
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'fsa-og-build-'));
fs.writeFileSync(path.join(BUILD, 'index.html'),
  '<!doctype html><html><head><title>Full Steam Ahead</title></head><body><div id="root"></div></body></html>');
process.env.CLIENT_V2_BUILD_DIR = BUILD;
process.env.CLIENT_V1_BUILD_DIR = BUILD;
delete process.env.LEARN_DOMAIN;

const request = require('supertest');
const { pool } = require('./testPool');
const app = require('../src/index');
const ml = require('../src/services/miniLessons');
const { renderExplainedHtml } = require('../src/services/explainedOg');

const get = (p) => request(app).get(p).set('Host', 'learn.fullsteamahead.ca');
const payload = (slug, over = {}) => ({
  slug, title: 'T ' + slug, description: 'd', paper_code: '2B3', source_lesson_code: null,
  source_label: 'src', request_text: 'req', og_image_url: 'og.png',
  slides: [{ slide_number: 1, chunk_type: 'intro', title: 's1', body: 'b', narration: 'n',
    audio_url: 'slide-001.mp3', image_url: null, narration_timing: null }],
  questions: [{ position: 1, question_text: 'q?', step_data: { steps: [] }, explanation: 'e' }],
  ...over,
});

let pendToken;
beforeAll(async () => {
  await pool.query(`DELETE FROM mini_lessons WHERE slug LIKE 'test-mini-%'`);
  await ml.upsertDraft(payload('test-mini-live', { title: 'A <script>alert(1)</script> "q" & co', description: 'x"><b>' }));
  await ml.setStatus('test-mini-live', 'live', { checksPassed: true, expectedVersion: 1 });
  await ml.upsertDraft(payload('test-mini-noimg', { og_image_url: null }));
  await ml.setStatus('test-mini-noimg', 'live', { checksPassed: true, expectedVersion: 1 });
  pendToken = (await ml.upsertDraft(payload('test-mini-pend'))).preview_token;
});
afterAll(async () => {
  await pool.query(`DELETE FROM mini_lessons WHERE slug LIKE 'test-mini-%'`);
  await pool.end();
  await require('../src/services/database').pool.end();
});

describe('renderExplainedHtml', () => {
  const html = '<html><head><title>x</title></head><body></body></html>';
  test('null lesson: only robots noindex', () => {
    const out = renderExplainedHtml(html, null, 'https://b.example');
    expect(out).toContain('<meta name="robots" content="noindex">');
    expect(out).not.toContain('og:title');
  });
});

describe('GET /explained/:slug', () => {
  test('live: tags present, escaped, absolute image, clean og:url', async () => {
    const r = await get('/explained/test-mini-live');
    expect(r.status).toBe(200);
    expect(r.text).toContain('<div id="root">');
    expect(r.text).toContain('property="og:title" content="A &lt;script&gt;alert(1)&lt;/script&gt; &quot;q&quot; &amp; co"');
    expect(r.text).toContain('content="x&quot;&gt;&lt;b&gt;"');
    expect(r.text).not.toContain('<script>alert(1)');
    expect(r.text).toContain('property="og:image" content="https://learn.fullsteamahead.ca/explained-media/test-mini-live/v1/og.png"');
    expect(r.text).toContain('property="og:url" content="https://learn.fullsteamahead.ca/explained/test-mini-live"');
    expect(r.text).toContain('property="og:type" content="article"');
    expect(r.text).toContain('name="twitter:card" content="summary_large_image"');
    expect(r.text).toContain('<meta name="robots" content="noindex">');
  });
  test('no og image: default image', async () => {
    const r = await get('/explained/test-mini-noimg');
    expect(r.text).toContain('property="og:image" content="https://learn.fullsteamahead.ca/pwa-512.png"');
  });
  test('pending + preview token: real tags, image carries token, og:url has none', async () => {
    const r = await get(`/explained/test-mini-pend?preview=${pendToken}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('property="og:title" content="T test-mini-pend"');
    expect(r.text).toContain(`/explained-media/test-mini-pend/v1/og.png?preview=${pendToken}`.replace('?', '?'));
    expect(r.text).toContain('property="og:url" content="https://learn.fullsteamahead.ca/explained/test-mini-pend"');
    expect(r.headers['cache-control']).toMatch(/no-store/);
  });
  test('pending without token, unknown slug, invalid slug: noindex only', async () => {
    for (const p of ['/explained/test-mini-pend', '/explained/test-mini-nope', '/explained/2B3-1-7', '/explained/..%2f..%2fx']) {
      const r = await get(p);
      expect(r.status).toBe(200);
      expect(r.text).toContain('<meta name="robots" content="noindex">');
      expect(r.text).not.toContain('og:title');
    }
  });
});
