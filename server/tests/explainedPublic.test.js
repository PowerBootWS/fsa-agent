process.env.USER_UPLOADS_DIR = process.env.USER_UPLOADS_DIR || '/tmp/fsa-test-user-uploads';
process.env.PRACTICE_EXAM_TOKEN_SECRET = process.env.PRACTICE_EXAM_TOKEN_SECRET || 'test-secret';
const fs = require('fs');
const os = require('os');
const path = require('path');

// MEDIA_DIR / MINI_MEDIA_DIR are read at module load in src/index.js.
const COURSE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fsa-media-test-'));
const MINI_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fsa-mini-media-test-'));
process.env.MEDIA_DIR = COURSE_DIR;
process.env.MINI_MEDIA_DIR = MINI_DIR;
fs.mkdirSync(path.join(COURSE_DIR, '2B3-1-7'), { recursive: true });
fs.writeFileSync(path.join(COURSE_DIR, '2B3-1-7', 'slide-001.mp3'), 'PAID COURSE AUDIO');
for (const s of ['test-mini-live', 'test-mini-pend']) {
  fs.mkdirSync(path.join(MINI_DIR, s, 'v1'), { recursive: true });
  fs.writeFileSync(path.join(MINI_DIR, s, 'v1', 'slide-001.mp3'), 'mini audio ' + s);
  fs.writeFileSync(path.join(MINI_DIR, s, 'v1', 'og.png'), 'mini og ' + s);
}
fs.mkdirSync(path.join(MINI_DIR, 'test-mini-live', 'v2'), { recursive: true });
fs.writeFileSync(path.join(MINI_DIR, 'test-mini-live', 'v2', 'slide-001.mp3'), 'DRAFT v2 audio');

const request = require('supertest');
const { pool } = require('./testPool');
const app = require('../src/index');
const ml = require('../src/services/miniLessons');

const LEARN = 'learn.fullsteamahead.ca';
const get = (p) => request(app).get(p).set('Host', LEARN);

const payload = (slug, over = {}, v = 1) => ({
  slug, title: 'T ' + slug, description: 'd', paper_code: '2B3', source_lesson_code: '2B3-1-7',
  source_label: 'src', request_text: 'req', og_image_url: `/explained-media/${slug}/v${v}/og.png`,
  slides: [{ slide_number: 1, chunk_type: 'intro', title: 's1', body: 'b', narration: 'n',
    audio_url: `/explained-media/${slug}/v${v}/slide-001.mp3`, image_url: null, narration_timing: null }],
  questions: [{ position: 1, question_text: 'q?', step_data: { steps: [] }, explanation: 'e' }],
  ...over,
});

let pendToken, otherToken, ownedChunk = false;
beforeAll(async () => {
  await pool.query(`DELETE FROM mini_lessons WHERE slug LIKE 'test-mini-%'`);
  await ml.upsertDraft(payload('test-mini-live'));
  await ml.setStatus('test-mini-live', 'live', { checksPassed: true });
  pendToken = (await ml.upsertDraft(payload('test-mini-pend'))).preview_token;
  otherToken = (await ml.upsertDraft(payload('test-mini-other'))).preview_token;
  const { rows } = await pool.query(`SELECT 1 FROM lesson_chunks WHERE lesson_code='2B3-1-7' LIMIT 1`);
  if (!rows.length) {
    await pool.query(`INSERT INTO lesson_chunks (lesson_code, slide_number, chunk_type, title, body)
      VALUES ('2B3-1-7', 1, 'content', 'paid', 'paid body')`);
    ownedChunk = true;
  }
  const { rows: chk } = await pool.query(`SELECT 1 FROM lesson_chunks WHERE lesson_code='2B3-1-7' LIMIT 1`);
  expect(chk).toHaveLength(1); // paid-content test must not pass vacuously
});
afterAll(async () => {
  await pool.query(`DELETE FROM mini_lessons WHERE slug LIKE 'test-mini-%'`);
  if (ownedChunk) await pool.query(`DELETE FROM lesson_chunks WHERE lesson_code='2B3-1-7' AND title='paid' AND body='paid body'`);
  await pool.end();
  await require('../src/services/database').pool.end();
});

