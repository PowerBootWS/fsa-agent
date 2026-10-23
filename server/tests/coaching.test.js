// Backlog #139 phase 2: goal setting, the commitment memory, and the hourly job.
jest.mock('../src/services/coachBot', () => ({ notify: jest.fn().mockResolvedValue(true), edit: jest.fn().mockResolvedValue(true) }));

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const coachBot = require('../src/services/coachBot');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const authRouter = require('../src/routes/auth');
const coachingRouter = require('../src/routes/coaching');
const { runDue, weeklyNote, weakestChapter } = require('../src/scripts/coaching_due');
const { validateGoal } = require('../src/services/coaching');

const FIXTURE = 'coach-%@example.com';
const PASSWORD = 'longenoughpassword';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use('/api/platform', coachingRouter);
  return app;
}

async function student(app, tag, { classCode = 'second', paper = '2A1', status = 'active' } = {}) {
  const email = `coach-${tag}@example.com`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  const { rows: [u] } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash) VALUES ($1, 'Pat', 'Goal', $2) RETURNING id`,
    [email, hash]);
  await pool.query(
    `INSERT INTO subscriptions (user_id, class_code, status, active_paper, activated_at)
     VALUES ($1, $2, $3, $4, now() - interval '40 days')`, [u.id, classCode, status, paper]);
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = (res.headers['set-cookie'] || []).find(c => c.startsWith('fsa_session=')).split(';')[0];
  return { id: u.id, email, cookie };
}

const inMonths = n => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

const GOAL = {
  paper: '2A1', target_date: inMonths(2), date_is_exact: true, exam_booked: false,
  shift_pattern: 'fourteen_on_fourteen_off', study_places: ['night_shift', 'home'], weekly_sessions: 3,
};

afterAll(async () => { await pool.end(); });

describe('coaching', () => {
  let app;
  beforeEach(() => { app = buildApp(); coachBot.notify.mockClear(); });
  afterEach(async () => {
    await pool.query(`DELETE FROM usage_events WHERE user_id IN (SELECT id FROM platform_users WHERE email LIKE $1)`, [FIXTURE]);
    await pool.query(`DELETE FROM exam_last_debrief WHERE user_email LIKE $1`, [FIXTURE]);
    await deleteFixtureUsersByEmailLike(pool, FIXTURE);
  });

  const state = s => request(app).get('/api/platform/coaching').set('Cookie', s.cookie);
  const saveGoal = (s, body) => request(app).put('/api/platform/coaching/goal').set('Cookie', s.cookie).send(body);
  const commitments = async id => (await pool.query(
    `SELECT kind, check_type, status, source, detail, due_at, meta FROM coaching_commitments WHERE user_id = $1 ORDER BY id`, [id])).rows;

  it('4th Class is not offered goal setting', async () => {
    const s = await student(app, 'fourth', { classCode: 'fourth_a', paper: '4A' });
    expect((await state(s)).body).toEqual({ eligible: false });
    expect((await saveGoal(s, { ...GOAL, paper: '4A' })).status).toBe(403);
  });

  it('a new 2nd Class student is invited; "not now" hides it, "no thanks" hides it for good', async () => {
    const s = await student(app, 'invite');
    const first = (await state(s)).body;
    expect(first).toMatchObject({ eligible: true, show_invite: true, goal: null });
    expect(first.options.shift_patterns.fourteen_on_fourteen_off).toBe('14-on/14-off');

    await request(app).post('/api/platform/coaching/invite').set('Cookie', s.cookie).send({ answer: 'later' }).expect(204);
    expect((await state(s)).body.show_invite).toBe(false);

    await request(app).post('/api/platform/coaching/invite').set('Cookie', s.cookie).send({ answer: 'declined' }).expect(204);
    expect((await state(s)).body).toMatchObject({ show_invite: false, declined: true });
    expect((await request(app).post('/api/platform/coaching/invite').set('Cookie', s.cookie).send({ answer: 'yes' })).status).toBe(400);
  });

  it('rejects a bad goal with a plain message', async () => {
    const s = await student(app, 'bad');
    expect((await saveGoal(s, { ...GOAL, paper: '3A1' })).body.error).toMatch(/your papers/);
    expect((await saveGoal(s, { ...GOAL, weekly_sessions: 9 })).status).toBe(400);
    expect((await saveGoal(s, { ...GOAL, shift_pattern: 'other' })).body.error).toMatch(/schedule/);
    expect((await saveGoal(s, { ...GOAL, target_date: '2020-01-01' })).body.error).toMatch(/ahead/);
  });

  it('saving a goal writes its commitments and tells Russ on the coach bot', async () => {
    const s = await student(app, 'save');
    const res = await saveGoal(s, GOAL);
    expect(res.status).toBe(200);
    const rows = await commitments(s.id);
    expect(rows.map(r => r.kind).sort()).toEqual(['book_exam', 'exam_date', 'two_weeks_out', 'weekly_sessions']);
    const tw = rows.find(r => r.kind === 'two_weeks_out');
    expect(new Date(tw.due_at).getTime()).toBeLessThan(Date.parse(`${GOAL.target_date}T12:00:00Z`) - 13 * 86400000);
    expect(rows.find(r => r.kind === 'book_exam').check_type).toBe('ask');
    expect(rows.find(r => r.kind === 'weekly_sessions').meta.target).toBe(3);
    // Exam follow-up lands the morning after the exam date.
    const exam = rows.find(r => r.kind === 'exam_date');
    expect(new Date(exam.due_at).getTime()).toBeGreaterThan(Date.parse(`${GOAL.target_date}T12:00:00Z`));
    expect(coachBot.notify).toHaveBeenCalledWith(expect.stringMatching(/New goal: Pat Goal[\s\S]*14-on\/14-off/));

    const st = (await state(s)).body;
    expect(st).toMatchObject({ show_invite: false, goal: { paper: '2A1', weekly_sessions: 3 }, plan: { weekly_target: 3 } });
  });

  it('re-saving replaces goal commitments but never touches Russ\'s own follow-ups', async () => {
    const s = await student(app, 'resave');
    await saveGoal(s, GOAL);
    await pool.query(
      `INSERT INTO coaching_commitments (user_id, kind, detail, due_at, check_type, source)
       VALUES ($1, 'custom', 'Asked on FB about 4B', now() + interval '3 days', 'ask', 'russ')`, [s.id]);
    await saveGoal(s, { ...GOAL, exam_booked: true, date_is_exact: false, target_date: inMonths(3).slice(0, 7) });
    const rows = await commitments(s.id);
    const open = rows.filter(r => r.status === 'open');
    expect(open.map(r => r.kind).sort()).toEqual(['custom', 'exam_date', 'weekly_sessions']);
    expect(rows.filter(r => r.status === 'closed')).toHaveLength(4); // month-only now: no two-weeks-out
    expect(coachBot.notify).toHaveBeenLastCalledWith(expect.stringMatching(/^Goal updated/));
  });

  it('the hourly job asks "booked yet?" once, and the answer is recorded', async () => {
    const s = await student(app, 'ask');
    await saveGoal(s, GOAL);
    await pool.query(`UPDATE coaching_commitments SET due_at = now() - interval '1 minute' WHERE user_id = $1 AND kind = 'book_exam'`, [s.id]);

    expect((await runDue({ pool })).asked).toBe(1);
    await runDue({ pool }); // second run must not ask again
    const msgs = (await pool.query(`SELECT id, body, answers FROM coaching_messages WHERE user_id = $1`, [s.id])).rows;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toMatch(/booked 2A1/);

    const st = (await state(s)).body;
    expect(st.message.id).toBe(msgs[0].id);

    const ans = await request(app).post(`/api/platform/coaching/messages/${msgs[0].id}/answer`).set('Cookie', s.cookie).send({ answer: 'yes' });
    expect(ans.body.reply).toMatch(/Booking it/);
    expect((await commitments(s.id)).find(r => r.kind === 'book_exam').status).toBe('kept');
    expect((await state(s)).body.goal.exam_booked).toBe(true);
  });

  it('"not yet" pushes the question a week out', async () => {
    const s = await student(app, 'notyet');
    await saveGoal(s, GOAL);
    await pool.query(`UPDATE coaching_commitments SET due_at = now() - interval '1 minute' WHERE user_id = $1 AND kind = 'book_exam'`, [s.id]);
    await runDue({ pool });
    const { rows: [m] } = await pool.query(`SELECT id FROM coaching_messages WHERE user_id = $1`, [s.id]);
    await request(app).post(`/api/platform/coaching/messages/${m.id}/answer`).set('Cookie', s.cookie).send({ answer: 'not_yet' }).expect(200);
    const c = (await commitments(s.id)).find(r => r.kind === 'book_exam');
    expect(c.status).toBe('open');
    expect(c.meta.asked_at).toBeUndefined();
    expect(new Date(c.due_at).getTime()).toBeGreaterThan(Date.now() + 6 * 86400000);
  });

  it('"I passed" tells Russ; another student cannot answer someone else\'s question', async () => {
    const s = await student(app, 'passed');
    const other = await student(app, 'other');
    await saveGoal(s, GOAL);
    await pool.query(`UPDATE coaching_commitments SET due_at = now() - interval '1 minute' WHERE user_id = $1 AND kind = 'exam_date'`, [s.id]);
    await runDue({ pool });
    const { rows: [m] } = await pool.query(`SELECT id, body FROM coaching_messages WHERE user_id = $1`, [s.id]);
    expect(m.body).toMatch(/How did it go/);
    expect((await request(app).post(`/api/platform/coaching/messages/${m.id}/answer`).set('Cookie', other.cookie).send({ answer: 'passed' })).status).toBe(404);
    coachBot.notify.mockClear();
    await request(app).post(`/api/platform/coaching/messages/${m.id}/answer`).set('Cookie', s.cookie).send({ answer: 'passed' }).expect(200);
    expect(coachBot.notify).toHaveBeenCalledWith(expect.stringMatching(/Pat Goal says they passed 2A1/));
  });

  it('weekly review counts last week\'s sessions, leaves a note and rolls to next week', async () => {
    const s = await student(app, 'weekly');
    await saveGoal(s, GOAL);
    await pool.query(
      `UPDATE coaching_commitments SET due_at = now() - interval '1 minute',
              meta = jsonb_build_object('target', 3, 'week_start', now() - interval '7 days')
        WHERE user_id = $1 AND kind = 'weekly_sessions'`, [s.id]);
    for (const sid of ['a', 'b']) {
      for (let i = 0; i < 3; i++) {
        await pool.query(
          `INSERT INTO usage_events (user_id, event_type, screen, client_session_id, occurred_at)
           VALUES ($1, 'screen_view', '/lobby', $2, now() - interval '2 days')`, [s.id, sid]);
      }
    }
    expect((await runDue({ pool })).weekly).toBe(1);
    const { rows: [m] } = await pool.query(`SELECT body FROM coaching_messages WHERE user_id = $1 AND kind = 'weekly'`, [s.id]);
    expect(m.body).toBe(weeklyNote(2, 3));
    const weekly = (await commitments(s.id)).filter(r => r.kind === 'weekly_sessions');
    expect(weekly.map(r => r.status).sort()).toEqual(['missed', 'open']);
  });

  it('two weeks out: an exam 10 days away is due now; Home gets a note with the plan link', async () => {
    const s = await student(app, 'twoweeks');
    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    await saveGoal(s, { ...GOAL, target_date: soon });
    const tw = (await commitments(s.id)).find(r => r.kind === 'two_weeks_out');
    expect(new Date(tw.due_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    await runDue({ pool });
    const st = (await state(s)).body;
    expect(st.message).toMatchObject({ link_url: 'https://fullsteamahead.ca/two-weeks-out', link_label: 'Open the two-weeks-out plan' });
    expect(st.message.body).toMatch(/^Two weeks to go until 2A1/);
    const after = (await commitments(s.id)).find(r => r.kind === 'two_weeks_out');
    expect(after.status).toBe('open'); // left for fsa-nurture to email
    expect(after.meta.noted_at).toBeTruthy();
    await runDue({ pool });
    expect((await pool.query(`SELECT 1 FROM coaching_messages WHERE user_id = $1 AND link_url IS NOT NULL`, [s.id])).rows).toHaveLength(1);
  });

  it('no two-weeks-out for a month-only goal or an exam date already past', async () => {
    const s = await student(app, 'twnone');
    await saveGoal(s, { ...GOAL, date_is_exact: false, target_date: inMonths(2).slice(0, 7) });
    expect((await commitments(s.id)).some(r => r.kind === 'two_weeks_out')).toBe(false);
  });

  it('Russ\'s own follow-up reminds him on the coach bot and closes', async () => {
    const s = await student(app, 'russ');
    await pool.query(
      `INSERT INTO coaching_commitments (user_id, kind, detail, due_at, check_type, source, created_by)
       VALUES ($1, 'custom', 'Did he book 4B?', now() - interval '1 minute', 'ask', 'russ', 'russ@fullsteamahead.ca')`, [s.id]);
    expect((await runDue({ pool })).reminded).toBe(1);
    expect(coachBot.notify).toHaveBeenCalledWith(expect.stringMatching(/Follow up with Pat Goal: Did he book 4B\?/), expect.objectContaining({ buttons: expect.any(Array) }));
    expect((await commitments(s.id))[0].status).toBe('closed');
  });

  it('reminder buttons: snooze reopens Russ\'s follow-up, done closes it; needs the internal secret', async () => {
    process.env.INTERNAL_SECRET = 'test-internal';
    const s = await student(app, 'btn');
    await pool.query(
      `INSERT INTO coaching_commitments (user_id, kind, detail, due_at, check_type, source)
       VALUES ($1, 'custom', 'Check on 4B', now() - interval '1 minute', 'ask', 'russ')`, [s.id]);
    await runDue({ pool });
    const sent = coachBot.notify.mock.calls.find(c => /Check on 4B/.test(c[0]));
    const [[done, s3]] = sent[1].buttons;
    const id = Number(done.data.split(':')[2]);
    const hit = (body, secret = 'test-internal') => request(app).post('/api/platform/coaching/internal/followup').set('x-internal-secret', secret).send(body);

    expect((await hit({ action: 's3', id }, 'wrong')).status).toBe(401);
    const snoozed = await hit({ action: s3.data.split(':')[1], id });
    expect(snoozed.body.text).toMatch(/^Snoozed to /);
    let [c] = await commitments(s.id);
    expect(c.status).toBe('open');
    expect(new Date(c.due_at).getTime()).toBeGreaterThan(Date.now() + 2 * 86400000);

    await hit({ action: 'done', id }).expect(200);
    [c] = await commitments(s.id);
    expect(c.status).toBe('closed');
    expect(c.meta.done).toBe(true);
  });

  it('a student whose subscription ended has their goal follow-ups closed, not asked', async () => {
    const s = await student(app, 'lapsed');
    await saveGoal(s, GOAL);
    await pool.query(`UPDATE subscriptions SET status = 'inactive' WHERE user_id = $1`, [s.id]);
    await pool.query(`UPDATE coaching_commitments SET due_at = now() - interval '1 minute' WHERE user_id = $1`, [s.id]);
    const out = await runDue({ pool });
    expect(out.closed).toBe(4); // book_exam, exam_date, two_weeks_out, weekly_sessions
    expect((await pool.query(`SELECT 1 FROM coaching_messages WHERE user_id = $1`, [s.id])).rows).toHaveLength(0);
  });

  it('a personal-best practice exam leaves one win note a day', async () => {
    const s = await student(app, 'win');
    await saveGoal(s, GOAL);
    const debrief = pct => JSON.stringify({ display_update: { score_pct: pct, chapter_stats: [
      { chapter: '2A1-3', pct: 20, total: 4 }, { chapter: '2A1-5', pct: 80, total: 5 }] } });
    await pool.query(`INSERT INTO exam_last_debrief (user_email, course_id, debrief, updated_at) VALUES ($1, '2A1', $2, now())`, [s.email, debrief(48)]);
    await runDue({ pool });
    expect((await pool.query(`SELECT 1 FROM coaching_messages WHERE user_id = $1 AND kind = 'win'`, [s.id])).rows).toHaveLength(0);

    await pool.query(`UPDATE exam_last_debrief SET debrief = $2, updated_at = now() WHERE user_email = $1`, [s.email, debrief(60)]);
    await runDue({ pool });
    const wins = (await pool.query(`SELECT body FROM coaching_messages WHERE user_id = $1 AND kind = 'win'`, [s.id])).rows;
    expect(wins).toHaveLength(1);
    expect(wins[0].body).toMatch(/60% on that 2A1 practice exam, your best yet\. Your weakest chapter was 3/);

    await pool.query(`UPDATE exam_last_debrief SET debrief = $2, updated_at = now() WHERE user_email = $1`, [s.email, debrief(70)]);
    await runDue({ pool });
    expect((await pool.query(`SELECT 1 FROM coaching_messages WHERE user_id = $1 AND kind = 'win'`, [s.id])).rows).toHaveLength(1);
  });

  it('marking a note seen hides it', async () => {
    const s = await student(app, 'seen');
    await saveGoal(s, GOAL);
    const { rows: [m] } = await pool.query(
      `INSERT INTO coaching_messages (user_id, kind, body) VALUES ($1, 'win', 'Nice one') RETURNING id`, [s.id]);
    expect((await state(s)).body.message.body).toBe('Nice one');
    await request(app).post(`/api/platform/coaching/messages/${m.id}/seen`).set('Cookie', s.cookie).expect(204);
    expect((await state(s)).body.message).toBeNull();
  });
});

describe('pure helpers', () => {
  it('weakestChapter ignores chapters with too few questions', () => {
    expect(weakestChapter([{ chapter: '2A1-1', pct: 0, total: 1 }, { chapter: '2A1-4', pct: 30, total: 3 }])).toBe('4');
    expect(weakestChapter([])).toBeNull();
  });

  it('validateGoal turns a month into the 1st of that month', () => {
    const g = validateGoal({ class_code: 'third' }, { ...GOAL, paper: '3B1', date_is_exact: false, target_date: inMonths(4).slice(0, 7) });
    expect(g.target_date).toMatch(/-01$/);
  });
});
