/**
 * scripts/mini-lesson-playthrough.js against the REAL client-v2 page.
 *
 * client-v2 is built into a temp dir (vite, ~2 s) and served by a local
 * express app that mounts the real explained API + media routers and the real
 * Open Graph renderer, with the miniLessons service mocked (no database).
 * Media URLs and og:image point at their production form; the script must
 * fetch them from the page's own origin, so nothing here reaches the network.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-play-'));
const MEDIA = path.join(TMP, 'media');
const BUILD = path.join(TMP, 'build');
process.env.MINI_MEDIA_DIR = MEDIA;

jest.mock('../src/services/miniLessons', () => ({
  getPublic: jest.fn(),
  mediaAccess: jest.fn(),
}));
const miniLessons = require('../src/services/miniLessons');
const express = require('express');
const { apiRouter, mediaRouter } = require('../src/routes/explained');
const { renderExplainedHtml } = require('../src/services/explainedOg');
const { playthrough } = require('../scripts/mini-lesson-playthrough');

const SLUG = '2b3-net-reactance-sign';
const TOKEN = 'tok123';
// 1x1 white PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC', 'base64');
const PITCH = `https://fullsteamahead.ca/enroll?class=second&utm_source=mini-lesson&utm_campaign=${SLUG}`;

function lesson(over = {}) {
  const media = (f) => `/explained-media/${SLUG}/v2/${f}`;
  return {
    slug: SLUG, paper_code: '2B3', class_code: 'second', version: 2, is_draft: true,
    title: 'What the Sign of Net Reactance Means', description: 'd', source_label: '2B3, Chapter 1, Objective 7',
    og_image_url: media('og.png'),
    sections: [
      { slide_number: 1, chunk_type: 'principle', title: 'Signs', body: '- Coils oppose\n- $$Q = I^2 X$$',
        narration: 'n', audio_url: media('slide-001.mp3'), image_url: media('slide-001.png'), narration_timing: null },
      { slide_number: 2, chunk_type: 'example', title: 'Net Reactance', body: 'A circuit.\n$$X = 30 - 110 = -80$$',
        narration: 'n', audio_url: media('slide-002.mp3'), image_url: null, narration_timing: null },
    ],
    questions: [
      { position: 1, question_text: 'A circuit has 20 Ω and 60 Ω.', step_data: { steps: [
        { type: 'intermediate', context: 'c', question: 'What is X?', options: ['40 Ω', '-40 Ω', '80 Ω'], correct: 1,
          explanation: 'Following the sign convention, X is $-40\\ \\Omega$.' },
        { type: 'final', context: '', question: 'Which dominates?', options: ['capacitor', 'coil'], correct: 0,
          explanation: 'The capacitor dominates here.' },
      ] } },
      { position: 2, question_text: 'Second.', step_data: { steps: [
        { type: 'final', context: '', question: 'Sign?', options: ['shows type', 'shows size'], correct: 0,
          explanation: 'The sign shows the type of reactance.' },
      ] } },
    ],
    ...over,
  };
}

let server;
let origin;
let current;
let ogTags = true;

beforeAll(async () => {
  execFileSync('npx', ['vite', 'build', '--outDir', BUILD, '--emptyOutDir', '--logLevel', 'error'],
    { cwd: path.join(__dirname, '..', '..', 'client-v2'), stdio: 'pipe' });
  const v = path.join(MEDIA, SLUG, 'v2');
  fs.mkdirSync(v, { recursive: true });
  fs.writeFileSync(path.join(v, 'og.png'), PNG);
  fs.writeFileSync(path.join(v, 'slide-001.png'), PNG);
  fs.writeFileSync(path.join(v, 'slide-001.mp3'), Buffer.alloc(64));
  fs.writeFileSync(path.join(v, 'slide-002.mp3'), Buffer.alloc(64));

  const index = fs.readFileSync(path.join(BUILD, 'index.html'), 'utf8');
  miniLessons.getPublic.mockImplementation(async (slug, token) =>
    (slug === SLUG && token === TOKEN ? JSON.parse(JSON.stringify(current)) : null));
  miniLessons.mediaAccess.mockImplementation(async (slug, version, token) =>
    slug === SLUG && version === 2 && token === TOKEN);

  const app = express();
  app.use('/api/explained', apiRouter);
  app.use('/explained-media', mediaRouter);
  app.get('/explained/:slug', async (req, res) => {
    const l = await miniLessons.getPublic(req.params.slug, req.query.preview);
    if (l) l.og_image_url = `${l.og_image_url}?preview=${req.query.preview}`;
    res.type('html').send(ogTags ? renderExplainedHtml(index, l, 'https://learn.fullsteamahead.ca') : index);
  });
  app.use('/v2', express.static(BUILD));
  app.use(express.static(BUILD));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  origin = `http://127.0.0.1:${server.address().port}`;
}, 120000);

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  fs.rmSync(TMP, { recursive: true, force: true });
});

beforeEach(() => { current = lesson(); ogTags = true; });

const url = () => `${origin}/explained/${SLUG}?preview=${TOKEN}`;

test('a good lesson passes both passes', async () => {
  const r = await playthrough(url(), { expectPitch: PITCH });
  expect(r.failures).toEqual([]);
  expect(r.ok).toBe(true);
}, 90000);

test('wrong pitch link fails', async () => {
  const r = await playthrough(url(), { expectPitch: PITCH.replace('second', 'third') });
  expect(r.ok).toBe(false);
  expect(r.failures.join('\n')).toMatch(/pitch link is .*class=second/);
}, 90000);

test('missing image file fails with a 404 for that slide', async () => {
  current = lesson();
  current.sections[1].image_url = `/explained-media/${SLUG}/v2/slide-002.png`;
  const r = await playthrough(url(), { expectPitch: PITCH });
  expect(r.ok).toBe(false);
  expect(r.failures).toContain('slide 2 image returned 404');
}, 90000);

test('an equation KaTeX cannot render fails', async () => {
  current = lesson();
  current.sections[1].body = 'A circuit.\n$$X = \\frac{30$$';
  const r = await playthrough(url(), { expectPitch: PITCH });
  expect(r.ok).toBe(false);
  expect(r.failures.join('\n')).toMatch(/slide 2 .*equation failed to render/);
}, 90000);

test('raw HTML without Open Graph tags fails', async () => {
  ogTags = false;
  const r = await playthrough(url(), { expectPitch: PITCH });
  expect(r.ok).toBe(false);
  expect(r.failures).toEqual(expect.arrayContaining(['raw HTML has no og:title tag', 'raw HTML has no og:image tag']));
}, 90000);

test('a wrong preview token fails at the API, before any browser work', async () => {
  const r = await playthrough(`${origin}/explained/${SLUG}?preview=nope`, { expectPitch: PITCH });
  expect(r.ok).toBe(false);
  expect(r.failures).toContain('lesson API returned 404');
}, 90000);

test('playthrough pinned to the version it was given', async () => {
  expect((await playthrough(url(), { expectPitch: PITCH, expectVersion: 2 })).failures).toEqual([]);
  const r = await playthrough(url(), { expectPitch: PITCH, expectVersion: 3 });
  expect(r.ok).toBe(false);
  expect(r.failures).toContain('page serves v2 (draft), expected draft v3');
}, 90000);

test('a live (non-draft) version fails a pinned draft check', async () => {
  current = lesson({ is_draft: false });
  const r = await playthrough(url(), { expectPitch: PITCH, expectVersion: 2 });
  expect(r.failures).toContain('page serves v2 (live), expected draft v2');
}, 90000);

test('missing audio fails with a 404 for that slide', async () => {
  current = lesson();
  current.sections[1].audio_url = `/explained-media/${SLUG}/v2/slide-009.mp3`;
  const r = await playthrough(url(), { expectPitch: PITCH });
  expect(r.failures).toContain('slide 2 audio returned 404');
}, 90000);

test('media answered with the wrong content type fails', async () => {
  current = lesson();
  current.sections[0].audio_url = '/v2/index.html';        // an HTML page answering 200
  current.sections[0].image_url = '/v2/index.html';
  const r = await playthrough(url(), { expectPitch: PITCH });
  expect(r.ok).toBe(false);
  expect(r.failures).toEqual(expect.arrayContaining([
    expect.stringMatching(/^slide 1 audio is text\/html, expected audio\/mpeg/),
    expect.stringMatching(/^slide 1 image is text\/html, expected image\/png/),
  ]));
}, 90000);

test('a non-lesson URL is refused', async () => {
  const r = await playthrough(`${origin}/lessons/2B3-1-7`);
  expect(r).toEqual({ ok: false, failures: [`not a mini lesson URL: ${origin}/lessons/2B3-1-7`] });
});
