# Split 4th Class into fourth_a / fourth_b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell 4th Class as two independently-purchasable annual subscriptions (`fourth_a` for 4A, `fourth_b` for 4B) instead of one bundled `fourth` product, letting a student own one or both — while touching as little of the rest of the app as possible.

**Architecture:** A DB migration relaxes the existing "one active subscription per user" constraint to "one active subscription per (user, class_code)", and `provision-user`'s guard gains the one new rule this requires ("fourth_a and fourth_b may coexist; nothing else may coexist with anything"). The 4th-Class-specific `quiz-lobby-data` endpoint — the only place that already queries `subscriptions` directly rather than trusting the single `req.user.class_code` — is changed to build its response from whichever paper(s) the student actually owns. Everywhere else, `class_code === 'fourth'` becomes "is this class_code one of the two 4th Class values" via one small shared helper, imported wherever it's needed. `requireAuth`, 2nd/3rd Class, and the AI service are untouched.

**Tech Stack:** Node/Express (`server`), React (`client-v2`), Jest + Supertest against a real Postgres test DB, no `client-v2` test harness (build + manual/live verification, matching every prior task in this branch).

**Source spec:** `docs/superpowers/specs/2026-07-23-fourth-class-split-a-b-design.md`

## Global Constraints

- `class_code='fourth'` (the old combined product) stops being issued by anything new, but nothing in this plan needs to delete or migrate old rows with that value via a script — the only such row in the database is the test account used throughout this branch, updated directly as part of Task 4.
- A student may hold `fourth_a` and `fourth_b` active at the same time. A student may **never** hold `second` or `third` active alongside **any** 4th Class paper, in either direction. Two active rows of the exact same `class_code` (a duplicate purchase) is never allowed, for any `class_code`.
- `requireAuth` (`server/src/middleware/requireAuth.js`) is **not modified**. It will pick one of a student's active rows arbitrarily if they have two (via its existing `LEFT JOIN ... WHERE status='active'`, unchanged) — that's fine, because the one entry gate that reads `req.user.class_code` for 4th Class (`quiz-lobby-data`) only needs to know "is this *some* flavor of 4th Class," and does its own direct query for "which paper(s) exactly."
- `ai-service`'s `FOURTH_CLASS_COURSES = {'4A', '4B'}` (keyed on `course_id`, not `class_code`) is unaffected and not touched by this plan.
- No live deploy inside individual task dispatches if executed via subagent-driven-development — deploy and live-verify once, at the end (Task 4), matching every prior plan in this branch.

---

## Task 1: Migration + provision-user guard

**Files:**
- Create: `server/migrations/014_fourth_class_split.sql`
- Modify: `server/src/config/papersForClass.js`
- Modify: `server/src/routes/platform.js:71-80` (the `provision-user` subscription insert)
- Modify: `server/tests/provisionUserOneActiveSubscription.test.js` (an EXISTING test whose DB-level assertion becomes factually wrong under the new index — see Step 2)
- Test: `server/tests/provisionUserFourthClassSplit.test.js`

**Interfaces:**
- Produces: `FOURTH_CLASS_CODES` (array `['fourth_a', 'fourth_b']`), exported from `server/src/config/papersForClass.js` alongside the existing `PAPERS_BY_CLASS` — consumed by Task 2's `quiz-lobby-data` endpoint and by `provision-user`'s new guard logic.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/provisionUserFourthClassSplit.test.js`:

```js
jest.mock('../src/services/email');

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const platformRouter = require('../src/routes/platform');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/platform', platformRouter);
  return app;
}

async function activeCodes(email) {
  const rows = await pool.query(
    `SELECT s.class_code FROM subscriptions s
     JOIN platform_users u ON u.id = s.user_id
     WHERE u.email = $1 AND s.status = 'active'
     ORDER BY s.class_code`,
    [email]
  );
  return rows.rows.map(r => r.class_code);
}

