// Mini lessons: free public lessons at /explained/<slug>.
// Public reads serve live_version to anyone, and draft_version only with the
// preview token while the row is pending/awaiting_approval. A rebuild of a live
// slug writes a new draft version and never disturbs live_version.
const crypto = require('crypto');
const { pool } = require('./database');

class TransitionError extends Error {
  constructor(message) { super(message); this.name = 'TransitionError'; }
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
  if (previewToken && ['pending', 'awaiting_approval'].includes(ml.status)
      && typeof previewToken === 'string' && previewToken.length === ml.preview_token.length
      && crypto.timingSafeEqual(Buffer.from(previewToken), Buffer.from(ml.preview_token))) {
    version = ml.draft_version;
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
  return {
    slug: ml.slug, title: ml.title, description: ml.description,
    paper_code: ml.paper_code, class_code: classCodeFor(ml.paper_code),
    source_label: ml.source_label, og_image_url: ml.og_image_url,
    sections, questions,
  };
}

async function upsertDraft(p) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const token = crypto.randomBytes(32).toString('hex');
    const { rows: [ml] } = await client.query(
      `INSERT INTO mini_lessons (slug, title, description, paper_code, source_lesson_code, source_label,
                                 request_text, og_image_url, preview_token, version, draft_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,NULL)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description, paper_code = EXCLUDED.paper_code,
         source_lesson_code = EXCLUDED.source_lesson_code, source_label = EXCLUDED.source_label,
         request_text = EXCLUDED.request_text, og_image_url = EXCLUDED.og_image_url,
         status = 'pending', checks_passed = false, hold_reason = NULL, updated_at = now()
       RETURNING id, slug, status, preview_token`,
      [p.slug, p.title, p.description, p.paper_code, p.source_lesson_code || null, p.source_label,
       p.request_text, p.og_image_url || null, token]);
    const { rows: [{ version }] } = await client.query(
      `SELECT GREATEST(
         COALESCE((SELECT MAX(version) FROM mini_lesson_slides WHERE mini_lesson_id = $1), 0),
         COALESCE((SELECT MAX(version) FROM mini_lesson_questions WHERE mini_lesson_id = $1), 0)) + 1 AS version`,
      [ml.id]);
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
    if (!ml) throw new TransitionError(`unknown slug ${slug}`);
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
    `SELECT slug, title, paper_code, source_lesson_code, status, updated_at
       FROM mini_lessons ORDER BY updated_at DESC`);
  return rows;
}

module.exports = { getPublic, upsertDraft, setStatus, list, TransitionError, classCodeFor };
