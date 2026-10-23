// Text-message coaching (backlog #139 phase 4).
//
// A student with a goal can opt in with their mobile number. From then on:
//   - every text in or out is copied into coaching_texts (the official record);
//   - when the student texts, we wait for Russ to answer from the GHL app (10
//     minutes for the first text of a conversation, 2 when the coach is already
//     looking after it), then draft a reply in his voice;
//   - due goal follow-ups ("booked yet?") become drafted texts too;
//   - every draft goes to Russ on the coach bot with Send / Skip. Nothing goes
//     to a student without his tap, except the one welcome text at opt-in.
//   - approved texts wait for 8 am to 9 pm Edmonton.
// A text Russ sends from the GHL app means he's handling it: drafts for that
// student are dropped and the coach stays out for a couple of hours.

const ghlDefault = require('./ghl');
const coachBot = require('./coachBot');
const { draft: draftDefault } = require('./coachDraft');
const { isEligible } = require('./coaching');

const TZ = 'America/Edmonton';
const minutes = (name, dflt) => Number(process.env[name]) || dflt;
const FIRST_WAIT_MIN = () => minutes('COACH_TEXT_WAIT_FIRST_MIN', 10);
const ACTIVE_WAIT_MIN = () => minutes('COACH_TEXT_WAIT_ACTIVE_MIN', 2);
const COACH_ACTIVE_MIN = () => minutes('COACH_TEXT_COACH_ACTIVE_MIN', 60);
const RUSS_ACTIVE_MIN = () => minutes('COACH_TEXT_RUSS_ACTIVE_MIN', 120);
const QUIET_END_HOUR = 8;     // texts go out from 8 am...
const QUIET_START_HOUR = 21;  // ...until 9 pm Edmonton
const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
const POLL_LOCK = 139004;

const CONSENT_TEXT = 'Russ from Full Steam Ahead can text you about your studying: check-ins, reminders and encouragement. '
  + 'Never sales. Message and data rates may apply. Reply STOP anytime to stop.';

// Canadian area codes (FSA's GHL number texts Canadian numbers only).
const CA_AREA_CODES = new Set(('204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 387 403 416 418 428 431 437 438 '
  + '450 460 468 474 506 514 519 548 579 581 584 587 604 613 639 647 672 683 705 709 742 753 778 780 782 807 819 825 '
  + '867 873 879 902 905 942').split(' '));

const CLASS_LABEL = { second: '2nd Class', third: '3rd Class' };

function badRequest(msg) { return Object.assign(new Error(msg), { status: 400 }); }

function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) throw badRequest('Enter a 10-digit mobile number.');
  if (!CA_AREA_CODES.has(d.slice(0, 3))) throw badRequest('Text check-ins work with Canadian mobile numbers only.');
  return `+1${d}`;
}

function edmontonHour(at) {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(at));
}

function inSendingHours(at) {
  const h = edmontonHour(at);
  return h >= QUIET_END_HOUR && h < QUIET_START_HOUR;
}

async function nextSendingTime(pool, now) {
  const { rows: [r] } = await pool.query(
    `SELECT CASE WHEN extract(hour FROM $1::timestamptz AT TIME ZONE $2) >= $3
                 THEN ((($1::timestamptz AT TIME ZONE $2)::date + 1) + make_interval(hours => $4)) AT TIME ZONE $2
                 ELSE ((($1::timestamptz AT TIME ZONE $2)::date) + make_interval(hours => $4)) AT TIME ZONE $2 END AS at`,
    [now, TZ, QUIET_START_HOUR, QUIET_END_HOUR]);
  return r.at;
}

