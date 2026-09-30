# Announcements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "What's new" pop-up in the LMS that shows each announcement once to the audiences it names, collects optional feedback to Russ on Telegram, and is published by a script from a JSON file in git.

**Architecture:**
- Storage is three new tables: `announcements`, `announcement_views` and `announcement_feedback`.
- One service module (`services/announcements.js`) holds validation, eligibility, publishing and reporting.
- A thin route file serves `next`, `seen` and `feedback`.
- Two CLI scripts publish and report.
- One React component (`AnnouncementModal`) is mounted in `AppShell`, so it appears on Home, lobby, Jobs, Profile and Credits, and never in lessons or exams.

**Tech Stack:** Express + pg (Jest + supertest), React + Vite (Vitest + Testing Library), fsa-common `telegram.notifyOwner`.

**Spec:** `docs/superpowers/specs/2026-09-30-announcements-design.md`

## Global Constraints

- **Workspace:** all work happens in the git worktree `/home/debian/.worktrees/fsa-agent-ann` (branch `feat/announcements`, created by the controller). Paths below are relative to that worktree root. Never edit `/home/debian/fsa-agent` directly. `node_modules` are symlinks to the main checkout; never run npm install/ci.
- **No implementer deploys, pushes, restarts containers, or touches the production `fsa_agent` database.** Task 6 (deploy) is controller-only.
- **Server tests run only against `fsa_agent_test`:** `cd server && POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-) npm test -- <pattern>`. **Never `source` or `set -a` `/home/debian/.env.shared`**; it sets `POSTGRES_DB=fsa_agent` (production). "Jest did not exit one second after the test run" is pre-existing noise.
- The test database has **no `affiliate` schema**. Code that reads `affiliate.*` directly must tolerate its absence.
- Fixture emails use a file-scoped prefix `…@example.com` and are removed with `deleteFixtureUsersByEmailLike` (`server/tests/fixtureCleanup.js`). Fixture announcements use slugs starting `test-` and are removed with `DELETE FROM announcements WHERE slug LIKE 'test-%'`; views and feedback cascade. Never write an unscoped DELETE.
- `platform_users.last_name` is NOT NULL; fixture inserts must set it.
- **Audience values (exact):** `everyone`, `students`, `second`, `third`, `fourth_a`, `fourth_b`, `affiliates`, `job_seekers`.
- **"Live subscription"** means `status = 'active' AND (cancel_at IS NULL OR cancel_at > NOW())`, the same test as `requireAuth`.
- **Job seeker** means at least one `saved_jobs` row with `status <> 'archived'`, **or** no `subscriptions` row ever.
- **Defaults and limits:**
  - Window: `ends_at` defaults to `starts_at` + 30 days, and `starts_at` defaults to now.
  - Feedback: 1–2000 characters after trim, and at most 5 posts per user per hour.
- **Student-facing copy:** never "tailor", and no em dashes (—).
- New client styling lives in the co-located `AnnouncementModal.css` with prefix `an-`. No inline-style objects.
- **Analytics:** the usage taxonomy lives in two identical files, `server/src/config/usageTaxonomy.json` and `client-v2/src/utils/usageTaxonomy.json`, and they must stay byte-identical.
- Commit messages end with the line `Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb`. Before each commit, confirm the branch is `feat/announcements`, and stage only the files you changed.

## Review Focus

1. **Affiliate-only announcement when the affiliate service is down:** no pop-up, no error, and it shows on a later visit. Tested in Task 2.
2. **An account created after the announcement started** never sees it, even when its audience is `everyone`. Tested in Task 2.
3. **A double-click on Send, or feedback posted after the pop-up was already dismissed:** no duplicate view row and no 500. The view keeps its first action. Tested in Task 3.
4. **Escape pressed while typing feedback:** it closes and records `dismissed`. Losing the draft is acceptable, but a stuck pop-up is not. Tested in Task 5.
5. **An announcement whose `cta_url` is an https link to another site:** it opens that URL and is not treated as a router path. Tested in Task 5.

---

## File Map

| File | Change |
|---|---|
| `server/migrations/022_announcements.sql` | Create: three tables |
| `server/src/services/announcements.js` | Create: `AUDIENCES`, `validateAnnouncement`, `upsertAnnouncement`, `endAnnouncementNow`, `countEligible`, `userGroups`, `findNextForUser`, `recordView`, `saveFeedback`, `getReport` |
| `server/src/scripts/publish_announcement.js` | Create: CLI to publish from JSON or `--end-now <slug>` |
| `server/src/scripts/announcement_report.js` | Create: CLI report |
| `server/src/announcements/.gitkeep` | Create: home for announcement JSON files |
| `server/src/routes/announcements.js` | Create: `GET /announcements/next`, `POST /announcements/:id/seen`, `POST /announcements/:id/feedback` |
| `server/src/index.js` | Modify: mount at `/api/platform` |
| `server/src/config/usageTaxonomy.json`, `client-v2/src/utils/usageTaxonomy.json` | Modify: add 3 actions |
| `client-v2/src/components/AnnouncementModal.jsx` / `.css` / `.test.jsx` | Create |
| `client-v2/src/components/AppShell.jsx` | Modify: render `<AnnouncementModal />` |
| `server/tests/announcementsPublish.test.js`, `announcementsEligibility.test.js`, `announcementsRoutes.test.js`, `announcementsReport.test.js` | Create |

---

### Task 1: Schema, validation and publishing

**Files:**
- Create: `server/migrations/022_announcements.sql`, `server/src/services/announcements.js` (first part), `server/src/scripts/publish_announcement.js`, `server/src/announcements/.gitkeep`
- Test: `server/tests/announcementsPublish.test.js`

**Interfaces:**
- Produces:
  - `AUDIENCES`: the exact 8-value array.
  - `validateAnnouncement(input, now = new Date())` returns `{ ok: true, value: { slug, title, body, cta_label, cta_url, audiences, starts_at: Date, ends_at: Date } }` or `{ ok: false, errors: string[] }`.
  - `upsertAnnouncement(pool, value)` returns `{ id, inserted: boolean }`.
  - `endAnnouncementNow(pool, slug)` returns `id | null`.
  - `countEligible(pool, value)` returns a number: accounts eligible right now, ignoring who has already seen it.
  - `publishFromFile(pool, filePath)` returns `{ id, inserted, eligible }` and throws `Error('Invalid announcement: …')` on validation failure.

