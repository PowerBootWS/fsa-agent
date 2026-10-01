// "What's new" announcements: validation, publishing, eligibility, views,
// feedback and reporting. Spec: docs/superpowers/specs/2026-09-30-announcements-design.md.
//
// Audience rules match the rest of the platform: a "live" subscription is the
// requireAuth condition, and a job seeker is anyone with a non-archived saved
// job or an account that never had a subscription (a free job-only signup).

const AUDIENCES = ['everyone', 'students', 'second', 'third', 'fourth_a', 'fourth_b', 'affiliates', 'job_seekers'];
const CLASS_AUDIENCES = ['second', 'third', 'fourth_a', 'fourth_b'];
const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_SUB = `s.status = 'active' AND (s.cancel_at IS NULL OR s.cancel_at > NOW())`;

function validateAnnouncement(input, now = new Date()) {
  const a = input || {};
  const str = v => (typeof v === 'string' ? v.trim() : '');
  const errors = [];

  const slug = str(a.slug);
  const title = str(a.title);
  const body = str(a.body);
  const ctaLabel = str(a.cta_label) || null;
  const ctaUrl = str(a.cta_url) || null;

  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(slug)) errors.push('slug must be 3-80 characters of a-z, 0-9 and -');
  if (!title || title.length > 80) errors.push('title is required and at most 80 characters');
  if (!body || body.length > 600) errors.push('body is required and at most 600 characters');
  if (Boolean(ctaLabel) !== Boolean(ctaUrl)) errors.push('cta_label and cta_url go together');
  if (ctaLabel && ctaLabel.length > 30) errors.push('cta_label is at most 30 characters');
  if (ctaUrl && !(/^\/(?!\/)/.test(ctaUrl) || /^https:\/\//.test(ctaUrl))) {
    errors.push('cta_url must be an in-app path (/...) or an https:// URL');
  }

  const audiences = Array.isArray(a.audiences) ? [...new Set(a.audiences)] : [];
  if (audiences.length === 0) errors.push('audiences must list at least one group');
  const unknown = audiences.filter(g => !AUDIENCES.includes(g));
  if (unknown.length) errors.push(`unknown audience(s): ${unknown.join(', ')}`);

  const copy = [title, body, ctaLabel || ''].join('\n');
  if (copy.includes('—')) errors.push('no em dashes in announcement copy');
  if (/tailor/i.test(copy)) errors.push('never "tailor" in student-facing copy; say "custom resume"');

  const startsAt = a.starts_at ? new Date(a.starts_at) : new Date(now);
  const endsAt = a.ends_at ? new Date(a.ends_at) : new Date(startsAt.getTime() + 30 * DAY_MS);
  if (Number.isNaN(startsAt.getTime())) errors.push('starts_at is not a valid date');
  if (Number.isNaN(endsAt.getTime())) errors.push('ends_at is not a valid date');
  if (!errors.some(e => e.includes('valid date')) && endsAt <= startsAt) errors.push('ends_at must be after starts_at');

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { slug, title, body, cta_label: ctaLabel, cta_url: ctaUrl, audiences, starts_at: startsAt, ends_at: endsAt },
  };
}

