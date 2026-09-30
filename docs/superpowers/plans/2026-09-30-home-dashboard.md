# Home Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/home` landing page for every logged-in user that shows course progress, jobs, custom-resume credits and the affiliate program in six cards, plus the free-credit fix for paid enrollments and the "tailoring" copy rename.

**Architecture:** One new session-authed endpoint `GET /api/platform/home` in fsa-agent assembles six independent sections in parallel (each failing to `null` on its own). Affiliate figures come from a new `GET /internal/affiliates/summary` in fsa-affiliate-program, reached over the shared Docker network. A new React page `HomePage.jsx` renders them; post-login redirects point to `/home`.

**Tech Stack:** Express + pg (fsa-agent server, Jest + supertest), React + Vite (client-v2, Vitest + Testing Library), Express (fsa-affiliate-program, `node --test`), static HTML (fsa-nurture templates, fsa-website).

**Spec:** `fsa-agent/docs/superpowers/specs/2026-09-30-home-dashboard-design.md`

## Global Constraints

- **No implementer deploys, merges to production, restarts containers, or writes to the production database.** Tasks 1–8 are code + tests + commit only. Task 9 (deploy) is run by the controller, not an implementer subagent.
- **fsa-agent server tests run only against `fsa_agent_test`.** Always run as:
  `cd /home/debian/fsa-agent/server && POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-) npm test -- <file>`
  (`npm test` already sets `POSTGRES_DB=fsa_agent_test POSTGRES_HOST=localhost POSTGRES_PORT=5434`). **Never `source` or `set -a` `/home/debian/.env.shared`.** It sets `POSTGRES_DB=fsa_agent` and would point the suite at production.
- Test fixture emails use a file-scoped prefix `@example.com` and clean up with `deleteFixtureUsersByEmailLike` (`tests/fixtureCleanup.js`). Never write an unscoped `DELETE`.
- Each sub-project is its own git repo: `fsa-agent` (branch `master`), `fsa-affiliate-program` (`main`), `fsa-nurture` (`master`), `fsa-website` (`master`). Before each commit run `git -C <repo> rev-parse --abbrev-ref HEAD` to confirm the branch, then `git add` only the files you changed. `fsa-nurture` has an unrelated uncommitted deletion (`engine/templates/job-digest-d16.html`) from another session. Do not stage or revert it.
- Student-facing copy: never "tailor"/"tailored"/"tailoring"; use "custom resume" / "customize". No em dashes (—) in any new student-facing string or email. Code identifiers, CSS classes, DB values and analytics action names (`tailoring_started`) stay unchanged.
- Numbers from the spec: new jobs = `first_seen` within the last 7×24h (rolling); affiliate commission copy = "20% of every referral, every month"; referral link = `https://fullsteamahead.ca/?am_id=<CODE>`; affiliate dashboard = `https://fullsteamahead.ca/affiliate-dashboard`; enroll page = `https://fullsteamahead.ca/enroll`; job board = `https://fullsteamahead.ca/jobs`.
- New client page styling goes in a co-located `HomePage.css` with class prefix `hm-`. No inline-style objects.
- Commit messages end with the line `Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb`.

## Review Focus

1. **A 2nd/3rd Class student with a live subscription but no `active_paper`** (bought, never picked a paper). The course card must say "Pick your paper" linking `/select-paper`, not crash or show "Paper null". Tested in Task 5.
2. **A subscription row with `status='active'` but `cancel_at` in the past** must count as *lapsed*, not active, matching `requireAuth`. Tested in Task 5.
3. **Affiliate service or jobs API hanging.** `/home` must still answer (affiliate/new-jobs sections `null`) within ~2s, not hang. Tested in Tasks 4 and 5.
4. **HTML in a user's first name** (free signup lets anyone type anything) must be escaped in the affiliate welcome email HTML. Tested in Task 5.
5. **Join clicked on an account that is already an affiliate, or a paused (inactive) one.** No second welcome email; a paused account gets a clear 409 message, not a card that silently stays on "Join". Tested in Task 5.

---

## File Map

| File | Repo | Change |
|---|---|---|
| `migrations/007_affiliate_source_in_app.sql` | fsa-affiliate-program | Create: widen `affiliates.source` CHECK to admit `in_app` |
| `src/handlers/internalCreate.js` | fsa-affiliate-program | Modify: add `in_app` to `VALID_SOURCES` |
| `src/handlers/internalSummary.js` | fsa-affiliate-program | Create: `getAffiliateSummaryByEmail`, `handleInternalSummary` |
| `src/app.js` | fsa-affiliate-program | Modify: mount `GET /internal/affiliates/summary` |
| `tests/internalSummary.test.js`, `tests/internalCreate.test.js` | fsa-affiliate-program | Tests |
| `server/src/services/signupCredit.js` | fsa-agent | Create: `grantSignupCredit(client, userId)`, shared by signup + provision |
| `server/src/routes/auth.js`, `server/src/routes/platform.js` | fsa-agent | Modify: use `grantSignupCredit`; provision-user grants on new user |
| `server/migrations/021_paid_enrollment_signup_credit.sql` | fsa-agent | Create: backfill |
| `server/src/services/paperStats.js` | fsa-agent | Create: `getObjectiveProgress`, `getLastExam` (extracted from platform.js) |
| `server/src/services/affiliateClient.js` | fsa-agent | Create: `getSummary(email)`, `join({name,email})` |
| `server/src/services/newJobsCount.js` | fsa-agent | Create: `getNewJobsCount()` with 10-min cache |
| `server/src/services/homeSummary.js` | fsa-agent | Create: `getCourseSection`, `getJobsSection`, `hasResumeOnFile` |
| `server/src/services/email.js` | fsa-agent | Modify: add `sendAffiliateWelcome`, `escapeHtml` |
| `server/src/routes/home.js` | fsa-agent | Create: `GET /home`, `POST /affiliate/join` |
| `server/src/index.js` | fsa-agent | Modify: mount `homeRouter` at `/api/platform` |
| `server/src/config/usageTaxonomy.json`, `client-v2/src/utils/usageTaxonomy.json` | fsa-agent | Modify: add `/home` screen, `affiliate_joined` action (files must stay identical) |
| `client-v2/src/utils/postLoginPath.js` | fsa-agent | Create: one post-login destination rule |
| `client-v2/src/pages/{LoginPage,SignupPage,SetupPage}.jsx`, `client-v2/src/App.jsx` | fsa-agent | Modify: use `postLoginPath`; add `/home` route; `DefaultRedirect` → `/home` |
| `client-v2/src/components/AppShell.jsx` | fsa-agent | Modify: Home nav item first |
| `client-v2/public/manifest.webmanifest` | fsa-agent | Modify: `start_url` → `/home` |
| `client-v2/src/pages/HomePage.jsx`, `HomePage.css`, `HomePage.test.jsx` | fsa-agent | Create |
| `client-v2/src/pages/JobDetailModal.jsx`, `server/src/routes/tailoring.js` | fsa-agent | Modify: copy |
| `engine/templates/saved-jobs-d0.html`, `saved-jobs-d3.html`, `saved-jobs-d7.html`, `job-digest-d7.html` | fsa-nurture | Modify: copy |
| `enrollment-confirmation.html` | fsa-website | Modify: copy |

---

### Task 1: Affiliate summary endpoint + `in_app` source (fsa-affiliate-program)

**Files:**
- Create: `/home/debian/fsa-affiliate-program/migrations/007_affiliate_source_in_app.sql`
- Create: `/home/debian/fsa-affiliate-program/src/handlers/internalSummary.js`
- Modify: `/home/debian/fsa-affiliate-program/src/handlers/internalCreate.js:14`
- Modify: `/home/debian/fsa-affiliate-program/src/app.js` (after line 66)
- Test: `/home/debian/fsa-affiliate-program/tests/internalSummary.test.js`, `tests/internalCreate.test.js`

**Interfaces:**
- Consumes: `findByEmailAnyStatus(pool, email)` from `src/affiliates.js`; `getDashboardSummary(pool, affiliateId)` from `src/handlers/dashboard.js` (returns `{code, totalClicks, totalLeads, totalEarnedCents, totalPaidCents, outstandingCents}`).
- Produces: `GET /internal/affiliates/summary?email=<email>` (header `x-affiliate-secret`) →
  `{ is_affiliate: false }` | `{ is_affiliate: false, paused: true }` |
  `{ is_affiliate: true, code, referral_url, referred_count, paying_referrals_count, earned_cents }`.
  `POST /internal/affiliates/create` accepts `source: 'in_app'`.

- [ ] **Step 1: Write the failing tests**

Create `tests/internalSummary.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { getAffiliateSummaryByEmail, handleInternalSummary } = require('../src/handlers/internalSummary');

function poolWith({ affiliate, leads = '0', earned = '0', paid = '0', paying = '0' }) {
  return {
    query: async (sql) => {
      if (sql.includes('SELECT id, code, name, email, status, source')) return { rows: affiliate ? [affiliate] : [] };
      if (sql.includes('SELECT code FROM affiliate.affiliates')) return { rows: [{ code: affiliate.code }] };
      if (sql.includes('FROM affiliate.clicks')) return { rows: [{ total: '3' }] };
      if (sql.includes('FROM affiliate.lead_attributions')) return { rows: [{ total: leads }] };
      if (sql.includes('FROM affiliate.commission_ledger')) return { rows: [{ total: earned }] };
      if (sql.includes('FROM affiliate.payouts')) return { rows: [{ total: paid }] };
      if (sql.includes('FROM affiliate.subscription_attributions')) return { rows: [{ total: paying }] };
      throw new Error('unexpected query: ' + sql);
    },
  };
}

test('returns is_affiliate false when no affiliate has this email', async () => {
  const result = await getAffiliateSummaryByEmail(poolWith({ affiliate: null }), 'nobody@example.com');
  assert.deepEqual(result, { is_affiliate: false });
});

test('returns paused for an inactive affiliate', async () => {
  const affiliate = { id: 4, code: 'PAUSED1234', email: 'p@example.com', status: 'inactive' };
  const result = await getAffiliateSummaryByEmail(poolWith({ affiliate }), 'p@example.com');
  assert.deepEqual(result, { is_affiliate: false, paused: true });
});

test('returns the same figures the dashboard shows, plus paying referrals', async () => {
  const affiliate = { id: 9, code: 'BLAKE1676', email: 'b@example.com', status: 'active' };
  const result = await getAffiliateSummaryByEmail(
    poolWith({ affiliate, leads: '5', earned: '8940', paying: '2' }), 'b@example.com');
  assert.deepEqual(result, {
    is_affiliate: true,
    code: 'BLAKE1676',
    referral_url: 'https://fullsteamahead.ca/?am_id=BLAKE1676',
    referred_count: 5,
    paying_referrals_count: 2,
    earned_cents: 8940,
  });
});

test('lowercases and trims the email before lookup', async () => {
  let seen = null;
  const pool = { query: async (sql, params) => { seen = params[0]; return { rows: [] }; } };
  await getAffiliateSummaryByEmail(pool, '  Mixed@Example.COM ');
  assert.equal(seen, 'mixed@example.com');
});

test('handler 400s without an email', async () => {
  let status = 200; let body = null;
  const res = { status(c) { status = c; return this; }, json(d) { body = d; return this; } };
  await handleInternalSummary(poolWith({ affiliate: null }))({ query: {} }, res);
  assert.equal(status, 400);
  assert.deepEqual(body, { error: 'email is required' });
});
```

