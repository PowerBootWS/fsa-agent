// Student goals and the commitment memory (backlog #139 phase 2).
// Spec: docs/superpowers/specs/2026-10-22-student-goals-design.md (root repo).
//
// Students are invited, never enrolled. One who says yes sets a goal (paper,
// exam date, shift pattern, where they study, sessions a week). The goal turns
// into dated commitments; the hourly job (scripts/coaching_due.js) follows up
// on the ones that are due with a one-way "From Russ" note on Home.
//
// 2nd and 3rd Class only. 4th Class joins when its full course exists.

const { PAPERS_BY_CLASS } = require('../config/papersForClass');
const coachBot = require('./coachBot');

const TZ = 'America/Edmonton';
const ELIGIBLE_CLASSES = ['second', 'third'];
const SNOOZE_DAYS = 30;
const BOOK_EXAM_FOLLOWUP_DAYS = 14;

const SHIFT_PATTERNS = {
  days: 'Straight days',
  nights: 'Straight nights',
  rotating_12s: 'Rotating 12s',
  four_on_four_off: '4-on/4-off',
  seven_on_seven_off: '7-on/7-off',
  fourteen_on_fourteen_off: '14-on/14-off',
  not_working: 'Not working right now',
  other: 'Something else',
};

const STUDY_PLACES = {
  night_shift: 'Night shift at work',
  home: 'At home',
  breaks: 'Breaks and lunch',
  days_off: 'Days off',
};

const WEEKLY_CHOICES = [2, 3, 4, 5];

function isEligible(user) {
  return Boolean(user && user.status === 'active' && ELIGIBLE_CLASSES.includes(user.class_code));
}

function papersFor(user) {
  return PAPERS_BY_CLASS[user.class_code] || [];
}

