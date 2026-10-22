// Hourly coaching job (backlog #139 phase 2).
//
//   docker exec fsa-agent-api-1 node src/scripts/coaching_due.js
//
// Reads only what is due, never whole histories:
//   1. open commitments whose due_at has passed
//        weekly_sessions (platform)  -> count last week's sessions, leave a note, roll to next week
//        book_exam / exam_date (ask) -> leave a question with answer buttons on Home
//        custom from Russ            -> remind Russ on the coach bot
//   2. new practice-exam results for students with a goal -> a "win" note when it's a
//      personal best or at/above the 65% pass mark (at most one win note a day)
//
// Notes are one-way "From Russ" cards on Home. A question nobody answers within
// 3 days goes out by email from fsa-nurture (study check-in sweep), not here.

const coachBot = require('../services/coachBot');

const PASS_PCT = 65;
const CRM_URL = process.env.CRM_BASE_URL || 'https://crm.fullsteamahead.ca';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function weeklyNote(n, target) {
  if (n >= target) {
    return `${plural(n, 'study session', 'study sessions')} last week, and your target was ${target}. That's exactly how tickets get written. Same again this week.`;
  }
  if (n > 0) {
    return `${n} of your ${target} sessions last week. Closer than it feels. Twenty minutes counts as a session, so see if you can fit in all ${target} this week.`;
  }
  return `Quiet week last week. It happens, especially around nights and overtime. Twenty minutes tonight is a real start, and it counts toward this week's ${target}.`;
}

async function activeStudent(pool, userId) {
  const { rows: [u] } = await pool.query(
    `SELECT pu.id, pu.email, pu.first_name, pu.last_name,
            EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = pu.id AND s.status = 'active'
                      AND s.class_code IN ('second', 'third')) AS active
       FROM platform_users pu WHERE pu.id = $1`, [userId]);
  return u;
}

async function addMessage(pool, { userId, kind, body, answers = null, commitmentId = null, dedupeKey }) {
  const { rowCount } = await pool.query(
    `INSERT INTO coaching_messages (user_id, kind, body, answers, commitment_id, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (dedupe_key) DO NOTHING`,
    [userId, kind, body, answers ? JSON.stringify(answers) : null, commitmentId, dedupeKey]);
  return rowCount > 0;
}

