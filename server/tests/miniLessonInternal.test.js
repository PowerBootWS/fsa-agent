process.env.MINI_LESSON_PUBLISH_TOKEN = 'test-publish-token';
const request = require('supertest');
const { pool } = require('./testPool');
const app = require('../src/index');

const LEARN = 'learn.fullsteamahead.ca';
const TOKEN = 'test-publish-token';
const SLUG = 'test-mini-int';
const BASE = '/api/internal/mini-lessons';

const step = () => ({ type: 'mcq', context: 'c', question: 'q', options: ['a', 'b', 'c'], correct: 1, explanation: 'e' });
const payload = (over = {}) => ({
  slug: SLUG, title: 'T', description: 'd', paper_code: '2B3', source_lesson_code: '2B3-1-7',
  source_label: 'src', request_text: 'req', og_image_url: null,
  slides: [{ slide_number: 1, chunk_type: 'intro', title: 's', body: 'b', narration: 'n',
    audio_url: `/explained-media/${SLUG}/v3/slide-001.mp3`, image_url: `/explained-media/${SLUG}/v3/slide-001.png`, narration_timing: null }],
  questions: [{ position: 1, question_text: 'q?', step_data: { steps: [step()] }, explanation: 'e' }],
  ...over,
});
const put = (body, slug = SLUG) => request(app).put(`${BASE}/${slug}`).set('Host', LEARN).set('x-mini-lesson-token', TOKEN).send(body);
const status = (to, extra = {}, slug = SLUG) =>
  request(app).post(`${BASE}/${slug}/status`).set('Host', LEARN).set('x-mini-lesson-token', TOKEN).send({ to, ...extra });

async function clean() { await pool.query(`DELETE FROM mini_lessons WHERE slug LIKE 'test-mini-%'`); }
beforeEach(clean);
afterAll(async () => { await clean(); await pool.end(); await require('../src/services/database').pool.end(); });

describe('auth', () => {
  test('no header -> 401', async () => {
    expect((await request(app).get(BASE).set('Host', LEARN)).status).toBe(401);
  });
  test('wrong token -> 401', async () => {
    expect((await request(app).get(BASE).set('Host', LEARN).set('x-mini-lesson-token', 'nope')).status).toBe(401);
  });
  test('env unset -> 401 even with empty header', async () => {
    delete process.env.MINI_LESSON_PUBLISH_TOKEN;
    try {
      expect((await request(app).get(BASE).set('Host', LEARN).set('x-mini-lesson-token', '')).status).toBe(401);
      expect((await request(app).get(BASE).set('Host', LEARN)).status).toBe(401);
    } finally { process.env.MINI_LESSON_PUBLISH_TOKEN = TOKEN; }
  });
  test('GET with token lists', async () => {
    const r = await request(app).get(BASE).set('Host', LEARN).set('x-mini-lesson-token', TOKEN);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });
  test('PUT/POST without token -> 401', async () => {
    expect((await request(app).put(`${BASE}/${SLUG}`).set('Host', LEARN).send(payload())).status).toBe(401);
    expect((await request(app).post(`${BASE}/${SLUG}/status`).set('Host', LEARN).send({ to: 'live' })).status).toBe(401);
  });
});

describe('validation -> 400', () => {
  const bad = {
    'empty slides': { slides: [] },
    'question with <2 options': { questions: [{ position: 1, question_text: 'q', step_data: { steps: [{ ...step(), options: ['a'] }] } }] },
    'correct out of range': { questions: [{ position: 1, question_text: 'q', step_data: { steps: [{ ...step(), correct: 3 }] } }] },
    'empty steps': { questions: [{ position: 1, question_text: 'q', step_data: { steps: [] } }] },
    'unknown paper': { paper_code: '9Z9' },
    'bad slug': { slug: 'Bad_Slug' },
    'em dash in title': { title: 'a — b' },
    'em dash in narration': { slides: [{ slide_number: 1, title: 's', body: 'b', narration: 'x — y' }] },
    'em dash in step explanation': { questions: [{ position: 1, question_text: 'q', step_data: { steps: [{ ...step(), explanation: 'a—b' }] } }] },
    'paid media path': { slides: [{ slide_number: 1, title: 's', body: 'b', audio_url: '/media/2B3-1-7/slide-001.mp3' }] },
    'other slug media': { slides: [{ slide_number: 1, title: 's', body: 'b', image_url: '/explained-media/other/v1/slide-001.png' }] },
  };
  for (const [name, over] of Object.entries(bad)) {
    test(name, async () => {
      const slug = over.slug || SLUG;
      const r = await put(payload(over), slug);
      expect(r.status).toBe(400);
      expect(Array.isArray(r.body.details)).toBe(true);
      expect(r.body.details.length).toBeGreaterThan(0);
    });
  }
  test('path/body slug mismatch -> 400', async () => {
    expect((await put(payload({ slug: 'test-mini-other' }))).status).toBe(400);
  });
  test('nothing written on 400', async () => {
    await put(payload({ slides: [] }));
    const { rows } = await pool.query(`SELECT 1 FROM mini_lessons WHERE slug = $1`, [SLUG]);
    expect(rows.length).toBe(0);
  });
});

describe('publish flow', () => {
  test('valid PUT -> 200 pending v1 with token', async () => {
    const r = await put(payload());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ slug: SLUG, status: 'pending', version: 1 });
    expect(r.body.preview_token).toMatch(/^[0-9a-f]{64}$/);
  });
  test('~2 MB payload accepted', async () => {
    const timing = Array.from({ length: 20000 }, (_, i) => ({ w: 'word' + i, s: i / 10, e: i / 10 + 0.1, pad: 'x'.repeat(60) }));
    const p = payload();
    p.slides[0].narration_timing = timing;
    expect(JSON.stringify(p).length).toBeGreaterThan(1.8e6);
    expect((await put(p)).status).toBe(200);
  });
  test('unknown slug status -> 404', async () => {
    expect((await status('live', { checks_passed: true }, 'test-mini-nope')).status).toBe(404);
  });
  test('pending -> live without checks -> 409', async () => {
    await put(payload());
    const r = await status('live');
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('transition not allowed');
  });
  test('pending -> live with checks_passed -> 200', async () => {
    await put(payload());
    const r = await status('live', { checks_passed: true });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ slug: SLUG, status: 'live' });
  });
  test('held -> live -> 409', async () => {
    await put(payload());
    expect((await status('held', { hold_reason: 'bad' })).status).toBe(200);
    expect((await status('live', { checks_passed: true })).status).toBe(409);
  });
  test('invalid target status -> 400', async () => {
    await put(payload());
    expect((await status('bogus')).status).toBe(400);
  });
  test('rebuild of live slug -> pending, live_version unchanged', async () => {
    await put(payload());
    await status('live', { checks_passed: true });
    const r = await put(payload({ title: 'T2' }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'pending', version: 2 });
    const { rows: [m] } = await pool.query(`SELECT status, live_version, draft_version FROM mini_lessons WHERE slug = $1`, [SLUG]);
    expect(m).toEqual({ status: 'pending', live_version: 1, draft_version: 2 });
  });
});
