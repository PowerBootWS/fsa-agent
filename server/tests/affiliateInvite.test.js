// The engagement-triggered affiliate invite (2026-09-10).
//
// Every paying student is auto-enrolled in the affiliate program at checkout,
// but the only place they were ever told so is onboarding D21 — a calendar
// date, not a signal that they had actually used the platform. This fires the
// same ask off real usage instead.
//
// These tests pin the parts that are easy to break quietly: the threshold is
// two conditions and not one, a free account is never invited (it has no
// affiliate code for the copy to point at), and neither a nurture outage nor
// a repeat beacon can turn into a second email.
jest.mock('../src/services/nurture', () => ({ enroll: jest.fn() }));

const { pool } = require('./testPool');
const nurture = require('../src/services/nurture');
const affiliateInvite = require('../src/services/affiliateInvite');

const EMAIL = 'affinvite-test@test.example';
let userId;

async function addEvents({ sessions, perSession }) {
  for (let s = 0; s < sessions; s++) {
    for (let e = 0; e < perSession; e++) {
      await pool.query(
        `INSERT INTO usage_events (user_id, event_type, screen, props, client_session_id, occurred_at)
         VALUES ($1, 'screen_view', '/lobby', '{}'::jsonb, $2, now())`,
        [userId, `sess-${s}`]
      );
    }
  }
}

beforeAll(async () => {
  const { rows } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash)
     VALUES ($1, 'Aff', 'Invite', 'x') RETURNING id`,
    [EMAIL]
  );
  userId = rows[0].id;
});

afterAll(async () => {
  // Scoped to this test's own fixture — never a bare DELETE FROM (2026-08-12).
  await pool.query('DELETE FROM usage_events WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM platform_users WHERE id = $1', [userId]);
  await pool.end();
});

afterEach(async () => {
  await pool.query('DELETE FROM usage_events WHERE user_id = $1', [userId]);
  affiliateInvite.alreadyInvited.clear();
  jest.clearAllMocks();
});

const subscriber = () => ({ id: userId, email: EMAIL, first_name: 'Aff', subscription_id: 42 });

describe('affiliate invite threshold', () => {
  it('does not fire on visits alone when the student barely looked around', async () => {
    // 4 visits but only 4 events: exactly the shape that makes a raw visit
    // count misleading — three logins that bounced straight back off the
    // dashboard are not "gave it a good test run".
    await addEvents({ sessions: 4, perSession: 1 });
    expect(await affiliateInvite.maybeInvite(pool, subscriber())).toBe(false);
    expect(nurture.enroll).not.toHaveBeenCalled();
  });

  it('does not fire on events alone from a single sitting', async () => {
    await addEvents({ sessions: 1, perSession: 30 });
    expect(await affiliateInvite.maybeInvite(pool, subscriber())).toBe(false);
    expect(nurture.enroll).not.toHaveBeenCalled();
  });

  it('fires once both the visit and the event floor are met', async () => {
    await addEvents({ sessions: 3, perSession: 4 });
    expect(await affiliateInvite.maybeInvite(pool, subscriber())).toBe(true);
    expect(nurture.enroll).toHaveBeenCalledTimes(1);
    expect(nurture.enroll).toHaveBeenCalledWith(expect.objectContaining({
      email: EMAIL,
      sequence: 'affiliate_invite',
      delayMinutes: affiliateInvite.DELAY_MINUTES,
    }));
  });

  it('holds the send back rather than landing while they are still in the platform', async () => {
    await addEvents({ sessions: 3, perSession: 4 });
    await affiliateInvite.maybeInvite(pool, subscriber());
    expect(nurture.enroll.mock.calls[0][0].delayMinutes).toBeGreaterThan(0);
  });
});

describe('who is eligible', () => {
  it('never invites an account with no active subscription', async () => {
    // A free jobs-only account was never auto-enrolled as an affiliate, so
    // the invite would point at a referral link that does not exist.
    await addEvents({ sessions: 5, perSession: 10 });
    const free = { ...subscriber(), subscription_id: null };
    expect(await affiliateInvite.maybeInvite(pool, free)).toBe(false);
    expect(nurture.enroll).not.toHaveBeenCalled();
  });

  it('ignores a request with no authenticated user', async () => {
    expect(await affiliateInvite.maybeInvite(pool, undefined)).toBe(false);
    expect(nurture.enroll).not.toHaveBeenCalled();
  });
});

describe('sending only once', () => {
  it('does not re-enrol on every subsequent beacon batch', async () => {
    await addEvents({ sessions: 3, perSession: 4 });
    await affiliateInvite.maybeInvite(pool, subscriber());
    await affiliateInvite.maybeInvite(pool, subscriber());
    await affiliateInvite.maybeInvite(pool, subscriber());
    expect(nurture.enroll).toHaveBeenCalledTimes(1);
  });

  it('retries on the next batch when nurture was down, rather than losing the invite', async () => {
    await addEvents({ sessions: 3, perSession: 4 });
    nurture.enroll.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    expect(await affiliateInvite.maybeInvite(pool, subscriber())).toBe(false);
    expect(await affiliateInvite.maybeInvite(pool, subscriber())).toBe(true);
    expect(nurture.enroll).toHaveBeenCalledTimes(2);
  });

  it('never throws — telemetry ingest must not fail because an email did', async () => {
    await addEvents({ sessions: 3, perSession: 4 });
    nurture.enroll.mockRejectedValue(new Error('boom'));
    await expect(affiliateInvite.maybeInvite(pool, subscriber())).resolves.toBe(false);
  });
});