async function handleWeekly(pool, c) {
  // Sessions in the week being reviewed, up to the due time.
  const { rows: [r] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT client_session_id FROM usage_events
        WHERE user_id = $1 AND occurred_at >= $2 AND occurred_at < $3 AND client_session_id IS NOT NULL
        GROUP BY client_session_id HAVING COUNT(*) >= 3) s`,
    [c.user_id, c.meta.week_start || c.created_at, c.due_at]);
  const sessions = r.n;
  const target = Number(c.meta.target) || 3;
  await addMessage(pool, {
    userId: c.user_id, kind: 'weekly', body: weeklyNote(sessions, target), commitmentId: c.id,
    dedupeKey: `weekly:${c.id}`,
  });
  await pool.query(
    `UPDATE coaching_commitments SET status = $2, resolved_at = now(),
            meta = meta || jsonb_build_object('sessions', $3::int) WHERE id = $1`,
    [c.id, sessions >= target ? 'kept' : 'missed', sessions]);
  // Roll on to next week with the student's current target.
  const { rows: [p] } = await pool.query(
    `SELECT weekly_sessions FROM coaching_profiles WHERE user_id = $1 AND goal_set_at IS NOT NULL`, [c.user_id]);
  if (p?.weekly_sessions) {
    await pool.query(
      `INSERT INTO coaching_commitments (user_id, kind, detail, due_at, check_type, source, created_by, meta)
       VALUES ($1, 'weekly_sessions', $2, $3::timestamptz + interval '7 days', 'platform', 'goal_form', 'system',
               jsonb_build_object('target', $4::int, 'week_start', $3::timestamptz - interval '9 hours'))`,
      [c.user_id, `${p.weekly_sessions} study sessions a week`, c.due_at, p.weekly_sessions]);
  }
}

async function handleAsk(pool, c) {
  if (c.meta.asked_at) return; // already waiting on an answer
  const paper = c.meta.paper || (c.detail.match(/\b[234][AB]\d?\b/) || [''])[0];
  let body;
  let answers;
  if (c.kind === 'book_exam') {
    body = `Quick one: have you booked ${paper || 'your exam'} yet?`;
    answers = [{ key: 'yes', label: 'Yes, booked' }, { key: 'not_yet', label: 'Not yet' }];
  } else {
    body = `${paper ? `Your ${paper} exam` : 'Your exam'} was set for ${c.meta.when || 'around now'}. How did it go?`;
    answers = [{ key: 'passed', label: 'I passed' }, { key: 'failed', label: "Didn't pass" }, { key: 'not_yet', label: "Haven't written yet" }];
  }
  await addMessage(pool, {
    userId: c.user_id, kind: 'commitment', body, answers, commitmentId: c.id,
    dedupeKey: `ask:${c.id}:${new Date(c.due_at).toISOString()}`,
  });
  await pool.query(
    `UPDATE coaching_commitments SET meta = meta || jsonb_build_object('asked_at', now()) WHERE id = $1`, [c.id]);
}

async function handleRussReminder(pool, c, u, notify) {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;
  await notify(`Follow up with ${name}: ${c.detail}\n${u.email}\n${CRM_URL}/customer/${u.id}`);
  await pool.query(
    `UPDATE coaching_commitments SET status = 'closed', resolved_at = now(),
            meta = meta || jsonb_build_object('reminded_at', now()) WHERE id = $1`, [c.id]);
}

function weakestChapter(stats = []) {
  const usable = stats.filter(s => Number(s.total) >= 2);
  if (!usable.length) return null;
  const w = usable.reduce((a, b) => (Number(b.pct) < Number(a.pct) ? b : a));
  return String(w.chapter || '').split('-').pop() || null;
}

async function checkWins(pool, now) {
  const { rows } = await pool.query(
    `SELECT p.user_id, p.best_exam_pct, p.wins_checked_at, pu.email
       FROM coaching_profiles p JOIN platform_users pu ON pu.id = p.user_id
      WHERE p.goal_set_at IS NOT NULL`);
  let wins = 0;
  for (const p of rows) {
    const { rows: results } = await pool.query(
      `SELECT course_id, debrief, updated_at FROM exam_last_debrief
        WHERE user_email = $1 AND updated_at > COALESCE($2, '-infinity'::timestamptz)
        ORDER BY updated_at`, [p.email, p.wins_checked_at]);
    const best = { ...(p.best_exam_pct || {}) };
    for (const r of results) {
      const d = r.debrief?.display_update || {};
      const pct = Number(d.score_pct);
      if (!Number.isFinite(pct)) continue;
      const paper = r.course_id;
      const prev = best[paper];
      const personalBest = prev !== undefined && pct > prev;
      best[paper] = prev === undefined ? pct : Math.max(prev, pct);
      if (!personalBest && pct < PASS_PCT) continue;
      const { rows: [recent] } = await pool.query(
        `SELECT 1 FROM coaching_messages WHERE user_id = $1 AND kind = 'win' AND created_at > now() - interval '1 day'`,
        [p.user_id]);
      if (recent) continue;
      const ch = weakestChapter(d.chapter_stats);
      const head = personalBest ? `${pct}% on that ${paper} practice exam, your best yet.` : `${pct}% on that ${paper} practice exam. That's at the pass mark.`;
      const tail = ch ? ` Your weakest chapter was ${ch}, so that's where I'd spend your next session.` : ' Keep that going.';
      if (await addMessage(pool, {
        userId: p.user_id, kind: 'win', body: head + tail,
        dedupeKey: `win:${p.user_id}:${paper}:${new Date(r.updated_at).toISOString()}`,
      })) wins += 1;
    }
    await pool.query(
      `UPDATE coaching_profiles SET best_exam_pct = $2, wins_checked_at = $3 WHERE user_id = $1`,
      [p.user_id, JSON.stringify(best), now]);
  }
  return wins;
}

async function runDue({ pool, now = new Date(), notify = coachBot.notify } = {}) {
  const out = { weekly: 0, asked: 0, reminded: 0, closed: 0, wins: 0, errors: 0 };
  const { rows: due } = await pool.query(
    `SELECT * FROM coaching_commitments WHERE status = 'open' AND due_at <= $1 ORDER BY due_at LIMIT 500`, [now]);
  for (const c of due) {
    try {
      const u = await activeStudent(pool, c.user_id);
      if (c.source === 'russ') {
        await handleRussReminder(pool, c, u, notify);
        out.reminded += 1;
        continue;
      }
      if (!u?.active) {
        await pool.query(
          `UPDATE coaching_commitments SET status = 'closed', resolved_at = now(),
                  meta = meta || '{"closed_by":"no_active_subscription"}'::jsonb WHERE id = $1`, [c.id]);
        out.closed += 1;
        continue;
      }
      if (c.kind === 'weekly_sessions') { await handleWeekly(pool, c); out.weekly += 1; }
      else if (c.check_type === 'ask') { await handleAsk(pool, c); out.asked += 1; }
    } catch (err) {
      out.errors += 1;
      console.error(`[coaching_due] commitment ${c.id} failed:`, err.message);
    }
  }
  try {
    out.wins = await checkWins(pool, now);
  } catch (err) {
    out.errors += 1;
    console.error('[coaching_due] win check failed:', err.message);
  }
  return out;
}

module.exports = { runDue, weeklyNote, weakestChapter, PASS_PCT };

if (require.main === module) {
  const { pool } = require('../services/database');
  runDue({ pool })
    .then(out => { console.log(`[coaching_due] ${new Date().toISOString()} ${JSON.stringify(out)}`); return pool.end(); })
    .catch(err => { console.error('[coaching_due] failed:', err); process.exit(1); });
}
