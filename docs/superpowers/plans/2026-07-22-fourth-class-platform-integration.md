# 4th Class Platform Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-content-complete 4th Class question banks (4A/4B) reachable through the platform as a dedicated quiz-only offering — new `class_code='fourth'`, a `QuizOnlyLobbyPage`, no AI tutor chat, a reduced-AI (stats-only) debrief, and a weighted retake — with no changes to the existing 2nd/3rd Class recurring-subscription experience.

**Architecture:** Additive changes only. A new DB migration adds a partial unique index enforcing one active subscription per user (closing a latent gap) and the `provision-user` guard is broadened to match. A new `GET /api/platform/quiz-lobby-data` endpoint and `QuizOnlyLobbyPage` component parallel the existing `lobby-data`/`LobbyPage` but with no lesson/progress joins. The AI tutor chat surface is conditionally hidden by `class_code`. The exam-taking mechanism itself (`/api/chat`, question serving, scoring) is entirely unchanged — 4th Class reuses it as-is.

**Tech Stack:** Node/Express (server), React (client-v2), Python/Flask (ai-service), PostgreSQL, Jest + Supertest (server tests), Pytest (ai-service tests).

**Source spec:** `docs/superpowers/specs/2026-07-13-fourth-class-platform-integration-design.md` (recovered from `/home/debian/docs/superpowers/specs/` — the original location under this repo's `docs/superpowers/specs/` was never committed).

## Global Constraints

- `subscriptions.class_code` gains a third informal value `'fourth'` — no DB CHECK constraint exists for this column today (only `'second'`/`'third'` are used by convention), and none is added by this plan either, matching existing practice.
- Server tests run against a real Postgres test DB: `POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_DB=fsa_agent_test npx jest --runInBand` from `server/`. Any new migration must also be applied to `fsa_agent_test` before its tests are run (`docker exec` doesn't reach it — it's a host-run Postgres bound to port 5434; connect with `psql -h localhost -p 5434 -U postgres -d fsa_agent_test -f server/migrations/013_fourth_class.sql`).
- `client-v2` has no test harness (no Jest/RTL config, no `*.test.jsx` files anywhere in the repo) — frontend tasks are verified manually (build + visual check against the live platform via Cloudflare Tunnel), not with invented unit tests. This matches existing project practice; do not introduce a new test framework as part of this work.
- Never test endpoints via `localhost`/container IP — always `https://learn.fullsteamahead.ca` through the Cloudflare Tunnel.
- Two deliberate deviations from the source spec, found while mapping it onto the current code:
  1. **§3 (papers-for-class) is NOT extended to `diagnostic.js`'s unauthenticated diagnostic-quiz sampler.** That module's `papersForClass()` serves a `?class=second|third` lead-magnet flow with no UI that ever passes `class=fourth`, and the spec's own scope (§8) excludes new lead-magnet work for 4th Class. The shared config is still extracted for DRY and reused by both files, but `diagnostic.js`'s ternary keeps its original two-branch behavior unchanged.
  2. **§7 (retake) needs no code at all, not even a frontend change.** Tracing the exam flow shows `ResultsPanel`'s existing "Retake Exam (Adaptive)" button already calls `onAnswer('yes')` → `/api/chat`, which the AI service already recognizes (`_is_exam_retry`) and answers with a freshly weighted question set (`get_chapter_weights` → `get_exam_questions`) via `_reset_and_start_exam` — all without unmounting the exam view, so it works whether or not a chat panel is visible. Once Task 5 hides the chat overlay for 4th Class, this same mechanism runs invisibly and already satisfies the spec's retake requirement. (An earlier draft of this plan tried to thread a separate `onRetakeExam` prop calling `handleStartExam(examConfig)` instead — that turned out to be broken, since `QuizExamView`'s initial-question fetch only runs in a mount-only `useEffect([])` that a same-phase state reset never re-triggers. See Task 7 for the full writeup of why it was rejected.)

---

## Task 1: One active subscription per user — migration + provision-user guard

**Files:**
- Create: `server/migrations/013_fourth_class.sql`
- Modify: `server/src/routes/platform.js:71-80` (the `provision-user` subscription insert)
- Test: `server/tests/provisionUserOneActiveSubscription.test.js`

**Interfaces:**
- Produces: `subscriptions_one_active_per_user` unique index (DB-level invariant consumed implicitly by every later task — `class_code='fourth'` must never coexist with an active `second`/`third` row for the same user).

- [ ] **Step 1: Write the failing tests**

Create `server/tests/provisionUserOneActiveSubscription.test.js`:

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

describe('provision-user — one active subscription per user', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, INTERNAL_SECRET: 'test-internal-secret' };
  });

  afterEach(async () => {
    process.env = originalEnv;
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
      .send({ email: 'dual-class@example.com', first_name: 'Dual', class_code: 'second' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/platform/provision-user')
      .set('x-internal-secret', 'test-internal-secret')
      .send({ email: 'dual-class@example.com', first_name: 'Dual', class_code: 'fourth' });
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
      `INSERT INTO platform_users (email, first_name) VALUES ('raw-dual@example.com', 'Raw') RETURNING id`
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

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_DB=fsa_agent_test npx jest tests/provisionUserOneActiveSubscription.test.js --runInBand`
Expected: first test FAILs (`rows.rows` has length 2, both `second` and `fourth` present) — the guard is currently scoped to `(user_id, class_code)`; second test FAILs (no unique index exists yet, insert succeeds instead of rejecting with `23505`).

- [ ] **Step 3: Write the migration**

Create `server/migrations/013_fourth_class.sql`:

```sql
-- 4th Class platform integration (see
-- docs/superpowers/specs/2026-07-13-fourth-class-platform-integration-design.md).
--
-- subscriptions.class_code gains a third informal value, 'fourth' -- enforced only by
-- application logic, same as 'second'/'third' today (no CHECK constraint exists to update).
--
-- Closes a latent gap: provision-user's "already has an active subscription" guard was
-- scoped to (user_id, class_code), not user_id alone, so nothing ever prevented two
-- simultaneous active subscriptions rows for the same user under different class_codes.
-- requireAuth.js's LEFT JOIN ... WHERE status='active' assumes exactly one active row and
-- picks arbitrarily if more than one exists. 4th Class must be mutually exclusive with a
-- 2nd/3rd Class subscription, so make the one-active-subscription-per-user invariant a real
-- DB constraint instead of an assumption.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_active_per_user
  ON subscriptions (user_id) WHERE status = 'active';
```

Apply it to both the dev DB and the test DB:

```bash
docker cp server/migrations/013_fourth_class.sql fsa-postgres:/tmp/013_fourth_class.sql
docker exec fsa-postgres psql -U postgres -d fsa_agent -f /tmp/013_fourth_class.sql
psql -h localhost -p 5434 -U postgres -d fsa_agent_test -f server/migrations/013_fourth_class.sql
```

- [ ] **Step 4: Broaden the provision-user guard**

In `server/src/routes/platform.js`, change the `provision-user` subscription insert (currently lines 71-80):

```js
    const subInsert = await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper, stripe_subscription_id)
       SELECT $1, $2, 'active', NULL, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM subscriptions
         WHERE user_id = $1 AND class_code = $2 AND status = 'active'
       )
       RETURNING id`,
      [user.id, class_code, stripe_subscription_id || null]
    );
```

to:

```js
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_DB=fsa_agent_test npx jest tests/provisionUserOneActiveSubscription.test.js --runInBand`
Expected: both tests PASS.

- [ ] **Step 6: Run the full server test suite to check for regressions**

Run: `cd server && npm test`
Expected: all existing tests still PASS (no test in the suite creates two simultaneous active subscriptions for one user — confirmed by grep before writing this plan).

- [ ] **Step 7: Commit**

```bash
git add server/migrations/013_fourth_class.sql server/src/routes/platform.js server/tests/provisionUserOneActiveSubscription.test.js
git commit -m "feat: enforce one active subscription per user (4th Class prerequisite)"
```

---

## Task 2: Shared papers-for-class config

**Files:**
- Create: `server/src/config/papersForClass.js`
- Modify: `server/src/routes/platform.js:288-295` (the `papers-for-class` route)
- Modify: `server/src/routes/diagnostic.js:1-11` (remove duplicated arrays)
- Test: `server/tests/papersForClass.test.js`
- Test: `server/tests/papersForClassRoute.test.js`

**Interfaces:**
- Produces: `PAPERS_BY_CLASS` (object, keys `'second'|'third'|'fourth'`, each an array of paper codes) from `server/src/config/papersForClass.js` — consumed by Task 3's `quiz-lobby-data` endpoint.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/papersForClass.test.js`:

```js
const { PAPERS_BY_CLASS } = require('../src/config/papersForClass');

describe('PAPERS_BY_CLASS config', () => {
  it('lists all six 2nd Class papers', () => {
    expect(PAPERS_BY_CLASS.second).toEqual(['2A1', '2A2', '2A3', '2B1', '2B2', '2B3']);
  });

  it('lists all four 3rd Class papers', () => {
    expect(PAPERS_BY_CLASS.third).toEqual(['3A1', '3A2', '3B1', '3B2']);
  });

  it('lists both 4th Class papers', () => {
    expect(PAPERS_BY_CLASS.fourth).toEqual(['4A', '4B']);
  });
});
```

Create `server/tests/papersForClassRoute.test.js`:

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

describe('GET /api/platform/papers-for-class', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM subscriptions`);
    await pool.query(`DELETE FROM platform_users`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns 4A and 4B for a fourth-class subscriber', async () => {
    const { token } = await createUser({ email: 'fourth-papers@example.com', classCode: 'fourth' });
    const res = await request(buildTestApp())
      .get('/api/platform/papers-for-class')
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.papers).toEqual(['4A', '4B']);
    expect(res.body.class_code).toBe('fourth');
  });

  it('still returns the six second-class papers for a second-class subscriber (unchanged)', async () => {
    const { token } = await createUser({ email: 'second-papers@example.com', classCode: 'second' });
    const res = await request(buildTestApp())
      .get('/api/platform/papers-for-class')
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.papers).toEqual(['2A1', '2A2', '2A3', '2B1', '2B2', '2B3']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_DB=fsa_agent_test npx jest tests/papersForClass.test.js tests/papersForClassRoute.test.js --runInBand`
Expected: FAIL — `Cannot find module '../src/config/papersForClass'`, and the route test's `fourth` case gets `['3A1','3A2','3B1','3B2']` (the current `=== 'second' ? ... : third` fallback).

- [ ] **Step 3: Create the shared config**

Create `server/src/config/papersForClass.js`:

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

- [ ] **Step 4: Wire it into `platform.js`**

Add near the other `require`s at the top of `server/src/routes/platform.js`:

```js
const { PAPERS_BY_CLASS } = require('../config/papersForClass');
```

Replace the `papers-for-class` route (currently):

```js
// GET /api/platform/papers-for-class
router.get('/papers-for-class', requireAuth, async (req, res) => {
  const { class_code } = req.user;
  const papers = class_code === 'second'
    ? ['2A1', '2A2', '2A3', '2B1', '2B2', '2B3']
    : ['3A1', '3A2', '3B1', '3B2'];
  return res.json({ papers, class_code });
});
```

with:

```js
// GET /api/platform/papers-for-class
router.get('/papers-for-class', requireAuth, async (req, res) => {
  const { class_code } = req.user;
  const papers = PAPERS_BY_CLASS[class_code] || PAPERS_BY_CLASS.third;
  return res.json({ papers, class_code });
});
```

- [ ] **Step 5: Wire it into `diagnostic.js` (DRY only — no `fourth` branch)**

In `server/src/routes/diagnostic.js`, replace:

```js
const PAPERS_SECOND = ['2A1', '2A2', '2A3', '2B1', '2B2', '2B3'];
// Note: 3B1/3B2 have no questions authored yet, so a third-class diagnostic
// effectively draws from 3A1/3A2 only until those papers are populated.
const PAPERS_THIRD = ['3A1', '3A2', '3B1', '3B2'];

function papersForClass(classCode) {
  return classCode === 'third' ? PAPERS_THIRD : PAPERS_SECOND;
}
```

with:

```js
const { PAPERS_BY_CLASS } = require('../config/papersForClass');

// Note: 3B1/3B2 have no questions authored yet, so a third-class diagnostic
// effectively draws from 3A1/3A2 only until those papers are populated.
// Deliberately NOT extended to 'fourth' — this is the unauthenticated diagnostic-quiz
// lead magnet, and no UI ever passes class=fourth (4th Class has no diagnostic funnel;
// see docs/superpowers/specs/2026-07-13-fourth-class-platform-integration-design.md §8).
function papersForClass(classCode) {
  return classCode === 'third' ? PAPERS_BY_CLASS.third : PAPERS_BY_CLASS.second;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd server && POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_DB=fsa_agent_test npx jest tests/papersForClass.test.js tests/papersForClassRoute.test.js --runInBand`
Expected: all PASS.

- [ ] **Step 7: Run the full server test suite to check for regressions**

Run: `cd server && npm test`
Expected: all PASS, including existing diagnostic tests (if any) unaffected since `papersForClass('second')`/`papersForClass('third')` behavior is byte-for-byte identical.

- [ ] **Step 8: Commit**

```bash
git add server/src/config/papersForClass.js server/src/routes/platform.js server/src/routes/diagnostic.js server/tests/papersForClass.test.js server/tests/papersForClassRoute.test.js
git commit -m "refactor: extract shared papers-for-class config, add fourth"
```

---

## Task 3: `GET /api/platform/quiz-lobby-data` endpoint

**Files:**
- Modify: `server/src/routes/platform.js` (add new route, near the existing `lobby-data` route)
- Test: `server/tests/quizLobbyData.test.js`

**Interfaces:**
- Consumes: `PAPERS_BY_CLASS` from Task 2.
- Produces: `GET /api/platform/quiz-lobby-data` → `{ class_code: 'fourth', papers: { '4A': {...}, '4B': {...} } }` where each paper object is `{ total_chapters, chapter_quizzes: [{chapter_id, score, total, correct, last_attempt, passed}], quizzes_passed, avg_quiz_score, next_quiz_chapter_id, last_exam: {score, date, chapters} | null }` — consumed by Task 4's `QuizOnlyLobbyPage`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/quizLobbyData.test.js`:

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

describe('GET /api/platform/quiz-lobby-data', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM questions WHERE course_id IN ('4A', '4B')`);
    await pool.query(`DELETE FROM chapters WHERE course_id IN ('4A', '4B')`);
    await pool.query(`DELETE FROM subscriptions`);
    await pool.query(`DELETE FROM platform_users`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects a non-fourth-class subscriber with 400', async () => {
    const { token } = await createUser({ email: 'not-fourth@example.com', classCode: 'second' });
    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(400);
  });

  it('returns both 4A and 4B with chapter-quiz and practice-exam stats, no lesson data', async () => {
    const { token } = await createUser({ email: 'fourth-lobby@example.com', classCode: 'fourth' });

    await pool.query(
      `INSERT INTO chapters (course_id, chapter_num, title) VALUES
        ('4A', 1, 'Intro'), ('4A', 2, 'Forces'), ('4B', 1, 'Lubrication')`
    );
    await pool.query(
      `INSERT INTO questions (id, question_text, options, correct_answer, question_type, chapter_id, course_id)
       VALUES
        (900001, 'Q1', '["A","B","C","D"]'::jsonb, 0, 'chapter_quiz', '4A-1', '4A'),
        (900002, 'Q2', '["A","B","C","D"]'::jsonb, 0, 'chapter_quiz', '4A-1', '4A'),
        (900003, 'Q3', '["A","B","C","D"]'::jsonb, 0, 'chapter_quiz', '4A-1', '4A'),
        (900004, 'Q4', '["A","B","C","D"]'::jsonb, 0, 'chapter_quiz', '4A-1', '4A')`
    );
    await pool.query(
      `INSERT INTO question_responses (user_email, question_id, session_type, course_id, chapter_id, correct)
       VALUES
        ('fourth-lobby@example.com', 900001, 'chapter_quiz', '4A', '4A-1', true),
        ('fourth-lobby@example.com', 900002, 'chapter_quiz', '4A', '4A-1', true),
        ('fourth-lobby@example.com', 900003, 'chapter_quiz', '4A', '4A-1', false),
        ('fourth-lobby@example.com', 900004, 'chapter_quiz', '4A', '4A-1', true)`
    );

    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.class_code).toBe('fourth');
    expect(Object.keys(res.body.papers)).toEqual(['4A', '4B']);
    expect(res.body.papers['4A'].total_chapters).toBe(2);
    expect(res.body.papers['4A'].chapter_quizzes).toEqual([
      { chapter_id: '4A-1', score: 75, total: 4, correct: 3, last_attempt: expect.anything(), passed: false },
    ]);
    expect(res.body.papers['4A'].next_quiz_chapter_id).toBe('4A-1');
    expect(res.body.papers['4A'].last_exam).toBeNull();
    expect(res.body.papers['4B'].total_chapters).toBe(1);
    expect(res.body.papers['4B'].chapter_quizzes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_DB=fsa_agent_test npx jest tests/quizLobbyData.test.js --runInBand`
Expected: FAIL with 404 (route doesn't exist yet).

- [ ] **Step 3: Implement the endpoint**

In `server/src/routes/platform.js`, add this route immediately after the existing `GET /api/platform/lobby-data` route (after its closing `});`):

```js
// GET /api/platform/quiz-lobby-data
// 4th Class is a practice-exam-only offering with no lesson content at all (see
// docs/superpowers/specs/2026-07-13-fourth-class-platform-integration-design.md) — this
// is the quiz/exam-only counterpart to /lobby-data, deliberately with no lessons/
// user_progress joins. Both 4A and 4B are shown together since 4th Class has no
// paper-switch/cooldown concept (both papers are accessible at once).
router.get('/quiz-lobby-data', requireAuth, async (req, res) => {
  try {
    const { email, class_code } = req.user;
    if (class_code !== 'fourth') {
      return res.status(400).json({ error: 'This endpoint is for 4th Class subscribers only' });
    }
    const passingThreshold = parseInt(process.env.QUIZ_PASSING_THRESHOLD || '75', 10);
    const papers = PAPERS_BY_CLASS.fourth;
    const result = {};

    for (const paper of papers) {
      const chapterQuizResult = await pool.query(
        `SELECT
           qr.chapter_id,
           COUNT(*) as total_questions,
           SUM(CASE WHEN qr.correct THEN 1 ELSE 0 END) as correct_count,
           MAX(qr.answered_at) as last_attempt
         FROM question_responses qr
         WHERE qr.user_email = $1 AND qr.course_id = $2 AND qr.session_type = 'chapter_quiz'
         GROUP BY qr.chapter_id
         ORDER BY qr.chapter_id`,
        [email, paper]
      );
      const chapterQuizzes = chapterQuizResult.rows.map(row => {
        const score = Math.round((parseInt(row.correct_count) / parseInt(row.total_questions)) * 100);
        return {
          chapter_id: row.chapter_id,
          score,
          total: parseInt(row.total_questions),
          correct: parseInt(row.correct_count),
          last_attempt: row.last_attempt,
          passed: score >= passingThreshold,
        };
      });

      const lastExamResult = await pool.query(
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
      let lastExam = null;
      if (lastExamResult.rows.length > 0) {
        const totalCorrect = lastExamResult.rows.reduce((sum, r) => sum + parseInt(r.correct), 0);
        const totalQs = lastExamResult.rows.reduce((sum, r) => sum + parseInt(r.total), 0);
        lastExam = {
          score: Math.round((totalCorrect / totalQs) * 100),
          date: lastExamResult.rows[0].exam_date,
          chapters: lastExamResult.rows.map(r => ({
            chapter_id: r.chapter_id,
            score: Math.round((parseInt(r.correct) / parseInt(r.total)) * 100),
          })),
        };
      }

      const totalChaptersResult = await pool.query(
        `SELECT COUNT(DISTINCT chapter_num) FROM chapters WHERE course_id = $1`,
        [paper]
      );
      const totalChapters = parseInt(totalChaptersResult.rows[0].count);

      const quizzesPassed = chapterQuizzes.filter(q => q.passed).length;
      const avgQuizScore = chapterQuizzes.length > 0
        ? Math.round(chapterQuizzes.reduce((sum, q) => sum + q.score, 0) / chapterQuizzes.length)
        : null;

      const nextQuizChapterId = (() => {
        for (let i = 1; i <= totalChapters; i++) {
          const chapterId = `${paper}-${i}`;
          const quiz = chapterQuizzes.find(q => q.chapter_id === chapterId);
          if (!quiz || !quiz.passed) return chapterId;
        }
        return null;
      })();

      result[paper] = {
        total_chapters: totalChapters,
        chapter_quizzes: chapterQuizzes,
        quizzes_passed: quizzesPassed,
        avg_quiz_score: avgQuizScore,
        next_quiz_chapter_id: nextQuizChapterId,
        last_exam: lastExam,
      };
    }

    return res.json({ class_code, papers: result });
  } catch (err) {
    console.error('GET /api/platform/quiz-lobby-data error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_DB=fsa_agent_test npx jest tests/quizLobbyData.test.js --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/platform.js server/tests/quizLobbyData.test.js
git commit -m "feat: add GET /api/platform/quiz-lobby-data for 4th Class"
```

---

## Task 4: `QuizOnlyLobbyPage` + routing

**Files:**
- Create: `client-v2/src/pages/QuizOnlyLobbyPage.jsx`
- Create: `client-v2/src/pages/QuizOnlyLobbyPage.css`
- Modify: `client-v2/src/App.jsx` (import + `/lobby` route)

**Interfaces:**
- Consumes: `GET /api/platform/quiz-lobby-data` from Task 3.
- Consumes: `localStorage.getItem('fsa_user')` → `{ class_code, ... }` (existing pattern, e.g. `ProtectedRoute.jsx:10`).

- [ ] **Step 1: Create the page component**

Create `client-v2/src/pages/QuizOnlyLobbyPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './QuizOnlyLobbyPage.css';

const PAPER_NAMES = {
  '4A': '4th Class Part A',
  '4B': '4th Class Part B',
};

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

function PaperCard({ paperCode, data, onStartExam }) {
  const { total_chapters, chapter_quizzes, quizzes_passed, avg_quiz_score,
          next_quiz_chapter_id, last_exam } = data;

  return (
    <div className="qo-paper-card">
      <div className="qo-paper-card-top">
        <h2 className="qo-paper-title">{paperCode} — {PAPER_NAMES[paperCode] || paperCode}</h2>
        <button className="qo-btn-primary" onClick={() => onStartExam(paperCode)}>
          Start Practice Exam
        </button>
      </div>

      <div className="qo-chip-row">
        <span className="qo-chip">
          Chapters Passed: <span className="qo-chip-value">{quizzes_passed}/{total_chapters}</span>
        </span>
        <span className="qo-chip">
          Avg Quiz Score: <span className="qo-chip-value">{avg_quiz_score !== null ? `${avg_quiz_score}%` : '—'}</span>
        </span>
      </div>

      <div className="qo-tile-grid">
        <div className="qo-tile">
          <h3 className="qo-tile-title">Chapter Quizzes</h3>
          {chapter_quizzes.length === 0 ? (
            <p className="qo-muted">No quizzes attempted yet</p>
          ) : (
            <ul className="qo-quiz-list">
              {chapter_quizzes.map(q => (
                <li key={q.chapter_id} className="qo-quiz-row">
                  <span className="qo-quiz-chapter-id">{q.chapter_id}</span>
                  <div className="qo-quiz-row-right">
                    <span className="qo-score-text">{q.score}%</span>
                    <span className={q.passed ? 'qo-badge-pass' : 'qo-badge-fail'}>
                      {q.passed ? 'Pass' : 'Fail'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {next_quiz_chapter_id && (
            <div className="qo-next-quiz-id">Next: {next_quiz_chapter_id}</div>
          )}
        </div>

        <div className="qo-tile">
          <h3 className="qo-tile-title">Last Practice Exam</h3>
          {!last_exam ? (
            <p className="qo-muted">No practice exam attempted yet</p>
          ) : (
            <>
              <div className="qo-big-score">{last_exam.score}%</div>
              <div className="qo-exam-date">{formatDate(last_exam.date)}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function QuizOnlyLobbyPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/platform/quiz-lobby-data', { credentials: 'include' })
      .then(async res => {
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || 'Failed to load your dashboard');
        }
        return res.json();
      })
      .then(setData)
      .catch(err => setError(err.message || 'Something went wrong. Please refresh.'))
      .finally(() => setLoading(false));
  }, []);

  function handleStartExam(paper) {
    navigate(`/practice-exam?paper=${paper}&count=50`);
  }

  if (loading) return <div className="qo-loading-wrap">Loading your dashboard…</div>;
  if (error) return <div className="qo-page"><div className="qo-error-wrap">{error}</div></div>;
  if (!data) return null;

  return (
    <div className="qo-page">
      <header className="qo-header">
        <div className="qo-brand">Full Steam Ahead</div>
        <p className="qo-header-sub">4th Class Practice Exams</p>
      </header>
      <div className="qo-content">
        {Object.entries(data.papers).map(([paperCode, paperData]) => (
          <PaperCard key={paperCode} paperCode={paperCode} data={paperData} onStartExam={handleStartExam} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the stylesheet**

Create `client-v2/src/pages/QuizOnlyLobbyPage.css`:

```css
/* QuizOnlyLobbyPage styles — parallels LobbyPage.css's palette/prefix convention
   (qo- instead of lb-) but with no progress-bar/lesson-deeplink UI. */

.qo-page {
  min-height: 100vh;
  background: #0D1117;
  color: #F4F5F7;
  font-family: 'Barlow', -apple-system, sans-serif;
}

.qo-header {
  background: #1C2333;
  border-bottom: 2px solid #E8720C;
  padding: 12px 24px;
}
.qo-brand {
  color: #E8720C;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 20px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.qo-header-sub {
  margin: 2px 0 0;
  color: #a8b4c0;
  font-size: 13px;
}

.qo-content {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.qo-loading-wrap,
.qo-error-wrap {
  padding: 48px 24px;
  text-align: center;
  color: #a8b4c0;
}

.qo-paper-card {
  background: #1C2333;
  border: 1px solid #252F42;
  border-radius: 8px;
  padding: 20px 24px;
}
.qo-paper-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}
.qo-paper-title {
  margin: 0;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 22px;
  font-weight: 700;
}

.qo-btn-primary {
  background: #E8720C;
  color: #0D1117;
  border: none;
  border-radius: 4px;
  padding: 10px 20px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  font-family: inherit;
}
.qo-btn-primary:hover { background: #f5821c; }

.qo-chip-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.qo-chip {
  font-size: 13px;
  color: #a8b4c0;
}
.qo-chip-value {
  color: #F4F5F7;
  font-weight: 700;
}

.qo-tile-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 640px) {
  .qo-tile-grid { grid-template-columns: 1fr; }
}

.qo-tile {
  background: #151b28;
  border: 1px solid #252F42;
  border-radius: 6px;
  padding: 16px;
}
.qo-tile-title {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 700;
}
.qo-muted { color: #6b7686; font-size: 13px; }

.qo-quiz-list { list-style: none; margin: 0 0 10px; padding: 0; }
.qo-quiz-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid #252F42;
  font-size: 13px;
}
.qo-quiz-row:last-child { border-bottom: none; }
.qo-quiz-row-right { display: flex; align-items: center; gap: 8px; }
.qo-score-text { color: #a8b4c0; }
.qo-badge-pass, .qo-badge-fail {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 3px;
}
.qo-badge-pass { background: #163a1f; color: #4ade80; }
.qo-badge-fail { background: #3a1616; color: #f87171; }

.qo-next-quiz-id { font-size: 12px; color: #E8720C; }

.qo-big-score {
  font-size: 32px;
  font-weight: 700;
  font-family: 'Barlow Condensed', sans-serif;
}
.qo-exam-date { font-size: 12px; color: #6b7686; }
```

- [ ] **Step 3: Wire routing in `App.jsx`**

Add the import near the other page imports in `client-v2/src/App.jsx`:

```js
import QuizOnlyLobbyPage from './pages/QuizOnlyLobbyPage';
```

Add this helper component above `export default function App()`:

```jsx
// 4th Class has no lesson content — it gets a dedicated quiz-only lobby at the
// same /lobby route path instead of a class_code branch inside LobbyPage itself.
function LobbyRoute() {
  const user = JSON.parse(localStorage.getItem('fsa_user') || 'null');
  return user?.class_code === 'fourth' ? <QuizOnlyLobbyPage /> : <LobbyPage />;
}
```

Change the `/lobby` route's element from:

```jsx
      <Route
        path="/lobby"
        element={
          <ProtectedRoute requirePaper={false}>
            <AppShell>
              <LobbyPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
```

to:

```jsx
      <Route
        path="/lobby"
        element={
          <ProtectedRoute requirePaper={false}>
            <AppShell>
              <LobbyRoute />
            </AppShell>
          </ProtectedRoute>
        }
      />
```

- [ ] **Step 4: Build and manually verify**

```bash
cd client-v2 && npm run build && cd .. && \
docker compose --env-file /home/debian/.env build api && \
docker compose --env-file /home/debian/.env up -d api
```

Temporarily point the test account at 4th Class to verify (same account used earlier this session):

```bash
docker exec fsa-postgres psql -U postgres -d fsa_agent -c \
  "UPDATE subscriptions SET class_code = 'fourth', active_paper = NULL WHERE user_id = (SELECT id FROM platform_users WHERE email = 'sysadmin@powerboot.ca');"
```

Log in at `https://learn.fullsteamahead.ca` as `sysadmin@powerboot.ca` and confirm:
- `/lobby` shows `QuizOnlyLobbyPage` with two cards (4A, 4B), each with a "Start Practice Exam" button and no progress bar / no "Continue lesson" / no "All Chapters" button.
- "Start Practice Exam" on the 4A card navigates to a working practice exam for `4A`.

Expected: page renders as designed, no console errors, exam starts successfully.

- [ ] **Step 5: Commit**

```bash
git add client-v2/src/pages/QuizOnlyLobbyPage.jsx client-v2/src/pages/QuizOnlyLobbyPage.css client-v2/src/App.jsx
git commit -m "feat: add QuizOnlyLobbyPage for 4th Class, route by class_code"
```

---

## Task 5: Hide AI tutor chat in the exam/quiz view

**Files:**
- Modify: `client-v2/src/ExamRouter.jsx:376` (`QuizExamView` — compute `isFourthClass`, gate tutor-fab + chat overlay)

**Interfaces:**
- Consumes: `user.class_code` (already a prop on `QuizExamView`, sourced from `localStorage.fsa_user` upstream).

- [ ] **Step 1: Gate the tutor-fab button and chat overlay**

In `client-v2/src/ExamRouter.jsx`, inside `function QuizExamView({ lesson, user, lessonId, mode, chatState, setChatState, examConfig, onSelectChapter, onComplete })`, add near the top of the function body (after the existing `const isExam = mode === 'practice_exam';` line):

```js
  // 4th Class has no AI tutor chat (see
  // docs/superpowers/specs/2026-07-13-fourth-class-platform-integration-design.md §5).
  const isFourthClass = user?.class_code === 'fourth';
```

Change the tutor-fab button and chat overlay block from:

```jsx
      {/* Floating chat button — pulses to draw attention once the exam
          review is on screen and the tutor's debrief is waiting. */}
      <button
        onClick={() => setChatOpen(o => !o)}
        className={isExam && isDone && !chatOpen ? 'tutor-fab tutor-fab--pulse' : 'tutor-fab'}
        style={{
          position: 'fixed', bottom: '24px', right: '24px',
          width: '56px', height: '56px', borderRadius: '50%',
          background: '#1d4ed8', border: 'none', cursor: 'pointer',
          fontSize: '24px', color: 'white', zIndex: 100,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}
        title="Ask the AI Tutor"
      >
        💬
      </button>

      {/* Chat overlay */}
      {chatOpen && (
```

to:

```jsx
      {/* Floating chat button — pulses to draw attention once the exam
          review is on screen and the tutor's debrief is waiting. Hidden
          entirely for 4th Class (no AI tutor chat for that offering). */}
      {!isFourthClass && (
        <button
          onClick={() => setChatOpen(o => !o)}
          className={isExam && isDone && !chatOpen ? 'tutor-fab tutor-fab--pulse' : 'tutor-fab'}
          style={{
            position: 'fixed', bottom: '24px', right: '24px',
            width: '56px', height: '56px', borderRadius: '50%',
            background: '#1d4ed8', border: 'none', cursor: 'pointer',
            fontSize: '24px', color: 'white', zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
          title="Ask the AI Tutor"
        >
          💬
        </button>
      )}

      {/* Chat overlay */}
      {!isFourthClass && chatOpen && (
```

(The overlay's existing closing `)}` and surrounding JSX structure are unchanged — only the two opening conditions gained the `!isFourthClass &&` guard.)

- [ ] **Step 2: Build and manually verify**

```bash
cd client-v2 && npm run build && cd .. && \
docker compose --env-file /home/debian/.env build api && \
docker compose --env-file /home/debian/.env up -d api
```

With the test account still on `class_code='fourth'` from Task 4, start a 4A practice exam at `https://learn.fullsteamahead.ca` and confirm no 💬 tutor-fab button appears at any point (during questions or on the results screen). Then log in as a 2nd/3rd Class account (or temporarily flip the test account's `class_code` back to `'third'`) and confirm the tutor-fab still appears as before.

Expected: tutor-fab present for 2nd/3rd, absent for 4th.

- [ ] **Step 3: Commit**

```bash
git add client-v2/src/ExamRouter.jsx
git commit -m "feat: hide AI tutor chat during 4th Class exams/quizzes"
```

---

## Task 6: Hide AI tutor tab in the lesson player (defense-in-depth)

**Files:**
- Modify: `client-v2/src/LessonPlayer.jsx:17,264-306`
- Modify: `client-v2/src/pages/LessonPlayerPage.jsx:19`
- Modify: `client-v2/src/index.css` (near line 64, new modifier rule)

**Interfaces:**
- Consumes: `user.class_code` from `LessonPlayerPage.jsx`'s existing `JSON.parse(localStorage.getItem('fsa_user') || '{}')`.

This route is never actually reached by 4th Class students (no `4A`/`4B` lesson-browsing entry point exists once Task 4 ships), but the spec calls for a direct guard in case a lesson URL is ever guessed/linked directly.

- [ ] **Step 1: Thread `classCode` into `LessonPlayer`**

In `client-v2/src/pages/LessonPlayerPage.jsx`, change:

```jsx
      <LessonPlayer lessonCode={lessonCode} learnerId={user.email || ''} />
```

to:

```jsx
      <LessonPlayer lessonCode={lessonCode} learnerId={user.email || ''} classCode={user.class_code || null} />
```

- [ ] **Step 2: Gate the tab button and `TutorPanel` in `LessonPlayer.jsx`**

Change the component signature from:

```js
export function LessonPlayer({ lessonCode: initialLessonCode, learnerId }) {
```

to:

```js
export function LessonPlayer({ lessonCode: initialLessonCode, learnerId, classCode }) {
```

Add near the top of the function body (after `const courseId = parseCourseId(initialLessonCode);`):

```js
  // 4th Class has no AI tutor chat (defense-in-depth — this route is never actually
  // reached by 4th Class students; see
  // docs/superpowers/specs/2026-07-13-fourth-class-platform-integration-design.md §5).
  const hideTutor = classCode === 'fourth';
```

Change the root div's className from:

```jsx
    <div className={`lesson-player lesson-player--show-${mobileTab}`}>
```

to:

```jsx
    <div className={`lesson-player lesson-player--show-${mobileTab}${hideTutor ? ' lesson-player--tutor-hidden' : ''}`}>
```

Change the mobile tab bar from:

```jsx
      <div className="lesson-mobile-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={mobileTab === 'lesson'}
          className={mobileTab === 'lesson' ? 'active' : ''}
          onClick={() => setMobileTab('lesson')}
        >
          📖 Lesson
        </button>
        <button
          role="tab"
          aria-selected={mobileTab === 'tutor'}
          className={mobileTab === 'tutor' ? 'active' : ''}
          onClick={() => setMobileTab('tutor')}
        >
          💬 AI Tutor
        </button>
      </div>
```

to:

```jsx
      <div className="lesson-mobile-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={mobileTab === 'lesson'}
          className={mobileTab === 'lesson' ? 'active' : ''}
          onClick={() => setMobileTab('lesson')}
        >
          📖 Lesson
        </button>
        {!hideTutor && (
          <button
            role="tab"
            aria-selected={mobileTab === 'tutor'}
            className={mobileTab === 'tutor' ? 'active' : ''}
            onClick={() => setMobileTab('tutor')}
          >
            💬 AI Tutor
          </button>
        )}
      </div>
```

Change the `TutorPanel` render from:

```jsx
      <TutorPanel
        lessonCode={activeLessonCode}
        learnerId={learnerId || 'anonymous'}
        sectionIndex={sectionIndex}
        checkpoint={checkpoint}
        completionTrigger={completionTrigger}
        onAnswered={handleAnswered}
      />
```

to:

```jsx
      {!hideTutor && (
        <TutorPanel
          lessonCode={activeLessonCode}
          learnerId={learnerId || 'anonymous'}
          sectionIndex={sectionIndex}
          checkpoint={checkpoint}
          completionTrigger={completionTrigger}
          onAnswered={handleAnswered}
        />
      )}
```

- [ ] **Step 3: Let ContentPanel span full width when the tutor is hidden**

In `client-v2/src/index.css`, add this rule immediately after the `.content-panel { ... }` block (around line 64):

```css
/* 4th Class defense-in-depth: no tutor panel means content should take the
   full width instead of leaving 40% blank. */
.lesson-player--tutor-hidden .content-panel {
  flex: 1 1 100%;
  border-right: none;
}
```

- [ ] **Step 4: Build and manually verify**

```bash
cd client-v2 && npm run build && cd .. && \
docker compose --env-file /home/debian/.env build api && \
docker compose --env-file /home/debian/.env up -d api
```

This route has no reachable UI entry point for a `class_code='fourth'` account (confirmed: `QuizOnlyLobbyPage` never links to `/lesson/*`), so verify by navigating directly to a URL like `https://learn.fullsteamahead.ca/lesson/4A-1-1` while logged in as the test account (still `class_code='fourth'` from Task 4/5) — even though this URL isn't reachable through the UI, it must not show the AI Tutor tab/panel if hit directly. Then confirm an existing 2nd/3rd Class lesson URL still shows the tutor panel/tab as before.

Expected: 4th Class direct URL hides tutor UI and content spans full width; 2nd/3rd Class unaffected.

- [ ] **Step 5: Commit**

```bash
git add client-v2/src/LessonPlayer.jsx client-v2/src/pages/LessonPlayerPage.jsx client-v2/src/index.css
git commit -m "feat: hide AI tutor panel for 4th Class in lesson player (defense-in-depth)"
```

---

## Task 7: Retake — verify the existing mechanism already works for 4th Class (no code change)

**Files:** none — this task is verification-only.

While mapping spec §7 onto the code, two candidate implementations were considered and rejected before landing on "no change needed":

1. **A new stateful REST endpoint** (the spec's own suggestion) that ports `_reset_and_start_exam`'s logic into a Node/Flask route reachable outside the chat session. Rejected: it would have to duplicate `orchestrator.conversation_state`'s session-keying (`f'{user}:{course_id}'`) to stay consistent with subsequent `/api/chat` answer-submission calls for the new exam — real complexity for no behavioral gain over option 3.
2. **Threading a new `onRetakeExam` prop that calls `PracticeExamRouter`'s `handleStartExam(examConfig)` in place of `onAnswer('yes')`.** This was actually drafted and then found to be broken on inspection: `handleStartExam` resets `chatState` and sets `phase` to the value it's already at (`'exam'`), so `QuizExamView` never unmounts — and its initial-`'hello'` fetch only runs inside a `useEffect` with an **empty dependency array** (`ExamRouter.jsx`, the effect starting `if (chatState.messages.length === 0) { fetch('/api/chat', ...) }`, `}, []);`), which only fires on mount. Resetting `chatState` without a remount would leave the results screen swapped for a permanent "Loading questions…" placeholder that never resolves. Caught here instead of in manual testing — do not implement this.
3. **Do nothing — the existing chat-based retry already works correctly, invisibly.** `ResultsPanel`'s "Retake Exam (Adaptive)" button already calls `onAnswer('yes')` → `sendAnswer('yes')` → `POST /api/chat`. At the moment this fires, `isDone` is `true` (results screen is showing), so `sendAnswer`'s `suppressChat` is `false` and it does append `{role:'user', content:'yes'}` + a `'...thinking...'` placeholder to `chatState.messages` — but Task 5 already wraps the entire chat overlay in `{!isFourthClass && chatOpen && (...)}`, so for a 4th Class user that overlay never renders regardless of `chatState.messages`, meaning this happens invisibly. The response handler then does `setChatState(prev => ({...prev, displayContent: data.display_update ?? prev.displayContent, examProgress: ...}))` — a normal state update on the already-mounted component, which re-renders `QuizExamDisplaySection` with the new first question. `data.display_update` comes from the AI service's `_is_exam_retry('yes')` → `_reset_and_start_exam`, which already calls `get_chapter_weights` fresh — the exact weak-area weighting the spec wants, already running, already reachable, already invisible once Task 5 hides the chat surface.

Net result: **Task 5 alone is sufficient for §7's retake requirement.** No `ExamRouter.jsx` changes beyond what Task 5 already made.

- [ ] **Step 1: Build and manually verify (after Task 5 and Task 8 are both deployed)**

```bash
cd client-v2 && npm run build && cd .. && \
docker compose --env-file /home/debian/.env build api && \
docker compose --env-file /home/debian/.env up -d api
```

With the test account on `class_code='fourth'`, complete a short 4A practice exam (e.g. `/practice-exam?paper=4A&count=25`), reach the results screen, and click "Retake Exam (Adaptive)". Confirm:
- A new exam starts immediately in-place (no navigation away, no chat bubble/message ever becomes visible, no tutor-fab visible before or after).
- The new question set is different from the first attempt (weighting can't be asserted visually with certainty on a small sample, but a fresh set loading confirms the mechanism ran).
- Answering through to the end produces a new, stats-only debrief (Task 8).

Then confirm a 2nd/3rd Class account's retake still works exactly as before (chat-based, tutor message appears in the chat panel).

Expected: both flows work; 4th Class shows zero visible chat interaction; no code changed in this task.

---

## Task 8: Reduced-AI debrief — stats only, no generated or templated prose

**Files:**
- Modify: `ai-service/agents/orchestrator.py:25` (new module constant), `:1098-1298` (`_generate_exam_debrief`)
- Test: `ai-service/tests/test_orchestrator_fourth_class_debrief.py`

**Interfaces:**
- Produces: `FOURTH_CLASS_COURSES = {'4A', '4B'}` (module-level constant in `orchestrator.py`) — the AI service only ever sees `course_id` (never `class_code`), so membership in this fixed set is the simplest correct "is this 4th Class" signal, used only inside `_generate_exam_debrief`.

- [ ] **Step 1: Write the failing tests**

Create `ai-service/tests/test_orchestrator_fourth_class_debrief.py`:

```python
import pytest
from unittest.mock import MagicMock
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.orchestrator import Orchestrator, PRACTICE_EXAM_QUESTION_COUNT


def _base_state():
    return {
        'exam_results': [
            {'question_id': 1, 'correct': False, 'chapter_id': '4A-1', 'lesson_code': '4A-1-2',
             'topic': 'friction', 'explanation': 'Coefficient of friction.'},
            {'question_id': 2, 'correct': True, 'chapter_id': '4A-1', 'lesson_code': '4A-1-3',
             'topic': 'friction', 'explanation': ''},
        ],
        'complexity_level': 3,
        'exam_question_count': PRACTICE_EXAM_QUESTION_COUNT,
        'chat_history': [],
    }


def test_fourth_class_debrief_has_no_objective_breakdowns_or_tutor_prose():
    orch = Orchestrator()
    mock_researcher = MagicMock()
    mock_tutor = MagicMock()

    result = orch._generate_exam_debrief(
        _base_state(), 'student@example.com', '4A', 'Jordan',
        mock_researcher, mock_tutor, {}, None,
    )

    assert result['tutor_response'] == ''
    assert result['display_update']['objective_breakdowns'] == []
    mock_tutor.respond.assert_not_called()


def test_fourth_class_debrief_still_includes_chapter_stats_and_next_allocation():
    orch = Orchestrator()
    mock_researcher = MagicMock()
    mock_tutor = MagicMock()

    result = orch._generate_exam_debrief(
        _base_state(), 'student@example.com', '4A', 'Jordan',
        mock_researcher, mock_tutor, {}, None,
    )

    display = result['display_update']
    assert display['score'] == 1
    assert display['total'] == 2
    assert display['chapter_stats'] == [
        {'chapter': '4A-1', 'correct': 1, 'total': 2, 'pct': 50, 'status': 'Developing'},
    ]
    assert display['next_attempt_allocation'] is not None


def test_second_class_debrief_unchanged_still_calls_tutor_and_builds_breakdowns():
    orch = Orchestrator()
    mock_researcher = MagicMock()
    mock_researcher.get_questions_by_ids.return_value = {}
    mock_tutor = MagicMock()
    mock_tutor.respond.return_value = {'response': 'Solid effort!'}
    orch._call_llm_for_teaching_tips = MagicMock(return_value={1: 'Review friction formulas.'})

    state = _base_state()
    state['exam_results'][0]['lesson_code'] = '2B1-1-2'
    state['exam_results'][0]['chapter_id'] = '2B1-1'
    state['exam_results'][1]['chapter_id'] = '2B1-1'

    result = orch._generate_exam_debrief(
        state, 'student@example.com', '2B1', 'Jordan',
        mock_researcher, mock_tutor, {}, None,
    )

    assert result['tutor_response'] == 'Solid effort!'
    assert len(result['display_update']['objective_breakdowns']) == 1
    mock_tutor.respond.assert_called_once()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ai-service && python -m pytest tests/test_orchestrator_fourth_class_debrief.py -v`
Expected: the first two tests FAIL (`mock_tutor.respond` IS called, `objective_breakdowns` is non-empty since today's code has no `course_id` branch at all); the third test passes already (documents current behavior).

- [ ] **Step 3: Add the `FOURTH_CLASS_COURSES` constant**

In `ai-service/agents/orchestrator.py`, add immediately after `PRACTICE_EXAM_QUESTION_COUNT = 50` (line 25):

```python
# Courses with no lesson content and a reduced-AI (stats-only) debrief — see
# docs/superpowers/specs/2026-07-13-fourth-class-platform-integration-design.md.
# The AI service only ever sees course_id (never class_code), so membership in
# this fixed set is the simplest correct "is this 4th Class" signal.
FOURTH_CLASS_COURSES = {'4A', '4B'}
```

- [ ] **Step 4: Branch `_generate_exam_debrief` on `FOURTH_CLASS_COURSES`**

Replace the entire `_generate_exam_debrief` method (currently lines 1098-1298) with:

```python
    def _generate_exam_debrief(self, state, user, course_id, first_name,
                                researcher, tutor, lesson_context, progress):
        """Generate the end-of-exam debrief with objective-level teaching tips."""
        results = state.get('exam_results', [])
        if not results:
            return {
                'tutor_response': f"Exam complete, {first_name}! No results to summarize.",
                'display_update': {'type': 'exam_done'},
                'progress_update': {},
                'complexity_level': state['complexity_level'],
                'first_name': first_name,
                'action': None,
                'mode': 'practice_exam',
            }

        # --- Enrich any wrong answers missing lesson_code (edge case fallback) ---
        wrong_missing = [
            r['question_id'] for r in results
            if not r['correct'] and not r.get('lesson_code')
        ]
        if wrong_missing:
            enrichment = researcher.get_questions_by_ids(wrong_missing)
            for r in results:
                if not r['correct'] and not r.get('lesson_code') and r['question_id'] in enrichment:
                    r.update(enrichment[r['question_id']])

        is_fourth_class = course_id in FOURTH_CLASS_COURSES

        # --- Group wrong answers by objective ---
        by_objective = self._group_wrong_by_objective(results)

        # --- Generate teaching tips via single batched LLM call ---
        # Skipped for 4th Class: no generated or templated prose of any kind (see
        # docs/superpowers/specs/2026-07-13-fourth-class-platform-integration-design.md §6) —
        # those students are already in a real accredited program elsewhere and are
        # understood to want the score breakdown, not FSA-authored explanations.
        objective_breakdowns = []
        if by_objective and not is_fourth_class:
            objectives_list = list(by_objective.values())
            numbered_lines = []
            for i, obj in enumerate(objectives_list, 1):
                chap_num, obj_num = self._parse_lesson_code(obj['lesson_code'], obj['chapter_id'])
                topic_label = obj['topic'].replace('_', ' ') if obj['topic'] else 'general concept'
                explanation = obj['explanation'] or 'No additional context available.'
                numbered_lines.append(
                    f"{i}. Chapter {chap_num} Objective {obj_num} (topic: {topic_label})\n"
                    f"   Explanation: {explanation}"
                )

            batch_prompt = (
                f"A student studying for the 2nd Class Power Engineering exam missed questions "
                f"on the following objectives. For each, write a 2-3 sentence teaching tip "
                f"that identifies what the student needs to remember or watch for — concrete "
                f"guidance specific to power engineering that helps them get it right next time. "
                f"Format your response as a numbered list matching the objective numbers.\n\n"
                + '\n\n'.join(numbered_lines)
            )
            tips = self._call_llm_for_teaching_tips(batch_prompt, len(objectives_list))

            for i, obj in enumerate(objectives_list):
                chap_num, obj_num = self._parse_lesson_code(obj['lesson_code'], obj['chapter_id'])
                topic_label = obj['topic'].replace('_', ' ') if obj['topic'] else 'general concept'
                objective_breakdowns.append({
                    'lesson_code': obj['lesson_code'],
                    'chapter_id': obj['chapter_id'],
                    'chapter_num': chap_num,
                    'objective_num': obj_num,
                    'topic': topic_label,
                    'teaching_tip': tips.get(i + 1, obj['explanation'] or ''),
                    'wrong_count': obj['count'],
                })

        # --- Aggregate chapter stats (unchanged for 4th Class — pure SQL, not an LLM feature) ---
        chapter_stats = {}
        for r in results:
            cid = r['chapter_id'] or 'Unknown'
            chapter_stats.setdefault(cid, {'correct': 0, 'total': 0})
            chapter_stats[cid]['total'] += 1
            if r['correct']:
                chapter_stats[cid]['correct'] += 1

        total_q = len(results)
        total_correct = sum(1 for r in results if r['correct'])
        score_pct = int(total_correct / total_q * 100) if total_q else 0

        chapter_lines = []
        weak_chapters, strong_chapters = [], []
        for cid, s in sorted(chapter_stats.items()):
            pct = int(s['correct'] / s['total'] * 100) if s['total'] else 0
            status = 'Strong' if pct >= 70 else ('Needs review' if pct < 50 else 'Developing')
            chapter_lines.append({
                'chapter': cid, 'correct': s['correct'],
                'total': s['total'], 'pct': pct, 'status': status,
            })
            if pct < 60:
                weak_chapters.append(cid)
            elif pct >= 75:
                strong_chapters.append(cid)

        # --- Compute next-attempt allocation (unchanged for 4th Class) ---
        fresh_weights = {
            cid: {'accuracy': s['correct'] / s['total'] if s['total'] else 0.5, 'total': s['total']}
            for cid, s in chapter_stats.items()
        }
        exam_count = state.get('exam_question_count', PRACTICE_EXAM_QUESTION_COUNT)
        all_chapters = list(chapter_stats.keys())
        next_allocation = self._compute_chapter_allocations(all_chapters, exam_count, fresh_weights)

        # --- Build tutor debrief message ---
        # Skipped entirely for 4th Class: no LLM call, no generated or templated prose.
        if is_fourth_class:
            tutor_response = ''
        else:
            missed_obj_mentions = []
            for obj in objective_breakdowns[:3]:
                missed_obj_mentions.append(
                    f"Chapter {obj['chapter_num']} Objective {obj['objective_num']} ({obj['topic']})"
                )
            weak_str = ', '.join(weak_chapters) if weak_chapters else 'none'
            strong_str = ', '.join(strong_chapters) if strong_chapters else 'none'
            missed_str = ', '.join(missed_obj_mentions) if missed_obj_mentions else ''

            if state.get('exam_lead_magnet'):
                debrief_prompt = (
                    f"A prospective student named {first_name} just completed a {total_q}-question "
                    f"practice exam for the {course_id} exam paper.\n"
                    f"Overall: {total_correct}/{total_q} ({score_pct}%)\n"
                    f"Strong chapters: {strong_str}\n"
                    f"Chapters needing review: {weak_str}\n"
                    + (f"Missed objectives: {missed_str}\n" if missed_str else "")
                    + f"\nWrite a warm, encouraging 5-7 sentence response. "
                    f"Address them as {first_name}. "
                    f"Start by acknowledging their score. "
                    f"Highlight their strong chapters if any exist. "
                    f"If they have weak chapters, explain that Full Steam Ahead's practice exams "
                    f"automatically adapt — giving more questions on chapters they struggle with — "
                    f"so they improve faster. "
                    f"End with a genuine, warm invitation: a Full Steam Ahead subscription gives them "
                    f"unlimited adaptive practice exams for all 6 papers, full course content with "
                    f"step-by-step lessons, and AI tutoring for $149/month. "
                    f"Invite them to enroll at https://enrollment.fullsteamahead.ca . "
                    f"Be encouraging and genuine, not pushy."
                )
            else:
                debrief_prompt = (
                    f"The student {first_name} just completed a {total_q}-question practice exam for {course_id}, "
                    f"scoring {total_correct}/{total_q} ({score_pct}%).\n"
                    f"The full score breakdown, per-chapter results, and per-objective teaching notes are ALREADY "
                    f"displayed on screen next to this chat, so do NOT repeat or list them.\n"
                    f"\nKeep your reply very brief — 2 to 3 short sentences total, no more. Do this in order:\n"
                    f"1. Summarize their performance in one short sentence at a high level "
                    f"(e.g. strong work / solid progress / room to grow) WITHOUT naming specific chapters, "
                    f"objectives, scores, or percentages.\n"
                    f"2. Encourage them to review the lessons in the \"Where to focus\" section shown on this page.\n"
                    f"3. Ask if there's anything they'd like explained in more detail.\n"
                    f"Address them as {first_name}. Do NOT list their weak areas or offer another exam."
                )

            debrief_state = {
                'activity': 'exam_debrief',
                'mode': 'practice_exam',
                'complexity_level': state.get('complexity_level', 3),
                'questions_done': total_q,
                'session_limit_reached': False,
                'chat_history': state.get('chat_history', []),
                'relevant_chunks': [],
                'display_is_question': False,
                'awaiting_next_question': False,
                'is_resume': False,
                'no_questions_available': False,
                'first_name': first_name,
                'exam_debrief_prompt': debrief_prompt,
            }

            tutor_result = tutor.respond(
                user_message=debrief_prompt,
                lesson_context={'title': f'{course_id} Practice Exam', 'summary': '', 'key_points': [],
                                'narration_text': '', 'video_transcript': ''},
                progress=progress,
                state=debrief_state,
                first_name=first_name,
            )
            tutor_response = tutor_result.get('response', '') if isinstance(tutor_result, dict) else str(tutor_result)

        display_update = {
            'type': 'exam_done',
            'title': f'{course_id} Exam Results',
            'score': total_correct,
            'total': total_q,
            'score_pct': score_pct,
            'chapter_stats': chapter_lines,
            'objective_breakdowns': objective_breakdowns,
            'next_attempt_allocation': next_allocation,
        }
        # Cache so page refreshes can return results without re-running the LLM.
        state['last_debrief'] = {
            'tutor_response': tutor_response,
            'display_update': display_update,
        }
        # Persist durably so the lobby review button and refreshes survive an
        # AI-service restart (in-memory state is lost on every deploy).
        researcher.save_last_debrief(user, course_id, state['last_debrief'])
        return {
            'tutor_response': tutor_response,
            'display_update': display_update,
            'progress_update': {},
            'complexity_level': state['complexity_level'],
            'first_name': first_name,
            'action': None,
            'mode': 'practice_exam',
        }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ai-service && python -m pytest tests/test_orchestrator_fourth_class_debrief.py -v`
Expected: all three PASS.

- [ ] **Step 6: Run the full ai-service test suite to check for regressions**

Run: `cd ai-service && python -m pytest -v`
Expected: all PASS, including `tests/test_orchestrator_debrief.py`.

- [ ] **Step 7: Rebuild and manually verify end-to-end**

```bash
docker compose --env-file /home/debian/.env build ai-service && \
docker compose --env-file /home/debian/.env up -d ai-service
```

Complete a 4A practice exam with the test account (`class_code='fourth'`) and confirm the results screen shows the score + chapter table with **no** "Where to focus" teaching-notes panel and **no** tutor message text anywhere on the results screen (the empty `tutor_response` means `ResultsPanel`'s `hasFocus` check — already gated on `objective_breakdowns.length > 0` — naturally hides `TeachingNotes` with no frontend change required). Then confirm a 2nd/3rd Class exam's debrief still shows both the teaching notes and the tutor's closing message as before.

Expected: 4th Class debrief is stats-only; 2nd/3rd Class debrief unchanged.

- [ ] **Step 8: Commit**

```bash
git add ai-service/agents/orchestrator.py ai-service/tests/test_orchestrator_fourth_class_debrief.py
git commit -m "feat: reduced-AI (stats-only) exam debrief for 4th Class"
```

---

## Task 10: Make chapter quizzes reachable for 4th Class (scope correction)

**Added after the whole-branch review and a follow-up conversation with the owner.** Owner clarification: 4th Class subscribers need to complete BOTH chapter practice quizzes (per-chapter) AND overall practice exams (whole-paper) — only lesson content is excluded. Task 4's `QuizOnlyLobbyPage` shipped with a "Chapter Quizzes" stats tile that can never be populated, because nothing links to a chapter-quiz launcher for 4th Class.

**Files:**
- Modify: `client-v2/src/pages/PracticeExamPage.jsx`
- Modify: `client-v2/src/pages/QuizOnlyLobbyPage.jsx`
- Modify: `client-v2/src/ExamRouter.jsx`

**Investigation, for the implementer's context (do not re-derive this — verify it against the current code, then implement):**

A fully-built, currently-orphaned chapter-quiz picker already exists: `client-v2/src/components/PracticeExamLobby.jsx` renders a "Chapter Quizzes" panel (fetches `GET /api/exam/:courseId/chapters`, one button per chapter, `onClick={() => onSelectChapter(chapterId)}`) alongside its "Practice Exam" panel. This is the `phase === 'lobby'` view inside `PracticeExamRouter` (`client-v2/src/ExamRouter.jsx`). The problem: `PracticeExamRouter`'s parent, the exported `ExamRouter` component, computes `startPhase={initialConfig ? 'exam' : 'lobby'}` — and `client-v2/src/pages/PracticeExamPage.jsx` (the actual `/practice-exam` route) ALWAYS builds a truthy `initialConfig` (`count` defaults to `'50'` via `parseInt(params.get('count') || '50', 10)`), so `startPhase` is always `'exam'` and `PracticeExamLobby` never renders in the live platform today, for ANY class. `GET /api/exam/:courseId/chapters` (`server/src/routes/exam.js`) is course-agnostic — no `class_code` gating, works for `4A`/`4B` already, confirmed against the real query.

Chapter-quiz mode reuses the same `QuizExamView` component as practice-exam mode — meaning Task 5's `isFourthClass` guard (`client-v2/src/ExamRouter.jsx:380`) currently hides the tutor-fab/chat overlay for chapter quizzes too. This is a real functional regression waiting to happen once chapter quizzes become reachable: unlike practice exams (which show a full stats debrief and don't need chat for anything essential), chapter quiz mode's entire per-question feedback mechanism (`_process_chapter_quiz` in `ai-service/agents/orchestrator.py`, "one question per turn, immediate right/wrong feedback") is delivered ONLY as a `tutor_response` chat message — there is no other display surface for "Correct!" / "Not quite — the correct answer was X" per question. It's 100% Python f-string templates, not an LLM call, so it isn't "AI tutoring" in the sense the original design spec meant to remove — it's the quiz mechanic itself, riding the same wire format as chat. If Task 5's guard is left as broad as it is, 4th Class chapter quizzes would silently lose all per-question feedback (students would answer blind and only see a bare final score) — a materially worse experience than what 2nd/3rd Class already gets from the same feature. The fix is to narrow the guard to exclude `chapter_quiz` mode, not to touch the AI service at all.

- [ ] **Step 1: Let `/practice-exam` land on the lobby (both panels) when no `count` param is given**

In `client-v2/src/pages/PracticeExamPage.jsx`, change:

```jsx
export default function PracticeExamPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const paper = params.get('paper') || '';
  const count = parseInt(params.get('count') || '50', 10);
  const timed = params.get('timed') === 'true';

  const user = JSON.parse(localStorage.getItem('fsa_user') || '{}');

  return (
    <ExamRouter
      courseId={paper}
      learnerId={user.email}
      initialConfig={{ count, timed }}
      onExit={() => navigate('/lobby')}
      onComplete={(debrief) =>
        navigate(`/exam/results?paper=${encodeURIComponent(paper)}`, { state: { debrief } })
      }
    />
  );
}
```

to:

```jsx
export default function PracticeExamPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const paper = params.get('paper') || '';
  const countParam = params.get('count');
  const timed = params.get('timed') === 'true';

  const user = JSON.parse(localStorage.getItem('fsa_user') || '{}');

  // No `count` in the URL → land on PracticeExamLobby (both the exam-count
  // picker AND the chapter-quiz grid) instead of auto-starting a full exam.
  // Every existing caller (LobbyPage, ExamResultsPage's retry, and
  // QuizOnlyLobbyPage's practice-exam launch) always passes an explicit
  // count, so this branch is new behavior only — nothing existing changes.
  const initialConfig = countParam ? { count: parseInt(countParam, 10), timed } : null;

  return (
    <ExamRouter
      courseId={paper}
      learnerId={user.email}
      initialConfig={initialConfig}
      onExit={() => navigate('/lobby')}
      onComplete={(debrief) =>
        navigate(`/exam/results?paper=${encodeURIComponent(paper)}`, { state: { debrief } })
      }
    />
  );
}
```

- [ ] **Step 2: Point `QuizOnlyLobbyPage`'s per-paper button at the combined lobby instead of an auto-started exam**

In `client-v2/src/pages/QuizOnlyLobbyPage.jsx`, change the button:

```jsx
        <button className="qo-btn-primary" onClick={() => onStartExam(paperCode)}>
          Start Practice Exam
        </button>
```

to:

```jsx
        <button className="qo-btn-primary" onClick={() => onStartExam(paperCode)}>
          Practice This Paper
        </button>
```

and change `handleStartExam`:

```js
  function handleStartExam(paper) {
    navigate(`/practice-exam?paper=${paper}&count=50`);
  }
```

to:

```js
  function handleStartExam(paper) {
    // No count param → lands on the combined practice-exam/chapter-quiz
    // picker (PracticeExamLobby) instead of auto-starting a 50-question exam.
    navigate(`/practice-exam?paper=${paper}`);
  }
```

- [ ] **Step 3: Narrow Task 5's tutor-hiding guard to exclude chapter-quiz mode**

In `client-v2/src/ExamRouter.jsx`, inside `QuizExamView`, change:

```js
  const isExam = mode === 'practice_exam';
  // 4th Class has no AI tutor chat (see
  // docs/superpowers/specs/2026-07-13-fourth-class-platform-integration-design.md §5).
  const isFourthClass = user?.class_code === 'fourth';
```

to:

```js
  const isExam = mode === 'practice_exam';
  // 4th Class has no AI tutor CHAT — but chapter-quiz mode's per-question
  // feedback ("Correct!" / "Not quite — the correct answer was...") is
  // delivered ONLY via this same tutor_response channel (see
  // _process_chapter_quiz in ai-service/agents/orchestrator.py — it's plain
  // templated text, not an LLM call, and there's no other display surface
  // for it). Hiding it there would silently break chapter quizzes for 4th
  // Class, not just remove optional tutoring. Only practice_exam mode's
  // chat is truly optional/supplementary (it shows a full stats debrief
  // instead), so only that mode gets hidden.
  const isFourthClass = user?.class_code === 'fourth' && mode !== 'chapter_quiz';
```

No other line in `QuizExamView` needs to change — both existing `{!isFourthClass && ...}` guards (the tutor-fab button and the chat overlay) now correctly stay visible for 4th Class chapter quizzes while remaining hidden for 4th Class practice exams, with zero change to 2nd/3rd Class behavior (their `isFourthClass` is always `false` regardless of `mode`).

- [ ] **Step 4: Build and verify**

```bash
cd client-v2 && npm run build
```
Must complete with zero errors. No live deploy (see plan Global Constraints).

Read through the three changed files once more and confirm:
- `PracticeExamPage.jsx`: every existing caller's URL (grep the codebase for `/practice-exam?paper=` navigations) still includes an explicit `count`, so `initialConfig` stays truthy and `startPhase` stays `'exam'` for all of them — zero behavior change for 2nd/3rd Class or for any existing 4th-Class practice-exam launch flow already shipped in Tasks 4/7.
- `QuizOnlyLobbyPage.jsx`: only this one file's navigation call changed; `LobbyPage.jsx` (2nd/3rd Class) is untouched.
- `ExamRouter.jsx`: `isFourthClass` is `false` for `mode === 'chapter_quiz'` regardless of `class_code`, and unchanged (`user?.class_code === 'fourth'`) for `mode === 'practice_exam'` — trace both `{!isFourthClass && ...}` sites to confirm chapter-quiz mode now shows the tutor-fab/chat for 4th Class exactly as it already does for 2nd/3rd Class.

- [ ] **Step 5: Commit**

```bash
git add client-v2/src/pages/PracticeExamPage.jsx client-v2/src/pages/QuizOnlyLobbyPage.jsx client-v2/src/ExamRouter.jsx
git commit -m "fix: make chapter quizzes reachable for 4th Class, keep their feedback chat visible"
```

---

## Task 9: Wiki update

**Files:**
- Modify: `/home/debian/wiki/projects/fsa-agent.md`
- Modify: `/home/debian/wiki/log.md`

- [ ] **Step 1: Update `wiki/projects/fsa-agent.md`**

Add a note documenting the new `class_code='fourth'`, the `quiz-lobby-data`/`QuizOnlyLobbyPage` route, and that content (Task 1-9 landed once Plan B / the Stripe side is also live) — per the spec's own Done Criteria #9 ("Wiki updated with the new class_code, route, and Stripe product details once built"). Hold this step until **both** this plan and the companion `fsa-webhook-listener` plan (`docs/superpowers/plans/2026-07-22-fourth-class-stripe-provisioning.md`) are deployed, since the wiki should describe the shipped feature, not a partial state.

- [ ] **Step 2: Append to `wiki/log.md`**

```
## [YYYY-MM-DD] feat | 4th Class platform integration shipped: class_code='fourth', QuizOnlyLobbyPage, reduced-AI debrief, weighted retake with no chat, Stripe $99/yr annual (cancel_at_period_end) provisioning. See docs/superpowers/plans/2026-07-22-fourth-class-platform-integration.md and .../2026-07-22-fourth-class-stripe-provisioning.md (fsa-webhook-listener).
```

(Fill in the actual deploy date when this step is executed.)

- [ ] **Step 3: Commit** (wiki is its own git repo, separate from `fsa-agent`)

```bash
cd /home/debian/wiki && git add projects/fsa-agent.md log.md && git commit -m "docs: 4th Class platform integration shipped"
```
