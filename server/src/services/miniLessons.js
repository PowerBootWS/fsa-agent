// Mini lessons: free public lessons at /explained/<slug>.
// Public reads serve live_version to anyone, and draft_version only with the
// preview token while the row is pending/awaiting_approval. A rebuild of a live
// slug writes a new draft version and never disturbs live_version.
const crypto = require('crypto');
const { pool } = require('./database');

class TransitionError extends Error {
  constructor(message) { super(message); this.name = 'TransitionError'; }
}

class NotFoundError extends Error {
  constructor(message) { super(message); this.name = 'NotFoundError'; }
}

// Hash both sides so lengths always match (byte length != string length for non-ASCII).
function tokenMatches(given, actual) {
  const h = (x) => crypto.createHash('sha256').update(x).digest();
  return crypto.timingSafeEqual(h(given), h(actual));
}

const ALLOWED = {
  pending: ['live', 'awaiting_approval', 'held'],
  awaiting_approval: ['live', 'held'],
  live: [],
  held: [],
};

function classCodeFor(paper) {
  const p = String(paper || '').toUpperCase();
  if (p === '4A') return 'fourth_a';
  if (p === '4B') return 'fourth_b';
  if (p.startsWith('3')) return 'third';
  return 'second';
}

async function getPublic(slug, previewToken) {
  const { rows: [ml] } = await pool.query('SELECT * FROM mini_lessons WHERE slug = $1', [slug]);
  if (!ml) return null;
  let version = null;
  let isDraft = false;
  if (previewToken && ['pending', 'awaiting_approval'].includes(ml.status)
      && typeof previewToken === 'string' && tokenMatches(previewToken, ml.preview_token)) {
    version = ml.draft_version;
    isDraft = true;
  } else if (ml.live_version != null) {
    version = ml.live_version;
  }
  if (version == null) return null;
  const { rows: sections } = await pool.query(
    `SELECT slide_number, chunk_type, title, body, narration, audio_url, image_url, narration_timing
       FROM mini_lesson_slides WHERE mini_lesson_id = $1 AND version = $2 ORDER BY slide_number`,
    [ml.id, version]);
  const { rows: questions } = await pool.query(
    `SELECT position, question_text, step_data
       FROM mini_lesson_questions WHERE mini_lesson_id = $1 AND version = $2 ORDER BY position`,
    [ml.id, version]);
  const { rows: [meta] } = await pool.query(
    `SELECT title, description, source_label, og_image_url FROM mini_lesson_versions
      WHERE mini_lesson_id = $1 AND version = $2`, [ml.id, version]);
  if (!meta) return null;
  return {
    slug: ml.slug, title: meta.title, description: meta.description,
    paper_code: ml.paper_code, class_code: classCodeFor(ml.paper_code),
    source_label: meta.source_label, og_image_url: meta.og_image_url,
    sections, questions, version, is_draft: isDraft,
  };
}

// One cheap query: may this (slug, version) media be served to this requester?
async function mediaAccess(slug, version, previewToken) {
  if (!Number.isInteger(version)) return false;
  const { rows: [ml] } = await pool.query(
    'SELECT status, live_version, draft_version, preview_token FROM mini_lessons WHERE slug = $1', [slug]);
  if (!ml) return false;
  if (ml.live_version != null && version === ml.live_version) return true;
  return !!(previewToken && typeof previewToken === 'string'
    && ml.draft_version != null && version === ml.draft_version
    && ['pending', 'awaiting_approval'].includes(ml.status)
    && tokenMatches(previewToken, ml.preview_token));
}

