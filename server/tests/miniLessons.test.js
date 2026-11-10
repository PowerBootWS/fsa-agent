const { pool } = require('./testPool');
const ml = require('../src/services/miniLessons');

const SLUG = 'test-mini-a';
const slides = (t) => [
  { slide_number: 2, chunk_type: 'content', title: `${t} two`, body: 'b2', narration: 'n2', audio_url: null, image_url: null, narration_timing: null },
  { slide_number: 1, chunk_type: 'intro', title: `${t} one`, body: 'b1', narration: 'n1', audio_url: null, image_url: null, narration_timing: [{ w: 'x' }] },
];
const payload = (t, over = {}) => ({
  slug: SLUG, title: t, description: 'd', paper_code: '2B3', source_lesson_code: '2B3-1-7',
  source_label: 'src', request_text: 'req', og_image_url: null, slides: slides(t),
  questions: [{ position: 1, question_text: 'q?', step_data: { steps: [] }, explanation: 'e' }], ...over,
});

async function clean() {
  await pool.query(`DELETE FROM mini_lessons WHERE slug LIKE 'test-mini-%'`);
}
beforeEach(clean);
afterAll(async () => { await clean(); await pool.end(); });

test('upsertDraft new slug is pending v1 with 64-hex token', async () => {
  const r = await ml.upsertDraft(payload('v1'));
  expect(r).toMatchObject({ slug: SLUG, status: 'pending', version: 1 });
  expect(r.preview_token).toMatch(/^[0-9a-f]{64}$/);
});

test('getPublic pending: null without token, draft with token in slide order', async () => {
  const { preview_token } = await ml.upsertDraft(payload('v1'));
  expect(await ml.getPublic(SLUG, null)).toBeNull();
  expect(await ml.getPublic(SLUG, 'wrong')).toBeNull();
  expect(await ml.getPublic(SLUG, '')).toBeNull();
  const p = await ml.getPublic(SLUG, preview_token);
  expect(p.sections.map(s => s.slide_number)).toEqual([1, 2]);
  expect(p.sections[0].narration_timing).toEqual([{ w: 'x' }]);
  expect(p.questions[0]).toMatchObject({ position: 1, question_text: 'q?' });
  expect(p.class_code).toBe('second');
});

test('live requires checks_passed', async () => {
  await ml.upsertDraft(payload('v1'));
  await expect(ml.setStatus(SLUG, 'live')).rejects.toBeInstanceOf(ml.TransitionError);
  const r = await ml.setStatus(SLUG, 'live', { checksPassed: true });
  expect(r).toEqual({ slug: SLUG, status: 'live' });
  const p = await ml.getPublic(SLUG, null);
  expect(p.title).toBe('v1');
});

test('rebuild while live keeps serving v1 publicly, v2 with token', async () => {
  await ml.upsertDraft(payload('v1'));
  await ml.setStatus(SLUG, 'live', { checksPassed: true });
  const r2 = await ml.upsertDraft(payload('v2', { title: 'T2' }));
  expect(r2.version).toBe(2);
  expect(r2.status).toBe('pending');
  expect((await ml.getPublic(SLUG, null)).sections[0].title).toBe('v1 one');
  expect((await ml.getPublic(SLUG, r2.preview_token)).sections[0].title).toBe('v2 one');
  await ml.setStatus(SLUG, 'held', { holdReason: 'bad' });
  expect((await ml.getPublic(SLUG, null)).sections[0].title).toBe('v1 one');
  // held draft is never served; the live version keeps serving even with the token
  expect((await ml.getPublic(SLUG, r2.preview_token)).sections[0].title).toBe('v1 one');
});

test('held to live throws; invalid and unknown transitions throw', async () => {
  await ml.upsertDraft(payload('v1'));
  await ml.setStatus(SLUG, 'held', { holdReason: 'x' });
  await expect(ml.setStatus(SLUG, 'live', { checksPassed: true })).rejects.toBeInstanceOf(ml.TransitionError);
  await expect(ml.setStatus('test-mini-nope', 'live', { checksPassed: true })).rejects.toBeInstanceOf(ml.TransitionError);
  const { rows } = await pool.query(`SELECT hold_reason FROM mini_lessons WHERE slug=$1`, [SLUG]);
  expect(rows[0].hold_reason).toBe('x');
});

test('awaiting_approval needs checks, then live', async () => {
  await ml.upsertDraft(payload('v1'));
  await expect(ml.setStatus(SLUG, 'awaiting_approval')).rejects.toBeInstanceOf(ml.TransitionError);
  await ml.setStatus(SLUG, 'awaiting_approval', { checksPassed: true });
  await ml.setStatus(SLUG, 'live');
  expect((await ml.getPublic(SLUG, null)).slug).toBe(SLUG);
});

test('class_code mapping', async () => {
  for (const [paper, cc] of [['2B3', 'second'], ['3A1', 'third'], ['4A', 'fourth_a'], ['4B', 'fourth_b']]) {
    const { preview_token } = await ml.upsertDraft(payload('v', { paper_code: paper }));
    expect((await ml.getPublic(SLUG, preview_token)).class_code).toBe(cc);
  }
});

test('list', async () => {
  await ml.upsertDraft(payload('v1'));
  const l = (await ml.list()).find(r => r.slug === SLUG);
  expect(l).toMatchObject({ title: 'v1', paper_code: '2B3', source_lesson_code: '2B3-1-7', status: 'pending' });
  expect(l.updated_at).toBeTruthy();
});