// A "session" is one visit with real activity: a client session id with at
// least 3 usage events. Hours can't be measured, so the target is sessions.
async function sessionsSince(pool, userId, since) {
  const { rows: [r] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT client_session_id FROM usage_events
        WHERE user_id = $1 AND occurred_at >= $2 AND client_session_id IS NOT NULL
        GROUP BY client_session_id HAVING COUNT(*) >= 3
     ) s`,
    [userId, since]
  );
  return r.n;
}

async function weekStart(pool) {
  const { rows: [r] } = await pool.query(
    `SELECT (date_trunc('week', now() AT TIME ZONE $1) AT TIME ZONE $1) AS start`, [TZ]);
  return r.start;
}

async function getProfile(pool, userId) {
  const { rows } = await pool.query(
    `SELECT *, to_char(target_date, 'YYYY-MM-DD') AS target_date_iso FROM coaching_profiles WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

function showInvite(profile, now = new Date()) {
  if (!profile) return true;
  if (profile.invite_status === 'pending') return true;
  if (profile.invite_status === 'later') {
    return !profile.invite_snoozed_until || new Date(profile.invite_snoozed_until) <= now;
  }
  return false;
}

function hasGoal(profile) {
  return Boolean(profile && profile.invite_status === 'accepted' && profile.goal_set_at);
}

function publicProfile(p) {
  if (!hasGoal(p)) return null;
  return {
    paper: p.paper,
    target_date: p.target_date_iso,
    date_is_exact: p.date_is_exact,
    exam_booked: p.exam_booked,
    shift_pattern: p.shift_pattern,
    shift_other: p.shift_other,
    study_places: p.study_places,
    weekly_sessions: p.weekly_sessions,
  };
}

async function nextMessage(pool, userId) {
  const { rows } = await pool.query(
    `SELECT id, kind, body, answers, created_at FROM coaching_messages
      WHERE user_id = $1 AND seen_at IS NULL AND expires_at > now()
      ORDER BY (answers IS NOT NULL) DESC, created_at ASC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

/** Everything Home and /goals need, in one call. */
async function getState(pool, user) {
  if (!isEligible(user)) return { eligible: false };
  const profile = await getProfile(pool, user.id);
  const state = {
    eligible: true,
    show_invite: !hasGoal(profile) && showInvite(profile),
    declined: profile?.invite_status === 'declined',
    papers: papersFor(user),
    active_paper: user.active_paper || null,
    options: {
      shift_patterns: SHIFT_PATTERNS,
      study_places: STUDY_PLACES,
      weekly_sessions: WEEKLY_CHOICES,
    },
    goal: publicProfile(profile),
    plan: null,
    message: null,
  };
  if (state.goal) {
    state.plan = {
      sessions_this_week: await sessionsSince(pool, user.id, await weekStart(pool)),
      weekly_target: profile.weekly_sessions,
    };
    state.message = await nextMessage(pool, user.id);
  }
  return state;
}

async function answerInvite(pool, user, answer) {
  if (!['later', 'declined'].includes(answer)) throw Object.assign(new Error('answer must be later or declined'), { status: 400 });
  await pool.query(
    `INSERT INTO coaching_profiles (user_id, invite_status, invite_snoozed_until)
     VALUES ($1, $2, CASE WHEN $2 = 'later' THEN now() + make_interval(days => $3) END)
     ON CONFLICT (user_id) DO UPDATE SET
       invite_status = EXCLUDED.invite_status,
       invite_snoozed_until = EXCLUDED.invite_snoozed_until,
       updated_at = now()
     WHERE coaching_profiles.invite_status <> 'accepted'`,
    [user.id, answer, SNOOZE_DAYS]
  );
}

function badRequest(msg) {
  return Object.assign(new Error(msg), { status: 400 });
}

/** Validate the goal form. Returns a clean object or throws a 400. */
function validateGoal(user, body = {}) {
  const papers = papersFor(user);
  const paper = String(body.paper || '');
  if (!papers.includes(paper)) throw badRequest('Pick one of your papers.');

  const exact = body.date_is_exact === true;
  const raw = String(body.target_date || '');
  let target;
  if (exact) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw badRequest('Pick the exam date.');
    target = raw;
  } else {
    if (!/^\d{4}-\d{2}(-\d{2})?$/.test(raw)) throw badRequest('Pick the month you want to write.');
    target = `${raw.slice(0, 7)}-01`;
  }
  const t = Date.parse(`${target}T12:00:00Z`);
  if (Number.isNaN(t)) throw badRequest('That date does not look right.');
  const today = Date.now();
  const earliest = exact ? today - 86400000 : today - 31 * 86400000;
  if (t < earliest) throw badRequest('Pick a date that is still ahead of you.');
  if (t > today + 2 * 365 * 86400000) throw badRequest('Pick a date within the next two years.');

  const shift = String(body.shift_pattern || '');
  if (!SHIFT_PATTERNS[shift]) throw badRequest('Pick your work schedule.');
  const shiftOther = shift === 'other' ? String(body.shift_other || '').trim().slice(0, 200) : null;
  if (shift === 'other' && !shiftOther) throw badRequest('Tell us a bit about your schedule.');

  const places = Array.isArray(body.study_places) ? [...new Set(body.study_places.map(String))] : [];
  if (places.length === 0 || places.some(p => !STUDY_PLACES[p])) throw badRequest('Pick where you study.');

  const weekly = Number(body.weekly_sessions);
  if (!WEEKLY_CHOICES.includes(weekly)) throw badRequest('Pick how many sessions a week is realistic.');

  return {
    paper, target_date: target, date_is_exact: exact, exam_booked: body.exam_booked === true,
    shift_pattern: shift, shift_other: shiftOther, study_places: places, weekly_sessions: weekly,
  };
}

function whenText(g) {
  const d = new Date(`${g.target_date}T12:00:00Z`);
  if (g.date_is_exact) return d.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  return d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Save the goal and rebuild the commitments it implies. Re-saving replaces the
 * goal-form commitments (closing the old open ones); Russ's own follow-ups are
 * never touched.
 */
async function saveGoal(pool, user, body, { notify = coachBot.notify } = {}) {
  const g = validateGoal(user, body);
  const client = await pool.connect();
  let firstGoal = false;
  try {
    await client.query('BEGIN');
    const { rows: [prev] } = await client.query(
      `SELECT goal_set_at FROM coaching_profiles WHERE user_id = $1 FOR UPDATE`, [user.id]);
    firstGoal = !prev || !prev.goal_set_at;
    await client.query(
      `INSERT INTO coaching_profiles (user_id, invite_status, paper, target_date, date_is_exact, exam_booked,
                                      shift_pattern, shift_other, study_places, weekly_sessions, goal_set_at, wins_checked_at)
       VALUES ($1, 'accepted', $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
       ON CONFLICT (user_id) DO UPDATE SET
         invite_status = 'accepted', invite_snoozed_until = NULL,
         paper = EXCLUDED.paper, target_date = EXCLUDED.target_date, date_is_exact = EXCLUDED.date_is_exact,
         exam_booked = EXCLUDED.exam_booked, shift_pattern = EXCLUDED.shift_pattern,
         shift_other = EXCLUDED.shift_other, study_places = EXCLUDED.study_places,
         weekly_sessions = EXCLUDED.weekly_sessions,
         goal_set_at = COALESCE(coaching_profiles.goal_set_at, now()),
         wins_checked_at = COALESCE(coaching_profiles.wins_checked_at, now()),
         updated_at = now()`,
      [user.id, g.paper, g.target_date, g.date_is_exact, g.exam_booked,
       g.shift_pattern, g.shift_other, g.study_places, g.weekly_sessions]
    );
    await client.query(
      `UPDATE coaching_commitments SET status = 'closed', resolved_at = now(),
              meta = meta || '{"closed_by":"goal_updated"}'::jsonb
        WHERE user_id = $1 AND source = 'goal_form' AND status = 'open'`, [user.id]);

    const when = whenText(g);
    if (!g.exam_booked) {
      await client.query(
        `INSERT INTO coaching_commitments (user_id, kind, detail, due_at, check_type, source, created_by)
         VALUES ($1, 'book_exam', $2, now() + make_interval(days => $3), 'ask', 'goal_form', 'student')`,
        [user.id, `Book ${g.paper} for ${when}`, BOOK_EXAM_FOLLOWUP_DAYS]);
    }
    // "How did it go?" the morning after an exact date, or at the start of the
    // month after a month-only goal.
    await client.query(
      `INSERT INTO coaching_commitments (user_id, kind, detail, due_at, check_type, source, created_by, meta)
       VALUES ($1, 'exam_date', $2,
               ((CASE WHEN $4 THEN $3::date + 1 ELSE ($3::date + interval '1 month')::date END)
                 + interval '10 hours') AT TIME ZONE $5,
               'ask', 'goal_form', 'student', jsonb_build_object('paper', $6::text, 'when', $7::text))`,
      [user.id, `Write ${g.paper} (${when})`, g.target_date, g.date_is_exact, TZ, g.paper, when]);
    await client.query(
      `INSERT INTO coaching_commitments (user_id, kind, detail, due_at, check_type, source, created_by, meta)
       VALUES ($1, 'weekly_sessions', $2,
               (date_trunc('week', now() AT TIME ZONE $3) + interval '7 days 9 hours') AT TIME ZONE $3,
               'platform', 'goal_form', 'student',
               jsonb_build_object('target', $4::int,
                                  'week_start', date_trunc('week', now() AT TIME ZONE $3) AT TIME ZONE $3))`,
      [user.id, `${g.weekly_sessions} study sessions a week`, TZ, g.weekly_sessions]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
  const shift = g.shift_pattern === 'other' ? g.shift_other : SHIFT_PATTERNS[g.shift_pattern];
  await notify(
    `${firstGoal ? 'New goal' : 'Goal updated'}: ${name}\n` +
    `${g.paper}, ${g.date_is_exact ? '' : 'in '}${whenText(g)}${g.exam_booked ? ' (booked)' : ' (not booked yet)'}\n` +
    `Works ${shift}. Studies: ${g.study_places.map(p => STUDY_PLACES[p]).join(', ')}. Target ${g.weekly_sessions} sessions a week.`
  ).catch(err => console.error('[coaching] coach bot notify failed:', err.message));
  return g;
}

async function markSeen(pool, user, messageId) {
  const { rowCount } = await pool.query(
    `UPDATE coaching_messages SET seen_at = COALESCE(seen_at, now()) WHERE id = $1 AND user_id = $2`,
    [messageId, user.id]);
  return rowCount > 0;
}

// What each answer does. `reply` is shown in place of the question; `link`
// sends them to update their goal.
const ANSWERS = {
  book_exam: {
    yes: { status: 'kept', booked: true, reply: "Nice. Booking it is the step most people put off, and it's what makes the date real. If you've got the exact date now, add it to your goal.", link: '/goals' },
    not_yet: { snooze: 7, reply: "No problem. I'll ask again next week. Booking it is what turns a plan into a date." },
  },
  exam_date: {
    passed: { status: 'kept', reply: "Congratulations! That's a big one. I'd love to hear how it went, so reply to any of my emails and tell me. When you're ready, set your next goal.", link: '/goals', tell: 'passed' },
    failed: { status: 'missed', reply: "That's not the end of anything. Plenty of good engineers needed a second go. Set your rewrite date and work from your weakest chapters first.", link: '/goals', tell: 'did not pass' },
    not_yet: { status: 'closed', reply: "No problem. Update your date so I check in at the right time.", link: '/goals' },
  },
};

async function answerMessage(pool, user, messageId, answer, { notify = coachBot.notify } = {}) {
  const { rows: [m] } = await pool.query(
    `SELECT m.id, m.commitment_id, m.answer, c.kind, c.detail, c.meta
       FROM coaching_messages m LEFT JOIN coaching_commitments c ON c.id = m.commitment_id
      WHERE m.id = $1 AND m.user_id = $2`, [messageId, user.id]);
  if (!m) return null;
  const rule = ANSWERS[m.kind]?.[answer];
  if (!rule) throw badRequest('Unknown answer.');
  if (m.answer) return { reply: rule.reply, link: rule.link || null };

  await pool.query(`UPDATE coaching_messages SET answer = $3, seen_at = now() WHERE id = $1 AND user_id = $2`,
    [messageId, user.id, answer]);
  if (rule.snooze) {
    await pool.query(
      `UPDATE coaching_commitments SET due_at = now() + make_interval(days => $2),
              meta = (meta - 'asked_at' - 'emailed_at') || jsonb_build_object('last_answer', $3::text)
        WHERE id = $1`, [m.commitment_id, rule.snooze, answer]);
  } else {
    await pool.query(
      `UPDATE coaching_commitments SET status = $2, resolved_at = now(),
              meta = meta || jsonb_build_object('answer', $3::text)
        WHERE id = $1`, [m.commitment_id, rule.status, answer]);
  }
  if (rule.booked) {
    await pool.query(`UPDATE coaching_profiles SET exam_booked = true, updated_at = now() WHERE user_id = $1`, [user.id]);
  }
  if (rule.tell) {
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
    const paper = m.meta?.paper || '';
    const nudge = rule.tell === 'passed' ? 'Worth a congratulations from you.' : 'Worth a personal note from you.';
    await notify(`${name} says they ${rule.tell} ${paper}.\n${nudge}\n${user.email}`)
      .catch(err => console.error('[coaching] coach bot notify failed:', err.message));
  }
  return { reply: rule.reply, link: rule.link || null };
}

module.exports = {
  TZ, ELIGIBLE_CLASSES, SHIFT_PATTERNS, STUDY_PLACES, WEEKLY_CHOICES, ANSWERS,
  isEligible, getState, answerInvite, saveGoal, validateGoal, markSeen, answerMessage,
  sessionsSince, showInvite, whenText,
};
