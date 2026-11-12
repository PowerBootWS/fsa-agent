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
    audio_url: 'slide-001.mp3', image_url: 'slide-001.png', narration_timing: null }],
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
    'encoded traversal media': { slides: [{ slide_number: 1, title: 's', body: 'b', audio_url: `/explained-media/${SLUG}/v1/%2e%2e/x.mp3` }] },
    'full explained url media': { slides: [{ slide_number: 1, title: 's', body: 'b', image_url: `/explained-media/${SLUG}/v1/slide-001.png` }] },
    'bad og': { og_image_url: 'x.png' },
    'step missing question': { questions: [{ position: 1, question_text: 'q', step_data: { steps: [{ ...step(), question: undefined }] } }] },
    'step missing type': { questions: [{ position: 1, question_text: 'q', step_data: { steps: [{ ...step(), type: '' }] } }] },
    'step missing explanation': { questions: [{ position: 1, question_text: 'q', step_data: { steps: [{ ...step(), explanation: undefined }] } }] },
    'step context not string': { questions: [{ position: 1, question_text: 'q', step_data: { steps: [{ ...step(), context: 5 }] } }] },
    'empty option': { questions: [{ position: 1, question_text: 'q', step_data: { steps: [{ ...step(), options: ['a', ''] }] } }] },
    'null option': { questions: [{ position: 1, question_text: 'q', step_data: { steps: [{ ...step(), options: ['a', null] }] } }] },
    'empty question_text': { questions: [{ position: 1, question_text: '', step_data: { steps: [step()] } }] },
    'duplicate slide_number': { slides: [{ slide_number: 1, title: 's', body: 'b' }, { slide_number: 1, title: 't', body: 'b' }] },
    'slide_number too big': { slides: [{ slide_number: 10000, title: 's', body: 'b' }] },
    'duplicate position': { questions: [{ position: 1, question_text: 'q', step_data: { steps: [step()] } }, { position: 1, question_text: 'q', step_data: { steps: [step()] } }] },
    'negative position': { questions: [{ position: -1, question_text: 'q', step_data: { steps: [step()] } }] },
    'bad source_lesson_code': { source_lesson_code: '../etc' },
    'long source_lesson_code': { source_lesson_code: '2B3-1-7-1-1-1-1-1-1-1-1-1' },
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
  test('real source_lesson_codes pass', async () => {
    for (const c of ['2B3-1-7', '3A1-10-2', '4A-3-1', null]) {
      expect((await put(payload({ source_lesson_code: c }))).status).toBe(200);
    }
  });
  test('bare filenames are stored as versioned URLs; rebuild uses v2', async () => {
    const r1 = await put(payload({ og_image_url: 'og.png' }));
    const { rows: s1 } = await pool.query(`SELECT s.audio_url, s.image_url FROM mini_lesson_slides s JOIN mini_lessons m ON m.id = s.mini_lesson_id WHERE m.slug = $1 AND s.version = 1`, [SLUG]);
    expect(s1[0]).toEqual({ audio_url: `/explained-media/${SLUG}/v1/slide-001.mp3`, image_url: `/explained-media/${SLUG}/v1/slide-001.png` });
    const r2 = await put(payload());
    expect(r2.body.version).toBe(r1.body.version + 1);
    const { rows: s2 } = await pool.query(`SELECT s.audio_url FROM mini_lesson_slides s JOIN mini_lessons m ON m.id = s.mini_lesson_id WHERE m.slug = $1 AND s.version = 2`, [SLUG]);
    expect(s2[0].audio_url).toBe(`/explained-media/${SLUG}/v2/slide-001.mp3`);
  });
  test('status checks_passed/hold_reason typing', async () => {
    await put(payload());
    for (const cp of ['false', '0', 'true', 1, null]) {
      expect((await status('live', { checks_passed: cp })).status).toBe(400);
    }
    expect((await status('held', { hold_reason: 5 })).status).toBe(400);
    expect((await status('held', { hold_reason: 'x'.repeat(2001) })).status).toBe(400);
    expect((await status('live', { checks_passed: false, expected_version: 1 })).status).toBe(409);
  });
  test('unknown slug status -> 404', async () => {
    expect((await status('live', { checks_passed: true, expected_version: 1 }, 'test-mini-nope')).status).toBe(404);
  });
  test('pending -> live without checks -> 409', async () => {
    await put(payload());
    const r = await status('live', { expected_version: 1 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('transition not allowed');
  });
  test('pending -> live with checks_passed -> 200', async () => {
    await put(payload());
    const r = await status('live', { checks_passed: true, expected_version: 1 });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ slug: SLUG, status: 'live' });
  });
  test('held -> live -> 409', async () => {
    await put(payload());
    expect((await status('held', { hold_reason: 'bad' })).status).toBe(200);
    expect((await status('live', { checks_passed: true, expected_version: 1 })).status).toBe(409);
  });
  test('invalid target status -> 400', async () => {
    await put(payload());
    expect((await status('bogus')).status).toBe(400);
  });
  test('rebuild of live slug -> pending, live_version unchanged', async () => {
    await put(payload());
    await status('live', { checks_passed: true, expected_version: 1 });
    const r = await put(payload({ title: 'T2' }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'pending', version: 2 });
    const { rows: [m] } = await pool.query(`SELECT status, live_version, draft_version FROM mini_lessons WHERE slug = $1`, [SLUG]);
    expect(m).toEqual({ status: 'pending', live_version: 1, draft_version: 2 });
  });
});

describe('expected version and create-only (final fix 2)', () => {
  test('status live/awaiting_approval without expected_version -> 400; bad type -> 400', async () => {
    await put(payload());
    expect((await status('live', { checks_passed: true })).status).toBe(400);
    expect((await status('awaiting_approval', { checks_passed: true })).status).toBe(400);
    for (const v of ['1', 0, 1.5, null]) {
      expect((await status('live', { checks_passed: true, expected_version: v })).status).toBe(400);
    }
  });
  test('a version other than the current draft -> 409 and nothing changes', async () => {
    await put(payload());
    await put(payload({ title: 'T2' }));                     // a second build uploaded v2
    const r = await status('live', { checks_passed: true, expected_version: 1 });
    expect(r.status).toBe(409);
    expect((await status('held', { hold_reason: 'x', expected_version: 1 })).status).toBe(409);
    const { rows: [m] } = await pool.query(`SELECT status, live_version FROM mini_lessons WHERE slug = $1`, [SLUG]);
    expect(m).toEqual({ status: 'pending', live_version: null });
    expect((await status('live', { checks_passed: true, expected_version: 2 })).status).toBe(200);
  });
  test('create_only PUT on an existing slug -> 409 slug exists, row untouched', async () => {
    expect((await put(payload({ create_only: true }))).status).toBe(200);
    const r = await put(payload({ create_only: true, title: 'Other post' }));
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('slug exists');
    const { rows } = await pool.query(
      `SELECT v.title FROM mini_lesson_versions v JOIN mini_lessons m ON m.id = v.mini_lesson_id WHERE m.slug = $1`, [SLUG]);
    expect(rows.map(x => x.title)).toEqual(['T']);
    expect((await put(payload({ create_only: 'yes' }))).status).toBe(400);
  });
});