Append to `tests/internalCreate.test.js`:

```js
test('handleInternalCreate accepts the in_app source', async () => {
  const fakePool = {
    query: async (sql, params) => {
      if (sql.includes('SELECT id, code, name, email, status, source')) return { rows: [] };
      if (sql.includes('INSERT INTO affiliate.affiliates')) {
        return { rows: [{ id: 9, code: params[0], name: params[1], email: params[2], status: 'active', source: params[3] }] };
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
  const handler = handleInternalCreate(fakePool);
  const { req, res, getBody, getStatus } = fakeReqRes({ name: 'In App', email: 'inapp@example.com', source: 'in_app' });
  await handler(req, res);
  assert.equal(getStatus(), 200);
  assert.equal(getBody().affiliate.source, 'in_app');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/debian/fsa-affiliate-program && node --test tests/internalSummary.test.js tests/internalCreate.test.js`
Expected: FAIL. `Cannot find module '../src/handlers/internalSummary'`, and the in_app test gets status 400.

- [ ] **Step 3: Implement**

`src/handlers/internalCreate.js` line 14:

```js
const VALID_SOURCES = new Set(['manual', 'auto_enrolled', 'in_app']);
```

Also extend the header comment's caller list with:
`//   - fsa-agent's Home page one-click Join (source: 'in_app')`

Create `src/handlers/internalSummary.js`:

```js
// src/handlers/internalSummary.js — per-email affiliate figures for trusted
// server-to-server callers (fsa-agent's Home page). Reuses getDashboardSummary
// so the numbers are exactly what the affiliate sees on their own dashboard;
// the only addition is how many referrals became paying subscriptions.

const { findByEmailAnyStatus } = require('../affiliates');
const { getDashboardSummary } = require('./dashboard');

async function getAffiliateSummaryByEmail(pool, rawEmail) {
  const email = (rawEmail || '').trim().toLowerCase();
  const affiliate = await findByEmailAnyStatus(pool, email);
  if (!affiliate) return { is_affiliate: false };
  if (affiliate.status !== 'active') return { is_affiliate: false, paused: true };

  const [summary, paying] = await Promise.all([
    getDashboardSummary(pool, affiliate.id),
    pool.query(
      'SELECT COUNT(*)::text AS total FROM affiliate.subscription_attributions WHERE affiliate_id = $1',
      [affiliate.id]
    ),
  ]);

  return {
    is_affiliate: true,
    code: affiliate.code,
    referral_url: `https://fullsteamahead.ca/?am_id=${affiliate.code}`,
    referred_count: summary.totalLeads,
    paying_referrals_count: Number(paying.rows[0].total),
    earned_cents: summary.totalEarnedCents,
  };
}

function handleInternalSummary(pool) {
  return async (req, res) => {
    const email = (req.query?.email || '').trim();
    if (!email) return res.status(400).json({ error: 'email is required' });
    res.json(await getAffiliateSummaryByEmail(pool, email));
  };
}

module.exports = { getAffiliateSummaryByEmail, handleInternalSummary };
```

`src/app.js`: add the require next to line 16 and the route after line 66:

```js
const { handleInternalSummary } = require('./handlers/internalSummary');
```
```js
  app.get('/internal/affiliates/summary', requireInternalSecret, asyncHandler(handleInternalSummary(pool)));
```

Create `migrations/007_affiliate_source_in_app.sql`:

```sql
-- migrations/007_affiliate_source_in_app.sql
-- Widen affiliate.affiliates.source to admit 'in_app' (fsa-agent Home page
-- one-click Join). Both layers change together: widening only the JS
-- allowlist in handlers/internalCreate.js would turn a 400 into a 500
-- constraint violation here (same lesson as 004).
--
-- Replay-safety: migrate.js re-applies every file on every run. 003's
-- ADD COLUMN IF NOT EXISTS never re-adds its narrower CHECK on replay, and
-- dropping before adding makes this file idempotent on its own.

ALTER TABLE affiliate.affiliates
  DROP CONSTRAINT IF EXISTS affiliates_source_check;

ALTER TABLE affiliate.affiliates
  ADD CONSTRAINT affiliates_source_check
    CHECK (source IN ('manual', 'self_signup', 'auto_enrolled', 'refgrow_import', 'in_app'));
```

- [ ] **Step 4: Run the whole suite**

Run: `cd /home/debian/fsa-affiliate-program && npm test`
Expected: all pass (the new tests included). If `tests/migrations.test.js` asserts a file list or count, update it to include `007_affiliate_source_in_app.sql`.

- [ ] **Step 5: Commit**

```bash
cd /home/debian/fsa-affiliate-program && git rev-parse --abbrev-ref HEAD   # expect: main
git add migrations/007_affiliate_source_in_app.sql src/handlers/internalSummary.js src/handlers/internalCreate.js src/app.js tests/internalSummary.test.js tests/internalCreate.test.js
git commit -m "feat: internal per-email affiliate summary + in_app source

Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb"
```
(Also stage `tests/migrations.test.js` if you changed it.)

---

### Task 2: Free credit for paid enrollments + backfill (fsa-agent server)

**Files:**
- Create: `server/src/services/signupCredit.js`
- Modify: `server/src/routes/auth.js:452-463` (signup grant → shared helper)
- Modify: `server/src/routes/platform.js:138-145` (provision-user)
- Create: `server/migrations/021_paid_enrollment_signup_credit.sql`
- Test: `server/tests/provisionUserSignupCredit.test.js`

**Interfaces:**
- Produces: `grantSignupCredit(queryable, userId)`: inserts one `signup_grant` transaction and adds 1 to `credit_balances` (upsert). `queryable` is a `pg` client or pool. Idempotent: a user who already has a `signup_grant` row gets nothing. Returns `true` if granted.

- [ ] **Step 1: Write the failing test**

Create `server/tests/provisionUserSignupCredit.test.js`:

```js
jest.mock('../src/services/email');

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const platformRouter = require('../src/routes/platform');

const FIXTURE_EMAIL_LIKE = 'provcredit-%@example.com';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/platform', platformRouter);
  return app;
}

async function creditState(email) {
  const { rows: [u] } = await pool.query(`SELECT id FROM platform_users WHERE email = $1`, [email]);
  const bal = await pool.query(`SELECT balance FROM credit_balances WHERE user_id = $1`, [u.id]);
  const tx = await pool.query(
    `SELECT delta FROM credit_transactions WHERE user_id = $1 AND reason = 'signup_grant'`, [u.id]);
  return { balance: bal.rows[0]?.balance ?? null, grants: tx.rows.length };
}

describe('paid enrollment gets the free custom-resume credit', () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv, INTERNAL_SECRET: 'test-internal-secret' }; });
  afterEach(async () => {
    process.env = originalEnv;
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });
  afterAll(async () => { await pool.end(); });

  const provision = (app, email, class_code = 'second') => request(app)
    .post('/api/platform/provision-user')
    .set('x-internal-secret', 'test-internal-secret')
    .send({ email, first_name: 'Paid', last_name: 'Student', class_code });

  it('grants exactly 1 credit when provision-user creates a new account', async () => {
    const app = buildTestApp();
    const email = 'provcredit-new@example.com';
    expect((await provision(app, email)).status).toBe(200);
    expect(await creditState(email)).toEqual({ balance: 1, grants: 1 });
  });

  it('does not grant again on a Stripe re-delivery or a second purchase', async () => {
    const app = buildTestApp();
    const email = 'provcredit-redeliver@example.com';
    await provision(app, email);
    await provision(app, email);
    expect(await creditState(email)).toEqual({ balance: 1, grants: 1 });
  });

  it('backfill migration grants only accounts that never had a signup_grant', async () => {
    const { rows: [bare] } = await pool.query(
      `INSERT INTO platform_users (email, first_name) VALUES ('provcredit-bare@example.com', 'Bare') RETURNING id`);
    const { rows: [granted] } = await pool.query(
      `INSERT INTO platform_users (email, first_name) VALUES ('provcredit-had@example.com', 'Had') RETURNING id`);
    await pool.query(`INSERT INTO credit_balances (user_id, balance) VALUES ($1, 0)`, [granted.id]);
    await pool.query(
      `INSERT INTO credit_transactions (user_id, delta, reason) VALUES ($1, 1, 'signup_grant')`, [granted.id]);

    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '021_paid_enrollment_signup_credit.sql'), 'utf8');
    await pool.query(sql);
    await pool.query(sql); // replay must be a no-op

    expect(await creditState('provcredit-bare@example.com')).toEqual({ balance: 1, grants: 1 });
    // Already had a grant and spent it: untouched.
    expect(await creditState('provcredit-had@example.com')).toEqual({ balance: 0, grants: 1 });
    void bare;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/debian/fsa-agent/server && POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-) npm test -- provisionUserSignupCredit`
Expected: FAIL. The first test sees `{ balance: null, grants: 0 }`, and the migration file is missing (ENOENT).

- [ ] **Step 3: Implement**

Create `server/src/services/signupCredit.js`:

```js
// The one free custom-resume credit every platform account gets, whichever way
// the account was created: free job-only signup (routes/auth.js /signup) or a
// paid enrollment (routes/platform.js /provision-user). Until 2026-09-30 only
// the signup path granted it, so paid students created after the migration-011
// backfill had no credit at all.
//
// Idempotent on the signup_grant row: calling it twice for one user grants once.
async function grantSignupCredit(queryable, userId) {
  const tx = await queryable.query(
    `INSERT INTO credit_transactions (user_id, delta, reason)
     SELECT $1, 1, 'signup_grant'
     WHERE NOT EXISTS (
       SELECT 1 FROM credit_transactions WHERE user_id = $1 AND reason = 'signup_grant'
     )
     RETURNING id`,
    [userId]
  );
  if (tx.rows.length === 0) return false;
  await queryable.query(
    `INSERT INTO credit_balances (user_id, balance) VALUES ($1, 1)
     ON CONFLICT (user_id) DO UPDATE SET balance = credit_balances.balance + 1, updated_at = now()`,
    [userId]
  );
  return true;
}

module.exports = { grantSignupCredit };
```

`server/src/routes/auth.js`: add `const { grantSignupCredit } = require('../services/signupCredit');` with the other requires, and replace the two `INSERT` statements at lines 456-463 (keep the comment above them) with:

```js
      await grantSignupCredit(client, user.id);
```

`server/src/routes/platform.js`: add `const { grantSignupCredit } = require('../services/signupCredit');` near line 7. In `provision-user`, directly after `const user = userResult.rows[0];` (line ~165) add:

```js
    // Every account gets the free custom-resume credit, not just free signups.
    if (userIsNew) {
      await grantSignupCredit(pool, user.id);
    }
```

Create `server/migrations/021_paid_enrollment_signup_credit.sql`:

```sql
-- 021: give the free custom-resume credit to every account that never got one.
-- The grant lived only in POST /api/auth/signup; paid accounts are created by
-- POST /api/platform/provision-user, which granted nothing, so every paid
-- student created after migration 011's one-time backfill (13 accounts on
-- 2026-09-30) had no credit. provision-user now grants it too.
--
-- Exact criterion (same as 011): a platform user with no signup_grant row.
-- A user who had the grant and spent it is excluded. Replay-safe: the second
-- run finds every user already granted.