- [ ] **Step 1: Create the migration and apply it to the test DB**

`server/migrations/022_announcements.sql`:

```sql
-- 022: "What's new" announcements (spec docs/superpowers/specs/2026-09-30-announcements-design.md).
-- Written by Claude when a feature ships, approved by Russ, published by
-- src/scripts/publish_announcement.js. Replay-safe (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS announcements (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  cta_label   TEXT,
  cta_url     TEXT,
  audiences   TEXT[] NOT NULL CHECK (
                cardinality(audiences) > 0 AND
                audiences <@ ARRAY['everyone','students','second','third','fourth_a','fourth_b','affiliates','job_seekers']::text[]
              ),
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS announcement_views (
  announcement_id  INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  action           TEXT NOT NULL CHECK (action IN ('dismissed', 'cta', 'feedback')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS announcement_feedback (
  id               SERIAL PRIMARY KEY,
  announcement_id  INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  message          TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS announcement_feedback_announcement_idx ON announcement_feedback (announcement_id);
```

Apply it to the **test** database only:

```bash
docker cp server/migrations/022_announcements.sql fsa-postgres:/tmp/022.sql && \
docker exec fsa-postgres psql -U postgres -d fsa_agent_test -v ON_ERROR_STOP=1 -f /tmp/022.sql
```

Expected output: `CREATE TABLE` ×3, then `CREATE INDEX`. Then create an empty `server/src/announcements/.gitkeep`.

- [ ] **Step 2: Write the failing tests**

`server/tests/announcementsPublish.test.js`:

```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd server && POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-) npm test -- announcementsPublish`
Expected: FAIL with `Cannot find module '../src/services/announcements'`.

- [ ] **Step 4: Implement**

`server/src/services/announcements.js` (first part; Tasks 2–4 append to it):

```js
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

module.exports = {
  AUDIENCES, CLASS_AUDIENCES, LIVE_SUB,
  validateAnnouncement, upsertAnnouncement, endAnnouncementNow, countEligible,
};
```

`server/src/scripts/publish_announcement.js`:

```js
#!/usr/bin/env node
/**
 * Publish an announcement from its JSON file (upsert by slug), or pull one early.
 *
 *   node src/scripts/publish_announcement.js src/announcements/<slug>.json
 *   node src/scripts/publish_announcement.js --end-now <slug>
 *
 * Process rule: Russ approves the title, body, button and audience list in
 * chat before this runs. See wiki/projects/fsa-agent.md "Announcements".
 */
const fs = require('fs');
const { pool } = require('../services/database');
const {
  validateAnnouncement, upsertAnnouncement, endAnnouncementNow, countEligible,
} = require('../services/announcements');

async function publishFromFile(db, filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const result = validateAnnouncement(parsed);
  if (!result.ok) throw new Error(`Invalid announcement:\n  - ${result.errors.join('\n  - ')}`);
  const { id, inserted } = await upsertAnnouncement(db, result.value);
  const eligible = await countEligible(db, result.value);
  return { id, inserted, eligible };
}

async function main(argv) {
  if (argv[0] === '--end-now') {
    if (!argv[1]) throw new Error('usage: publish_announcement.js --end-now <slug>');
    const id = await endAnnouncementNow(pool, argv[1]);
    console.log(id ? `Ended announcement ${argv[1]} (id ${id}).` : `No announcement with slug ${argv[1]}.`);
    return;
  }
  if (!argv[0]) throw new Error('usage: publish_announcement.js <file.json> | --end-now <slug>');
  const r = await publishFromFile(pool, argv[0]);
  console.log(`${r.inserted ? 'Published' : 'Updated'} announcement id ${r.id}. Eligible accounts right now: ${r.eligible}.`);
}

if (require.main === module) {
  main(process.argv.slice(2))
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { publishFromFile };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run the Step 3 command. Expected: PASS (all tests in `announcementsPublish`).

- [ ] **Step 6: Commit**

```bash
git add server/migrations/022_announcements.sql server/src/services/announcements.js server/src/scripts/publish_announcement.js server/src/announcements/.gitkeep server/tests/announcementsPublish.test.js
git commit -m "feat: announcements schema, validation and publish script

Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb"
```

---

### Task 2: Eligibility (who sees what, next)

**Files:**
- Modify: `server/src/services/announcements.js` (append, and extend `module.exports`)
- Test: `server/tests/announcementsEligibility.test.js`

**Interfaces:**
- Consumes: `LIVE_SUB` and `upsertAnnouncement`/`validateAnnouncement` from Task 1.
- Produces:
  - `userGroups(pool, userId)` returns a `Set<string>` of every audience except `affiliates`.
  - `findNextForUser(pool, user, { isAffiliate })`:
    - `user` is `{ id, email }`; `isAffiliate` is `async (email) => boolean`.
    - Returns `{ id, title, body, cta_label, cta_url }` or `null`.
    - `isAffiliate` is called at most once, and only if an unmatched candidate targets `affiliates`. If it throws, it counts as `false`.

- [ ] **Step 1: Write the failing tests**

`server/tests/announcementsEligibility.test.js`:

```js
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const { userGroups, findNextForUser } = require('../src/services/announcements');

const FIXTURE_EMAIL_LIKE = 'annelig-%@example.com';

async function cleanup() {
  await pool.query(`DELETE FROM announcements WHERE slug LIKE 'test-%'`);
  await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
}

// Users are created "yesterday" so announcements starting now are after signup.
async function makeUser(tag, { subs = [], savedJobs = 0 } = {}) {
  const email = `annelig-${tag}@example.com`;
  const { rows: [u] } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, created_at)
     VALUES ($1, 'Test', 'User', now() - interval '1 day') RETURNING id`, [email]);
  for (const s of subs) {
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper, cancel_at) VALUES ($1, $2, $3, $4, $5)`,
      [u.id, s.class_code, s.status || 'active', s.active_paper || null, s.cancel_at || null]);
  }
  for (let i = 0; i < savedJobs; i++) {
    await pool.query(
      `INSERT INTO saved_jobs (user_id, title, company, status) VALUES ($1, 'Operator', 'Plant', 'saved')`, [u.id]);
  }
  return { id: u.id, email };
}

