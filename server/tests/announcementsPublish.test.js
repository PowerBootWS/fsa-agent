const fs = require('fs');
const os = require('os');
const path = require('path');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const {
  AUDIENCES, validateAnnouncement, upsertAnnouncement, endAnnouncementNow, countEligible,
} = require('../src/services/announcements');
const { publishFromFile } = require('../src/scripts/publish_announcement');

const FIXTURE_EMAIL_LIKE = 'annpub-%@example.com';
const NOW = new Date('2026-10-01T12:00:00Z');
const base = { slug: 'test-home', title: 'Meet your new Home page', body: 'Everything in one place.', audiences: ['everyone'] };

async function cleanup() {
  await pool.query(`DELETE FROM announcements WHERE slug LIKE 'test-%'`);
  await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
}

describe('validateAnnouncement', () => {
  it('fills the default window: starts now, ends 30 days later', () => {
    const r = validateAnnouncement(base, NOW);
    expect(r.ok).toBe(true);
    expect(r.value.starts_at.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(r.value.ends_at.toISOString()).toBe('2026-10-31T12:00:00.000Z');
    expect(r.value.cta_label).toBeNull();
  });

  it('lists every problem at once', () => {
    const r = validateAnnouncement({ slug: 'X', title: '', body: '', audiences: ['martians'], cta_label: 'Go' }, NOW);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/slug/);
    expect(r.errors.join('\n')).toMatch(/title/);
    expect(r.errors.join('\n')).toMatch(/body/);
    expect(r.errors.join('\n')).toMatch(/martians/);
    expect(r.errors.join('\n')).toMatch(/cta_label and cta_url/);
  });

  it('rejects em dashes and "tailor" in copy', () => {
    expect(validateAnnouncement({ ...base, body: 'New — shiny' }, NOW).errors.join()).toMatch(/em dash/);
    expect(validateAnnouncement({ ...base, title: 'Tailored resumes' }, NOW).errors.join()).toMatch(/tailor/);
  });

  it('accepts in-app paths and https links only', () => {
    expect(validateAnnouncement({ ...base, cta_label: 'Check it out', cta_url: '/home' }, NOW).ok).toBe(true);
    expect(validateAnnouncement({ ...base, cta_label: 'Read more', cta_url: 'https://fullsteamahead.ca/jobs' }, NOW).ok).toBe(true);
    expect(validateAnnouncement({ ...base, cta_label: 'x', cta_url: 'http://evil.example' }, NOW).ok).toBe(false);
    expect(validateAnnouncement({ ...base, cta_label: 'x', cta_url: '//evil.example' }, NOW).ok).toBe(false);
    expect(validateAnnouncement({ ...base, cta_label: 'x', cta_url: 'javascript:alert(1)' }, NOW).ok).toBe(false);
  });

  it('rejects an end before the start', () => {
    const r = validateAnnouncement({ ...base, starts_at: '2026-10-05T00:00:00Z', ends_at: '2026-10-01T00:00:00Z' }, NOW);
    expect(r.ok).toBe(false);
  });

  it('exports the exact audience list', () => {
    expect(AUDIENCES).toEqual(['everyone', 'students', 'second', 'third', 'fourth_a', 'fourth_b', 'affiliates', 'job_seekers']);
  });
});

describe('publishing', () => {
  beforeEach(cleanup);
  afterAll(async () => { await cleanup(); await pool.end(); });

  it('upserts by slug: re-publishing updates the copy, not a second row', async () => {
    const first = await upsertAnnouncement(pool, validateAnnouncement(base).value);
    const again = await upsertAnnouncement(pool, validateAnnouncement({ ...base, title: 'Updated title' }).value);
    expect(first.inserted).toBe(true);
    expect(again).toEqual({ id: first.id, inserted: false });
    const { rows } = await pool.query(`SELECT title FROM announcements WHERE slug = 'test-home'`);
    expect(rows).toEqual([{ title: 'Updated title' }]);
  });

  it('endAnnouncementNow closes the window; unknown slug returns null', async () => {
    const { id } = await upsertAnnouncement(pool, validateAnnouncement(base).value);
    expect(await endAnnouncementNow(pool, 'test-home')).toBe(id);
    const { rows: [a] } = await pool.query(`SELECT ends_at <= now() AS ended FROM announcements WHERE id = $1`, [id]);
    expect(a.ended).toBe(true);
    expect(await endAnnouncementNow(pool, 'test-nope')).toBeNull();
  });

  it('countEligible counts existing accounts in the audience', async () => {
    const hash = 'x';
    const mk = (email) => pool.query(
      `INSERT INTO platform_users (email, first_name, last_name, password_hash, created_at)
       VALUES ($1, 'A', 'B', $2, now() - interval '1 day') RETURNING id`, [email, hash]);
    const { rows: [student] } = await mk('annpub-student@example.com');
    await mk('annpub-jobonly@example.com');
    await pool.query(`INSERT INTO subscriptions (user_id, class_code, status, active_paper) VALUES ($1, 'second', 'active', '2A1')`, [student.id]);

    const before = await countEligible(pool, validateAnnouncement({ ...base, audiences: ['second'] }).value);
    const allBefore = await countEligible(pool, validateAnnouncement(base).value);
    // Relative to whatever else is in the test DB: our student adds 1 to "second";
    // both fixtures add 2 to "everyone".
    await pool.query(`UPDATE subscriptions SET status = 'inactive' WHERE user_id = $1`, [student.id]);
    const after = await countEligible(pool, validateAnnouncement({ ...base, audiences: ['second'] }).value);
    expect(before - after).toBe(1);
    expect(allBefore).toBeGreaterThanOrEqual(2);
  });

  it('countEligible does not fail when the affiliate schema is absent', async () => {
    await expect(countEligible(pool, validateAnnouncement({ ...base, audiences: ['affiliates'] }).value))
      .resolves.toEqual(expect.any(Number));
  });

  it('publishFromFile validates, upserts and reports the eligible count', async () => {
    const file = path.join(os.tmpdir(), `test-ann-${process.pid}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...base, slug: 'test-from-file' }));
    const result = await publishFromFile(pool, file);
    expect(result).toEqual({ id: expect.any(Number), inserted: true, eligible: expect.any(Number) });
    fs.writeFileSync(file, JSON.stringify({ ...base, slug: 'test-bad', audiences: [] }));
    await expect(publishFromFile(pool, file)).rejects.toThrow(/Invalid announcement/);
    fs.unlinkSync(file);
  });
});