WITH missing AS (
  INSERT INTO credit_transactions (user_id, delta, reason)
  SELECT id, 1, 'signup_grant' FROM platform_users
  WHERE id NOT IN (SELECT user_id FROM credit_transactions WHERE reason = 'signup_grant')
  RETURNING user_id
)
INSERT INTO credit_balances (user_id, balance)
SELECT user_id, 1 FROM missing
ON CONFLICT (user_id) DO UPDATE SET balance = credit_balances.balance + 1, updated_at = now();
```

- [ ] **Step 4: Run tests**

Run: `cd /home/debian/fsa-agent/server && POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-) npm test -- provisionUser authSignupCredits credits`
Expected: all pass, including the existing `authSignupCredits` (signup still grants exactly 1) and the three existing `provisionUser*` suites.

- [ ] **Step 5: Commit**

```bash
cd /home/debian/fsa-agent && git rev-parse --abbrev-ref HEAD   # expect: master
git add server/src/services/signupCredit.js server/src/routes/auth.js server/src/routes/platform.js server/migrations/021_paid_enrollment_signup_credit.sql server/tests/provisionUserSignupCredit.test.js
git commit -m "fix: paid enrollments get the free custom-resume credit; backfill

Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb"
```

---

### Task 3: Extract per-paper stats helpers (fsa-agent server, refactor)

**Files:**
- Create: `server/src/services/paperStats.js`
- Modify: `server/src/routes/platform.js` (`/lobby-data` steps 1, 2, 5; `/quiz-lobby-data` last-exam block)
- Test: `server/tests/paperStats.test.js`; existing `platform.test.js`, `quizLobbyData*.test.js` must still pass

**Interfaces:**
- Produces:
  - `getObjectiveProgress(pool, email, paper)` → `{ completed: number, total: number, percent: number }` (`percent` is 0 when `total` is 0)
  - `getLastExam(pool, email, paper)` → `null` | `{ score: number, date: Date, chapters: [{ chapter_id: string, score: number }] }`, the exact shape `/lobby-data` returns as `last_exam` today.

- [ ] **Step 1: Write the failing test**

Create `server/tests/paperStats.test.js`:

```js
const { pool } = require('./testPool');
const { getObjectiveProgress, getLastExam } = require('../src/services/paperStats');

// question_responses / user_progress are keyed by email, not user id, so the
// fixture needs no platform_users row; clean up by the fixture email only.
const EMAIL = 'paperstats-fixture@example.com';
// question_responses.question_id is an FK to questions; the test DB has no
// question bank, so the suite owns one fixture question (same pattern as
// quizLobbyData.test.js's 9000xx ids).
const FIXTURE_QUESTION_ID = 910001;

async function cleanup() {
  await pool.query(`DELETE FROM question_responses WHERE user_email = $1`, [EMAIL]);
  await pool.query(`DELETE FROM user_progress WHERE user_email = $1`, [EMAIL]);
  await pool.query(`DELETE FROM questions WHERE id = $1`, [FIXTURE_QUESTION_ID]);
}

describe('paperStats', () => {
  beforeEach(async () => {
    await cleanup();
    await pool.query(
      `INSERT INTO questions (id, question_text, options, correct_answer, question_type, chapter_id, course_id)
       VALUES ($1, 'Fixture', '["A","B"]'::jsonb, 0, 'chapter_quiz', '2A3-1', '2A3')`,
      [FIXTURE_QUESTION_ID]);
  });
  afterAll(async () => { await cleanup(); await pool.end(); });

  it('getLastExam returns null when there is no practice exam', async () => {
    expect(await getLastExam(pool, EMAIL, '2A3')).toBeNull();
  });

  it('getLastExam scores only the most recent attempt, per chapter', async () => {
    const insert = (chapter, correct, at) => pool.query(
      `INSERT INTO question_responses (user_email, course_id, chapter_id, session_type, correct, answered_at, question_id)
       VALUES ($1, '2A3', $2, 'practice_exam', $3, $4, $5)`,
      [EMAIL, chapter, correct, at, FIXTURE_QUESTION_ID]);
    await insert('2A3-1', false, '2026-09-01T10:00:00Z');           // older attempt, ignored
    await insert('2A3-1', true, '2026-09-02T10:00:00Z');
    await insert('2A3-2', false, '2026-09-02T10:00:00Z');
    const exam = await getLastExam(pool, EMAIL, '2A3');
    expect(exam.score).toBe(50);
    expect(exam.chapters).toEqual(expect.arrayContaining([
      { chapter_id: '2A3-1', score: 100 },
      { chapter_id: '2A3-2', score: 0 },
    ]));
  });

  it('getObjectiveProgress returns percent 0 for a paper with no lessons', async () => {
    expect(await getObjectiveProgress(pool, EMAIL, 'NOPAPER')).toEqual({ completed: 0, total: 0, percent: 0 });
  });
});
```


- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/debian/fsa-agent/server && POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-) npm test -- paperStats`
Expected: FAIL with `Cannot find module '../src/services/paperStats'`.

- [ ] **Step 3: Implement**

Create `server/src/services/paperStats.js` by moving the SQL verbatim out of `/lobby-data` (steps 1, 2 and 5 plus the "Calculate last exam total score" block):

```js
// Per-paper progress figures shared by the course lobby (/lobby-data), the
// 4th Class quiz lobby (/quiz-lobby-data) and the Home page (/home). Extracted
// so the three cannot drift apart on what "last practice exam" means.

async function getObjectiveProgress(pool, email, paper) {
  const totalResult = await pool.query(
    `SELECT COUNT(*) FROM lessons WHERE lesson_code LIKE $1`,
    [`${paper}-%`]
  );
  const completedResult = await pool.query(
    `SELECT COUNT(*) FROM user_progress
     WHERE user_email = $1 AND lesson_code LIKE $2 AND completed = true`,
    [email, `${paper}-%`]
  );
  const total = parseInt(totalResult.rows[0].count);
  const completed = parseInt(completedResult.rows[0].count);
  return { completed, total, percent: total > 0 ? Math.round((completed / total) * 100) : 0 };
}

async function getLastExam(pool, email, paper) {
  const { rows } = await pool.query(
    `SELECT
       qr.chapter_id,
       COUNT(*) as total,
       SUM(CASE WHEN qr.correct THEN 1 ELSE 0 END) as correct,
       DATE_TRUNC('minute', MAX(qr.answered_at)) as exam_date
     FROM question_responses qr
     WHERE qr.user_email = $1 AND qr.course_id = $2 AND qr.session_type = 'practice_exam'
       AND qr.answered_at = (
         SELECT MAX(answered_at) FROM question_responses
         WHERE user_email = $1 AND course_id = $2 AND session_type = 'practice_exam'
       )
     GROUP BY qr.chapter_id`,
    [email, paper]
  );
  if (rows.length === 0) return null;
  const totalCorrect = rows.reduce((sum, r) => sum + parseInt(r.correct), 0);
  const totalQs = rows.reduce((sum, r) => sum + parseInt(r.total), 0);
  return {
    score: Math.round((totalCorrect / totalQs) * 100),
    date: rows[0].exam_date,
    chapters: rows.map(r => ({
      chapter_id: r.chapter_id,
      score: Math.round((parseInt(r.correct) / parseInt(r.total)) * 100),
    })),
  };
}

module.exports = { getObjectiveProgress, getLastExam };
```

In `platform.js` add `const { getObjectiveProgress, getLastExam } = require('../services/paperStats');`. Then:
- `/lobby-data`: replace steps 1 and 2 with
  `const { completed: completedObjectives, total: totalObjectives } = await getObjectiveProgress(pool, email, active_paper);`
  Replace step 5 and the "Calculate last exam total score" block with
  `const lastExam = await getLastExam(pool, email, active_paper);`
  The response keeps `percent` computed as it is now (or use the helper's `percent`), and the JSON shape must not change.
- `/quiz-lobby-data`: replace its `lastExamResult` query and the `let lastExam = null; if (...) {...}` block with
  `const lastExam = await getLastExam(pool, email, paper);`

- [ ] **Step 4: Run tests**

Run: `cd /home/debian/fsa-agent/server && POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-) npm test -- paperStats platform quizLobbyData`
Expected: all pass. The existing lobby suites prove the refactor preserved the response shape.

- [ ] **Step 5: Commit**

```bash
cd /home/debian/fsa-agent && git rev-parse --abbrev-ref HEAD   # expect: master
git add server/src/services/paperStats.js server/src/routes/platform.js server/tests/paperStats.test.js
git commit -m "refactor: shared per-paper progress/last-exam helpers

Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb"
```

---

### Task 4: Affiliate client + new-jobs count services (fsa-agent server)

**Files:**
- Create: `server/src/services/affiliateClient.js`
- Create: `server/src/services/newJobsCount.js`
- Test: `server/tests/affiliateClient.test.js`, `server/tests/newJobsCount.test.js`

**Interfaces:**
- Consumes: env `AFFILIATE_INTERNAL_URL` (e.g. `http://fsa-affiliate-program:3000`), `AFFILIATE_INTERNAL_SECRET`, `JOBS_API_BASE_URL` (default `https://jobs-api.fullsteamahead.ca`); Task 1's endpoints.
- Produces:
  - `getSummary(email)` → the Task 1 summary object, or `null` on missing config / non-2xx / network error / timeout (2000 ms). Never throws.
  - `join({ name, email })` → `{ affiliate: {id, code, name, email, status, source}, created: boolean }`. **Throws** on missing config, non-2xx, or timeout.
  - `getNewJobsCount()` → `number | null`. Caches a success for 10 min and a failure for 60 s. Never throws.
  - `_resetNewJobsCache()` for tests.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/affiliateClient.test.js`:

```js
const affiliateClient = require('../src/services/affiliateClient');

describe('affiliateClient', () => {
  const originalEnv = process.env;
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env = { ...originalEnv, AFFILIATE_INTERNAL_URL: 'http://aff.test', AFFILIATE_INTERNAL_SECRET: 's3cret' };
  });
  afterEach(() => { process.env = originalEnv; global.fetch = realFetch; });

  it('getSummary sends the secret and the encoded email', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ is_affiliate: false }) }));
    expect(await affiliateClient.getSummary('a+b@example.com')).toEqual({ is_affiliate: false });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://aff.test/internal/affiliates/summary?email=a%2Bb%40example.com');
    expect(opts.headers['x-affiliate-secret']).toBe('s3cret');
  });

  it('getSummary returns null on a non-2xx, a network error, or missing config', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(await affiliateClient.getSummary('x@example.com')).toBeNull();
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    expect(await affiliateClient.getSummary('x@example.com')).toBeNull();
    delete process.env.AFFILIATE_INTERNAL_URL;
    expect(await affiliateClient.getSummary('x@example.com')).toBeNull();
  });

  it('getSummary gives up after the timeout instead of hanging', async () => {
    global.fetch = jest.fn((url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const started = Date.now();
    expect(await affiliateClient.getSummary('slow@example.com')).toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('join posts source in_app and returns the service body', async () => {
    const body = { affiliate: { id: 1, code: 'SAM1234', status: 'active' }, created: true };
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => body }));
    expect(await affiliateClient.join({ name: 'Sam Lee', email: 'sam@example.com' })).toEqual(body);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://aff.test/internal/affiliates/create');
    expect(JSON.parse(opts.body)).toEqual({ name: 'Sam Lee', email: 'sam@example.com', source: 'in_app' });
  });

  it('join throws on a non-2xx', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, text: async () => 'bad' }));
    await expect(affiliateClient.join({ name: 'X', email: 'x@example.com' })).rejects.toThrow(/400/);
  });
});
```

Create `server/tests/newJobsCount.test.js`:

```js
const { getNewJobsCount, _resetNewJobsCache } = require('../src/services/newJobsCount');

