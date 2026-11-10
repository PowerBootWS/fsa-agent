#!/usr/bin/env node
/**
 * Turn each student's saved latest practice exam (exam_last_debrief) into one
 * fully reviewable `source='pre_history'` assessment_attempts row.
 * Plan: docs/superpowers/plans/2026-11-08-practice-attempt-history.md §7
 * (Russ, 2026-11-10: debrief rows only, no time-gap backfill).
 *
 * The debrief's question_review is the only record of those questions as they
 * were shown. The answers themselves already exist in question_responses, so
 * nothing new is inserted there: the script finds the exam's own rows (the
 * student's last N practice_exam answers for that paper up to the debrief time,
 * N = number of reviewed questions) and links them to the attempt, with the
 * debrief's snapshot. A debrief is only linked when every one of those N rows
 * matches its review item (same correct flag, same selected option where both
 * are known). Anything else is skipped and reported, never guessed.
 *
 * Skipped: debriefs with no question_review (pre-2026 format), users/papers
 * that already have a pre_history attempt (re-runs), and debriefs already
 * covered by a live attempt.
 *
 * Dry run by default; nothing is written without --write. POSTGRES_DB has no
 * default on purpose. Scratch first:
 *   POSTGRES_DB=fsa_agent_scratch POSTGRES_HOST=localhost POSTGRES_PORT=5434 \
 *   POSTGRES_PASSWORD=... node scripts/backfill_debrief_attempts.js [--write]
 *
 * Revert:
 *   UPDATE question_responses SET attempt_id = NULL, position = NULL, question_snapshot = NULL
 *    WHERE attempt_id IN (SELECT id FROM assessment_attempts WHERE source = 'pre_history');
 *   DELETE FROM assessment_attempts WHERE source = 'pre_history';
 */
const { Pool } = require('pg');

const WRITE = process.argv.includes('--write');
if (!process.env.POSTGRES_DB) {
  console.error('POSTGRES_DB must be set explicitly (fsa_agent_scratch first).');
  process.exit(2);
}

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5434,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
});

function chapterStatsFrom(lines) {
  const out = {};
  for (const l of lines || []) {
    if (l && l.chapter) out[l.chapter] = { correct: l.correct, total: l.total };
  }
  return out;
}

function aligned(rows, review) {
  if (rows.length !== review.length) return false;
  return rows.every((r, i) => {
    const q = review[i];
    if (Boolean(r.correct) !== Boolean(q.correct)) return false;
    const a = r.selected_index, b = q.selected_index;
    return a === null || a === undefined || b === null || b === undefined || Number(a) === Number(b);
  });
}

async function processDebrief(client, d) {
  const du = d.debrief && d.debrief.display_update;
  const review = du && Array.isArray(du.question_review) ? du.question_review : [];
  if (!review.length) return 'no_review';

  const { rows: existing } = await client.query(
    `SELECT 1 FROM assessment_attempts
      WHERE user_email = $1 AND course_id = $2 AND kind = 'practice_exam'
        AND (source = 'pre_history' OR finished_at >= $3::timestamptz - interval '10 minutes')
      LIMIT 1`,
    [d.user_email, d.course_id, d.updated_at]);
  if (existing.length) return 'already_has_attempt';

  // The exam's own answers: last N for this paper up to the debrief. No slack
  // after it: the debrief is saved after the final answer in the same turn,
  // and a stray answer seconds later (a new sitting) broke alignment when a
  // one-minute slack was tried on scratch.
  const { rows: desc } = await client.query(
    `SELECT id, question_id, chapter_id, correct, selected_index, answered_at, attempt_id
       FROM question_responses
      WHERE user_email = $1 AND course_id = $2 AND session_type = 'practice_exam'
        AND answered_at <= $3::timestamptz
      ORDER BY answered_at DESC, id DESC
      LIMIT $4`,
    [d.user_email, d.course_id, d.updated_at, review.length]);
  const rows = desc.reverse();
  if (rows.some(r => r.attempt_id !== null)) return 'rows_already_linked';
  if (!aligned(rows, review)) return 'not_aligned';

  const score = Number.isInteger(du.score) ? du.score : review.filter(q => q.correct).length;
  const total = Number.isInteger(du.total) ? du.total : review.length;
  const pct = Number.isInteger(du.score_pct) ? du.score_pct : (total ? Math.floor(score * 100 / total) : 0);

  if (!WRITE) return 'would_link';

  await client.query('BEGIN');
  try {
    const { rows: [att] } = await client.query(
      `INSERT INTO assessment_attempts
         (user_email, course_id, kind, started_at, finished_at, question_count,
          score, score_pct, chapter_stats, source)
       VALUES ($1, $2, 'practice_exam',
               (SELECT min(answered_at) FROM question_responses WHERE id = ANY($3::int[])),
               $4, $5, $6, $7, $8, 'pre_history')
       RETURNING id`,
      [d.user_email, d.course_id, rows.map(r => r.id), d.updated_at, total,
       score, pct, JSON.stringify(chapterStatsFrom(du.chapter_stats))]);
    for (let i = 0; i < rows.length; i++) {
      const q = review[i];
      const snapshot = {
        question_text: q.question_text || '',
        options: q.options || [],
        correct_index: q.correct_index,
        explanation: q.explanation || '',
        chapter_id: rows[i].chapter_id,
      };
      const res = await client.query(
        `UPDATE question_responses SET attempt_id = $1, position = $2, question_snapshot = $3
          WHERE id = $4 AND attempt_id IS NULL`,
        [att.id, i + 1, JSON.stringify(snapshot), rows[i].id]);
      if (res.rowCount !== 1) throw new Error(`response ${rows[i].id} changed underneath`);
    }
    await client.query('COMMIT');
    return 'linked';
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function main() {
  const client = await pool.connect();
  // question_responses.answered_at is a timestamp WITHOUT time zone written
  // as America/Edmonton wall time (ai-service PGTZ, and fsa_agent's database
  // TimeZone setting). Compare it to the debrief's timestamptz in that same
  // zone. fsa_agent_scratch has no per-database TimeZone and defaults to UTC,
  // which shifted the cut-off by 6-7 hours and pulled in the next sitting.
  await client.query("SET TIME ZONE 'America/Edmonton'");
  const counts = {};
  const notes = [];
  try {
    const { rows: debriefs } = await client.query(
      `SELECT user_email, course_id, debrief, updated_at FROM exam_last_debrief
        ORDER BY updated_at`);
    for (const d of debriefs) {
      const outcome = await processDebrief(client, d);
      counts[outcome] = (counts[outcome] || 0) + 1;
      if (outcome !== 'linked' && outcome !== 'would_link') {
        notes.push(`${outcome.padEnd(20)} ${d.course_id.padEnd(4)} ${d.updated_at.toISOString()} ${d.user_email}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`${WRITE ? 'WRITE' : 'DRY RUN'} on ${process.env.POSTGRES_DB}`);
  for (const n of notes) console.log('  ' + n);
  console.log(counts);
}

main().catch(e => { console.error(e); process.exit(1); });