async function announce(slug, audiences, { startsAgo = '0 minutes', endsIn = '30 days' } = {}) {
  const { rows: [a] } = await pool.query(
    `INSERT INTO announcements (slug, title, body, audiences, starts_at, ends_at)
     VALUES ($1, $1, 'Body', $2, now() - $3::interval, now() + $4::interval) RETURNING id`,
    [slug, audiences, startsAgo, endsIn]);
  return a.id;
}

const notAffiliate = async () => false;

describe('announcement eligibility', () => {
  beforeEach(cleanup);
  afterAll(async () => { await cleanup(); await pool.end(); });

  it('userGroups: live 2nd Class student', async () => {
    const u = await makeUser('second', { subs: [{ class_code: 'second', active_paper: '2A1' }] });
    expect([...(await userGroups(pool, u.id))].sort()).toEqual(['everyone', 'second', 'students']);
  });

  it('userGroups: job-only account is a job seeker, not a student', async () => {
    const u = await makeUser('jobonly');
    expect([...(await userGroups(pool, u.id))].sort()).toEqual(['everyone', 'job_seekers']);
  });

  it('userGroups: lapsed student with a saved job is a job seeker; without one is neither', async () => {
    const past = { class_code: 'third', active_paper: '3A1', cancel_at: '2026-01-01T00:00:00Z' };
    const withJob = await makeUser('lapsedjob', { subs: [past], savedJobs: 1 });
    const without = await makeUser('lapsed', { subs: [past] });
    expect([...(await userGroups(pool, withJob.id))].sort()).toEqual(['everyone', 'job_seekers']);
    expect([...(await userGroups(pool, without.id))]).toEqual(['everyone']);
  });

  it('shows the newest eligible announcement first', async () => {
    const u = await makeUser('newest');
    await announce('test-older', ['everyone'], { startsAgo: '2 hours' });
    const newer = await announce('test-newer', ['everyone'], { startsAgo: '1 hour' });
    expect((await findNextForUser(pool, u, { isAffiliate: notAffiliate })).id).toBe(newer);
  });

  it('skips announcements for other audiences', async () => {
    const u = await makeUser('skip', { subs: [{ class_code: 'second', active_paper: '2A1' }] });
    await announce('test-fourth', ['fourth_a', 'fourth_b']);
    expect(await findNextForUser(pool, u, { isAffiliate: notAffiliate })).toBeNull();
  });

  it('never shows an announcement that started before the account existed', async () => {
    const u = await makeUser('late');   // created 1 day ago
    await announce('test-old', ['everyone'], { startsAgo: '2 days' });
    expect(await findNextForUser(pool, u, { isAffiliate: notAffiliate })).toBeNull();
  });

  it('respects the window', async () => {
    const u = await makeUser('window');
    await announce('test-expired', ['everyone'], { startsAgo: '2 hours', endsIn: '-1 hour' });
    await pool.query(
      `INSERT INTO announcements (slug, title, body, audiences, starts_at, ends_at)
       VALUES ('test-future', 'f', 'b', '{everyone}', now() + interval '1 day', now() + interval '2 days')`);
    expect(await findNextForUser(pool, u, { isAffiliate: notAffiliate })).toBeNull();
  });

  it('never shows a seen announcement again', async () => {
    const u = await makeUser('seen');
    const id = await announce('test-seen', ['everyone']);
    await pool.query(`INSERT INTO announcement_views (announcement_id, user_id, action) VALUES ($1, $2, 'dismissed')`, [id, u.id]);
    expect(await findNextForUser(pool, u, { isAffiliate: notAffiliate })).toBeNull();
  });

  it('affiliates: asks the affiliate lookup once, only when needed', async () => {
    const u = await makeUser('aff', { subs: [{ class_code: 'second', active_paper: '2A1' }] });
    const id = await announce('test-aff', ['affiliates']);
    const isAffiliate = jest.fn(async () => true);
    expect((await findNextForUser(pool, u, { isAffiliate })).id).toBe(id);
    expect(isAffiliate).toHaveBeenCalledTimes(1);
    expect(isAffiliate).toHaveBeenCalledWith(u.email);
  });

  it('affiliates: a failing lookup means no pop-up, not an error', async () => {
    const u = await makeUser('affdown');
    await announce('test-aff-down', ['affiliates']);
    const isAffiliate = jest.fn(async () => { throw new Error('down'); });
    await expect(findNextForUser(pool, u, { isAffiliate })).resolves.toBeNull();
  });

  it('does not call the affiliate lookup when nothing targets affiliates', async () => {
    const u = await makeUser('noaff');
    await announce('test-all', ['everyone']);
    const isAffiliate = jest.fn(async () => true);
    await findNextForUser(pool, u, { isAffiliate });
    expect(isAffiliate).not.toHaveBeenCalled();
  });

  it('returns only the display fields', async () => {
    const u = await makeUser('shape');
    await announce('test-shape', ['everyone']);
    const a = await findNextForUser(pool, u, { isAffiliate: notAffiliate });
    expect(Object.keys(a).sort()).toEqual(['body', 'cta_label', 'cta_url', 'id', 'title']);
  });
});
```

Before running, check the `saved_jobs` NOT NULL columns: `docker exec fsa-postgres psql -U postgres -d fsa_agent_test -c '\d saved_jobs'`. If the fixture `INSERT` is missing a required column that has no default, add it with a fixture value. Do not change the assertions.

- [ ] **Step 2: Run to verify failure**

Run: `cd server && POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-) npm test -- announcementsEligibility`
Expected: FAIL. `userGroups is not a function`.

- [ ] **Step 3: Implement** (append to `services/announcements.js`, and add `userGroups, findNextForUser` to `module.exports`)

```js
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
```

- [ ] **Step 4: Run to verify pass**, plus `announcementsPublish`

Run: `… npm test -- announcements`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/announcements.js server/tests/announcementsEligibility.test.js
git commit -m "feat: announcement eligibility by audience, window and seen

Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb"
```

---

### Task 3: Routes (next, seen, feedback) and Telegram