describe('GET /api/explained/:slug', () => {
  test('live slug: 200 with shape, no token needed', async () => {
    const r = await get('/api/explained/test-mini-live');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ slug: 'test-mini-live', title: 'T test-mini-live', class_code: 'second' });
    expect(r.body.sections).toHaveLength(1);
    expect(r.body.questions).toHaveLength(1);
    expect(r.body.sections[0].audio_url).toBe('/explained-media/test-mini-live/v1/slide-001.mp3');
  });
  test('pending: 404 no token / empty / other slug token; 200 with right token', async () => {
    expect((await get('/api/explained/test-mini-pend')).status).toBe(404);
    expect((await get('/api/explained/test-mini-pend?preview=')).status).toBe(404);
    expect((await get(`/api/explained/test-mini-pend?preview=${otherToken}`)).status).toBe(404);
    expect((await get('/api/explained/test-mini-pend?preview=wrong')).status).toBe(404);
    const r = await get(`/api/explained/test-mini-pend?preview=${pendToken}`);
    expect(r.status).toBe(200);
    expect(r.body.slug).toBe('test-mini-pend');
  });
  test('draft response appends ?preview=<token> to audio/image/og urls', async () => {
    const r = await get(`/api/explained/test-mini-pend?preview=${pendToken}`);
    expect(r.body.sections[0].audio_url).toBe(`/explained-media/test-mini-pend/v1/slide-001.mp3?preview=${pendToken}`);
    expect(r.body.og_image_url).toBe(`/explained-media/test-mini-pend/v1/og.png?preview=${pendToken}`);
    expect(r.body.sections[0].image_url).toBeNull();
  });
  test('live response never gets a preview suffix even if a token is supplied', async () => {
    const r = await get(`/api/explained/test-mini-live?preview=${pendToken}`);
    expect(r.status).toBe(200);
    expect(r.body.sections[0].audio_url).toBe('/explained-media/test-mini-live/v1/slide-001.mp3');
  });
  test('course lesson code is 404 even with a lesson_chunks row', async () => {
    expect((await get('/api/explained/2B3-1-7')).status).toBe(404);
    expect((await get('/api/explained/2b3-1-7')).status).toBe(404);
    expect((await get('/api/explained/..%2f2B3-1-7')).status).toBe(404);
    expect((await get('/api/explained/%2e%2e')).status).toBe(404);
  });
  test('404 body', async () => {
    expect((await get('/api/explained/nope')).body).toEqual({ error: 'Not found' });
  });
});

describe('GET /explained-media/:slug/:file', () => {
  test('live slug media: 200, public cache header', async () => {
    const r = await get('/explained-media/test-mini-live/v1/slide-001.mp3');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=3600');
  });
  test('traversal and course codes: 404', async () => {
    for (const p of [
      '/explained-media/..%2f2B3-1-7/v1/slide-001.mp3',
      '/explained-media/test-mini-live/v1/..%2f..%2f..%2f2B3-1-7%2fslide-001.mp3',
      '/explained-media/test-mini-live/..%2f2B3-1-7/slide-001.mp3',
      '/explained-media/%2e%2e/v1/slide-001.mp3',
      '/explained-media/2B3-1-7/v1/slide-001.mp3',
      '/explained-media/test-mini-live/slide-001.mp3',
      '/explained-media/test-mini-live/v01/slide-001.mp3',
      '/explained-media/test-mini-live/v0/slide-001.mp3',
      '/explained-media/2b3-1-7/v1/slide-001.mp3',
      '/explained-media/test-mini-live/v1/secret.txt',
    ]) {
      const r = await get(p);
      expect([p, r.status]).toEqual([p, 404]);
      expect(r.text || '').not.toContain('PAID COURSE AUDIO');
    }
  });
  test('pending media: 404 without/with wrong preview, 200 with right token', async () => {
    expect((await get('/explained-media/test-mini-pend/v1/slide-001.mp3')).status).toBe(404);
    expect((await get('/explained-media/test-mini-pend/v1/slide-001.mp3?preview=')).status).toBe(404);
    expect((await get(`/explained-media/test-mini-pend/v1/slide-001.mp3?preview=${otherToken}`)).status).toBe(404);
    expect((await get(`/explained-media/test-mini-pend/v1/slide-001.mp3?preview=${pendToken}`)).status).toBe(200);
  });
  test('unknown slug and missing file: 404', async () => {
    expect((await get('/explained-media/test-mini-nope/v1/slide-001.mp3')).status).toBe(404);
    expect((await get('/explained-media/test-mini-live/v1/slide-009.mp3')).status).toBe(404);
  });
});

describe('versioned media + cache headers', () => {
  let v2Token;
  beforeAll(async () => {
    v2Token = (await ml.upsertDraft(payload('test-mini-live', { title: 'T2' }, 2))).preview_token;
  });
  test('live v1 still served tokenless with public cache while v2 draft exists', async () => {
    const r = await get('/explained-media/test-mini-live/v1/slide-001.mp3');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=3600');
  });
  test('draft v2 media: 404 without/wrong token; 200 with token and private, no-store', async () => {
    expect((await get('/explained-media/test-mini-live/v2/slide-001.mp3')).status).toBe(404);
    expect((await get(`/explained-media/test-mini-live/v2/slide-001.mp3?preview=${otherToken}`)).status).toBe(404);
    const r = await get(`/explained-media/test-mini-live/v2/slide-001.mp3?preview=${v2Token}`);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
  });
  test('v3 (nonexistent version) 404 even with token', async () => {
    expect((await get(`/explained-media/test-mini-live/v3/slide-001.mp3?preview=${v2Token}`)).status).toBe(404);
  });
  test('API: live+differing draft: token gets draft with preview-suffixed v2 urls; tokenless gets live v1 clean', async () => {
    const d = await get(`/api/explained/test-mini-live?preview=${v2Token}`);
    expect(d.body.title).toBe('T2');
    expect(d.body.sections[0].audio_url).toBe(`/explained-media/test-mini-live/v2/slide-001.mp3?preview=${v2Token}`);
    const l = await get('/api/explained/test-mini-live');
    expect(l.body.sections[0].audio_url).toBe('/explained-media/test-mini-live/v1/slide-001.mp3');
    expect(l.body.og_image_url).not.toContain('preview');
  });
  test('pending media via token is private, no-store', async () => {
    const r = await get(`/explained-media/test-mini-pend/v1/slide-001.mp3?preview=${pendToken}`);
    expect(r.headers['cache-control']).toBe('private, no-store');
  });
});
