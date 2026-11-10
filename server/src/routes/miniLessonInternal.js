// Token-guarded internal API the lesson-creator build script uses to upload a
// mini lesson draft and flip its status. Never exposed to browsers.
const crypto = require('crypto');
const express = require('express');
const miniLessons = require('../services/miniLessons');
const { PAPERS_BY_CLASS } = require('../config/papersForClass');

const router = express.Router();

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STATUSES = ['pending', 'awaiting_approval', 'live', 'held'];
const PAPERS = new Set(Object.values(PAPERS_BY_CLASS).flat());

// Hash both sides so the compare is constant-time regardless of length.
function tokenOk(given) {
  const expected = process.env.MINI_LESSON_PUBLISH_TOKEN;
  if (!expected || typeof given !== 'string') return false;
  const h = (x) => crypto.createHash('sha256').update(x).digest();
  return crypto.timingSafeEqual(h(given), h(expected));
}

function requireToken(req, res, next) {
  if (!tokenOk(req.get('x-mini-lesson-token'))) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// The global express.json() (100kb) skips this prefix; payloads carry narration timing.
router.use(requireToken, express.json({ limit: '10mb' }));

const isStr = (v) => typeof v === 'string' && v.trim() !== '';

// Collect every string in a value, for the em-dash rule.
function* strings(v) {
  if (typeof v === 'string') yield v;
  else if (Array.isArray(v)) for (const x of v) yield* strings(x);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) yield* strings(x);
}

function validatePayload(p, slug) {
  const errs = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['body must be an object'];
  if (typeof p.slug !== 'string' || !SLUG_RE.test(p.slug) || p.slug.length > 80) errs.push('slug invalid');
  else if (p.slug !== slug) errs.push('slug does not match path');
  if (!PAPERS.has(p.paper_code)) errs.push('paper_code not in papersForClass');
  for (const f of ['title', 'description', 'source_label', 'request_text']) {
    if (!isStr(p[f])) errs.push(`${f} required`);
  }
  if (!Array.isArray(p.slides) || p.slides.length === 0) errs.push('slides must be a non-empty array');
  else {
    const prefix = `/explained-media/${slug}/v`;
    p.slides.forEach((s, i) => {
      if (!s || typeof s !== 'object') { errs.push(`slides[${i}] must be an object`); return; }
      if (!Number.isInteger(s.slide_number)) errs.push(`slides[${i}].slide_number must be an integer`);
      for (const f of ['audio_url', 'image_url']) {
        if (s[f] != null && !(typeof s[f] === 'string' && s[f].startsWith(prefix) && !s[f].includes('..'))) {
          errs.push(`slides[${i}].${f} must start with ${prefix}`);
        }
      }
    });
  }
  if (p.og_image_url != null && !(typeof p.og_image_url === 'string'
      && p.og_image_url.startsWith(`/explained-media/${slug}/v`) && !p.og_image_url.includes('..'))) {
    errs.push('og_image_url must be under /explained-media/<slug>/v');
  }
  if (!Array.isArray(p.questions) || p.questions.length === 0) errs.push('questions must be a non-empty array');
  else {
    p.questions.forEach((q, i) => {
      if (!q || typeof q !== 'object') { errs.push(`questions[${i}] must be an object`); return; }
      if (!Number.isInteger(q.position)) errs.push(`questions[${i}].position must be an integer`);
      if (!isStr(q.question_text)) errs.push(`questions[${i}].question_text required`);
      const steps = q.step_data && q.step_data.steps;
      if (!Array.isArray(steps) || steps.length === 0) { errs.push(`questions[${i}].step_data.steps must be non-empty`); return; }
      steps.forEach((st, j) => {
        const at = `questions[${i}].step_data.steps[${j}]`;
        if (!st || typeof st !== 'object') { errs.push(`${at} must be an object`); return; }
        if (!Array.isArray(st.options) || st.options.length < 2) errs.push(`${at}.options needs at least 2`);
        else if (!Number.isInteger(st.correct) || st.correct < 0 || st.correct >= st.options.length) {
          errs.push(`${at}.correct out of range`);
        }
      });
    });
  }
  // Russ's voice: no em dashes anywhere in the text.
  for (const s of strings({ ...p, slug: undefined })) {
    if (s.includes('—')) { errs.push('text contains an em dash'); break; }
  }
  return errs;
}

function fail(res, err) {
  if (err instanceof miniLessons.TransitionError) return res.status(409).json({ error: 'transition not allowed', detail: err.message });
  if (err instanceof miniLessons.NotFoundError) return res.status(404).json({ error: 'not found' });
  console.error('mini-lesson internal error:', err);
  return res.status(500).json({ error: 'internal error' });
}

router.get('/', async (req, res) => {
  try { res.json(await miniLessons.list()); } catch (e) { fail(res, e); }
});

router.put('/:slug', async (req, res) => {
  const details = validatePayload(req.body, req.params.slug);
  if (details.length) return res.status(400).json({ error: 'invalid payload', details });
  try { res.json(await miniLessons.upsertDraft(req.body)); } catch (e) { fail(res, e); }
});

router.post('/:slug/status', async (req, res) => {
  const { to, hold_reason: holdReason, checks_passed: checksPassed } = req.body || {};
  if (!STATUSES.includes(to)) return res.status(400).json({ error: 'invalid payload', details: ['to must be one of ' + STATUSES.join(', ')] });
  try {
    res.json(await miniLessons.setStatus(req.params.slug, to, { holdReason: holdReason || null, checksPassed }));
  } catch (e) { fail(res, e); }
});

// Malformed JSON / oversize bodies from this router: JSON error, not an HTML page.
router.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    return res.status(err.status || 400).json({ error: 'invalid payload', details: [err.type] });
  }
  next(err);
});

module.exports = router;