**Files:**
- Modify: `server/src/services/announcements.js` (append `recordView`, `saveFeedback`, `announcementExists`)
- Create: `server/src/routes/announcements.js`
- Modify: `server/src/index.js` (require and mount directly after the existing `app.use('/api/platform', homeRouter);`)
- Modify: both `usageTaxonomy.json` files: append to `actions`: `"announcement_shown"`, `"announcement_cta"`, `"announcement_feedback"`
- Test: `server/tests/announcementsRoutes.test.js`

**Interfaces:**
- Consumes: `findNextForUser` (Task 2); `affiliateClient.getSummary(email)` → `{is_affiliate}` or `null` (`server/src/services/affiliateClient.js`); `telegram.notifyOwner(text)` from `fsa-common`; `createRateLimiter({ windowMs, max })` → `{ check(key) → boolean }` (`server/src/utils/rateLimit.js`).
- Produces:
  - `recordView(pool, announcementId, userId, action)`: idempotent, first action wins.
  - `saveFeedback(pool, announcementId, userId, message)`: inserts feedback and records a `feedback` view in one transaction.
  - `announcementExists(pool, id)` returns `{ id, title } | null`.
  - Routes:
    - `GET /api/platform/announcements/next` → `200 { announcement }` (null on any error).
    - `POST …/:id/seen` → `204` | `400` | `404`.
    - `POST …/:id/feedback` → `201 { ok: true }` | `400` | `404` | `429`.

- [ ] **Step 1: Write the failing tests**

`server/tests/announcementsRoutes.test.js`:

```js
jest.mock('fsa-common', () => ({
  telegram: { notifyOwner: jest.fn().mockResolvedValue(undefined) },
  email: { sendEmail: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/services/affiliateClient');

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { telegram } = require('fsa-common');
const affiliateClient = require('../src/services/affiliateClient');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const authRouter = require('../src/routes/auth');
const announcementsRouter = require('../src/routes/announcements');

const FIXTURE_EMAIL_LIKE = 'annroute-%@example.com';
const PASSWORD = 'longenoughpassword';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use('/api/platform', announcementsRouter);
  return app;
}

async function login(app, tag) {
  const email = `annroute-${tag}@example.com`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash, created_at)
     VALUES ($1, 'Taylor', 'Tester', $2, now() - interval '1 day')`, [email, hash]);
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return (res.headers['set-cookie'] || []).find(c => c.startsWith('fsa_session=')).split(';')[0];
}

async function announce(slug, extra = {}) {
  const { rows: [a] } = await pool.query(
    `INSERT INTO announcements (slug, title, body, cta_label, cta_url, audiences, starts_at, ends_at)
     VALUES ($1, 'New Home', 'Body', $2, $3, '{everyone}', now(), now() + interval '30 days') RETURNING id`,
    [slug, extra.cta_label || null, extra.cta_url || null]);
  return a.id;
}

afterAll(async () => { await pool.end(); });

describe('announcement routes', () => {
  beforeEach(async () => {
    affiliateClient.getSummary.mockResolvedValue({ is_affiliate: false });
    telegram.notifyOwner.mockClear();
  });
  afterEach(async () => {
    await pool.query(`DELETE FROM announcements WHERE slug LIKE 'test-%'`);
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  it('GET next returns the announcement, then null once dismissed', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'next');
    const id = await announce('test-next', { cta_label: 'Check it out', cta_url: '/home' });
    const first = await request(app).get('/api/platform/announcements/next').set('Cookie', cookie);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ announcement: { id, title: 'New Home', body: 'Body', cta_label: 'Check it out', cta_url: '/home' } });

    const seen = await request(app).post(`/api/platform/announcements/${id}/seen`).set('Cookie', cookie).send({ action: 'dismissed' });
    expect(seen.status).toBe(204);
    const after = await request(app).get('/api/platform/announcements/next').set('Cookie', cookie);
    expect(after.body).toEqual({ announcement: null });
  });

  it('seen is idempotent and keeps the first action', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'idem');
    const id = await announce('test-idem');
    await request(app).post(`/api/platform/announcements/${id}/seen`).set('Cookie', cookie).send({ action: 'cta' });
    const again = await request(app).post(`/api/platform/announcements/${id}/seen`).set('Cookie', cookie).send({ action: 'dismissed' });
    expect(again.status).toBe(204);
    const { rows } = await pool.query(`SELECT action FROM announcement_views WHERE announcement_id = $1`, [id]);
    expect(rows).toEqual([{ action: 'cta' }]);
  });

  it('seen rejects a bad action and an unknown id', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'bad');
    const id = await announce('test-bad');
    expect((await request(app).post(`/api/platform/announcements/${id}/seen`).set('Cookie', cookie).send({ action: 'feedback' })).status).toBe(400);
    expect((await request(app).post(`/api/platform/announcements/999999/seen`).set('Cookie', cookie).send({ action: 'dismissed' })).status).toBe(404);
    expect((await request(app).post(`/api/platform/announcements/abc/seen`).set('Cookie', cookie).send({ action: 'dismissed' })).status).toBe(404);
  });

  it('feedback saves, marks seen, and notifies Russ', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'fb');
    const id = await announce('test-fb');
    const res = await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie)
      .send({ message: '  Love it. Add a dark mode?  ' });
    expect(res.status).toBe(201);
    const { rows: fb } = await pool.query(`SELECT message FROM announcement_feedback WHERE announcement_id = $1`, [id]);
    expect(fb).toEqual([{ message: 'Love it. Add a dark mode?' }]);
    const { rows: views } = await pool.query(`SELECT action FROM announcement_views WHERE announcement_id = $1`, [id]);
    expect(views).toEqual([{ action: 'feedback' }]);
    await new Promise(r => setImmediate(r));
    expect(telegram.notifyOwner).toHaveBeenCalledTimes(1);
    const text = telegram.notifyOwner.mock.calls[0][0];
    expect(text).toContain('New Home');
    expect(text).toContain('annroute-fb@example.com');
    expect(text).toContain('Love it. Add a dark mode?');
  });

  it('feedback after dismiss keeps the dismiss and still saves; a double send makes no duplicate view', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'after');
    const id = await announce('test-after');
    await request(app).post(`/api/platform/announcements/${id}/seen`).set('Cookie', cookie).send({ action: 'dismissed' });
    const a = await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie).send({ message: 'one' });
    const b = await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie).send({ message: 'two' });
    expect([a.status, b.status]).toEqual([201, 201]);
    const { rows } = await pool.query(`SELECT action FROM announcement_views WHERE announcement_id = $1`, [id]);
    expect(rows).toEqual([{ action: 'dismissed' }]);
    const { rows: fb } = await pool.query(`SELECT count(*)::int AS n FROM announcement_feedback WHERE announcement_id = $1`, [id]);
    expect(fb[0].n).toBe(2);
  });

  it('feedback validation: empty and over-long messages are 400', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'val');
    const id = await announce('test-val');
    expect((await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie).send({ message: '   ' })).status).toBe(400);
    expect((await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie).send({ message: 'x'.repeat(2001) })).status).toBe(400);
    expect((await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie).send({})).status).toBe(400);
  });

  it('feedback is rate limited to 5 per hour per user', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'rate');
    const id = await announce('test-rate');
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie).send({ message: `m${i}` })).status);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('a Telegram failure never fails the request', async () => {
    telegram.notifyOwner.mockRejectedValueOnce(new Error('telegram down'));
    const app = buildTestApp();
    const cookie = await login(app, 'tg');
    const id = await announce('test-tg');
    const res = await request(app).post(`/api/platform/announcements/${id}/feedback`).set('Cookie', cookie).send({ message: 'hi' });
    expect(res.status).toBe(201);
  });

  it('GET next answers null (not 500) when the lookup blows up', async () => {
    const app = buildTestApp();
    const cookie = await login(app, 'boom');
    await pool.query(
      `INSERT INTO announcements (slug, title, body, audiences, starts_at, ends_at)
       VALUES ('test-boom', 't', 'b', '{affiliates}', now(), now() + interval '1 day')`);
    affiliateClient.getSummary.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/platform/announcements/next').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ announcement: null });
  });

  it('requires a session', async () => {
    expect((await request(buildTestApp()).get('/api/platform/announcements/next')).status).toBe(401);
  });
});
```

The "5 per hour" limiter is module-level. Each test uses a different user id, so the tests don't interfere with each other.

- [ ] **Step 2: Run to verify failure**

Run: `… npm test -- announcementsRoutes`
Expected: FAIL. `Cannot find module '../src/routes/announcements'`.

- [ ] **Step 3: Implement**

Append to `services/announcements.js`, and add `recordView, saveFeedback, announcementExists` to `module.exports`:

```js
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
```

`server/src/routes/announcements.js`:

```js
// "What's new" pop-up API. A failure on the read path answers "nothing to
// show": an announcement must never get in the way of someone's course.
const express = require('express');
const { telegram } = require('fsa-common');
const { pool } = require('../services/database');
const requireAuth = require('../middleware/requireAuth');
const affiliateClient = require('../services/affiliateClient');
const { createRateLimiter } = require('../utils/rateLimit');
const {
  findNextForUser, recordView, saveFeedback, announcementExists,
} = require('../services/announcements');