describe('provision-user — 4th Class split (fourth_a / fourth_b)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, INTERNAL_SECRET: 'test-internal-secret' };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.query(`DELETE FROM auth_tokens`);
    await pool.query(`DELETE FROM subscriptions`);
    await pool.query(`DELETE FROM platform_users`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('buying fourth_b after fourth_a leaves both active — the one new case', async () => {
    const app = buildTestApp();
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'both-papers@example.com', first_name: 'Both', last_name: 'Papers', class_code: 'fourth_a' });
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'both-papers@example.com', first_name: 'Both', last_name: 'Papers', class_code: 'fourth_b' });

    expect(await activeCodes('both-papers@example.com')).toEqual(['fourth_a', 'fourth_b']);
  });

  it('buying fourth_a twice does not create a duplicate row', async () => {
    const app = buildTestApp();
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'repeat-buyer@example.com', first_name: 'Repeat', last_name: 'Buyer', class_code: 'fourth_a' });
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'repeat-buyer@example.com', first_name: 'Repeat', last_name: 'Buyer', class_code: 'fourth_a' });

    expect(await activeCodes('repeat-buyer@example.com')).toEqual(['fourth_a']);
  });

  it('buying fourth_a while second is active is blocked (cross-tier)', async () => {
    const app = buildTestApp();
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'cross-tier-1@example.com', first_name: 'Cross', last_name: 'Tier', class_code: 'second' });
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'cross-tier-1@example.com', first_name: 'Cross', last_name: 'Tier', class_code: 'fourth_a' });

    expect(await activeCodes('cross-tier-1@example.com')).toEqual(['second']);
  });

  it('buying second while fourth_a is active is blocked (cross-tier, reverse direction)', async () => {
    const app = buildTestApp();
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'cross-tier-2@example.com', first_name: 'Cross', last_name: 'Tier', class_code: 'fourth_a' });
    await request(app).post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'cross-tier-2@example.com', first_name: 'Cross', last_name: 'Tier', class_code: 'second' });

    expect(await activeCodes('cross-tier-2@example.com')).toEqual(['fourth_a']);
  });

  it('DB allows a raw fourth_a + fourth_b active pair for the same user', async () => {
    const userResult = await pool.query(
      `INSERT INTO platform_users (email, first_name, last_name) VALUES ('raw-both@example.com', 'Raw', 'Both') RETURNING id`
    );
    const userId = userResult.rows[0].id;
    await pool.query(`INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, 'fourth_a', 'active')`, [userId]);

    await expect(
      pool.query(`INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, 'fourth_b', 'active')`, [userId])
    ).resolves.toBeDefined();
  });

  it('DB still rejects two active rows with the exact same class_code', async () => {
    const userResult = await pool.query(
      `INSERT INTO platform_users (email, first_name, last_name) VALUES ('raw-dup@example.com', 'Raw', 'Dup') RETURNING id`
    );
    const userId = userResult.rows[0].id;
    await pool.query(`INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, 'fourth_a', 'active')`, [userId]);

    await expect(
      pool.query(`INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, 'fourth_a', 'active')`, [userId])
    ).rejects.toMatchObject({ code: '23505' });
  });
});
```

- [ ] **Step 2: Fix the existing test whose premise the new index invalidates**

`server/tests/provisionUserOneActiveSubscription.test.js`'s second test currently asserts that the database itself rejects a raw `second` + `fourth` active pair for the same user — that assertion becomes **factually wrong** once the migration in Step 4 replaces the "one active row per user" index with "one active row per (user, class_code)" (different `class_code` values no longer collide at the database level at all; cross-tier exclusion moves to `provision-user`'s application code, per this plan's Global Constraints). Left unchanged, this test would start failing for the right reason (behavior correctly changed) but for a confusing one (it looks like a regression until you remember this index was deliberately relaxed).

Change the whole file from:

```js
jest.mock('../src/services/email');

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const platformRouter = require('../src/routes/platform');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/platform', platformRouter);
  return app;
}

describe('provision-user — one active subscription per user', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, INTERNAL_SECRET: 'test-internal-secret' };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.query(`DELETE FROM auth_tokens`);
    await pool.query(`DELETE FROM subscriptions`);
    await pool.query(`DELETE FROM platform_users`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('does not create a second active subscription row under a different class_code for the same user', async () => {
    const app = buildTestApp();

    const first = await request(app)
      .post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'dual-class@example.com', first_name: 'Dual', last_name: 'User', class_code: 'second' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'dual-class@example.com', first_name: 'Dual', last_name: 'User', class_code: 'fourth' });
    expect(second.status).toBe(200);

    const rows = await pool.query(
      `SELECT s.class_code FROM subscriptions s
       JOIN platform_users u ON u.id = s.user_id
       WHERE u.email = 'dual-class@example.com' AND s.status = 'active'`
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].class_code).toBe('second');
  });

  it('DB rejects a raw second active subscription insert for the same user', async () => {
    const userResult = await pool.query(
      `INSERT INTO platform_users (email, first_name, last_name) VALUES ('raw-dual@example.com', 'Raw', 'User') RETURNING id`
    );
    const userId = userResult.rows[0].id;
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, 'second', 'active')`,
      [userId]
    );

    await expect(
      pool.query(
        `INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, 'fourth', 'active')`,
        [userId]
      )
    ).rejects.toMatchObject({ code: '23505' });
  });
});
```