const DAY = 24 * 60 * 60 * 1000;

describe('getNewJobsCount', () => {
  const realFetch = global.fetch;
  beforeEach(() => _resetNewJobsCache());
  afterEach(() => { global.fetch = realFetch; });

  it('counts jobs first seen in the last 7 x 24h, rolling', async () => {
    const now = Date.now();
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [
      { first_seen: new Date(now - 1 * DAY).toISOString() },
      { first_seen: new Date(now - 6.9 * DAY).toISOString() },
      { first_seen: new Date(now - 7.1 * DAY).toISOString() },  // just outside
      { first_seen: null },
      {},
    ] }));
    expect(await getNewJobsCount()).toBe(2);
  });

  it('caches a success so a second call does not refetch', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] }));
    await getNewJobsCount();
    await getNewJobsCount();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns null on failure and does not throw', async () => {
    global.fetch = jest.fn(async () => { throw new Error('down'); });
    expect(await getNewJobsCount()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/debian/fsa-agent/server && POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-) npm test -- affiliateClient newJobsCount`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

Create `server/src/services/affiliateClient.js`:

```js
// Client for fsa-affiliate-program's /internal/* API. Reached over the shared
// fsa-agent_fsa-network (AFFILIATE_INTERNAL_URL=http://fsa-affiliate-program:3000),
// the same way fsa-webhook-listener reaches it. AFFILIATE_INTERNAL_SECRET comes
// from /home/debian/.env.shared.
//
// getSummary is for display and never throws: the Home page must load even
// when the affiliate service is down. join is an action and does throw, so the
// route can tell the student it didn't work.

const TIMEOUT_MS = 2000;

function config() {
  const url = process.env.AFFILIATE_INTERNAL_URL;
  const secret = process.env.AFFILIATE_INTERNAL_SECRET;
  return url && secret ? { url, secret } : null;
}