async function upsertAnnouncement(pool, v) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO announcements (slug, title, body, cta_label, cta_url, audiences, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (slug) DO UPDATE SET
       title = EXCLUDED.title, body = EXCLUDED.body, cta_label = EXCLUDED.cta_label,
       cta_url = EXCLUDED.cta_url, audiences = EXCLUDED.audiences,
       starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at
     RETURNING id, (xmax = 0) AS inserted`,
    [v.slug, v.title, v.body, v.cta_label, v.cta_url, v.audiences, v.starts_at, v.ends_at]
  );
  return { id: row.id, inserted: row.inserted };
}

async function endAnnouncementNow(pool, slug) {
  const { rows } = await pool.query(
    `UPDATE announcements SET ends_at = GREATEST(now(), starts_at) WHERE slug = $1 RETURNING id`,
    [slug]
  );
  return rows[0]?.id ?? null;
}

// How many accounts would see this right now (ignores who already has).
// Reads affiliate.affiliates only if that schema exists (it doesn't in the
// test database).
async function countEligible(pool, v) {
  const { rows: [{ has_affiliate }] } = await pool.query(
    `SELECT to_regclass('affiliate.affiliates') IS NOT NULL AS has_affiliate`
  );
  const affiliateExpr = has_affiliate
    ? `EXISTS (SELECT 1 FROM affiliate.affiliates af WHERE af.email = lower(pu.email) AND af.status = 'active')`
    : 'false';
  const { rows: [{ count }] } = await pool.query(
    `WITH u AS (
       SELECT pu.id,
         EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = pu.id AND ${LIVE_SUB}) AS student,
         ARRAY(SELECT s.class_code FROM subscriptions s WHERE s.user_id = pu.id AND ${LIVE_SUB}) AS classes,
         ${affiliateExpr} AS affiliate,
         (EXISTS (SELECT 1 FROM saved_jobs j WHERE j.user_id = pu.id AND j.status <> 'archived')
          OR NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = pu.id)) AS job_seeker
       FROM platform_users pu
       WHERE pu.created_at <= $1
     )
     SELECT COUNT(*)::int AS count FROM u
     WHERE 'everyone' = ANY($2::text[])
        OR (student AND 'students' = ANY($2::text[]))
        OR (classes && $2::text[])
        OR (affiliate AND 'affiliates' = ANY($2::text[]))
        OR (job_seeker AND 'job_seekers' = ANY($2::text[]))`,
    [v.starts_at, v.audiences]
  );
  return count;
}

async function userGroups(pool, userId) {
  const { rows: [r] } = await pool.query(
    `SELECT
       ARRAY(SELECT s.class_code FROM subscriptions s WHERE s.user_id = $1 AND ${LIVE_SUB}) AS classes,
       EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = $1) AS had_any,
       EXISTS (SELECT 1 FROM saved_jobs j WHERE j.user_id = $1 AND j.status <> 'archived') AS has_saved`,
    [userId]
  );
  const groups = new Set(['everyone']);
  if (r.classes.length > 0) {
    groups.add('students');
    for (const c of r.classes) if (CLASS_AUDIENCES.includes(c)) groups.add(c);
  }
  if (r.has_saved || !r.had_any) groups.add('job_seekers');
  return groups;
}

async function findNextForUser(pool, user, { isAffiliate }) {
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.body, a.cta_label, a.cta_url, a.audiences
       FROM announcements a
       JOIN platform_users pu ON pu.id = $1
      WHERE now() >= a.starts_at AND now() < a.ends_at
        AND pu.created_at <= a.starts_at
        AND NOT EXISTS (
          SELECT 1 FROM announcement_views v WHERE v.announcement_id = a.id AND v.user_id = $1
        )
      ORDER BY a.starts_at DESC, a.id DESC`,
    [user.id]
  );
  if (rows.length === 0) return null;

  const groups = await userGroups(pool, user.id);
  let affiliate = null; // looked up lazily, at most once
  for (const a of rows) {
    let match = a.audiences.some(g => groups.has(g));
    if (!match && a.audiences.includes('affiliates')) {
      if (affiliate === null) {
        try { affiliate = Boolean(await isAffiliate(user.email)); } catch { affiliate = false; }
      }
      match = affiliate;
    }
    if (match) {
      const { id, title, body, cta_label, cta_url } = a;
      return { id, title, body, cta_label, cta_url };
    }
  }
  return null;
}

async function announcementExists(pool, id) {
  const { rows } = await pool.query(`SELECT id, title FROM announcements WHERE id = $1`, [id]);
  return rows[0] || null;
}

// First action wins: a later dismiss after a CTA click (or feedback after a
// dismiss) leaves the original row alone.
async function recordView(pool, announcementId, userId, action) {
  await pool.query(
    `INSERT INTO announcement_views (announcement_id, user_id, action) VALUES ($1, $2, $3)
     ON CONFLICT (announcement_id, user_id) DO NOTHING`,
    [announcementId, userId, action]
  );
}

async function saveFeedback(pool, announcementId, userId, message) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO announcement_feedback (announcement_id, user_id, message) VALUES ($1, $2, $3)`,
      [announcementId, userId, message]
    );
    await recordView(client, announcementId, userId, 'feedback');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function getReport(pool, slug) {
  const { rows: [a] } = await pool.query(
    `SELECT id, slug, title, audiences, starts_at, ends_at FROM announcements WHERE slug = $1`, [slug]);
  if (!a) return null;
  const { rows: counts } = await pool.query(
    `SELECT action, count(*)::int AS n FROM announcement_views WHERE announcement_id = $1 GROUP BY action`, [a.id]);
  const seen = { dismissed: 0, cta: 0, feedback: 0, total: 0 };
  for (const c of counts) { seen[c.action] = c.n; seen.total += c.n; }
  const { rows: feedback } = await pool.query(
    `SELECT concat_ws(' ', pu.first_name, pu.last_name) AS name, pu.email, f.message, f.created_at
       FROM announcement_feedback f JOIN platform_users pu ON pu.id = f.user_id
      WHERE f.announcement_id = $1 ORDER BY f.created_at ASC, f.id ASC`, [a.id]);
  const eligible = await countEligible(pool, { audiences: a.audiences, starts_at: a.starts_at });
  return { slug: a.slug, title: a.title, starts_at: a.starts_at, ends_at: a.ends_at, eligible, seen, feedback };
}

module.exports = {
  AUDIENCES, CLASS_AUDIENCES, LIVE_SUB,
  validateAnnouncement, upsertAnnouncement, endAnnouncementNow, countEligible,
  userGroups, findNextForUser,
  recordView, saveFeedback, announcementExists, getReport,
};