to:

```js
jest.mock('../src/services/email');

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const platformRouter = require('../src/routes/platform');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/platform', platformRouter);
  return app;
}

describe('provision-user — one active subscription per (user, class_code)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, INTERNAL_SECRET: 'test-internal-secret' };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.query(`DELETE FROM auth_tokens`);
    await pool.query(`DELETE FROM subscriptions`);
    await pool.query(`DELETE FROM platform_users`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('does not create a second active subscription row under a different class_code for the same user (cross-tier, application-enforced)', async () => {
    const app = buildTestApp();

    const first = await request(app)
      .post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'dual-class@example.com', first_name: 'Dual', last_name: 'User', class_code: 'second' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'dual-class@example.com', first_name: 'Dual', last_name: 'User', class_code: 'fourth_a' });
    expect(second.status).toBe(200);

    const rows = await pool.query(
      `SELECT s.class_code FROM subscriptions s
       JOIN platform_users u ON u.id = s.user_id
       WHERE u.email = 'dual-class@example.com' AND s.status = 'active'`
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].class_code).toBe('second');
  });

  it('DB rejects a raw duplicate active subscription (same class_code) for the same user', async () => {
    const userResult = await pool.query(
      `INSERT INTO platform_users (email, first_name, last_name) VALUES ('raw-dual@example.com', 'Raw', 'User') RETURNING id`
    );
    const userId = userResult.rows[0].id;
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, 'second', 'active')`,
      [userId]
    );

    await expect(
      pool.query(
        `INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, 'second', 'active')`,
        [userId]
      )
    ).rejects.toMatchObject({ code: '23505' });
  });
});
```

(The cross-tier exclusion in the first test is now enforced by `provision-user`'s application logic — Step 5 below — not the database index; the second test now checks what the new index actually guarantees: no duplicate `(user_id, class_code)` pair, demonstrated with `second` since that's unambiguously never allowed to repeat, independent of the 4th-Class-specific coexistence rule.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_DB=fsa_agent_test npx jest tests/provisionUserFourthClassSplit.test.js tests/provisionUserOneActiveSubscription.test.js --runInBand`
Expected: FAIL — `fourth_a`/`fourth_b` aren't recognized by anything yet (the old guard blocks ANY second active row regardless of class_code, so the "both active" test fails), and the old index still rejects the raw `second`+`second` pair test's setup differently than expected until the migration lands.

- [ ] **Step 4: Write the migration**

Create `server/migrations/014_fourth_class_split.sql`:

```sql
-- 4th Class is now sold as two independently-purchasable annual subscriptions
-- (fourth_a for 4A, fourth_b for 4B) instead of one combined 'fourth' product. A
-- student can hold both simultaneously (bought separately, in either order), which
-- the previous one-active-subscription-per-user constraint (013_fourth_class.sql)
-- doesn't allow.
DROP INDEX IF EXISTS subscriptions_one_active_per_user;

-- One active row per (user, class_code) -- still blocks a duplicate purchase of the
-- SAME product (including the same 4th Class paper twice), no longer blocks
-- fourth_a + fourth_b coexisting (different class_code values). Cross-tier exclusion
-- (2nd/3rd Class vs any 4th Class paper) is enforced in provision-user's application
-- code instead (server/src/routes/platform.js) -- "these two specific values are
-- mutually exclusive with everything else but not with each other" isn't
-- expressible as a single partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_active_per_user_class
  ON subscriptions (user_id, class_code) WHERE status = 'active';
```

Apply it to both the dev DB and the test DB:

```bash
docker cp server/migrations/014_fourth_class_split.sql fsa-postgres:/tmp/014_fourth_class_split.sql
docker exec fsa-postgres psql -U postgres -d fsa_agent -f /tmp/014_fourth_class_split.sql
docker exec fsa-postgres psql -U postgres -d fsa_agent_test -f /tmp/014_fourth_class_split.sql
```

