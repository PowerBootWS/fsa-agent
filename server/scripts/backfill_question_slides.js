#!/usr/bin/env node
/**
 * Backfill `questions.earliest_slide` — backlog #102.
 *
 * Two passes, both idempotent and both re-runnable:
 *   deterministic  match the question's `topic` against slide section titles
 *                  and bodies, TEACHING SLIDES ONLY (see questionSlideMapping.js
 *                  for why that restriction is the whole ballgame)
 *   llm            one offline call per lesson for whatever is left, choosing
 *                  from the lesson's actual section starts
 *
 * Dry run by default. Nothing is written without --write.
 *
 *   node scripts/backfill_question_slides.js --pass=deterministic
 *   node scripts/backfill_question_slides.js --pass=deterministic --write
 *   node scripts/backfill_question_slides.js --pass=llm --limit=20
 *
 * Point it at the scratch copy first:
 *   POSTGRES_DB=fsa_agent_scratch POSTGRES_HOST=localhost POSTGRES_PORT=5434 ...
 *
 * `earliest_slide_source` records which pass placed each row, so a batch can be
 * reverted on its own:
 *   UPDATE questions SET earliest_slide = NULL, earliest_slide_source = NULL
 *    WHERE earliest_slide_source = 'llm';
 */
const { Pool } = require('pg');
const axios = require('axios');
const { placeQuestion, isTeachingSlide } = require('../src/services/questionSlideMapping');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const WRITE = args.includes('--write');
const PASS = flag('pass', 'deterministic');
const LIMIT = Number(flag('limit', 0)) || 0;
const ONLY_LESSON = flag('lesson');
const MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash';

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5434,
  database: process.env.POSTGRES_DB || 'fsa_agent',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
});

async function loadLessons() {
  const { rows } = await pool.query(
    `SELECT q.id, q.lesson_code, q.topic, q.question_text, q.earliest_slide
     FROM questions q
     WHERE q.question_type = 'objective_practice'
       AND q.standalone = true
       ${ONLY_LESSON ? 'AND q.lesson_code = $1' : ''}
     ORDER BY q.lesson_code, q.id`,
    ONLY_LESSON ? [ONLY_LESSON] : []
  );
  const { rows: chunks } = await pool.query(
    `SELECT lesson_code, slide_number, chunk_type, title, body, narration
     FROM lesson_chunks
     ${ONLY_LESSON ? 'WHERE lesson_code = $1' : ''}
     ORDER BY lesson_code, slide_number`,
    ONLY_LESSON ? [ONLY_LESSON] : []
  );

  const slidesByLesson = new Map();
  for (const c of chunks) {
    if (!slidesByLesson.has(c.lesson_code)) slidesByLesson.set(c.lesson_code, []);
    slidesByLesson.get(c.lesson_code).push(c);
  }
  return { questions: rows, slidesByLesson };
}

async function applyPlacement(id, slide, source) {
  if (!WRITE) return;
  await pool.query(
    'UPDATE questions SET earliest_slide = $2, earliest_slide_source = $3 WHERE id = $1',
    [id, slide, source]
  );
}

// ── deterministic ────────────────────────────────────────────────────────────

async function runDeterministic(questions, slidesByLesson) {
  const placed = [];
  const unplaced = [];
  for (const q of questions) {
    if (q.earliest_slide !== null) continue;
    const hit = placeQuestion(q.topic, slidesByLesson.get(q.lesson_code) || []);
    if (!hit) { unplaced.push(q); continue; }
    placed.push({ ...q, slide: hit.slide, titleTokens: hit.matchedTitleTokens });
    await applyPlacement(q.id, hit.slide, 'deterministic');
  }
  return { placed, unplaced };
}

// ── llm ──────────────────────────────────────────────────────────────────────

