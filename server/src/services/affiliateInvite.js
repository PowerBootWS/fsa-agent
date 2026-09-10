// Engagement-triggered affiliate invite.
//
// Every paying student is auto-enrolled in the affiliate program at checkout,
// but the only place they are ever told so is onboarding D21. That is
// deliberate — an advocacy ask is worth more once the product has proved
// itself than at the moment of purchase — but it is keyed to the calendar
// rather than to whether the student has actually used the thing yet.
//
// This fires the same ask off real usage instead: once someone has come back
// three separate times and done more than glance around, they have had a
// genuine look, and a "you have used it, you would be telling people
// something true" note lands. D21 still sends; the two are far enough apart
// (this almost always fires inside week one) that the later one reads as a
// reminder.
//
// Why visits and events rather than time on the platform: there is no
// heartbeat beacon, so any duration figure has to be inferred from the gaps
// between screen views, and a sparse session inflates it badly — a user with
// four recorded events scores 40 "minutes" that may be 40 seconds of real
// use. Distinct client_session_id is a number we actually have.

const nurture = require('./nurture');

const MIN_VISITS = 3;
const MIN_EVENTS = 10;

// Holding the invite back an hour keeps it from landing while the student is
// still sitting in the platform, which reads as surveillance rather than as a
// note from Russ.
const DELAY_MINUTES = 60;

// Process-lifetime guard. /intake is idempotent per contact+sequence, so this
// is not what makes the invite send-once — it just stops every subsequent
// beacon batch from a long-running student re-running the count query and
// re-opening an HTTPS call that nurture will only discard. Cleared on restart,
// which is harmless for the same reason.
const alreadyInvited = new Set();

// Only counted on success, so a transient nurture outage retries on the
// student's next batch instead of losing the invite entirely.
function markInvited(userId) {
  alreadyInvited.add(userId);
}

async function meetsThreshold(pool, userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT client_session_id)::int AS visits,
            COUNT(*)::int                         AS events
       FROM usage_events
      WHERE user_id = $1
        AND client_session_id IS NOT NULL`,
    [userId]
  );
  const { visits, events } = rows[0] || { visits: 0, events: 0 };
  return visits >= MIN_VISITS && events >= MIN_EVENTS;
}

// Fire-and-forget. Never throws: telemetry ingest must not be able to fail
// because a marketing email did.
async function maybeInvite(pool, user) {
  try {
    if (!user?.id) return false;

    // No active subscription means no affiliate code was ever created for
    // them at checkout, and the invite copy would be telling them about a
    // referral link that does not exist.
    if (!user.subscription_id) return false;

    if (alreadyInvited.has(user.id)) return false;

    if (!(await meetsThreshold(pool, user.id))) return false;

    await nurture.enroll({
      email: user.email,
      firstName: user.first_name,
      sequence: 'affiliate_invite',
      source: 'platform-engagement',
      delayMinutes: DELAY_MINUTES,
    });

    markInvited(user.id);
    return true;
  } catch (err) {
    console.error('[affiliate-invite] enrolment failed for user', user?.id, '-', err.message);
    return false;
  }
}

module.exports = { maybeInvite, meetsThreshold, MIN_VISITS, MIN_EVENTS, DELAY_MINUTES, alreadyInvited };