- [ ] **Step 5: Add `FOURTH_CLASS_CODES` to the shared config**

In `server/src/config/papersForClass.js`, change:

```js
// Papers offered per class_code. Single source of truth for both the authenticated
// paper-picker (routes/platform.js) and the unauthenticated diagnostic-quiz sampler
// (routes/diagnostic.js), which previously duplicated the second/third arrays
// independently.
const PAPERS_BY_CLASS = {
  second: ['2A1', '2A2', '2A3', '2B1', '2B2', '2B3'],
  third: ['3A1', '3A2', '3B1', '3B2'],
  fourth: ['4A', '4B'],
};

module.exports = { PAPERS_BY_CLASS };
```

to:

```js
// Papers offered per class_code. Single source of truth for both the authenticated
// paper-picker (routes/platform.js) and the unauthenticated diagnostic-quiz sampler
// (routes/diagnostic.js), which previously duplicated the second/third arrays
// independently.
const PAPERS_BY_CLASS = {
  second: ['2A1', '2A2', '2A3', '2B1', '2B2', '2B3'],
  third: ['3A1', '3A2', '3B1', '3B2'],
  fourth_a: ['4A'],
  fourth_b: ['4B'],
};

// 4th Class is sold as two independently-purchasable papers rather than one
// combined product -- every place that used to check `class_code === 'fourth'`
// needs to recognize either of these instead of one fixed string.
const FOURTH_CLASS_CODES = ['fourth_a', 'fourth_b'];

module.exports = { PAPERS_BY_CLASS, FOURTH_CLASS_CODES };
```

- [ ] **Step 6: Rewrite `provision-user`'s guard**

In `server/src/routes/platform.js`, add `FOURTH_CLASS_CODES` to the existing import (search for `require('../config/papersForClass')`):

```js
const { PAPERS_BY_CLASS, FOURTH_CLASS_CODES } = require('../config/papersForClass');
```

Then change the subscription-insert block inside `POST /api/platform/provision-user` from:

```js
    // Insert active subscription if none exists — RETURNING id tells us if it was just created.
    // Covers both new subscribers and re-enrollment after cancellation.
    const subInsert = await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper, stripe_subscription_id)
       SELECT $1, $2, 'active', NULL, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM subscriptions
         WHERE user_id = $1 AND status = 'active'
       )
       RETURNING id`,
      [user.id, class_code, stripe_subscription_id || null]
    );
    const subIsNew = subInsert.rowCount > 0;
```

to:

```js
    // Determine whether this purchase is allowed to create a new active row.
    // - second/third: blocked by ANY existing active subscription (unchanged from
    //   before the 4th Class split).
    // - fourth_a/fourth_b: blocked only by an active second/third subscription
    //   (cross-tier exclusion) or an active row of this SAME class_code
    //   (duplicate/idempotent-retry) -- but NOT by the other fourth_x code, since
    //   a student can now own both papers at once.
    const existingActive = await pool.query(
      `SELECT class_code FROM subscriptions WHERE user_id = $1 AND status = 'active'`,
      [user.id]
    );
    const existingCodes = existingActive.rows.map(r => r.class_code);
    const isFourthClassPurchase = FOURTH_CLASS_CODES.includes(class_code);
    const blocked = isFourthClassPurchase
      ? existingCodes.includes(class_code) || existingCodes.some(c => !FOURTH_CLASS_CODES.includes(c))
      : existingCodes.length > 0;

    let subIsNew = false;
    if (!blocked) {
      const subInsert = await pool.query(
        `INSERT INTO subscriptions (user_id, class_code, status, active_paper, stripe_subscription_id)
         VALUES ($1, $2, 'active', NULL, $3)
         RETURNING id`,
        [user.id, class_code, stripe_subscription_id || null]
      );
      subIsNew = subInsert.rowCount > 0;
    }
```

(`subIsNew` is consumed unchanged by the existing magic-link-sending logic right below this block — no further changes needed there.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd server && POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_DB=fsa_agent_test npx jest tests/provisionUserFourthClassSplit.test.js tests/provisionUserOneActiveSubscription.test.js --runInBand`
Expected: all PASS.

- [ ] **Step 8: Run the full server test suite to check for regressions**