const router = express.Router();
const feedbackLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
const MAX_FEEDBACK = 2000;

function parseId(raw) {
  return /^\d+$/.test(String(raw)) ? Number(raw) : null;
}

router.get('/announcements/next', requireAuth, async (req, res) => {
  try {
    const announcement = await findNextForUser(pool, req.user, {
      isAffiliate: async (email) => (await affiliateClient.getSummary(email))?.is_affiliate === true,
    });
    return res.json({ announcement });
  } catch (err) {
    console.error('GET /api/platform/announcements/next error:', err);
    return res.json({ announcement: null });
  }
});

router.post('/announcements/:id/seen', requireAuth, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null || !(await announcementExists(pool, id))) return res.status(404).json({ error: 'Not found' });
    const action = req.body?.action;
    if (action !== 'dismissed' && action !== 'cta') return res.status(400).json({ error: 'action must be dismissed or cta' });
    await recordView(pool, id, req.user.id, action);
    return res.status(204).end();
  } catch (err) {
    console.error('POST /api/platform/announcements/:id/seen error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/announcements/:id/feedback', requireAuth, async (req, res) => {
  let announcement;
  let message;
  try {
    const id = parseId(req.params.id);
    announcement = id === null ? null : await announcementExists(pool, id);
    if (!announcement) return res.status(404).json({ error: 'Not found' });
    message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message || message.length > MAX_FEEDBACK) {
      return res.status(400).json({ error: `Feedback must be 1 to ${MAX_FEEDBACK} characters` });
    }
    if (!feedbackLimiter.check(String(req.user.id))) {
      return res.status(429).json({ error: 'That is a lot of feedback at once. Try again in a bit.' });
    }
    await saveFeedback(pool, announcement.id, req.user.id, message);
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('POST /api/platform/announcements/:id/feedback error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  // After the response: nothing here may reject unhandled.
  const u = req.user;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
  telegram.notifyOwner(
    `💡 Feedback on "${announcement.title}"\n\n` +
    `From: ${name || '(no name)'} <${u.email}>\n\n` +
    message
  ).catch(err => console.error('announcement feedback notify failed (non-fatal):', err.message));
});

module.exports = router;
```

`server/src/index.js`: add `const announcementsRouter = require('./routes/announcements');` with the other route requires, and `app.use('/api/platform', announcementsRouter);` directly after `app.use('/api/platform', homeRouter);`.

Taxonomy: append the three actions to `actions` in both files, with identical edits.

- [ ] **Step 4: Run to verify pass**

Run: `… npm test -- announcements usageEvents apiNotFound && diff src/config/usageTaxonomy.json ../client-v2/src/utils/usageTaxonomy.json && echo TAXONOMY-IDENTICAL`
Expected: all pass, then `TAXONOMY-IDENTICAL`.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/announcements.js server/src/routes/announcements.js server/src/index.js server/src/config/usageTaxonomy.json client-v2/src/utils/usageTaxonomy.json server/tests/announcementsRoutes.test.js
git commit -m "feat: announcement routes and Telegram feedback

Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb"
```

---

### Task 4: Report script

**Files:**
- Modify: `server/src/services/announcements.js` (append `getReport`, export it)
- Create: `server/src/scripts/announcement_report.js`
- Test: `server/tests/announcementsReport.test.js`

**Interfaces:**
- Consumes: `countEligible`, `validateAnnouncement` (Task 1).
- Produces: `getReport(pool, slug)` returns `null` or:
  ```
  {
    slug, title, starts_at, ends_at, eligible,
    seen: { dismissed, cta, feedback, total },
    feedback: [{ name, email, message, created_at }]   // oldest first
  }
  ```

- [ ] **Step 1: Write the failing test**

`server/tests/announcementsReport.test.js`:

```js
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const { getReport } = require('../src/services/announcements');

const FIXTURE_EMAIL_LIKE = 'annrep-%@example.com';

async function cleanup() {
  await pool.query(`DELETE FROM announcements WHERE slug LIKE 'test-%'`);
  await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
}

describe('getReport', () => {
  beforeEach(cleanup);
  afterAll(async () => { await cleanup(); await pool.end(); });

  it('returns null for an unknown slug', async () => {
    expect(await getReport(pool, 'test-missing')).toBeNull();
  });

  it('counts views by action and lists feedback oldest first', async () => {
    const { rows: [a] } = await pool.query(
      `INSERT INTO announcements (slug, title, body, audiences, starts_at, ends_at)
       VALUES ('test-rep', 'New Home', 'b', '{everyone}', now(), now() + interval '30 days') RETURNING id`);
    const users = [];
    for (const tag of ['a', 'b', 'c']) {
      const { rows: [u] } = await pool.query(
        `INSERT INTO platform_users (email, first_name, last_name) VALUES ($1, 'Pat', $2) RETURNING id`,
        [`annrep-${tag}@example.com`, tag.toUpperCase()]);
      users.push(u.id);
    }
    await pool.query(`INSERT INTO announcement_views (announcement_id, user_id, action) VALUES ($1,$2,'dismissed'),($1,$3,'cta'),($1,$4,'feedback')`, [a.id, ...users]);
    await pool.query(`INSERT INTO announcement_feedback (announcement_id, user_id, message, created_at) VALUES ($1,$2,'second', now()), ($1,$2,'first', now() - interval '1 minute')`, [a.id, users[2]]);

    const r = await getReport(pool, 'test-rep');
    expect(r.title).toBe('New Home');
    expect(r.eligible).toEqual(expect.any(Number));
    expect(r.seen).toEqual({ dismissed: 1, cta: 1, feedback: 1, total: 3 });
    expect(r.feedback.map(f => f.message)).toEqual(['first', 'second']);
    expect(r.feedback[0]).toMatchObject({ name: 'Pat C', email: 'annrep-c@example.com' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `… npm test -- announcementsReport`. Expected: FAIL. `getReport is not a function`.

- [ ] **Step 3: Implement**

Append to `services/announcements.js` and export `getReport`:

```js
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
```

`server/src/scripts/announcement_report.js`:

```js
#!/usr/bin/env node
/** node src/scripts/announcement_report.js <slug> — reach and feedback for one announcement. */
const { pool } = require('../services/database');
const { getReport } = require('../services/announcements');

async function main(slug) {
  if (!slug) throw new Error('usage: announcement_report.js <slug>');
  const r = await getReport(pool, slug);
  if (!r) { console.log(`No announcement with slug ${slug}.`); return; }
  console.log(`${r.title} (${r.slug})`);
  console.log(`Window: ${r.starts_at.toISOString()} to ${r.ends_at.toISOString()}`);
  console.log(`Eligible now: ${r.eligible}`);
  console.log(`Seen: ${r.seen.total} (dismissed ${r.seen.dismissed}, clicked ${r.seen.cta}, feedback ${r.seen.feedback})`);
  console.log(`\nFeedback (${r.feedback.length}):`);
  for (const f of r.feedback) {
    console.log(`\n[${f.created_at.toISOString()}] ${f.name} <${f.email}>\n${f.message}`);
  }
}

if (require.main === module) {
  main(process.argv[2])
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
```

- [ ] **Step 4: Run to verify pass**: `… npm test -- announcements`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/announcements.js server/src/scripts/announcement_report.js server/tests/announcementsReport.test.js
git commit -m "feat: announcement report script

Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb"
```

---

### Task 5: AnnouncementModal (client)

**Files:**
- Create: `client-v2/src/components/AnnouncementModal.jsx`, `AnnouncementModal.css`, `AnnouncementModal.test.jsx`
- Modify: `client-v2/src/components/AppShell.jsx`:
  - `import AnnouncementModal from './AnnouncementModal';`
  - Render `<AnnouncementModal />` directly after `<div className="as-content">{children}</div>`.

**Interfaces:**
- Consumes: the Task 3 routes; `track` from `../utils/usage`.
- Produces: default export `AnnouncementModal`, and named export `_resetAnnouncementCheck()` for tests.

- [ ] **Step 1: Write the failing tests**

`client-v2/src/components/AnnouncementModal.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AnnouncementModal, { _resetAnnouncementCheck } from './AnnouncementModal';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => mockNavigate,
}));

const respond = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const ann = { id: 7, title: 'Meet your new Home page', body: 'Everything in one place.\n\nTake a look.', cta_label: 'Check it out', cta_url: '/home' };

function setup(announcement = ann) {
  globalThis.fetch = vi.fn(async (url, opts) => {
    if (String(url).endsWith('/announcements/next')) return respond({ announcement });
    return respond({ ok: true }, opts?.method === 'POST' && String(url).endsWith('/feedback') ? 201 : 204);
  });
  return render(<MemoryRouter><AnnouncementModal /></MemoryRouter>);
}
const posts = (suffix) => globalThis.fetch.mock.calls.filter(([u, o]) => String(u).endsWith(suffix) && o?.method === 'POST');

beforeEach(() => { _resetAnnouncementCheck(); mockNavigate.mockClear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('AnnouncementModal', () => {
  it('renders nothing when there is no announcement', async () => {
    setup(null);
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the announcement with its paragraphs, labelled by its title', async () => {
    setup();
    const dialog = await screen.findByRole('dialog', { name: 'Meet your new Home page' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Everything in one place.')).toBeInTheDocument();
    expect(screen.getByText('Take a look.')).toBeInTheDocument();
    expect(screen.getByText(/new/i, { selector: '.an-badge' })).toBeInTheDocument();
  });

  it('Got it records dismissed and closes', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /got it/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(JSON.parse(posts('/announcements/7/seen')[0][1].body)).toEqual({ action: 'dismissed' });
  });

  it('the close button and Escape also record dismissed', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /close/i }));
    expect(posts('/announcements/7/seen')).toHaveLength(1);
    cleanup(); _resetAnnouncementCheck();
    setup();
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts('/announcements/7/seen')).toHaveLength(1);
  });

  it('Escape while typing feedback still closes it', async () => {
    setup();
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: 'half a thought' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clicking the backdrop does not close it', async () => {
    const { container } = setup();
    await screen.findByRole('dialog');
    fireEvent.mouseDown(container.ownerDocument.querySelector('.an-backdrop'));
    fireEvent.click(container.ownerDocument.querySelector('.an-backdrop'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('the button records cta and navigates in-app', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Check it out' }));
    expect(JSON.parse(posts('/announcements/7/seen')[0][1].body)).toEqual({ action: 'cta' });
    expect(mockNavigate).toHaveBeenCalledWith('/home');
  });

  it('an https button opens that URL, not a router path', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    setup({ ...ann, cta_url: 'https://fullsteamahead.ca/jobs' });
    fireEvent.click(await screen.findByRole('button', { name: 'Check it out' }));
    expect(open).toHaveBeenCalledWith('https://fullsteamahead.ca/jobs', '_self');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('feedback: Send is disabled when empty, posts the text, then thanks', async () => {
    setup();
    const send = await screen.findByRole('button', { name: /send/i });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Add dark mode' } });
    fireEvent.click(send);
    expect(await screen.findByText(/thanks, russ reads every one of these/i)).toBeInTheDocument();
    expect(JSON.parse(posts('/announcements/7/feedback')[0][1].body)).toEqual({ message: 'Add dark mode' });
  });

  it('feedback failure shows a retry message and stays open', async () => {
    setup();
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'hello' } });
    globalThis.fetch.mockImplementationOnce(async () => respond({ error: 'x' }, 500));
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(await screen.findByText(/couldn't send that, try again/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('checks for an announcement only once per page load', async () => {
    setup(null);
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    cleanup();
    render(<MemoryRouter><AnnouncementModal /></MemoryRouter>);
    await new Promise(r => setTimeout(r, 0));
    expect(globalThis.fetch.mock.calls.filter(([u]) => String(u).endsWith('/announcements/next'))).toHaveLength(1);
  });

  it('never says tailor and has no em dash in its own copy', async () => {
    const { container } = setup();
    await screen.findByRole('dialog');
    expect(container.ownerDocument.body.textContent).not.toMatch(/tailor|—/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd client-v2 && npx vitest run src/components/AnnouncementModal.test.jsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`client-v2/src/components/AnnouncementModal.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { track } from '../utils/usage';
import './AnnouncementModal.css';

// One check per full page load: AppShell remounts on every in-app navigation,
// and a "visit" should get at most one pop-up.
let checkedThisLoad = false;
export function _resetAnnouncementCheck() { checkedThisLoad = false; }

function post(url, body) {
  return fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export default function AnnouncementModal() {
  const navigate = useNavigate();
  const [announcement, setAnnouncement] = useState(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);

  useEffect(() => {
    if (checkedThisLoad) return;
    checkedThisLoad = true;
    fetch('/api/platform/announcements/next', { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data?.announcement) {
          setAnnouncement(data.announcement);
          track('feature_use', { action: 'announcement_shown', props: { id: data.announcement.id } });
        }
      })
      .catch(() => {});
  }, []);

  function recordSeen(action) {
    post(`/api/platform/announcements/${announcement.id}/seen`, { action }).catch(() => {});
  }

  function dismiss() {
    recordSeen('dismissed');
    setAnnouncement(null);
  }

  // Latest dismiss for the key listener without re-binding it on every keystroke.
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    if (!announcement) return undefined;
    const previous = document.activeElement;
    dialogRef.current?.focus();
    function onKey(e) { if (e.key === 'Escape') dismissRef.current(); }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, [announcement]);

  if (!announcement) return null;

  function handleCta() {
    recordSeen('cta');
    track('feature_use', { action: 'announcement_cta', props: { id: announcement.id } });
    const url = announcement.cta_url;
    setAnnouncement(null);
    if (url.startsWith('/')) navigate(url);
    // jsdom can't spy on location.assign; window.open(url, '_self') is the same navigation.
    else window.open(url, '_self');
  }

  async function handleSend() {
    setSending(true);
    setError('');
    try {
      const res = await post(`/api/platform/announcements/${announcement.id}/feedback`, { message: message.trim() });
      if (!res.ok) throw new Error('send failed');
      track('feature_use', { action: 'announcement_feedback', props: { id: announcement.id } });
      setSent(true);
    } catch {
      setError("Couldn't send that, try again.");
    } finally {
      setSending(false);
    }
  }

  const paragraphs = announcement.body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const titleId = `an-title-${announcement.id}`;

  return (
    <div className="an-backdrop">
      <div
        className="an-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
      >
        <button className="an-close" aria-label="Close" onClick={dismiss}>✕</button>
        <span className="an-badge">New</span>
        <h2 className="an-title" id={titleId}>{announcement.title}</h2>
        {paragraphs.map((p, i) => <p className="an-body" key={i}>{p}</p>)}
        {announcement.cta_label && announcement.cta_url && (
          <button className="an-cta" onClick={handleCta}>{announcement.cta_label}</button>
        )}

        <div className="an-feedback">
          {sent ? (
            <p className="an-thanks">Thanks, Russ reads every one of these.</p>
          ) : (
            <>
              <label className="an-feedback-label" htmlFor={`an-fb-${announcement.id}`}>
                Got an idea or something that would make this better? Tell us.
              </label>
              <textarea
                id={`an-fb-${announcement.id}`}
                className="an-textarea"
                rows={3}
                maxLength={2000}
                value={message}
                onChange={e => setMessage(e.target.value)}
              />
              {error && <p className="an-error">{error}</p>}
              <button className="an-send" onClick={handleSend} disabled={sending || !message.trim()}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </>
          )}
        </div>

        <button className="an-done" onClick={dismiss}>Got it</button>
      </div>
    </div>
  );
}
```

`client-v2/src/components/AnnouncementModal.css`:

```css
/* AnnouncementModal — prefix an-. Colours match HomePage.css / LobbyPage.css. */
.an-backdrop {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(13, 17, 23, 0.78);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.an-card {
  position: relative;
  width: 100%; max-width: 520px; max-height: calc(100vh - 32px); overflow-y: auto;
  box-sizing: border-box;
  background: #1C2333; color: #F4F5F7;
  border: 1px solid #252F42; border-top: 4px solid #E8720C; border-radius: 6px;
  padding: 28px 28px 24px;
  font-family: 'Barlow', -apple-system, sans-serif;
  display: flex; flex-direction: column; gap: 12px;
  outline: none;
}
.an-close {
  position: absolute; top: 10px; right: 12px;
  background: none; border: 0; color: #9AA4B5; font-size: 18px; cursor: pointer; padding: 6px;
}
.an-close:hover { color: #F4F5F7; }
.an-badge {
  align-self: flex-start;
  background: #E8720C; color: #fff; border-radius: 3px;
  padding: 3px 8px; font-size: 12px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
}
.an-title { font-size: 24px; font-weight: 700; margin: 0; line-height: 1.2; }
.an-body { margin: 0; line-height: 1.55; color: #D6DAE1; }
.an-cta {
  align-self: flex-start; margin-top: 4px;
  background: #E8720C; color: #fff; border: 0; border-radius: 4px;
  padding: 10px 18px; font: inherit; font-weight: 700; cursor: pointer;
}
.an-feedback { border-top: 1px solid #252F42; padding-top: 14px; margin-top: 6px; display: flex; flex-direction: column; gap: 8px; }
.an-feedback-label { font-size: 14px; color: #9AA4B5; }
.an-textarea {
  width: 100%; box-sizing: border-box; resize: vertical;
  background: #0D1117; color: #F4F5F7; border: 1px solid #252F42; border-radius: 4px;
  padding: 8px 10px; font: inherit; font-size: 15px;
}
.an-textarea:focus { outline: 2px solid #E8720C; outline-offset: 1px; }
.an-send {
  align-self: flex-start;
  background: transparent; color: #E8720C; border: 1px solid #E8720C; border-radius: 4px;
  padding: 6px 14px; font: inherit; font-weight: 700; cursor: pointer;
}
.an-send:disabled { opacity: 0.5; cursor: default; }
.an-thanks { margin: 0; color: #7EE2A8; font-weight: 600; }
.an-error { margin: 0; color: #F47067; font-size: 14px; }
.an-done {
  align-self: flex-end;
  background: none; border: 0; color: #F4F5F7; font: inherit; font-weight: 700; cursor: pointer; padding: 6px 4px;
}
.an-done:hover { color: #E8720C; }

@media (max-width: 600px) {
  .an-card { padding: 24px 18px 18px; }
  .an-title { font-size: 21px; }
}
```

Then add the `AppShell.jsx` import and render, as listed under Files.

- [ ] **Step 4: Run the full client suite and build**

Run: `cd client-v2 && npx vitest run && npm run build`
Expected: everything passes and the build succeeds. Restore any `client-v2/build/` changes before committing (`git checkout -- client-v2/build && git clean -fd client-v2/build`), because the controller rebuilds it at deploy.

- [ ] **Step 5: Commit**

```bash
git add client-v2/src/components/AnnouncementModal.jsx client-v2/src/components/AnnouncementModal.css client-v2/src/components/AnnouncementModal.test.jsx client-v2/src/components/AppShell.jsx
git commit -m "feat: What's new announcement pop-up

Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb"
```

---

### Task 6: Deploy, live check and first announcement (controller only)

- [ ] **Step 1:** Merge `feat/announcements` into `master` (fast-forward) and push.
- [ ] **Step 2: Back up, then migrate.**
  - `sudo /usr/local/bin/fsa-backup.sh daily`.
  - `docker cp server/migrations/022_announcements.sql fsa-postgres:/tmp/022.sql && docker exec fsa-postgres psql -U postgres -d fsa_agent -v ON_ERROR_STOP=1 -f /tmp/022.sql`.
- [ ] **Step 3: Deploy the api.**
  - `cd client-v2 && npm run build && cd ..`, then commit the rebuilt `client-v2/build` and push.
  - `GITHUB_TOKEN=$(gh auth token) docker compose build api && docker compose up -d api`.
- [ ] **Step 4: Live check on the test announcement.**
  - Write `server/src/announcements/test-live-check.json` (not committed):
    - audience `["everyone"]`, `starts_at` now, `ends_at` 1 hour ahead;
    - copy "Testing the new announcement pop-up".
  - `docker cp` it into `fsa-agent-api-1:/app/src/announcements/` (confirm the container's working dir with `docker exec fsa-agent-api-1 pwd`) and run the publish script.
  - Because `russ@`'s account predates the announcement, it is eligible.
  - Log in as `russ@fullsteamahead.ca` with Playwright. The password comes from the vault key `FSA_RUSS_LMS_PASSWORD` via the vault marker in the command, never printed.
  - Confirm the pop-up shows on `/home` at desktop width and at 375px, and screenshot both.
  - Send one feedback message ("Test from Claude, please ignore") and confirm it arrives on Russ's Telegram. Ask Russ.
  - Reload and confirm the pop-up does not return.
  - Run `publish_announcement.js --end-now test-live-check` and `announcement_report.js test-live-check`.
  - Tell Russ that logging in signed out his other devices.
- [ ] **Step 5: Wiki.**
  - Add an "Announcements" section to `wiki/projects/fsa-agent.md`: how to publish, the process rule (confirm copy and audience with Russ first), the report command and the audience definitions.
  - Add the new routes to the API table.
  - Append to `wiki/log.md`.
- [ ] **Step 6: First announcement draft.**
  - Write `server/src/announcements/2026-10-home-dashboard.json` (Home + custom resumes, suggested audience `everyone`) and show Russ the title, body, button and audience.
  - Publish only after he approves: commit the file, `docker cp` it into the container, run the publish script, and report the eligible count.