async function getSummary(email) {
  const c = config();
  if (!c) return null;
  try {
    const res = await fetch(
      `${c.url}/internal/affiliates/summary?email=${encodeURIComponent(email)}`,
      { headers: { 'x-affiliate-secret': c.secret }, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('[affiliate-client] summary failed:', err.message);
    return null;
  }
}

async function join({ name, email }) {
  const c = config();
  if (!c) throw new Error('AFFILIATE_INTERNAL_URL or AFFILIATE_INTERNAL_SECRET not set');
  const res = await fetch(`${c.url}/internal/affiliates/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-affiliate-secret': c.secret },
    body: JSON.stringify({ name, email, source: 'in_app' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`affiliate create failed (${res.status}): ${body}`);
  }
  return res.json();
}

module.exports = { getSummary, join };
```

Create `server/src/services/newJobsCount.js`:

```js
// "N new postings in the last 7 days" for the Home page. Rolling window
// (now minus 7x24h), not a calendar week. Counts fsa-jobs-bot's public
// /jobs list by first_seen. Cached in-process: 10 minutes on success, 60
// seconds on failure so a down jobs API doesn't slow every Home load.

const JOBS_API_BASE = process.env.JOBS_API_BASE_URL || 'https://jobs-api.fullsteamahead.ca';
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SUCCESS_TTL_MS = 10 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
const TIMEOUT_MS = 2000;

let cache = null; // { value, expiresAt }

async function getNewJobsCount() {
  const now = Date.now();
  if (cache && now < cache.expiresAt) return cache.value;
  try {
    const res = await fetch(`${JOBS_API_BASE}/jobs`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`jobs api ${res.status}`);
    const jobs = await res.json();
    const cutoff = now - WINDOW_MS;
    const value = jobs.filter(j => j && j.first_seen && Date.parse(j.first_seen) >= cutoff).length;
    cache = { value, expiresAt: now + SUCCESS_TTL_MS };
    return value;
  } catch (err) {
    console.error('[new-jobs-count] failed:', err.message);
    cache = { value: null, expiresAt: now + FAILURE_TTL_MS };
    return null;
  }
}

function _resetNewJobsCache() { cache = null; }

module.exports = { getNewJobsCount, _resetNewJobsCache };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/debian/fsa-agent && git rev-parse --abbrev-ref HEAD   # expect: master
git add server/src/services/affiliateClient.js server/src/services/newJobsCount.js server/tests/affiliateClient.test.js server/tests/newJobsCount.test.js
git commit -m "feat: affiliate internal client and rolling 7-day new-jobs count

Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb"
```

---

### Task 5: `GET /home` and `POST /affiliate/join` (fsa-agent server)

**Files:**
- Create: `server/src/services/homeSummary.js`
- Create: `server/src/routes/home.js`
- Modify: `server/src/services/email.js` (add `escapeHtml`, `sendAffiliateWelcome`; export both)
- Modify: `server/src/index.js:206` (mount `homeRouter`)
- Modify: `server/src/config/usageTaxonomy.json` **and** `client-v2/src/utils/usageTaxonomy.json` (identical edit): add `"/home"` to `screens` after `"/select-paper"`, and `"affiliate_joined"` to `actions`
- Test: `server/tests/home.test.js`

**Interfaces:**
- Consumes: `getObjectiveProgress`, `getLastExam` (Task 3); `affiliateClient.getSummary`, `affiliateClient.join`, `getNewJobsCount` (Task 4); `credits.getBalance(userId)` (`services/credits.js`); `PAPERS_BY_CLASS`, `FOURTH_CLASS_CODES` (`config/papersForClass.js`).
- Produces: `GET /api/platform/home` →
  ```
  { first_name,
    course: { state: 'active'|'lapsed'|'none',
              subscriptions: [{ class_code, paper: string|null, pct_complete: number|null,
                                last_exam_score: number|null,
                                weakest_chapter: { chapter_id, title: string|null, score } | null }] } | null,
    jobs: { saved_count, custom_resumes_count } | null,
    credits: { balance } | null,
    resume_on_file: boolean | null,
    new_jobs_7d: number | null,
    affiliate: <Task 1 summary object> | null }
  ```
  `pct_complete` is `null` for 4th Class (no lessons). `paper` is `null` for a 2nd/3rd subscription with no `active_paper`.
  `POST /api/platform/affiliate/join` → `200 { affiliate }` (same shape as `/home`'s `affiliate`) | `409 { error }` for a paused account | `502 { error }` if the service call fails.
  `sendAffiliateWelcome(email, firstName, code)` in `services/email.js`.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/home.test.js`:

```js
jest.mock('../src/services/email');
jest.mock('../src/services/affiliateClient');
jest.mock('../src/services/newJobsCount');

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const email = require('../src/services/email');
const affiliateClient = require('../src/services/affiliateClient');
const { getNewJobsCount } = require('../src/services/newJobsCount');
const authRouter = require('../src/routes/auth');
const homeRouter = require('../src/routes/home');

const FIXTURE_EMAIL_LIKE = 'homepage-%@example.com';
const PASSWORD = 'longenoughpassword';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use('/api/platform', homeRouter);
  return app;
}

async function createUser(addr, { firstName = 'Taylor', subs = [] } = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const { rows: [u] } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash)
     VALUES ($1, $2, 'Tester', $3) RETURNING id`, [addr, firstName, hash]);
  for (const s of subs) {
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper, cancel_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [u.id, s.class_code, s.status || 'active', s.active_paper || null, s.cancel_at || null]);
  }
  return u.id;
}

async function login(app, addr) {
  const res = await request(app).post('/api/auth/login').send({ email: addr, password: PASSWORD });
  const cookie = (res.headers['set-cookie'] || []).find(c => c.startsWith('fsa_session='));
  return cookie.split(';')[0];
}

// Top level, not inside a describe: a describe-scoped afterAll would end the
// pool before the second describe's tests run.
afterAll(async () => { await pool.end(); });

describe('GET /api/platform/home', () => {
  beforeEach(() => {
    affiliateClient.getSummary.mockResolvedValue({ is_affiliate: false });
    getNewJobsCount.mockResolvedValue(14);
  });
  afterEach(async () => {
    jest.resetAllMocks();
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  it('job-only account: course none, all other sections present', async () => {
    const app = buildTestApp();
    await createUser('homepage-jobonly@example.com');
    const cookie = await login(app, 'homepage-jobonly@example.com');
    const res = await request(app).get('/api/platform/home').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      first_name: 'Taylor',
      course: { state: 'none', subscriptions: [] },
      jobs: { saved_count: 0, custom_resumes_count: 0 },
      credits: { balance: 0 },
      resume_on_file: false,
      new_jobs_7d: 14,
      affiliate: { is_affiliate: false },
    });
  });

  it('active 2nd Class student on 2A3', async () => {
    const app = buildTestApp();
    await createUser('homepage-second@example.com', { subs: [{ class_code: 'second', active_paper: '2A3' }] });
    const cookie = await login(app, 'homepage-second@example.com');
    const res = await request(app).get('/api/platform/home').set('Cookie', cookie);
    expect(res.body.course.state).toBe('active');
    expect(res.body.course.subscriptions).toEqual([
      { class_code: 'second', paper: '2A3', pct_complete: expect.any(Number), last_exam_score: null, weakest_chapter: null },
    ]);
  });

  it('2nd Class student with no paper picked yet gets paper null, not an error', async () => {
    const app = buildTestApp();
    await createUser('homepage-nopaper@example.com', { subs: [{ class_code: 'third' }] });
    const cookie = await login(app, 'homepage-nopaper@example.com');
    const res = await request(app).get('/api/platform/home').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.course.subscriptions).toEqual([
      { class_code: 'third', paper: null, pct_complete: null, last_exam_score: null, weakest_chapter: null },
    ]);
  });

  it('4th Class A and B are both listed, with no lesson percentage', async () => {
    const app = buildTestApp();
    await createUser('homepage-fourth@example.com', {
      subs: [{ class_code: 'fourth_a' }, { class_code: 'fourth_b' }] });
    const cookie = await login(app, 'homepage-fourth@example.com');
    const res = await request(app).get('/api/platform/home').set('Cookie', cookie);
    expect(res.body.course.subscriptions.map(s => [s.paper, s.pct_complete])).toEqual([['4A', null], ['4B', null]]);
  });

  it('active status with cancel_at in the past counts as lapsed', async () => {
    const app = buildTestApp();
    await createUser('homepage-lapsed@example.com', {
      subs: [{ class_code: 'second', active_paper: '2B3', cancel_at: '2026-01-01T00:00:00Z' }] });
    const cookie = await login(app, 'homepage-lapsed@example.com');
    const res = await request(app).get('/api/platform/home').set('Cookie', cookie);
    expect(res.body.course).toEqual({ state: 'lapsed', subscriptions: [] });
  });

  it('affiliate and new-jobs failures come back as null, page still 200', async () => {
    affiliateClient.getSummary.mockResolvedValue(null);
    getNewJobsCount.mockResolvedValue(null);
    const app = buildTestApp();
    await createUser('homepage-degraded@example.com');
    const cookie = await login(app, 'homepage-degraded@example.com');
    const res = await request(app).get('/api/platform/home').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.affiliate).toBeNull();
    expect(res.body.new_jobs_7d).toBeNull();
  });

  it('401 without a session', async () => {
    const res = await request(buildTestApp()).get('/api/platform/home');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/platform/affiliate/join', () => {
  const stats = { is_affiliate: true, code: 'TAYLOR1234', referral_url: 'https://fullsteamahead.ca/?am_id=TAYLOR1234',
    referred_count: 0, paying_referrals_count: 0, earned_cents: 0 };
  afterEach(async () => {
    jest.resetAllMocks();
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  it('creates the affiliate, emails once, and returns the stats', async () => {
    affiliateClient.join.mockResolvedValue({ affiliate: { code: 'TAYLOR1234', status: 'active' }, created: true });
    affiliateClient.getSummary.mockResolvedValue(stats);
    const app = buildTestApp();
    await createUser('homepage-join@example.com');
    const cookie = await login(app, 'homepage-join@example.com');
    const res = await request(app).post('/api/platform/affiliate/join').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ affiliate: stats });
    expect(affiliateClient.join).toHaveBeenCalledWith({ name: 'Taylor Tester', email: 'homepage-join@example.com' });
    expect(email.sendAffiliateWelcome).toHaveBeenCalledWith('homepage-join@example.com', 'Taylor', 'TAYLOR1234');
  });

  it('an existing affiliate gets no second welcome email', async () => {
    affiliateClient.join.mockResolvedValue({ affiliate: { code: 'TAYLOR1234', status: 'active' }, created: false });
    affiliateClient.getSummary.mockResolvedValue(stats);
    const app = buildTestApp();
    await createUser('homepage-again@example.com');
    const cookie = await login(app, 'homepage-again@example.com');
    const res = await request(app).post('/api/platform/affiliate/join').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(email.sendAffiliateWelcome).not.toHaveBeenCalled();
  });

  it('a paused affiliate gets a 409 with a clear message', async () => {
    affiliateClient.join.mockResolvedValue({ affiliate: { code: 'OLD1234', status: 'inactive' }, created: false });
    const app = buildTestApp();
    await createUser('homepage-paused@example.com');
    const cookie = await login(app, 'homepage-paused@example.com');
    const res = await request(app).post('/api/platform/affiliate/join').set('Cookie', cookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/paused/i);
  });

  it('service failure returns 502 with a retry message', async () => {
    affiliateClient.join.mockRejectedValue(new Error('down'));
    const app = buildTestApp();
    await createUser('homepage-down@example.com');
    const cookie = await login(app, 'homepage-down@example.com');
    const res = await request(app).post('/api/platform/affiliate/join').set('Cookie', cookie);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Couldn't join right now, try again in a minute.");
  });

  it('falls back to the create result when the summary call fails after joining', async () => {
    affiliateClient.join.mockResolvedValue({ affiliate: { code: 'TAYLOR1234', status: 'active' }, created: true });
    affiliateClient.getSummary.mockResolvedValue(null);
    const app = buildTestApp();
    await createUser('homepage-fallback@example.com');
    const cookie = await login(app, 'homepage-fallback@example.com');
    const res = await request(app).post('/api/platform/affiliate/join').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.affiliate).toEqual(stats);
  });
});
```

Create `server/tests/emailAffiliateWelcome.test.js`. It is a separate file because `home.test.js` mocks `email`:

```js
jest.mock('fsa-common', () => ({ email: { sendEmail: jest.fn() } }));
const { email: common } = require('fsa-common');
const { sendAffiliateWelcome } = require('../src/services/email');

it('escapes HTML in the first name and includes the referral link', async () => {
  await sendAffiliateWelcome('x@example.com', '<b>Sam</b>', 'SAM1234');
  const msg = common.sendEmail.mock.calls[0][0];
  expect(msg.html).toContain('&lt;b&gt;Sam&lt;/b&gt;');
  expect(msg.html).not.toContain('<b>Sam</b>');
  expect(msg.text).toContain('https://fullsteamahead.ca/?am_id=SAM1234');
  expect(msg.text).toContain('https://fullsteamahead.ca/affiliate-dashboard');
  expect(msg.html + msg.text + msg.subject).not.toMatch(/—|tailor/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/debian/fsa-agent/server && POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-) npm test -- home.test emailAffiliateWelcome`
Expected: FAIL with `Cannot find module '../src/routes/home'` and `sendAffiliateWelcome is not a function`.

- [ ] **Step 3: Implement**

Append to `server/src/services/email.js` (before `module.exports`) and add `sendAffiliateWelcome, escapeHtml` to the exports:

```js
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Sent when a student joins the affiliate program from the Home page. The
// first name is whatever the account holder typed at signup, so it is escaped.
async function sendAffiliateWelcome(email_, firstName, code) {
  const link = `https://fullsteamahead.ca/?am_id=${code}`;
  const dashboard = 'https://fullsteamahead.ca/affiliate-dashboard';
  const name = escapeHtml(firstName || 'there');
  await email.sendEmail({
    from: FROM,
    to: email_,
    subject: 'Your Full Steam Ahead referral link',
    html: `<p>Hi ${name},</p><p>You're in. Here's your referral link:</p><p><a href="${link}">${link}</a></p><p>Share it with anyone working toward their ticket. When someone enrolls through it, you earn 20% of what they pay, every month they stay enrolled.</p><p>Track your referrals and earnings anytime at <a href="${dashboard}">${dashboard}</a>. Log in with this email address.</p><p>Full Steam Ahead</p>`,
    text: `Hi ${firstName || 'there'},\n\nYou're in. Here's your referral link:\n${link}\n\nShare it with anyone working toward their ticket. When someone enrolls through it, you earn 20% of what they pay, every month they stay enrolled.\n\nTrack your referrals and earnings anytime at ${dashboard}. Log in with this email address.\n\nFull Steam Ahead`,
  });
}
```

Create `server/src/services/homeSummary.js`:

```js
// Data for the Home page's course and jobs cards. Each function is independent
// so routes/home.js can let one fail without taking the page down.

const { PAPERS_BY_CLASS, FOURTH_CLASS_CODES } = require('../config/papersForClass');
const { getObjectiveProgress, getLastExam } = require('./paperStats');

async function weakestChapter(pool, paper, lastExam) {
  if (!lastExam || lastExam.chapters.length === 0) return null;
  const weakest = lastExam.chapters.reduce((a, b) => (b.score < a.score ? b : a));
  const chapterNum = parseInt(String(weakest.chapter_id).split('-').pop(), 10);
  const { rows } = await pool.query(
    `SELECT title FROM chapters WHERE course_id = $1 AND chapter_num = $2`,
    [paper, chapterNum]
  );
  return { chapter_id: weakest.chapter_id, title: rows[0]?.title || null, score: weakest.score };
}

async function paperSnapshot(pool, email, classCode, paper) {
  const isFourth = FOURTH_CLASS_CODES.includes(classCode);
  const progress = isFourth ? null : await getObjectiveProgress(pool, email, paper);
  const lastExam = await getLastExam(pool, email, paper);
  return {
    class_code: classCode,
    paper,
    pct_complete: progress ? progress.percent : null,
    last_exam_score: lastExam ? lastExam.score : null,
    weakest_chapter: await weakestChapter(pool, paper, lastExam),
  };
}

// "Live" uses the same condition as requireAuth: status active and cancel_at
// unset or still in the future.
async function getCourseSection(pool, userId, email) {
  const { rows } = await pool.query(
    `SELECT class_code, active_paper FROM subscriptions
     WHERE user_id = $1 AND status = 'active' AND (cancel_at IS NULL OR cancel_at > NOW())
     ORDER BY class_code`,
    [userId]
  );
  if (rows.length === 0) {
    const { rows: [hist] } = await pool.query(
      `SELECT COUNT(*) > 0 AS had FROM subscriptions WHERE user_id = $1`, [userId]);
    return { state: hist.had ? 'lapsed' : 'none', subscriptions: [] };
  }
  const subscriptions = [];
  for (const row of rows) {
    const papers = FOURTH_CLASS_CODES.includes(row.class_code)
      ? PAPERS_BY_CLASS[row.class_code]
      : (row.active_paper ? [row.active_paper] : []);
    if (papers.length === 0) {
      subscriptions.push({ class_code: row.class_code, paper: null, pct_complete: null,
        last_exam_score: null, weakest_chapter: null });
      continue;
    }
    for (const paper of papers) {
      subscriptions.push(await paperSnapshot(pool, email, row.class_code, paper));
    }
  }
  return { state: 'active', subscriptions };
}

async function getJobsSection(pool, userId) {
  const { rows: [r] } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM saved_jobs WHERE user_id = $1 AND status <> 'archived')::int AS saved_count,
       (SELECT COUNT(*) FROM generated_documents WHERE user_id = $1 AND doc_type = 'resume')::int AS custom_resumes_count`,
    [userId]
  );
  return { saved_count: r.saved_count, custom_resumes_count: r.custom_resumes_count };
}

async function hasResumeOnFile(pool, userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM user_documents WHERE user_id = $1 AND doc_type = 'resume' LIMIT 1`, [userId]);
  return rows.length > 0;
}

module.exports = { getCourseSection, getJobsSection, hasResumeOnFile };
```

Create `server/src/routes/home.js`:

```js
// Home page (/home): one call for all six cards. Every section is computed
// independently and comes back null on its own failure, so a slow affiliate
// service or jobs API never takes the page down.
const express = require('express');
const { pool } = require('../services/database');
const requireAuth = require('../middleware/requireAuth');
const credits = require('../services/credits');
const affiliateClient = require('../services/affiliateClient');
const { getNewJobsCount } = require('../services/newJobsCount');
const { getCourseSection, getJobsSection, hasResumeOnFile } = require('../services/homeSummary');
const { sendAffiliateWelcome } = require('../services/email');

const router = express.Router();

async function settle(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`GET /api/platform/home ${label} error:`, err);
    return null;
  }
}

router.get('/home', requireAuth, async (req, res) => {
  const u = req.user;
  const [course, jobs, balance, resumeOnFile, newJobs, affiliate] = await Promise.all([
    settle('course', () => getCourseSection(pool, u.id, u.email)),
    settle('jobs', () => getJobsSection(pool, u.id)),
    settle('credits', () => credits.getBalance(u.id)),
    settle('resume', () => hasResumeOnFile(pool, u.id)),
    getNewJobsCount(),
    affiliateClient.getSummary(u.email),
  ]);
  return res.json({
    first_name: u.first_name,
    course,
    jobs,
    credits: balance === null ? null : { balance },
    resume_on_file: resumeOnFile,
    new_jobs_7d: newJobs,
    affiliate,
  });
});