/** The first slide of each section — the only values the model may choose from. */
function sectionStarts(slides) {
  const starts = [];
  let previous = null;
  for (const s of slides.filter(isTeachingSlide)) {
    const title = (s.title || '').trim();
    if (title && title !== previous) {
      starts.push({ slide: Number(s.slide_number), title });
      previous = title;
    }
  }
  return starts;
}

async function askModel(lessonCode, starts, questions) {
  const sections = starts.map(s => `  slide ${s.slide} — ${s.title}`).join('\n');
  const list = questions
    .map(q => `  ${q.id}: [${q.topic}] ${String(q.question_text).slice(0, 220)}`)
    .join('\n');

  const prompt =
`A Power Engineering lesson (${lessonCode}) is taught as these sections, in order:
${sections}

For each question below, give the slide number of the EARLIEST section that teaches
enough for a student to answer it. A student who has only seen slides before that
number must not be asked the question.

Questions:
${list}

Reply with JSON only: {"<question id>": <slide number>, ...}
Use only slide numbers from the section list. If no section teaches it, use null.`;

  const res = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    { model: MODEL, max_tokens: 500, messages: [{ role: 'user', content: prompt }] },
    { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, timeout: 60000 }
  );
  const text = res.data.choices[0].message.content || '';
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(json);
}

async function runLlm(unplaced, slidesByLesson) {
  const byLesson = new Map();
  for (const q of unplaced) {
    if (!byLesson.has(q.lesson_code)) byLesson.set(q.lesson_code, []);
    byLesson.get(q.lesson_code).push(q);
  }

  const placed = [];
  const rejected = [];
  let lessons = 0;
  for (const [lessonCode, questions] of byLesson) {
    if (LIMIT && lessons >= LIMIT) break;
    lessons += 1;
    const starts = sectionStarts(slidesByLesson.get(lessonCode) || []);
    if (starts.length === 0) continue;

    let answer;
    try {
      answer = await askModel(lessonCode, starts, questions);
    } catch (err) {
      console.error(`  ${lessonCode}: ${err.message}`);
      continue;
    }

    const allowed = new Set(starts.map(s => s.slide));
    for (const q of questions) {
      const slide = answer[String(q.id)];
      // Never trust the number: it must be one of the section starts we offered.
      // Anything else is left NULL, which is unrestricted — today's behaviour.
      if (!Number.isInteger(slide) || !allowed.has(slide)) {
        rejected.push({ ...q, got: slide });
        continue;
      }
      placed.push({ ...q, slide });
      await applyPlacement(q.id, slide, 'llm');
    }
  }
  return { placed, rejected, lessons };
}

// ── report ───────────────────────────────────────────────────────────────────

function sample(rows, n = 12) {
  return rows.slice(0, n).map(r =>
    `  ${r.lesson_code}  slide ${String(r.slide).padStart(3)}  ${r.topic}`).join('\n');
}

(async () => {
  console.log(`database: ${process.env.POSTGRES_DB || 'fsa_agent'}  mode: ${WRITE ? 'WRITE' : 'dry-run'}  pass: ${PASS}`);
  const { questions, slidesByLesson } = await loadLessons();
  console.log(`${questions.length} questions across ${slidesByLesson.size} lessons\n`);

  const { placed, unplaced } = await runDeterministic(questions, slidesByLesson);
  console.log(`deterministic: placed ${placed.length}, left ${unplaced.length}`);
  console.log(sample(placed));

  if (PASS === 'llm' || PASS === 'both') {
    console.log(`\nllm pass over ${new Set(unplaced.map(q => q.lesson_code)).size} lessons...`);
    const r = await runLlm(unplaced, slidesByLesson);
    console.log(`llm: placed ${r.placed.length}, rejected ${r.rejected.length}, lessons ${r.lessons}`);
    console.log(sample(r.placed));
    if (r.rejected.length) {
      console.log(`  rejected (not a section start): ${r.rejected.slice(0, 5).map(x => `${x.id}->${x.got}`).join(', ')}`);
    }
  }

  await pool.end();
})().catch(err => { console.error(err); process.exit(1); });
