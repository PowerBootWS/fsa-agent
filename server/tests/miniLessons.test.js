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
afterAll(async () => { await clean(); await pool.end(); await require('../src/services/database').pool.end(); });

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
  await expect(ml.setStatus('test-mini-nope', 'live', { checksPassed: true })).rejects.toBeInstanceOf(ml.NotFoundError);
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

test('rebuild metadata is versioned: live keeps title A, draft token sees B', async () => {
  await ml.upsertDraft(payload('v1', { title: 'A' }));
  await ml.setStatus(SLUG, 'live', { checksPassed: true });
  const r2 = await ml.upsertDraft(payload('v2', { title: 'B', description: 'd2', og_image_url: 'og.png' }));
  expect((await ml.getPublic(SLUG, null)).title).toBe('A');
  expect((await ml.getPublic(SLUG, null)).og_image_url).toBeNull();
  const d = await ml.getPublic(SLUG, r2.preview_token);
  expect(d).toMatchObject({ title: 'B', description: 'd2', og_image_url: '/explained-media/test-mini-a/v2/og.png' });
  expect((await ml.list()).find(r => r.slug === SLUG).title).toBe('A');
});

test('non-ASCII token of 64 chars resolves to null, no throw', async () => {
  await ml.upsertDraft(payload('v1'));
  expect(await ml.getPublic(SLUG, '\u00e9'.repeat(64))).toBeNull();
});

test('mediaAccess: live version anyone; draft only with token; held/superseded/wrong false', async () => {
  const r1 = await ml.upsertDraft(payload('v1'));
  expect(await ml.mediaAccess(SLUG, 1, null)).toBe(false); // pending, no token
  expect(await ml.mediaAccess(SLUG, 1, r1.preview_token)).toBe(true);
  expect(await ml.mediaAccess(SLUG, 1, 'wrong')).toBe(false);
  expect(await ml.mediaAccess(SLUG, 1, '')).toBe(false);
  expect(await ml.mediaAccess('test-mini-nope', 1, r1.preview_token)).toBe(false);
  await ml.setStatus(SLUG, 'live', { checksPassed: true });
  expect(await ml.mediaAccess(SLUG, 1, null)).toBe(true);
  const r2 = await ml.upsertDraft(payload('v2'));
  expect(await ml.mediaAccess(SLUG, 1, null)).toBe(true);   // live stays served
  expect(await ml.mediaAccess(SLUG, 2, null)).toBe(false);
  expect(await ml.mediaAccess(SLUG, 2, 'wrong')).toBe(false);
  expect(await ml.mediaAccess(SLUG, 2, r2.preview_token)).toBe(true);
  expect(await ml.mediaAccess(SLUG, 3, r2.preview_token)).toBe(false);
  await ml.setStatus(SLUG, 'held', { holdReason: 'bad' });
  expect(await ml.mediaAccess(SLUG, 2, r2.preview_token)).toBe(false); // held draft never
  expect(await ml.mediaAccess(SLUG, 1, null)).toBe(true);
  // promote a new draft: old v1 superseded
  const r3 = await ml.upsertDraft(payload('v3'));
  await ml.setStatus(SLUG, 'live', { checksPassed: true });
  expect(await ml.mediaAccess(SLUG, r3.version, null)).toBe(true);
  expect(await ml.mediaAccess(SLUG, 1, null)).toBe(false);
});

test('getPublic reports version and is_draft', async () => {
  const r1 = await ml.upsertDraft(payload('v1'));
  expect(await ml.getPublic(SLUG, r1.preview_token)).toMatchObject({ version: 1, is_draft: true });
  await ml.setStatus(SLUG, 'live', { checksPassed: true });
  expect(await ml.getPublic(SLUG, null)).toMatchObject({ version: 1, is_draft: false });
  const r2 = await ml.upsertDraft(payload('v2'));
  expect(await ml.getPublic(SLUG, r2.preview_token)).toMatchObject({ version: 2, is_draft: true });
  expect(await ml.getPublic(SLUG, 'bad')).toMatchObject({ version: 1, is_draft: false });
});

test('upsertDraft stores media URLs built from the assigned version', async () => {
  const slides = (t) => [{ slide_number: 1, title: t, body: 'b', audio_url: 'slide-001.mp3', image_url: 'slide-001.png' }];
  const r1 = await ml.upsertDraft(payload('v1', { slides: slides('a'), og_image_url: 'og.png' }));
  const p1 = await ml.getPublic(SLUG, r1.preview_token);
  expect(p1.sections[0]).toMatchObject({ audio_url: `/explained-media/${SLUG}/v1/slide-001.mp3`, image_url: `/explained-media/${SLUG}/v1/slide-001.png` });
  expect(p1.og_image_url).toBe(`/explained-media/${SLUG}/v1/og.png`);
  const r2 = await ml.upsertDraft(payload('v2', { slides: slides('b') }));
  const p2 = await ml.getPublic(SLUG, r2.preview_token);
  expect(p2.sections[0].audio_url).toBe(`/explained-media/${SLUG}/v2/slide-001.mp3`);
});

test('setStatus: checksPassed must be strictly true', async () => {
  await ml.upsertDraft(payload('v1'));
  await expect(ml.setStatus(SLUG, 'live', { checksPassed: 'false' })).rejects.toBeInstanceOf(ml.TransitionError);
});