router.post('/affiliate/join', requireAuth, async (req, res) => {
  const u = req.user;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
  let result;
  try {
    result = await affiliateClient.join({ name, email: u.email });
  } catch (err) {
    console.error('POST /api/platform/affiliate/join error:', err.message);
    return res.status(502).json({ error: "Couldn't join right now, try again in a minute." });
  }

  if (result.affiliate.status !== 'active') {
    return res.status(409).json({
      error: "Your referral account is paused. Reply to any Full Steam Ahead email and we'll sort it out.",
    });
  }

  if (result.created) {
    try {
      await sendAffiliateWelcome(u.email, u.first_name, result.affiliate.code);
    } catch (err) {
      console.error('affiliate welcome email failed for user', u.id, '-', err.message);
    }
  }

  const summary = await affiliateClient.getSummary(u.email);
  const affiliate = summary && summary.is_affiliate ? summary : {
    is_affiliate: true,
    code: result.affiliate.code,
    referral_url: `https://fullsteamahead.ca/?am_id=${result.affiliate.code}`,
    referred_count: 0,
    paying_referrals_count: 0,
    earned_cents: 0,
  };
  return res.json({ affiliate });
});

module.exports = router;
```

`server/src/index.js`: require `const homeRouter = require('./routes/home');` alongside the other route requires, and mount directly after line 206:

```js
app.use('/api/platform', homeRouter);
```

Taxonomy (both files, identical): `screens` gains `"/home"` after `"/select-paper"`; `actions` gains `"affiliate_joined"`.

- [ ] **Step 4: Run tests**

Run: `cd /home/debian/fsa-agent/server && POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-) npm test -- home.test emailAffiliateWelcome usageEvents apiNotFound && diff src/config/usageTaxonomy.json ../client-v2/src/utils/usageTaxonomy.json && echo TAXONOMY-IDENTICAL`
Expected: all pass, then `TAXONOMY-IDENTICAL`. Note that `apiNotFound.test.js` drives the app's own pool (not `testPool`), so run it only with the `npm test` env shown.

- [ ] **Step 5: Commit**

```bash
cd /home/debian/fsa-agent && git rev-parse --abbrev-ref HEAD   # expect: master
git add server/src/services/homeSummary.js server/src/routes/home.js server/src/services/email.js server/src/index.js server/src/config/usageTaxonomy.json client-v2/src/utils/usageTaxonomy.json server/tests/home.test.js server/tests/emailAffiliateWelcome.test.js
git commit -m "feat: GET /home and one-click affiliate join

Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb"
```

---

### Task 6: Land on `/home` after login (fsa-agent client)

**Files:**
- Create: `client-v2/src/utils/postLoginPath.js`, `client-v2/src/utils/postLoginPath.test.js`
- Modify: `client-v2/src/pages/LoginPage.jsx:133-148`, `SignupPage.jsx:62-74`, `SetupPage.jsx:217-227`
- Modify: `client-v2/src/App.jsx` (import `HomePage` placeholder route + `DefaultRedirect`)
- Modify: `client-v2/src/components/AppShell.jsx` (Home nav item first)
- Modify: `client-v2/public/manifest.webmanifest` (`"start_url": "/home"`)

**Interfaces:**
- Produces: `postLoginPath(user, next)` → string. Rules, in order:
  1. a safe `next` (starts with `/`, not `//`) → `next`
  2. 2nd/3rd Class (`class_code` set, not 4th) with no `active_paper` → `/select-paper`
  3. everything else → `/home`
- Route `/home` renders `HomePage` (built in Task 7). In this task, create `client-v2/src/pages/HomePage.jsx` as a stub: `export default function HomePage() { return null; }`. Task 7 replaces it.

- [ ] **Step 1: Write the failing test**

Create `client-v2/src/utils/postLoginPath.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { postLoginPath } from './postLoginPath';

describe('postLoginPath', () => {
  it('honours a safe next', () => {
    expect(postLoginPath({ class_code: 'second', active_paper: '2A1' }, '/jobs/capture?token=x')).toBe('/jobs/capture?token=x');
  });
  it('ignores protocol-relative next', () => {
    expect(postLoginPath({}, '//evil.example')).toBe('/home');
  });
  it('sends a 2nd/3rd Class student with no paper to the picker', () => {
    expect(postLoginPath({ class_code: 'third', active_paper: null }, null)).toBe('/select-paper');
  });
  it('sends everyone else to /home', () => {
    expect(postLoginPath({ class_code: 'second', active_paper: '2A3' }, null)).toBe('/home');
    expect(postLoginPath({ class_code: 'fourth_a', active_paper: null }, null)).toBe('/home');
    expect(postLoginPath({ class_code: null, active_paper: null }, null)).toBe('/home');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/debian/fsa-agent/client-v2 && npx vitest run src/utils/postLoginPath.test.js`
Expected: FAIL. `postLoginPath` cannot be resolved.

- [ ] **Step 3: Implement**

Create `client-v2/src/utils/postLoginPath.js`:

```js
import { isFourthClassCode } from './fourthClass';

// Where a user goes after login, signup or password setup. Everyone lands on
// /home, except a 2nd/3rd Class student who hasn't picked a paper yet (the
// picker comes first) and an explicit, same-origin ?next= (e.g. /jobs/capture).
export function postLoginPath(user, next) {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  if (user?.class_code && !isFourthClassCode(user.class_code) && !user.active_paper) {
    return '/select-paper';
  }
  return '/home';
}
```

In `LoginPage.jsx` and `SignupPage.jsx`, replace the whole `const next = ...; const isSafeNext = ...; if (isSafeNext) {...} else if ... else {...}` chain with:

```js
      navigate(postLoginPath(data.user, searchParams.get('next')), { replace: true });
```

In `SetupPage.jsx`, replace the `if (isFourthClassCode(...)) {...} else if (!data.user.active_paper) {...} else {...}` chain with:

```js
      navigate(postLoginPath(data.user, null), { replace: true });
```

Add `import { postLoginPath } from '../utils/postLoginPath';` to each of the three files, and remove any `isFourthClassCode` import that becomes unused.

`App.jsx`:
- `import HomePage from './pages/HomePage';`
- Add before the `/lobby` route:
  ```jsx
      <Route
        path="/home"
        element={
          <ProtectedRoute requirePaper={false}>
            <AppShell>
              <HomePage />
            </AppShell>
          </ProtectedRoute>
        }
      />
  ```
- Replace `DefaultRedirect`'s body and its comment with:
  ```jsx
  // Everyone lands on Home; it links onward to the course lobby, jobs and profile.
  function DefaultRedirect() {
    return <Navigate to="/home" replace />;
  }
  ```

`AppShell.jsx`: insert as the first `NavLink` in `.as-sidebar`, after `.as-brand`:

```jsx
        <NavLink to="/home" className={({ isActive }) => `as-nav-item${isActive ? ' as-nav-item--active' : ''}`}>
          🏠 Home
        </NavLink>
```

`manifest.webmanifest`: `"start_url": "/home",`

- [ ] **Step 4: Run the client suite**

Run: `cd /home/debian/fsa-agent/client-v2 && npx vitest run`
Expected: all pass. If `SetupPage.test.jsx` asserts navigation to `/lobby` for a user with a paper, update that expectation to `/home`, because this is the intended behaviour change. Leave `SelectPaperPage` alone: after picking a paper it still goes to `/lobby`.

- [ ] **Step 5: Commit**

```bash
cd /home/debian/fsa-agent && git rev-parse --abbrev-ref HEAD   # expect: master
git add client-v2/src/utils/postLoginPath.js client-v2/src/utils/postLoginPath.test.js client-v2/src/pages/LoginPage.jsx client-v2/src/pages/SignupPage.jsx client-v2/src/pages/SetupPage.jsx client-v2/src/App.jsx client-v2/src/components/AppShell.jsx client-v2/public/manifest.webmanifest client-v2/src/pages/HomePage.jsx
git commit -m "feat: land on /home after login; Home in the sidebar

Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb"
```
(Include `client-v2/src/pages/SetupPage.test.jsx` if its expectation changed.)

---

### Task 7: HomePage UI (fsa-agent client)

**Files:**
- Replace: `client-v2/src/pages/HomePage.jsx` (stub from Task 6)
- Create: `client-v2/src/pages/HomePage.css`, `client-v2/src/pages/HomePage.test.jsx`

**Interfaces:**
- Consumes: `GET /api/platform/home` and `POST /api/platform/affiliate/join` (Task 5 shapes); `track` from `../utils/usage` (`track('feature_use', { action: 'affiliate_joined' })`).

- [ ] **Step 1: Write the failing tests**