Run: `cd server && npm test`
Expected: all PASS. `server/tests/quizLobbyData.test.js` is EXPECTED to fail at this point (it still uses the literal `'fourth'` class_code, which Task 2 fixes) — confirm that's the only failure, and do not attempt to fix it in this task; that's explicitly Task 2's job.

- [ ] **Step 9: Commit**

```bash
git add server/migrations/014_fourth_class_split.sql server/src/config/papersForClass.js server/src/routes/platform.js server/tests/provisionUserFourthClassSplit.test.js server/tests/provisionUserOneActiveSubscription.test.js
git commit -m "feat: split 4th Class into independently-purchasable fourth_a / fourth_b"
```

---

## Task 2: `quiz-lobby-data` — build the response from owned papers only

**Files:**
- Modify: `server/src/routes/platform.js` (the `quiz-lobby-data` route)
- Modify: `server/tests/quizLobbyData.test.js` (an EXISTING test whose fixture uses the retired `'fourth'` class_code)
- Test: `server/tests/quizLobbyDataOwnedPapers.test.js`

**Interfaces:**
- Consumes: `FOURTH_CLASS_CODES`, `PAPERS_BY_CLASS` (Task 1).

- [ ] **Step 1: Fix the existing test's fixture**

`server/tests/quizLobbyData.test.js`'s second test creates a user with `classCode: 'fourth'` and a single subscription row, expecting both `4A` and `4B` in the response. Once Task 1 lands, `'fourth'` no longer passes the entry gate at all (400 instead of 200), and even if it did, `PAPERS_BY_CLASS.fourth` no longer exists. Update the fixture to grant both papers the way a real student now would: two separate active rows.

Change the test file's `createUser` helper and its "both papers" test from:

```js
async function createUser({ email, classCode }) {
  const token = `test-token-${email}`;
  const userResult = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Test', 'User', $2) RETURNING id`,
    [email, token]
  );
  const userId = userResult.rows[0].id;
  await pool.query(
    `INSERT INTO subscriptions (user_id, class_code, status, active_paper)
     VALUES ($1, $2, 'active', NULL)`,
    [userId, classCode]
  );
  return { userId, token };
}
```

to:

```js
async function createUser({ email, classCodes }) {
  const token = `test-token-${email}`;
  const userResult = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Test', 'User', $2) RETURNING id`,
    [email, token]
  );
  const userId = userResult.rows[0].id;
  for (const classCode of classCodes) {
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper)
       VALUES ($1, $2, 'active', NULL)`,
      [userId, classCode]
    );
  }
  return { userId, token };
}
```

Then change both call sites in the same file — the "rejects a non-fourth-class subscriber" test:

```js
    const { token } = await createUser({ email: 'not-fourth@example.com', classCode: 'second' });
```

to:

```js
    const { token } = await createUser({ email: 'not-fourth@example.com', classCodes: ['second'] });
```

and the "returns both 4A and 4B" test:

```js
    const { token } = await createUser({ email: 'fourth-lobby@example.com', classCode: 'fourth' });
```

to:

```js
    const { token } = await createUser({ email: 'fourth-lobby@example.com', classCodes: ['fourth_a', 'fourth_b'] });
```

Finally, `res.body.class_code` in that same test currently asserts the literal `'fourth'` — since `requireAuth`'s `LEFT JOIN` will now arbitrarily pick ONE of the user's two active rows for `req.user.class_code`, this becomes non-deterministic. Change:

```js
    expect(res.body.class_code).toBe('fourth');
```

to:

```js
    expect(['fourth_a', 'fourth_b']).toContain(res.body.class_code);
```

- [ ] **Step 2: Write the new failing tests**

Create `server/tests/quizLobbyDataOwnedPapers.test.js`:

```js
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const platformRouter = require('../src/routes/platform');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/platform', platformRouter);
  return app;
}

async function createUser({ email, classCodes }) {
  const token = `test-token-${email}`;
  const userResult = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Test', 'User', $2) RETURNING id`,
    [email, token]
  );
  const userId = userResult.rows[0].id;
  for (const classCode of classCodes) {
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper)
       VALUES ($1, $2, 'active', NULL)`,
      [userId, classCode]
    );
  }
  return { userId, token };
}

describe('GET /api/platform/quiz-lobby-data — owned papers only', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM chapters WHERE course_id IN ('4A', '4B')`);
    await pool.query(`DELETE FROM subscriptions`);
    await pool.query(`DELETE FROM platform_users`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns only 4A for a student who owns just fourth_a', async () => {
    const { token } = await createUser({ email: 'a-only@example.com', classCodes: ['fourth_a'] });
    await pool.query(`INSERT INTO chapters (course_id, chapter_num, title) VALUES ('4A', 1, 'Intro')`);

    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.papers)).toEqual(['4A']);
  });

  it('returns only 4B for a student who owns just fourth_b', async () => {
    const { token } = await createUser({ email: 'b-only@example.com', classCodes: ['fourth_b'] });
    await pool.query(`INSERT INTO chapters (course_id, chapter_num, title) VALUES ('4B', 1, 'Lubrication')`);

    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.papers)).toEqual(['4B']);
  });

  it('returns both papers for a student who owns fourth_a and fourth_b', async () => {
    const { token } = await createUser({ email: 'both-owned@example.com', classCodes: ['fourth_a', 'fourth_b'] });
    await pool.query(
      `INSERT INTO chapters (course_id, chapter_num, title) VALUES ('4A', 1, 'Intro'), ('4B', 1, 'Lubrication')`
    );

    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.papers).sort()).toEqual(['4A', '4B']);
  });

  it('still rejects a 2nd/3rd Class subscriber with 400', async () => {
    const { token } = await createUser({ email: 'second-only@example.com', classCodes: ['second'] });

    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_DB=fsa_agent_test npx jest tests/quizLobbyDataOwnedPapers.test.js tests/quizLobbyData.test.js -v --runInBand`
Expected: FAIL — the endpoint still gates on literal `'fourth'` and always builds both papers regardless of what's actually owned.

- [ ] **Step 4: Rewrite the endpoint**

In `server/src/routes/platform.js`, change the `quiz-lobby-data` route's opening from:

```js
router.get('/quiz-lobby-data', requireAuth, async (req, res) => {
  try {
    const { email, class_code } = req.user;
    if (class_code !== 'fourth') {
      return res.status(400).json({ error: 'This endpoint is for 4th Class subscribers only' });
    }
    const passingThreshold = parseInt(process.env.QUIZ_PASSING_THRESHOLD || '75', 10);
    const papers = PAPERS_BY_CLASS.fourth;
    const result = {};
```

to:

```js
router.get('/quiz-lobby-data', requireAuth, async (req, res) => {
  try {
    const { id: userId, email, class_code } = req.user;
    if (!FOURTH_CLASS_CODES.includes(class_code)) {
      return res.status(400).json({ error: 'This endpoint is for 4th Class subscribers only' });
    }

    // A student may own just one paper or both, purchased separately —
    // requireAuth only surfaces ONE of the user's possibly-two active rows as
    // req.user.class_code (via its existing LEFT JOIN, unmodified), so this
    // endpoint queries subscriptions directly to find every paper actually owned,
    // rather than assuming both the way the original combined 'fourth' did.
    const ownedResult = await pool.query(
      `SELECT class_code FROM subscriptions
       WHERE user_id = $1 AND status = 'active' AND class_code = ANY($2::text[])`,
      [userId, FOURTH_CLASS_CODES]
    );
    const papers = ownedResult.rows.flatMap(r => PAPERS_BY_CLASS[r.class_code] || []);

    const passingThreshold = parseInt(process.env.QUIZ_PASSING_THRESHOLD || '75', 10);
    const result = {};
```

No other line in the route needs to change — the `for (const paper of papers)` loop and everything inside it already works per-paper generically, and will now simply iterate over one or two papers instead of always two.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_DB=fsa_agent_test npx jest tests/quizLobbyDataOwnedPapers.test.js tests/quizLobbyData.test.js -v --runInBand`
Expected: all PASS.

- [ ] **Step 6: Run the full server test suite to check for regressions**

Run: `cd server && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/platform.js server/tests/quizLobbyData.test.js server/tests/quizLobbyDataOwnedPapers.test.js
git commit -m "feat: quiz-lobby-data builds response from owned 4th Class papers, not both always"
```

---

## Task 3: Frontend — recognize both `fourth_a` and `fourth_b` everywhere

**Files:**
- Create: `client-v2/src/utils/fourthClass.js`
- Modify: `client-v2/src/App.jsx`
- Modify: `client-v2/src/components/ProtectedRoute.jsx`
- Modify: `client-v2/src/pages/LoginPage.jsx`
- Modify: `client-v2/src/pages/SetupPage.jsx`
- Modify: `client-v2/src/pages/SignupPage.jsx`
- Modify: `client-v2/src/ExamRouter.jsx`
- Modify: `client-v2/src/LessonPlayer.jsx`
- Modify: `client-v2/src/pages/ExamResultsPage.jsx`

**Interfaces:**
- Produces: `isFourthClassCode(classCode)` and `FOURTH_CLASS_CODES`, exported from `client-v2/src/utils/fourthClass.js` — consumed by all eight files below. One shared definition instead of duplicating the two-element array eight times.

- [ ] **Step 1: Create the shared helper**

Create `client-v2/src/utils/fourthClass.js`:

```js
// Shared helper for "is this class_code some flavor of 4th Class" — 4th Class is
// sold as two independently-purchasable papers (fourth_a, fourth_b) rather than one
// combined product, so every place that used to check `=== 'fourth'` needs to
// recognize either instead of one fixed string.
export const FOURTH_CLASS_CODES = ['fourth_a', 'fourth_b'];

export function isFourthClassCode(classCode) {
  return FOURTH_CLASS_CODES.includes(classCode);
}
```

- [ ] **Step 2: `App.jsx`**

Add the import near the other imports at the top of `client-v2/src/App.jsx`:

```jsx
import { isFourthClassCode } from './utils/fourthClass';
```

Change:

```jsx
// 4th Class has no lesson content — it gets a dedicated quiz-only lobby at the
// same /lobby route path instead of a class_code branch inside LobbyPage itself.
function LobbyRoute() {
  const user = JSON.parse(localStorage.getItem('fsa_user') || 'null');
  return user?.class_code === 'fourth' ? <QuizOnlyLobbyPage /> : <LobbyPage />;
}
```

to:

```jsx
// 4th Class has no lesson content — it gets a dedicated quiz-only lobby at the
// same /lobby route path instead of a class_code branch inside LobbyPage itself.
function LobbyRoute() {
  const user = JSON.parse(localStorage.getItem('fsa_user') || 'null');
  return isFourthClassCode(user?.class_code) ? <QuizOnlyLobbyPage /> : <LobbyPage />;
}
```

- [ ] **Step 3: `ProtectedRoute.jsx`**

Add the import at the top of `client-v2/src/components/ProtectedRoute.jsx`:

```jsx
import { isFourthClassCode } from '../utils/fourthClass';
```

Change:

```jsx
  if (requirePaper && !user.active_paper && user.class_code !== 'fourth') return <Navigate to="/select-paper" replace />;
```

to:

```jsx
  if (requirePaper && !user.active_paper && !isFourthClassCode(user.class_code)) return <Navigate to="/select-paper" replace />;
```

- [ ] **Step 4: `LoginPage.jsx`, `SetupPage.jsx`, `SignupPage.jsx`**

Add `import { isFourthClassCode } from '../utils/fourthClass';` near the top of each of the three files (all live in `client-v2/src/pages/`).

In `client-v2/src/pages/LoginPage.jsx`, change:

```jsx
      } else if (data.user.class_code === 'fourth') {
```

to:

```jsx
      } else if (isFourthClassCode(data.user.class_code)) {
```

In `client-v2/src/pages/SetupPage.jsx`, change:

```jsx
      if (data.user.class_code === 'fourth') {
```

to:

```jsx
      if (isFourthClassCode(data.user.class_code)) {
```

In `client-v2/src/pages/SignupPage.jsx`, change:

```jsx
      } else if (data.user.class_code === 'fourth') {
```

to:

```jsx
      } else if (isFourthClassCode(data.user.class_code)) {
```

- [ ] **Step 5: `ExamRouter.jsx`**

Add the import near the other imports at the top of `client-v2/src/ExamRouter.jsx`:

```jsx
import { isFourthClassCode } from './utils/fourthClass';
```

Change:

```js
  const isFourthClass = classCode === 'fourth' && mode !== 'chapter_quiz';
```

to:

```js
  const isFourthClass = isFourthClassCode(classCode) && mode !== 'chapter_quiz';
```

- [ ] **Step 6: `LessonPlayer.jsx`**

Add the import near the top of `client-v2/src/LessonPlayer.jsx`:

```jsx
import { isFourthClassCode } from './utils/fourthClass';
```

Change:

```js
  const hideTutor = classCode === 'fourth';
```

to:

```js
  const hideTutor = isFourthClassCode(classCode);
```

- [ ] **Step 7: `ExamResultsPage.jsx`**

Add the import near the top of `client-v2/src/pages/ExamResultsPage.jsx`:

```jsx
import { isFourthClassCode } from '../utils/fourthClass';
```

Change:

```js
  const isFourthClass = user.class_code === 'fourth';
```

to:

```js
  const isFourthClass = isFourthClassCode(user.class_code);
```

- [ ] **Step 8: Confirm nothing was missed**

Run: `grep -rn "'fourth'" client-v2/src server/src`
Expected: the only remaining hits are `server/src/routes/diagnostic.js`'s comment explaining why that file is deliberately NOT extended (unrelated to this plan — the diagnostic-quiz lead magnet was never given 4th Class support at all, per the original 4th Class plan's documented scope decision, and still isn't). If anything else turns up, it was missed by this task — fix it before moving on.

- [ ] **Step 9: Build and verify**

```bash
cd client-v2 && npm run build
```
Must complete with zero errors. No live deploy in this step — full verification happens once, at the end (Task 4).

- [ ] **Step 10: Commit**

```bash
git add client-v2/src/utils/fourthClass.js client-v2/src/App.jsx client-v2/src/components/ProtectedRoute.jsx client-v2/src/pages/LoginPage.jsx client-v2/src/pages/SetupPage.jsx client-v2/src/pages/SignupPage.jsx client-v2/src/ExamRouter.jsx client-v2/src/LessonPlayer.jsx client-v2/src/pages/ExamResultsPage.jsx
git commit -m "feat: recognize fourth_a/fourth_b everywhere the app checked for 'fourth'"
```

---

## Task 4: Deploy and live-verify

**Files:** none — deployment, test-account migration, and verification only.

- [ ] **Step 1: Rebuild and deploy both containers**

```bash
cd client-v2 && npm run build && cd ..
docker compose -p fsa-agent --env-file /home/debian/.env build api
docker compose -p fsa-agent --env-file /home/debian/.env up -d api
```

(`ai-service` is untouched by this plan — no rebuild needed there.)

- [ ] **Step 2: Update the test account's data to the new model**

The test account (`sysadmin@powerboot.ca`) currently has a single `class_code='fourth'` row — the only such row in the database, since 4th Class hasn't launched. Replace it with two rows so the "owns both papers" case can be exercised:

```bash
docker exec fsa-postgres psql -U postgres -d fsa_agent -c "
  UPDATE subscriptions SET class_code = 'fourth_a' WHERE user_id = (SELECT id FROM platform_users WHERE email = 'sysadmin@powerboot.ca') AND class_code = 'fourth';
  INSERT INTO subscriptions (user_id, class_code, status, active_paper)
    SELECT id, 'fourth_b', 'active', NULL FROM platform_users WHERE email = 'sysadmin@powerboot.ca'
    ON CONFLICT DO NOTHING;
"
```

Verify: `docker exec fsa-postgres psql -U postgres -d fsa_agent -c "SELECT class_code, status FROM subscriptions WHERE user_id = (SELECT id FROM platform_users WHERE email = 'sysadmin@powerboot.ca');"` should show two active rows, `fourth_a` and `fourth_b`.

- [ ] **Step 3: Live-verify against production**

Using a fresh browser session (cookie + `fsa_user` localStorage set the same way as every prior live-verification pass in this branch):

- With both `fourth_a` and `fourth_b` active: confirm `/lobby` shows both the 4A and 4B cards, exactly as before this plan.
- Temporarily deactivate one row (`UPDATE subscriptions SET status='inactive' WHERE user_id=... AND class_code='fourth_b'`) and reload: confirm `/lobby` now shows **only** the 4A card.
- Reactivate `fourth_b`, deactivate `fourth_a` instead, reload: confirm `/lobby` now shows **only** the 4B card.
- Reactivate both, confirm both cards are back.
- Confirm a chapter quiz and a practice exam both still work end-to-end (question count, immediate results, question review, retry — all built in the previous plan in this branch) for whichever paper(s) are active.

- [ ] **Step 4: Report results**

Summarize what was verified (and any issues found) back to the user before considering this plan complete, matching how every other live-verification pass in this branch has been handled.