async function upsertDraft(p) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const token = crypto.randomBytes(32).toString('hex');
    const { rows: [ml] } = await client.query(
      `INSERT INTO mini_lessons (slug, paper_code, source_lesson_code, preview_token, version)
       VALUES ($1,$2,$3,$4,1)
       ON CONFLICT (slug) DO UPDATE SET
         paper_code = EXCLUDED.paper_code, source_lesson_code = EXCLUDED.source_lesson_code,
         status = 'pending', checks_passed = false, hold_reason = NULL, updated_at = now()
       RETURNING id, slug, status, preview_token`,
      [p.slug, p.paper_code, p.source_lesson_code || null, token]);
    const { rows: [{ version }] } = await client.query(
      `SELECT GREATEST(
         COALESCE((SELECT MAX(version) FROM mini_lesson_slides WHERE mini_lesson_id = $1), 0),
         COALESCE((SELECT MAX(version) FROM mini_lesson_questions WHERE mini_lesson_id = $1), 0),
         COALESCE((SELECT MAX(version) FROM mini_lesson_versions WHERE mini_lesson_id = $1), 0)) + 1 AS version`,
      [ml.id]);
    await client.query(
      `INSERT INTO mini_lesson_versions (mini_lesson_id, version, title, description, source_label, og_image_url, request_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ml.id, version, p.title, p.description, p.source_label, p.og_image_url || null, p.request_text]);
    for (const s of p.slides || []) {
      await client.query(
        `INSERT INTO mini_lesson_slides (mini_lesson_id, version, slide_number, chunk_type, title, body,
                                         narration, audio_url, image_url, narration_timing)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [ml.id, version, s.slide_number, s.chunk_type || null, s.title || null, s.body || null,
         s.narration || null, s.audio_url || null, s.image_url || null,
         s.narration_timing == null ? null : JSON.stringify(s.narration_timing)]);
    }
    for (const q of p.questions || []) {
      await client.query(
        `INSERT INTO mini_lesson_questions (mini_lesson_id, version, position, question_text, step_data, explanation)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [ml.id, version, q.position, q.question_text, JSON.stringify(q.step_data), q.explanation || null]);
    }
    await client.query('UPDATE mini_lessons SET version = $2, draft_version = $2 WHERE id = $1', [ml.id, version]);
    await client.query('COMMIT');
    return { slug: ml.slug, status: ml.status, preview_token: ml.preview_token, version };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function setStatus(slug, to, { holdReason = null, checksPassed } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [ml] } = await client.query('SELECT * FROM mini_lessons WHERE slug = $1 FOR UPDATE', [slug]);
    if (!ml) throw new NotFoundError(`unknown slug ${slug}`);
    if (!(ALLOWED[ml.status] || []).includes(to)) {
      throw new TransitionError(`transition ${ml.status} -> ${to} not allowed`);
    }
    const checks = checksPassed === undefined ? ml.checks_passed : !!checksPassed;
    if ((to === 'live' || to === 'awaiting_approval') && !checks) {
      throw new TransitionError(`${to} requires checks_passed`);
    }
    if (to === 'live') {
      await client.query(
        `UPDATE mini_lessons SET status='live', checks_passed=$2, live_version=draft_version,
                published_at=now(), updated_at=now() WHERE id=$1`, [ml.id, checks]);
    } else if (to === 'held') {
      await client.query(
        `UPDATE mini_lessons SET status='held', checks_passed=$2, hold_reason=$3, updated_at=now() WHERE id=$1`,
        [ml.id, checks, holdReason]);
    } else {
      await client.query(
        `UPDATE mini_lessons SET status=$3, checks_passed=$2, updated_at=now() WHERE id=$1`, [ml.id, checks, to]);
    }
    await client.query('COMMIT');
    return { slug, status: to };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function list() {
  const { rows } = await pool.query(
    `SELECT m.slug, v.title, m.paper_code, m.source_lesson_code, m.status, m.updated_at
       FROM mini_lessons m
       LEFT JOIN mini_lesson_versions v
         ON v.mini_lesson_id = m.id AND v.version = COALESCE(m.live_version, m.draft_version)
      ORDER BY m.updated_at DESC`);
  return rows;
}

module.exports = { getPublic, mediaAccess, upsertDraft, setStatus, list, TransitionError, NotFoundError, classCodeFor };