Create `client-v2/src/pages/HomePage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './HomePage';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => mockNavigate,
}));

const respond = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

const base = {
  first_name: 'Taylor',
  course: { state: 'none', subscriptions: [] },
  jobs: { saved_count: 0, custom_resumes_count: 0 },
  credits: { balance: 1 },
  resume_on_file: true,
  new_jobs_7d: 14,
  affiliate: { is_affiliate: false },
};

function renderHome(data) {
  globalThis.fetch = vi.fn().mockResolvedValue(respond(data));
  return render(<MemoryRouter><HomePage /></MemoryRouter>);
}

beforeEach(() => { mockNavigate.mockClear(); localStorage.setItem('fsa_user', '{"id":1}'); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('HomePage', () => {
  it('not enrolled: points to the courses', async () => {
    renderHome(base);
    expect(await screen.findByText(/not currently enrolled/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /have a look at the courses/i }))
      .toHaveAttribute('href', 'https://fullsteamahead.ca/enroll');
  });

  it('active student: shows paper, exam line and Continue to /lobby', async () => {
    renderHome({ ...base, course: { state: 'active', subscriptions: [{
      class_code: 'second', paper: '2A3', pct_complete: 40, last_exam_score: 72,
      weakest_chapter: { chapter_id: '2A3-6', title: 'Boilers', score: 40 } }] } });
    expect(await screen.findByText(/2nd Class/)).toBeInTheDocument();
    expect(screen.getByText(/2A3/)).toBeInTheDocument();
    expect(screen.getByText(/Last practice exam 72%/)).toBeInTheDocument();
    expect(screen.getByText(/Boilers/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /continue/i })).toHaveAttribute('href', '/lobby');
  });

  it('student with no paper picked: links to the picker', async () => {
    renderHome({ ...base, course: { state: 'active', subscriptions: [{
      class_code: 'third', paper: null, pct_complete: null, last_exam_score: null, weakest_chapter: null }] } });
    expect(await screen.findByRole('link', { name: /pick your paper/i })).toHaveAttribute('href', '/select-paper');
  });

  it('lapsed: welcome back', async () => {
    renderHome({ ...base, course: { state: 'lapsed', subscriptions: [] } });
    expect(await screen.findByText(/welcome back, taylor/i)).toBeInTheDocument();
  });

  it('credits with saved jobs: points to saved jobs by name', async () => {
    renderHome({ ...base, jobs: { saved_count: 3, custom_resumes_count: 0 } });
    expect(await screen.findByText(/let's go, taylor/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /pick a saved job/i })).toHaveAttribute('href', '/jobs');
  });

  it('credits, no saved jobs: points to the job board', async () => {
    renderHome(base);
    expect(await screen.findByText(/find a job worth going after first/i)).toBeInTheDocument();
  });

  it('no credits: offers more credits', async () => {
    renderHome({ ...base, credits: { balance: 0 } });
    expect(await screen.findByRole('link', { name: /get more credits/i })).toHaveAttribute('href', '/credits');
  });

  it('shows the resume upload nudge only without a resume', async () => {
    renderHome({ ...base, resume_on_file: false });
    expect(await screen.findByText(/upload your resume/i)).toBeInTheDocument();
  });

  it('hides the new-jobs card when the count is unavailable', async () => {
    renderHome({ ...base, new_jobs_7d: null });
    await screen.findByText(/not currently enrolled/i);
    expect(screen.queryByText(/new postings/i)).not.toBeInTheDocument();
  });

  it('shows the rolling new-jobs count', async () => {
    renderHome(base);
    expect(await screen.findByText(/14 new postings in the last 7 days/i)).toBeInTheDocument();
  });

  it('affiliate: shows earnings and the referral link', async () => {
    renderHome({ ...base, affiliate: { is_affiliate: true, code: 'TAY1', referral_url: 'https://fullsteamahead.ca/?am_id=TAY1',
      referred_count: 4, paying_referrals_count: 2, earned_cents: 5960 } });
    expect(await screen.findByText('$59.60')).toBeInTheDocument();
    expect(screen.getByText('https://fullsteamahead.ca/?am_id=TAY1')).toBeInTheDocument();
  });

  it('affiliate section failed: shows the fallback line', async () => {
    renderHome({ ...base, affiliate: null });
    expect(await screen.findByText(/couldn't load your referral stats/i)).toBeInTheDocument();
  });

  it('Join flips the card to the referral link', async () => {
    renderHome(base);
    await screen.findByText(/earn 20% of every referral, every month/i);
    globalThis.fetch.mockResolvedValueOnce(respond({ affiliate: { is_affiliate: true, code: 'TAY1',
      referral_url: 'https://fullsteamahead.ca/?am_id=TAY1', referred_count: 0, paying_referrals_count: 0, earned_cents: 0 } }));
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(await screen.findByText('https://fullsteamahead.ca/?am_id=TAY1')).toBeInTheDocument();
  });

  it('Join failure shows the server message', async () => {
    renderHome(base);
    await screen.findByText(/earn 20%/i);
    globalThis.fetch.mockResolvedValueOnce(respond({ error: "Couldn't join right now, try again in a minute." }, 502));
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(await screen.findByText(/couldn't join right now/i)).toBeInTheDocument();
  });

  it('401 clears the stale user and goes to /login', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ error: 'x' }, 401));
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true }));
    expect(localStorage.getItem('fsa_user')).toBeNull();
  });

  it('never says tailor', async () => {
    const { container } = renderHome({ ...base, resume_on_file: false, credits: { balance: 0 } });
    await screen.findByText(/not currently enrolled/i);
    expect(container.textContent).not.toMatch(/tailor/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/debian/fsa-agent/client-v2 && npx vitest run src/pages/HomePage.test.jsx`
Expected: FAIL, because the stub renders nothing.

- [ ] **Step 3: Implement**

Replace `client-v2/src/pages/HomePage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { track } from '../utils/usage';
import './HomePage.css';

const CLASS_LABELS = { second: '2nd Class', third: '3rd Class', fourth_a: '4th Class', fourth_b: '4th Class' };
const ENROLL_URL = 'https://fullsteamahead.ca/enroll';
const JOB_BOARD_URL = 'https://fullsteamahead.ca/jobs';
const AFFILIATE_DASHBOARD_URL = 'https://fullsteamahead.ca/affiliate-dashboard';

const dollars = cents => `$${(cents / 100).toFixed(2)}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function CourseCard({ course, firstName }) {
  if (!course) {
    return <section className="hm-card"><h2 className="hm-card-title">Your course</h2><p className="hm-muted">Couldn't load your course right now.</p></section>;
  }
  if (course.state === 'none') {
    return (
      <section className="hm-card">
        <h2 className="hm-card-title">Your course</h2>
        <p>You're not currently enrolled.</p>
        <a className="hm-btn" href={ENROLL_URL}>Have a look at the courses</a>
      </section>
    );
  }
  if (course.state === 'lapsed') {
    return (
      <section className="hm-card">
        <h2 className="hm-card-title">Welcome back, {firstName}.</h2>
        <p>Your course access has ended. Pick up where you left off whenever you're ready.</p>
        <a className="hm-btn" href={ENROLL_URL}>See courses</a>
      </section>
    );
  }
  return (
    <section className="hm-card">
      <h2 className="hm-card-title">Your course</h2>
      {course.subscriptions.map(s => (
        <div className="hm-course-line" key={`${s.class_code}-${s.paper}`}>
          <div className="hm-course-name">
            {CLASS_LABELS[s.class_code] || s.class_code}
            {s.paper ? <> · Paper {s.paper}</> : null}
          </div>
          {!s.paper && <Link className="hm-link" to="/select-paper">Pick your paper</Link>}
          {s.pct_complete !== null && (
            <div className="hm-progress" aria-label={`${s.pct_complete}% complete`}>
              <div className="hm-progress-fill" style={{ width: `${s.pct_complete}%` }} />
              <span className="hm-progress-label">{s.pct_complete}% complete</span>
            </div>
          )}
          {s.paper && (
            <p className="hm-muted">
              {s.last_exam_score !== null
                ? <>Last practice exam {s.last_exam_score}%{s.weakest_chapter && <> · weakest: {s.weakest_chapter.title || `Chapter ${s.weakest_chapter.chapter_id.split('-').pop()}`}</>}</>
                : 'No practice exam yet'}
            </p>
          )}
        </div>
      ))}
      <Link className="hm-btn" to="/lobby">Continue</Link>
    </section>
  );
}