const shortTime = d => new Date(d).toLocaleString('en-CA', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' });

// ── opt in / out ─────────────────────────────────────────────────────────────

async function optIn(pool, user, { phone, agree }, { ghl = ghlDefault, notify = coachBot.notify } = {}) {
  if (!isEligible(user)) throw Object.assign(new Error('Text check-ins are for 2nd and 3rd Class students.'), { status: 403 });
  if (agree !== true) throw badRequest('Tick the box to say it is OK to text you.');
  const e164 = normalizePhone(phone);

  let contactId;
  try {
    contactId = await ghl.upsertTextingContact({
      firstName: user.first_name, lastName: user.last_name, email: user.email, phone: e164,
    });
  } catch (err) {
    console.error('[coachTexts] GHL contact upsert failed:', err.message);
    throw Object.assign(new Error("Couldn't set up text check-ins right now. Try again in a few minutes."), { status: 502 });
  }

  await pool.query(
    `INSERT INTO coaching_profiles (user_id, phone, text_opt_in_at, text_consent, ghl_contact_id)
     VALUES ($1, $2, now(), $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone, text_opt_in_at = now(),
       text_consent = EXCLUDED.text_consent, text_opt_out_at = NULL, text_offer_declined_at = NULL,
       ghl_contact_id = EXCLUDED.ghl_contact_id, updated_at = now()`,
    [user.id, e164, CONSENT_TEXT, contactId]);

  const { rows: [p] } = await pool.query(`SELECT paper FROM coaching_profiles WHERE user_id = $1`, [user.id]);
  const welcome = `Hi ${user.first_name}, it's Russ from Full Steam Ahead. You're set up for text check-ins`
    + `${p?.paper ? ` on your ${p.paper} studying` : ' on your studying'}. Text me here anytime. Reply STOP if you ever want them to stop.`;
  try {
    const sent = await ghl.sendText(contactId, welcome);
    await recordText(pool, { userId: user.id, direction: 'out', sentBy: 'system', body: welcome, ghlMessageId: sent.messageId });
    if (sent.conversationId) {
      await pool.query(`UPDATE coaching_profiles SET ghl_conversation_id = $2 WHERE user_id = $1`, [user.id, sent.conversationId]);
    }
  } catch (err) {
    console.error('[coachTexts] welcome text failed:', err.message);
  }
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  await notify(`${name} turned on text check-ins (${e164.slice(0, 2)} ••• ${e164.slice(-4)}). Welcome text sent.`)
    .catch(err => console.error('[coachTexts] notify failed:', err.message));
  return { phone_last4: e164.slice(-4) };
}

async function dropOpenDrafts(pool, userId, note, { edit = coachBot.edit } = {}) {
  const { rows } = await pool.query(
    `UPDATE coaching_text_drafts SET status = 'superseded', decided_at = now()
      WHERE user_id = $1 AND status IN ('pending', 'scheduled')
      RETURNING telegram_message_id, telegram_text`, [userId]);
  for (const d of rows) {
    await edit(Number(d.telegram_message_id) || null, `${d.telegram_text || ''}\n\n✕ ${note}`).catch(() => {});
  }
  return rows.length;
}

async function optOut(pool, userId, why, deps = {}) {
  await pool.query(
    `UPDATE coaching_profiles SET text_opt_out_at = now(), text_pending_since = NULL, updated_at = now()
      WHERE user_id = $1 AND text_opt_in_at IS NOT NULL AND text_opt_out_at IS NULL`, [userId]);
  await dropOpenDrafts(pool, userId, `Not sent: they turned texts off (${why}).`, deps);
}

async function declineOffer(pool, userId) {
  await pool.query(
    `INSERT INTO coaching_profiles (user_id, text_offer_declined_at) VALUES ($1, now())
     ON CONFLICT (user_id) DO UPDATE SET text_offer_declined_at = now(), updated_at = now()`, [userId]);
}

async function textingState(pool, userId) {
  const { rows: [p] } = await pool.query(
    `SELECT phone, text_opt_in_at, text_opt_out_at, text_offer_declined_at FROM coaching_profiles WHERE user_id = $1`, [userId]);
  const on = Boolean(p?.text_opt_in_at && !p.text_opt_out_at);
  return {
    on,
    phone_last4: on ? p.phone.slice(-4) : null,
    offer: !on && !p?.text_offer_declined_at,
    consent_text: CONSENT_TEXT,
  };
}

// ── the record ───────────────────────────────────────────────────────────────

async function recordText(pool, { userId, direction, sentBy, body, ghlMessageId = null, sentAt = null, meta = {} }) {
  const { rows } = await pool.query(
    `INSERT INTO coaching_texts (user_id, direction, sent_by, body, ghl_message_id, sent_at, meta)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()), $7)
     ON CONFLICT (ghl_message_id) DO NOTHING RETURNING id`,
    [userId, direction, sentBy, body, ghlMessageId, sentAt, JSON.stringify(meta)]);
  return rows.length > 0;
}

// ── polling GHL ──────────────────────────────────────────────────────────────

async function getState(pool, key) {
  const { rows: [r] } = await pool.query(`SELECT value FROM coaching_state WHERE key = $1`, [key]);
  return r ? r.value : null;
}

async function setState(pool, key, value) {
  await pool.query(
    `INSERT INTO coaching_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, String(value)]);
}

/**
 * One poll: find conversations with new messages since the last poll, keep the
 * opted-in students' ones, and record what's new. Returns counts.
 */
async function pollOnce(pool, { ghl = ghlDefault, now = new Date(), notify = coachBot.notify, edit = coachBot.edit } = {}) {
  const out = { conversations: 0, inbound: 0, russ: 0, stopped: 0 };
  const cursorRaw = await getState(pool, 'ghl_cursor_ms');
  if (!cursorRaw) {
    // First run: start from now rather than importing history.
    await setState(pool, 'ghl_cursor_ms', now.getTime());
    return out;
  }
  const cursor = Number(cursorRaw);
  const { rows: profiles } = await pool.query(
    `SELECT p.user_id, p.ghl_contact_id, pu.first_name, pu.last_name
       FROM coaching_profiles p JOIN platform_users pu ON pu.id = p.user_id
      WHERE p.ghl_contact_id IS NOT NULL AND p.text_opt_in_at IS NOT NULL AND p.text_opt_out_at IS NULL`);
  const byContact = new Map(profiles.map(p => [p.ghl_contact_id, p]));

  let newest = cursor;
  const convs = await ghl.recentConversations({ limit: 50 });
  for (const c of convs) {
    const last = Number(c.lastMessageDate) || 0;
    newest = Math.max(newest, last);
    if (last <= cursor || !byContact.has(c.contactId)) continue;
    out.conversations += 1;
    const p = byContact.get(c.contactId);
    await pool.query(`UPDATE coaching_profiles SET ghl_conversation_id = $2 WHERE user_id = $1 AND ghl_conversation_id IS DISTINCT FROM $2`, [p.user_id, c.id]);
    const msgs = (await ghl.conversationMessages(c.id, { limit: 20 }))
      .filter(m => m.messageType === 'TYPE_SMS' && m.body)
      // a little overlap with the last poll; the unique message id stops duplicates
      .filter(m => Date.parse(m.dateAdded) > cursor - 5 * 60 * 1000)
      .sort((a, b) => Date.parse(a.dateAdded) - Date.parse(b.dateAdded));
    for (const m of msgs) {
      const at = new Date(m.dateAdded);
      if (m.direction === 'inbound') {
        if (!(await recordText(pool, { userId: p.user_id, direction: 'in', sentBy: 'student', body: m.body, ghlMessageId: m.id, sentAt: at }))) continue;
        out.inbound += 1;
        const word = m.body.trim().toLowerCase().replace(/[^a-z]/g, '');
        if (STOP_WORDS.has(word)) {
          await optOut(pool, p.user_id, 'replied STOP', { edit });
          out.stopped += 1;
          await notify(`${p.first_name} ${p.last_name || ''} replied STOP. Text check-ins are off for them.`).catch(() => {});
          continue;
        }
        // A newer text replaces any draft that didn't see it.
        await dropOpenDrafts(pool, p.user_id, 'A newer text came in; a fresh draft is on its way.', { edit });
        await pool.query(
          `UPDATE coaching_profiles SET text_pending_since = COALESCE(text_pending_since, $2) WHERE user_id = $1`, [p.user_id, at]);
      } else {
        // Our own send whose id GHL didn't return at send time: attach the id, it's not Russ.
        const { rowCount: ours } = await pool.query(
          `UPDATE coaching_texts SET ghl_message_id = $3
            WHERE id = (SELECT id FROM coaching_texts WHERE user_id = $1 AND direction = 'out' AND sent_by IN ('coach', 'system')
                          AND ghl_message_id IS NULL AND body = $2 AND sent_at > $4::timestamptz - interval '15 minutes'
                        ORDER BY sent_at DESC LIMIT 1)`, [p.user_id, m.body, m.id, at]);
        if (ours) continue;
        // An outbound text we didn't send ourselves: Russ typed it in the GHL app.
        if (!(await recordText(pool, { userId: p.user_id, direction: 'out', sentBy: 'russ', body: m.body, ghlMessageId: m.id, sentAt: at, meta: { ghl_user_id: m.userId || null } }))) continue;
        out.russ += 1;
        await pool.query(
          `UPDATE coaching_profiles SET text_pending_since = NULL,
                  text_russ_active_until = $2::timestamptz + make_interval(mins => $3), text_coach_active_until = NULL
            WHERE user_id = $1`, [p.user_id, at, RUSS_ACTIVE_MIN()]);
        await dropOpenDrafts(pool, p.user_id, 'You replied in GHL, so this draft was dropped.', { edit });
      }
    }
  }
  await setState(pool, 'ghl_cursor_ms', newest);
  await setState(pool, 'poll_heartbeat', now.toISOString());
  return out;
}

// ── drafting ─────────────────────────────────────────────────────────────────

async function draftContext(pool, userId, extra = {}) {
  const { rows: [s] } = await pool.query(
    `SELECT pu.first_name, pu.last_name, p.paper, to_char(p.target_date, 'YYYY-MM-DD') AS target_date, p.date_is_exact,
            p.exam_booked, p.weekly_sessions,
            (SELECT class_code FROM subscriptions WHERE user_id = pu.id AND status = 'active' ORDER BY activated_at DESC LIMIT 1) AS class_code,
            to_char(now() AT TIME ZONE $2, 'YYYY-MM-DD (Dy)') AS today
       FROM platform_users pu JOIN coaching_profiles p ON p.user_id = pu.id WHERE pu.id = $1`, [userId, TZ]);
  const [{ rows: texts }, { rows: open }, { rows: rules }] = await Promise.all([
    pool.query(`SELECT sent_by, body FROM (SELECT sent_by, body, sent_at FROM coaching_texts WHERE user_id = $1
                 ORDER BY sent_at DESC LIMIT 12) t ORDER BY sent_at`, [userId]),
    pool.query(`SELECT id, detail, to_char(due_at AT TIME ZONE $2, 'YYYY-MM-DD') AS due FROM coaching_commitments
                 WHERE user_id = $1 AND status = 'open' ORDER BY due_at LIMIT 10`, [userId, TZ]),
    pool.query(`SELECT rule, example FROM coaching_rules WHERE active ORDER BY id LIMIT 40`),
  ]);
  const goal = s.paper && s.target_date
    ? `write ${s.paper} ${s.date_is_exact ? `on ${s.target_date}` : `in ${s.target_date.slice(0, 7)}`}, ${s.exam_booked ? 'booked' : 'not booked yet'}, ${s.weekly_sessions || '?'} sessions a week`
    : null;
  return {
    today: s.today, firstName: s.first_name, lastName: s.last_name, paper: s.paper,
    classLabel: CLASS_LABEL[s.class_code] || 'student', goal, texts, openFollowups: open, rules, ...extra,
  };
}

async function applyModelNotes(pool, userId, d) {
  const added = [];
  for (const f of d.followups) {
    const { rows: [r] } = await pool.query(
      `INSERT INTO coaching_commitments (user_id, kind, detail, due_at, check_type, source, created_by)
       VALUES ($1, 'custom', $2, ($3::date + interval '10 hours') AT TIME ZONE $4, 'ask', 'text', 'coach-draft')
       RETURNING id`, [userId, f.detail, f.date, TZ]);
    added.push({ ...f, id: r.id });
  }
  const resolved = [];
  for (const r of d.resolve) {
    const { rowCount } = await pool.query(
      `UPDATE coaching_commitments SET status = $3, resolved_at = now(),
              meta = meta || '{"closed_by":"text_conversation"}'::jsonb
        WHERE id = $1 AND user_id = $2 AND status = 'open'`, [r.id, userId, r.outcome]);
    if (rowCount) resolved.push(r);
  }
  return { added, resolved };
}

async function sendDraftToRuss(pool, { userId, reason, commitmentId = null, d, header, notify }) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO coaching_text_drafts (user_id, reason, commitment_id, body, meta)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, reason, commitmentId, d.reply, JSON.stringify({ needs_russ: d.needsRuss, why: d.why })]);
  const notes = await applyModelNotes(pool, userId, d);
  const lines = [header, '', `Draft from you:\n"${d.reply}"`];
  if (d.needsRuss) lines.push('', `⚠ Worth your own answer: ${d.why || 'see the conversation'}`);
  for (const f of notes.added) lines.push(`Follow-up noted: ${f.date}, ${f.detail}`);
  for (const r of notes.resolved) lines.push(`Marked follow-up #${r.id} ${r.outcome}.`);
  lines.push('', 'Or just reply to them yourself in GHL and this draft is dropped.');
  const text = lines.join('\n');
  const label = inSendingHours(new Date()) ? 'Send' : 'Send (goes at 8 am)';
  const msgId = await notify(text, { buttons: [[{ text: label, data: `cd:send:${row.id}` }, { text: 'Skip', data: `cd:skip:${row.id}` }]] });
  await pool.query(`UPDATE coaching_text_drafts SET telegram_message_id = $2, telegram_text = $3 WHERE id = $1`,
    [row.id, typeof msgId === 'number' ? msgId : null, text]);
  return row.id;
}

/** Draft replies for students whose wait is up. */
async function draftDue(pool, { now = new Date(), draft = draftDefault, notify = coachBot.notify } = {}) {
  const { rows } = await pool.query(
    `SELECT p.user_id, pu.first_name, pu.last_name, p.paper, p.text_pending_since, p.text_coach_active_until
       FROM coaching_profiles p JOIN platform_users pu ON pu.id = p.user_id
      WHERE p.text_opt_in_at IS NOT NULL AND p.text_opt_out_at IS NULL AND p.text_pending_since IS NOT NULL
        AND (p.text_russ_active_until IS NULL OR p.text_russ_active_until < $1)
        AND NOT EXISTS (SELECT 1 FROM coaching_text_drafts d WHERE d.user_id = p.user_id AND d.status IN ('pending', 'scheduled'))`,
    [now]);
  let drafted = 0;
  for (const p of rows) {
    const active = p.text_coach_active_until && new Date(p.text_coach_active_until) > new Date(p.text_pending_since);
    const waitMs = (active ? ACTIVE_WAIT_MIN() : FIRST_WAIT_MIN()) * 60 * 1000;
    if (now - new Date(p.text_pending_since) < waitMs) continue;
    try {
      const ctx = await draftContext(pool, p.user_id, { mode: 'reply' });
      const d = await draft(ctx);
      const lastIn = [...ctx.texts].reverse().filter(t => t.sent_by === 'student').slice(0, 3).reverse().map(t => `> ${t.body}`).join('\n');
      await sendDraftToRuss(pool, {
        userId: p.user_id, reason: 'reply', d, notify,
        header: `Text from ${p.first_name} ${p.last_name || ''}${p.paper ? ` (${p.paper})` : ''}:\n${lastIn}`,
      });
      drafted += 1;
    } catch (err) {
      console.error(`[coachTexts] draft for user ${p.user_id} failed:`, err.message);
    }
  }
  return drafted;
}

/** A due goal follow-up for a texting student becomes a drafted check-in text. */
async function draftForCommitment(pool, c, { draft = draftDefault, notify = coachBot.notify } = {}) {
  const ctx = await draftContext(pool, c.user_id, { mode: 'commitment', commitmentDetail: c.detail });
  const d = await draft(ctx);
  // The follow-up being texted about isn't one to resolve from this draft.
  d.resolve = d.resolve.filter(r => r.id !== c.id);
  await sendDraftToRuss(pool, {
    userId: c.user_id, reason: 'commitment', commitmentId: c.id, d, notify,
    header: `Check-in due for ${ctx.firstName} ${ctx.lastName || ''}: ${c.detail}`,
  });
  await pool.query(`UPDATE coaching_commitments SET meta = meta || jsonb_build_object('texted_at', now()) WHERE id = $1`, [c.id]);
}

async function isTexting(pool, userId) {
  const { rows: [p] } = await pool.query(
    `SELECT 1 FROM coaching_profiles WHERE user_id = $1 AND text_opt_in_at IS NOT NULL AND text_opt_out_at IS NULL AND ghl_contact_id IS NOT NULL`, [userId]);
  return Boolean(p);
}

// ── Russ's tap ───────────────────────────────────────────────────────────────

async function sendDraftNow(pool, dr, { ghl, now }) {
  const sent = await ghl.sendText(dr.ghl_contact_id, dr.body);
  await recordText(pool, { userId: dr.user_id, direction: 'out', sentBy: 'coach', body: dr.body, ghlMessageId: sent.messageId, meta: { draft_id: dr.id } });
  await pool.query(`UPDATE coaching_text_drafts SET status = 'sent', decided_at = COALESCE(decided_at, now()) WHERE id = $1`, [dr.id]);
  await pool.query(
    `UPDATE coaching_profiles SET text_pending_since = NULL,
            text_coach_active_until = $2::timestamptz + make_interval(mins => $3) WHERE user_id = $1`,
    [dr.user_id, now, COACH_ACTIVE_MIN()]);
}

async function loadDraft(pool, id) {
  const { rows: [dr] } = await pool.query(
    `SELECT d.*, p.ghl_contact_id, p.text_opt_out_at, p.text_russ_active_until,
            (SELECT max(sent_at) FROM coaching_texts t WHERE t.user_id = d.user_id AND t.sent_by = 'russ') AS last_russ_text
       FROM coaching_text_drafts d JOIN coaching_profiles p ON p.user_id = d.user_id WHERE d.id = $1`, [id]);
  return dr;
}

/** Send or Skip from the coach bot. Returns the line to show under the draft. */
async function decide(pool, id, action, { ghl = ghlDefault, now = new Date(), edit = coachBot.edit } = {}) {
  const dr = await loadDraft(pool, id);
  if (!dr) return { status: 404, text: 'That draft is gone.' };
  const finish = async (line) => {
    await edit(Number(dr.telegram_message_id) || null, `${dr.telegram_text || ''}\n\n${line}`).catch(() => {});
    return { status: 200, text: line };
  };
  if (dr.status !== 'pending') return { status: 200, text: `Already ${dr.status}.` };

  if (action === 'skip') {
    await pool.query(`UPDATE coaching_text_drafts SET status = 'skipped', decided_at = now() WHERE id = $1`, [id]);
    if (dr.reason === 'reply') await pool.query(`UPDATE coaching_profiles SET text_pending_since = NULL WHERE user_id = $1`, [dr.user_id]);
    return finish('✕ Skipped. Nothing sent.');
  }
  if (action !== 'send') return { status: 400, text: 'Unknown action.' };
  if (dr.text_opt_out_at) {
    await pool.query(`UPDATE coaching_text_drafts SET status = 'superseded', decided_at = now() WHERE id = $1`, [id]);
    return finish('✕ Not sent: they turned texts off.');
  }
  if (dr.last_russ_text && new Date(dr.last_russ_text) > new Date(dr.created_at)) {
    await pool.query(`UPDATE coaching_text_drafts SET status = 'superseded', decided_at = now() WHERE id = $1`, [id]);
    return finish('✕ Not sent: you already replied in GHL.');
  }
  if (!inSendingHours(now)) {
    const at = await nextSendingTime(pool, now);
    await pool.query(`UPDATE coaching_text_drafts SET status = 'scheduled', send_after = $2, decided_at = now() WHERE id = $1`, [id, at]);
    return finish(`🕗 Approved. Goes out ${shortTime(at)} (quiet hours).`);
  }
  try {
    await sendDraftNow(pool, dr, { ghl, now });
  } catch (err) {
    console.error(`[coachTexts] send of draft ${id} failed:`, err.message);
    await pool.query(`UPDATE coaching_text_drafts SET status = 'failed', decided_at = now(), meta = meta || jsonb_build_object('error', $2::text) WHERE id = $1`, [id, err.message]);
    return finish("✕ GHL wouldn't send it. Text them from the GHL app instead.");
  }
  return finish('✓ Sent.');
}

/** Approved drafts that were waiting for quiet hours to end. */
async function sendScheduled(pool, { ghl = ghlDefault, now = new Date(), edit = coachBot.edit } = {}) {
  if (!inSendingHours(now)) return 0;
  const { rows } = await pool.query(
    `SELECT id FROM coaching_text_drafts WHERE status = 'scheduled' AND send_after <= $1 ORDER BY send_after`, [now]);
  let sent = 0;
  for (const { id } of rows) {
    const dr = await loadDraft(pool, id);
    let line;
    if (dr.text_opt_out_at) line = '✕ Not sent: they turned texts off.';
    else if (dr.last_russ_text && new Date(dr.last_russ_text) > new Date(dr.created_at)) line = '✕ Not sent: you replied in GHL first.';
    if (line) {
      await pool.query(`UPDATE coaching_text_drafts SET status = 'superseded' WHERE id = $1`, [id]);
    } else {
      try {
        await sendDraftNow(pool, dr, { ghl, now });
        line = '✓ Sent this morning.';
        sent += 1;
      } catch (err) {
        await pool.query(`UPDATE coaching_text_drafts SET status = 'failed', meta = meta || jsonb_build_object('error', $2::text) WHERE id = $1`, [id, err.message]);
        line = "✕ GHL wouldn't send it. Text them from the GHL app instead.";
      }
    }
    await edit(Number(dr.telegram_message_id) || null, `${dr.telegram_text || ''}\n\n${line}`).catch(() => {});
  }
  return sent;
}

module.exports = {
  CONSENT_TEXT, normalizePhone, inSendingHours, optIn, optOut, declineOffer, textingState,
  pollOnce, draftDue, draftForCommitment, isTexting, sendDraftToRuss, decide, sendScheduled, recordText, getState,
};