function JobsCard({ jobs }) {
  return (
    <section className="hm-card">
      <h2 className="hm-card-title">Jobs</h2>
      {jobs
        ? <p>{plural(jobs.saved_count, 'saved job', 'saved jobs')} · {plural(jobs.custom_resumes_count, 'custom resume', 'custom resumes')} built</p>
        : <p className="hm-muted">Couldn't load your jobs right now.</p>}
      <div className="hm-actions">
        <a className="hm-btn" href={JOB_BOARD_URL}>View the job board</a>
        <Link className="hm-link" to="/jobs">Saved jobs</Link>
      </div>
    </section>
  );
}

function AffiliateCard({ affiliate, onJoin, joining, joinError }) {
  const [copied, setCopied] = useState(false);
  if (affiliate === null) {
    return <section className="hm-card"><h2 className="hm-card-title">Referrals</h2><p className="hm-muted">Couldn't load your referral stats right now.</p></section>;
  }
  if (!affiliate.is_affiliate) {
    return (
      <section className="hm-card hm-card--quiet">
        <h2 className="hm-card-title">Referrals</h2>
        <p>Earn 20% of every referral, every month.</p>
        {affiliate.paused
          ? <p className="hm-muted">Your referral account is paused. Reply to any Full Steam Ahead email and we'll sort it out.</p>
          : <button className="hm-btn hm-btn--ghost" onClick={onJoin} disabled={joining}>{joining ? 'Joining…' : 'Join'}</button>}
        {joinError && <p className="hm-error">{joinError}</p>}
      </section>
    );
  }
  async function copy() {
    try { await navigator.clipboard.writeText(affiliate.referral_url); setCopied(true); } catch { /* ignore */ }
  }
  return (
    <section className="hm-card">
      <h2 className="hm-card-title">Referrals</h2>
      <div className="hm-stats">
        <div><div className="hm-stat-value">{dollars(affiliate.earned_cents)}</div><div className="hm-stat-label">earned to date</div></div>
        <div><div className="hm-stat-value">{affiliate.referred_count}</div><div className="hm-stat-label">people referred</div></div>
        <div><div className="hm-stat-value">{affiliate.paying_referrals_count}</div><div className="hm-stat-label">paying</div></div>
      </div>
      <div className="hm-referral">
        <code className="hm-referral-url">{affiliate.referral_url}</code>
        <button className="hm-btn hm-btn--small" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <a className="hm-link" href={AFFILIATE_DASHBOARD_URL}>Full dashboard</a>
    </section>
  );
}

function CreditsCard({ credits, jobs, firstName }) {
  if (!credits) return null;
  const n = credits.balance;
  if (n > 0 && jobs && jobs.saved_count > 0) {
    return (
      <section className="hm-card hm-card--small">
        <p>Let's go, {firstName}. You've got {plural(n, 'free custom resume', 'free custom resumes')}. Pick one of your saved jobs and we'll build it.</p>
        <Link className="hm-link" to="/jobs">Pick a saved job</Link>
      </section>
    );
  }
  if (n > 0) {
    return (
      <section className="hm-card hm-card--small">
        <p>You've got {plural(n, 'free custom resume', 'free custom resumes')}. Find a job worth going after first.</p>
        <a className="hm-link" href={JOB_BOARD_URL}>Browse the job board</a>
      </section>
    );
  }
  return (
    <section className="hm-card hm-card--small">
      <p>A custom resume is rewritten for one specific posting, so it matches what that employer is asking for.</p>
      <Link className="hm-link" to="/credits">Get more credits</Link>
    </section>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  async function load() {
    setError(false);
    try {
      const res = await fetch('/api/platform/home', { credentials: 'include' });
      if (res.status === 401) {
        localStorage.removeItem('fsa_user');
        navigate('/login', { replace: true });
        return;
      }
      if (!res.ok) throw new Error('home failed');
      setData(await res.json());
    } catch {
      setError(true);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleJoin() {
    setJoining(true);
    setJoinError('');
    try {
      const res = await fetch('/api/platform/affiliate/join', { method: 'POST', credentials: 'include' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Couldn't join right now, try again in a minute.");
      track('feature_use', { action: 'affiliate_joined' });
      setData(d => ({ ...d, affiliate: body.affiliate }));
    } catch (err) {
      setJoinError(err.message);
    } finally {
      setJoining(false);
    }
  }

  if (error) {
    return (
      <div className="hm-page">
        <p>Couldn't load your home page.</p>
        <button className="hm-btn" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!data) return <div className="hm-page"><p className="hm-muted">Loading…</p></div>;

  return (
    <div className="hm-page">
      <h1 className="hm-greeting">Hi {data.first_name}</h1>
      <div className="hm-grid hm-grid--main">
        <CourseCard course={data.course} firstName={data.first_name} />
        <JobsCard jobs={data.jobs} />
        <AffiliateCard affiliate={data.affiliate} onJoin={handleJoin} joining={joining} joinError={joinError} />
      </div>
      <div className="hm-grid hm-grid--small">
        {data.new_jobs_7d !== null && (
          <section className="hm-card hm-card--small">
            <p><strong>{data.new_jobs_7d}</strong> new postings in the last 7 days.</p>
            <a className="hm-link" href={JOB_BOARD_URL}>Browse the board</a>
          </section>
        )}
        <CreditsCard credits={data.credits} jobs={data.jobs} firstName={data.first_name} />
        {data.resume_on_file === false && (
          <section className="hm-card hm-card--small">
            <p>Upload your resume to unlock one-click custom resumes.</p>
            <Link className="hm-link" to="/profile">Upload your resume</Link>
          </section>
        )}
      </div>
    </div>
  );
}
```

Note that `style={{ width }}` on the progress fill is a dynamic value, the one allowed inline style. Everything else lives in CSS.

Create `client-v2/src/pages/HomePage.css` (colours and font match `LobbyPage.css`):

```css
/* HomePage styles — prefix hm-. Colours match LobbyPage.css. */
.hm-page {
  min-height: 100vh;
  background: #0D1117;
  color: #F4F5F7;
  font-family: 'Barlow', -apple-system, sans-serif;
  padding: 32px 24px;
  max-width: 1200px;
  margin: 0 auto;
  box-sizing: border-box;
}
.hm-greeting { font-size: 28px; font-weight: 700; margin: 0 0 24px; }
.hm-grid { display: grid; gap: 20px; margin-bottom: 20px; }
.hm-grid--main { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.hm-grid--small { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.hm-card {
  background: #1C2333;
  border: 1px solid #252F42;
  border-top: 3px solid #E8720C;
  border-radius: 4px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.hm-card--quiet { border-top-color: #252F42; }
.hm-card--small { padding: 18px 20px; border-top-width: 1px; }
.hm-card p { margin: 0; line-height: 1.5; }
.hm-card-title {
  font-size: 13px; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: #9AA4B5; margin: 0;
}
.hm-muted { color: #9AA4B5; font-size: 14px; }
.hm-error { color: #F47067; font-size: 14px; }
.hm-course-line { display: flex; flex-direction: column; gap: 8px; }
.hm-course-name { font-size: 20px; font-weight: 700; }
.hm-progress { position: relative; height: 22px; background: #252F42; border-radius: 3px; overflow: hidden; }
.hm-progress-fill { height: 100%; background: #E8720C; }
.hm-progress-label { position: absolute; inset: 0; display: flex; align-items: center; padding-left: 8px; font-size: 12px; font-weight: 600; }
.hm-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-top: auto; }
.hm-btn {
  align-self: flex-start; margin-top: auto;
  background: #E8720C; color: #fff; border: 0; border-radius: 4px;
  padding: 10px 18px; font: inherit; font-weight: 700; text-decoration: none; cursor: pointer;
}
.hm-btn:disabled { opacity: 0.6; cursor: default; }
.hm-btn--ghost { background: transparent; border: 1px solid #E8720C; color: #E8720C; }
.hm-btn--small { padding: 6px 12px; margin-top: 0; font-size: 14px; }
.hm-link { color: #E8720C; font-weight: 600; text-decoration: none; }
.hm-link:hover { text-decoration: underline; }
.hm-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.hm-stat-value { font-size: 22px; font-weight: 700; }
.hm-stat-label { font-size: 12px; color: #9AA4B5; }
.hm-referral { display: flex; gap: 8px; align-items: center; min-width: 0; }
.hm-referral-url {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: #0D1117; border: 1px solid #252F42; border-radius: 3px; padding: 6px 8px; font-size: 13px;
}

@media (max-width: 768px) {
  .hm-page { padding: 20px 16px; }
  .hm-grid--main, .hm-grid--small { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: Run tests**

Run: `cd /home/debian/fsa-agent/client-v2 && npx vitest run && npm run build`
Expected: all tests pass and the build succeeds.

- [ ] **Step 5: Commit**

```bash
cd /home/debian/fsa-agent && git rev-parse --abbrev-ref HEAD   # expect: master
git add client-v2/src/pages/HomePage.jsx client-v2/src/pages/HomePage.css client-v2/src/pages/HomePage.test.jsx
git commit -m "feat: Home page cards

Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb"
```
Do not commit `client-v2/build/` unless it is already tracked (`git ls-files client-v2/build | head -1` returns something). If it is tracked, leave it for Task 9.

---

### Task 8: Retire "tailoring" from student-facing copy (fsa-agent, fsa-nurture, fsa-website)

**Files:**
- Modify: `fsa-agent/client-v2/src/pages/JobDetailModal.jsx:156,185`
- Modify: `fsa-agent/server/src/routes/tailoring.js:47`
- Modify: `fsa-nurture/engine/templates/saved-jobs-d0.html`, `saved-jobs-d3.html`, `saved-jobs-d7.html`, `job-digest-d7.html`
- Modify: `fsa-website/enrollment-confirmation.html:97`

**Interfaces:** none (copy only).

- [ ] **Step 1: Write the guard check (fails now)**

Run:
```bash
cd /home/debian && rtk proxy grep -n -i -E "tailor" \
  fsa-agent/client-v2/src/pages/JobDetailModal.jsx fsa-agent/server/src/routes/tailoring.js \
  fsa-nurture/engine/templates/saved-jobs-d0.html fsa-nurture/engine/templates/saved-jobs-d3.html \
  fsa-nurture/engine/templates/saved-jobs-d7.html fsa-nurture/engine/templates/job-digest-d7.html \
  fsa-website/enrollment-confirmation.html | rtk proxy grep -v -E "className=|tailorError|tailorResult|tailoringRef|scrollToTailoring|focusTailoring|loadTailoringContext|tailoring_started|console.error|/tailor"
```
Expected now: matching lines, meaning student-visible "tailor" text remains. The goal is no output.

- [ ] **Step 2: Replace the copy exactly**

`JobDetailModal.jsx`
- line 156: `Upload a resume on your <a href="/profile">Profile</a> page before generating tailored documents.` → `Upload a resume on your <a href="/profile">Profile</a> page before building a custom resume or cover letter.`
- line 185: `'Tailoring your documents… this can take up to a minute.'` → `'Building your custom documents… this can take up to a minute.'`

`server/src/routes/tailoring.js` line 47: `'Upload a resume before generating tailored documents'` → `'Upload a resume before building a custom resume or cover letter'`. Then `rtk proxy grep -rn "generating tailored documents" /home/debian/fsa-agent/server/tests /home/debian/fsa-agent/client-v2/src`. Update any test asserting the old string to the new one.

`saved-jobs-d0.html`: link text `Tailor your resume to the job you just saved &rarr;` → `Build a custom resume for the job you just saved &rarr;`

`saved-jobs-d3.html`:
- `loses to a tailored one sent to three` → `loses to a custom one sent to three`
- `That's exactly what the tailoring tool does with your saved jobs:` → `That's exactly what the custom resume tool does with your saved jobs:`
- `Tailor a resume for one of your saved jobs &rarr;` → `Build a custom resume for one of your saved jobs &rarr;`

`saved-jobs-d7.html`: `the tailoring tool writes one for the exact posting` → `the custom resume tool writes one for the exact posting`

`job-digest-d7.html`:
- `sent to three postings, tailored to each` → `sent to three postings, customized for each`
- `your first tailored resume + cover letter is free` → `your first custom resume or cover letter is free` (this also corrects the claim, since one credit covers one document)

`fsa-website/enrollment-confirmation.html` line 97: `Save the ones you want and tailor your resume to them.` → `Save the ones you want and build a custom resume for each.`

- [ ] **Step 3: Re-run the guard and the affected suites**

Run the Step 1 command. Expected: no output.
Run: `cd /home/debian/fsa-nurture && npm run preflight` (expected: passes, and all templates still resolve).
Run: `cd /home/debian/fsa-agent/server && POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-) npm test -- tailoring` and `cd /home/debian/fsa-agent/client-v2 && npx vitest run`. Expected: pass.

- [ ] **Step 4: Commit (three repos, only these files)**

```bash
cd /home/debian/fsa-agent && git rev-parse --abbrev-ref HEAD   # master
git add client-v2/src/pages/JobDetailModal.jsx server/src/routes/tailoring.js   # plus any test whose string changed
git commit -m "copy: custom resume, not tailoring

Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb"

cd /home/debian/fsa-nurture && git rev-parse --abbrev-ref HEAD   # master
git add engine/templates/saved-jobs-d0.html engine/templates/saved-jobs-d3.html engine/templates/saved-jobs-d7.html engine/templates/job-digest-d7.html
git commit -m "copy: custom resume, not tailoring

Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb"

cd /home/debian/fsa-website && git rev-parse --abbrev-ref HEAD   # master
git add enrollment-confirmation.html
git commit -m "copy: custom resume, not tailoring

Claude-Session: https://claude.ai/code/session_01YShHJgFEVExyRPyoFRZKLb"
```
Do **not** stage `fsa-nurture/engine/templates/job-digest-d16.html` (another session's uncommitted deletion).

---

### Task 9: Deploy and verify (controller only, not an implementer subagent)

- [ ] **Step 1: Backup.** `sudo /usr/local/bin/fsa-backup.sh daily`. Note the printed path.
- [ ] **Step 2: Affiliate program.** `cd /home/debian/fsa-affiliate-program && git push origin main && GITHUB_TOKEN=$(gh auth token) docker compose build && docker compose up -d && docker compose run --rm fsa-affiliate-program node src/migrate.js`. Verify: `docker exec fsa-postgres psql -U postgres -d fsa_agent -Atc "select pg_get_constraintdef(oid) from pg_constraint where conname='affiliates_source_check'"` contains `in_app`.
- [ ] **Step 3: fsa-agent env.** Append `AFFILIATE_INTERNAL_URL=http://fsa-affiliate-program:3000` to `/home/debian/fsa-agent/.env`. `AFFILIATE_INTERNAL_SECRET` already comes from `.env.shared`. Both containers are on `fsa-agent_fsa-network`.
- [ ] **Step 4: Migration 021.** Before: `docker exec fsa-postgres psql -U postgres -d fsa_agent -Atc "select count(*) from platform_users where id not in (select user_id from credit_transactions where reason='signup_grant')"` (expect 13, or a few more if new students enrolled). Apply: `docker cp server/migrations/021_paid_enrollment_signup_credit.sql fsa-postgres:/tmp/021.sql && docker exec fsa-postgres psql -U postgres -d fsa_agent -f /tmp/021.sql`. After: same count query returns 0.
- [ ] **Step 5: fsa-agent deploy.** `git push origin master`, then `cd /home/debian/fsa-agent/client-v2 && npm run build && cd .. && GITHUB_TOKEN=$(gh auth token) docker compose build api && docker compose up -d api`.
- [ ] **Step 6: fsa-nurture deploy.** `git push origin master`, then `cd /home/debian/fsa-nurture && GITHUB_TOKEN=$(gh auth token) docker compose build fsa-nurture && docker compose up -d fsa-nurture`. Check `docker ps` shows it up (not restarting).
- [ ] **Step 7: Website.** Use the `fsa-website-deploy` skill for `enrollment-confirmation.html`.
- [ ] **Step 8: Live check** (Playwright against `https://learn.fullsteamahead.ca`, desktop and 375px width), with a real job-only test account and a real student account: login lands on `/home`; all six cards render; Continue → `/lobby`; `?next=/jobs/capture...` still wins; Join on a non-affiliate test account flips to the link and the welcome email arrives (read the delivered message). Do not click Join on a real customer's account.
- [ ] **Step 9: Wiki.** Update `wiki/projects/fsa-agent.md` (route table: `/home`; API table: `/api/platform/home`, `/affiliate/join`; the credit-grant fact), `wiki/projects/fsa-affiliate-program.md` (`/internal/affiliates/summary`, `in_app` source), and append `## [2026-09-30] feature | Home dashboard ...` to `wiki/log.md`.
