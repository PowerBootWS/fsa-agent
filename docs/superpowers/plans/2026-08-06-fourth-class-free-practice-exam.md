# 4th Class Free Practice Exam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Free Practice Exam lead magnet (currently 2nd/3rd class only) to offer 4th Class Part A (`4A`) and Part B (`4B`) as two additional, independently-selectable free exams, and close a gap where nothing today stops a lead from free-attempting multiple different papers/classes.

**Architecture:** All 4th-class data plumbing (`PAPERS_BY_CLASS`, `FOURTH_CLASS_CODES`, `isFourthClassCode`, the AI orchestrator's reduced-AI debrief for `course_id in {4A,4B}`) already exists for the authenticated platform — this plan only wires the *unauthenticated* free-exam funnel (`practiceExam.js` → `FreePracticeExamPage.jsx` → `free-practice-exam.html`) to recognize `fourth_a`/`fourth_b`, and adds a new cross-class exclusivity check so picking any one class/paper locks out all others for that email. No DB schema change — `practice_exam_attempts.class_code`/`paper_code` are free-text `VARCHAR` already.

**Tech Stack:** Express.js + PostgreSQL (`fsa-agent/server`), React/Vite (`fsa-agent/client-v2`), static HTML/vanilla JS (`fsa-website`), Jest + Supertest for backend tests.

## Global Constraints

- Spec: `fsa-agent/docs/superpowers/specs/2026-08-06-fourth-class-free-practice-exam-design.md` — read it if anything here is ambiguous.
- No `practice_exam_attempts` schema change — `class_code`/`paper_code` are `VARCHAR`, already generalize to `fourth_a`/`4A` and `fourth_b`/`4B`.
- Cross-class exclusivity = **any attempt blocks**, not completed-only: a started-but-abandoned attempt on one paper still locks out every other paper/class for that email.
- 4th class labeling: "4th Class – Part A" / "4th Class – Part B" (matches the paid subscription naming `fourth_a`/`fourth_b`), not paper-code-style names like "4th Class A1".
- `diagnostic.js`, `preview.js` (old v1 lead magnet), and `fsa-lead-capture` are explicitly out of scope — do not touch them.
- Backend tests: `cd fsa-agent/server && npm test` runs against `POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_DB=fsa_agent_test` (see `server/package.json`'s `test` script) — do not point tests at the production `fsa-postgres` container.
- `client-v2` has no unit-test infra (no test script, no `*.test.jsx` files) — verify frontend changes with `npm run lint` and `npm run build`, not new test files.
- Deploy: always pass `--env-file /home/debian/.env` to `docker compose`. Build `client-v2` before rebuilding the `api` image. Never test via `localhost`/container IP — only `https://learn.fullsteamahead.ca` via the Cloudflare Tunnel.
- Community/group posts (Facebook groups, Reddit): never mention FSA/product/links; no em dashes; close with a short direct question; follow `wiki/style-guide.md` and `.claude/skills/social-planner/GROUP-ENGAGEMENT.md`. The promotional pitch belongs only on the FSA-owned LinkedIn/FB Page posts.

---

### Task 1: Backend — wire 4th class into the free-exam route + cross-class exclusivity gate

**Files:**
- Modify: `fsa-agent/server/src/routes/practiceExam.js`
- Test: `fsa-agent/server/tests/practiceExamRoute.test.js` (new)

**Interfaces:**
- Consumes: `PAPERS_BY_CLASS` from `fsa-agent/server/src/config/papersForClass.js` — `{ second: [...], third: [...], fourth_a: ['4A'], fourth_b: ['4B'] }` (already exists, unmodified by this task).
- Produces: `POST /api/practice-exam/request-code` now accepts `classCode` of `second|third|fourth_a|fourth_b`; on cross-class conflict returns `{ success: false, already_used: true, paper_code: '<existing paper_code>' }` (new `paper_code` field). Same-paper "already used" response also now includes `paper_code` for symmetry. No other route/response shape changes.

- [ ] **Step 1: Write the failing tests**

Create `fsa-agent/server/tests/practiceExamRoute.test.js`:

```js
const request = require('supertest');
const express = require('express');
const { pool } = require('./testPool');
const practiceExamRouter = require('../src/routes/practiceExam');

jest.mock('../src/services/email');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/practice-exam', practiceExamRouter);
  return app;
}

async function insertAttempt({ email, classCode, paperCode, completedAt = null }) {
  await pool.query(
    `INSERT INTO practice_exam_attempts
       (email, first_name, class_code, paper_code, verification_code, code_expires_at, completed_at)
     VALUES ($1, 'Test', $2, $3, '000000', NOW() + interval '10 minutes', $4)`,
    [email, classCode, paperCode, completedAt]
  );
}

describe('POST /api/practice-exam/request-code — 4th class + cross-class exclusivity', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM practice_exam_attempts`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('accepts fourth_a/4A and creates an attempt row', async () => {
    const res = await request(buildTestApp())
      .post('/api/practice-exam/request-code')
      .send({ firstName: 'Jordan', email: 'fourth-a@example.com', classCode: 'fourth_a', paperCode: '4A' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const row = await pool.query(
      `SELECT class_code, paper_code FROM practice_exam_attempts WHERE email = $1`,
      ['fourth-a@example.com']
    );
    expect(row.rows[0]).toEqual({ class_code: 'fourth_a', paper_code: '4A' });
  });

  it('accepts fourth_b/4B and creates an attempt row', async () => {
    const res = await request(buildTestApp())
      .post('/api/practice-exam/request-code')
      .send({ firstName: 'Jordan', email: 'fourth-b@example.com', classCode: 'fourth_b', paperCode: '4B' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('rejects a paperCode that does not belong to the given 4th-class classCode', async () => {
    const res = await request(buildTestApp())
      .post('/api/practice-exam/request-code')
      .send({ firstName: 'Jordan', email: 'mismatch@example.com', classCode: 'fourth_a', paperCode: '4B' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid paperCode');
  });

  it('blocks a different paper/class if the email has ANY prior attempt, even uncompleted', async () => {
    await insertAttempt({ email: 'switcher@example.com', classCode: 'second', paperCode: '2A1' });

    const res = await request(buildTestApp())
      .post('/api/practice-exam/request-code')
      .send({ firstName: 'Jordan', email: 'switcher@example.com', classCode: 'fourth_a', paperCode: '4A' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, already_used: true, paper_code: '2A1' });
  });

  it('still allows requesting/resending a code for the SAME paper already started', async () => {
    await insertAttempt({ email: 'resend@example.com', classCode: 'fourth_a', paperCode: '4A' });

    const res = await request(buildTestApp())
      .post('/api/practice-exam/request-code')
      .send({ firstName: 'Jordan', email: 'resend@example.com', classCode: 'fourth_a', paperCode: '4A' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('a fresh email with no prior rows can pick any of second/third/fourth_a/fourth_b', async () => {
    const res = await request(buildTestApp())
      .post('/api/practice-exam/request-code')
      .send({ firstName: 'Jordan', email: 'fresh@example.com', classCode: 'third', paperCode: '3A1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd fsa-agent/server && npm test -- practiceExamRoute`
Expected: FAIL — `fourth_a`/`fourth_b` rejected with `Invalid classCode` (400), and no cross-class exclusivity check exists yet so the "blocks a different paper/class" test fails (`success: true` returned instead of `already_used`).

- [ ] **Step 3: Wire `papersForClass.js` into `practiceExam.js` and add the cross-class exclusivity check**

In `fsa-agent/server/src/routes/practiceExam.js`, replace lines 6–26 (imports through `paperListForClass`) with:

```js
const { pool } = require('../services/database');
const { PAPERS_BY_CLASS } = require('./papersForClass');
const practiceExamTokens = require('../services/practiceExamTokens');
const { createRateLimiter } = require('../utils/rateLimit');
const { sendPracticeExamCode } = require('../services/email');

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';

const requestCodeLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
const verifyCodeLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
// Defense-in-depth: keyed on email alone (not ip:email), so rotating IPs
// can't multiply brute-force attempts against one target email. Slightly
// looser than verifyCodeLimiter since its blast radius is "one email from
// anywhere" rather than "one ip+email pair".
const verifyCodeEmailLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 15 });

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_CLASS_CODES = Object.keys(PAPERS_BY_CLASS); // ['second','third','fourth_a','fourth_b']

function paperListForClass(classCode) {
  return PAPERS_BY_CLASS[classCode] || [];
}
```

Then in `request-code` (still inside the same file), replace the classCode validation:

```js
  if (classCode !== 'second' && classCode !== 'third') {
    return res.status(400).json({ error: 'Invalid classCode' });
  }
```

with:

```js
  if (!VALID_CLASS_CODES.includes(classCode)) {
    return res.status(400).json({ error: 'Invalid classCode' });
  }
```

Then, still in `request-code`'s `try` block, insert the new cross-class exclusivity check immediately before the existing same-paper `existing` query, and add `paper_code` to both `already_used` responses:

```js
  try {
    // Cross-class exclusivity: a lead gets exactly one free exam total,
    // across every class/paper — not one per paper. An uncompleted,
    // abandoned attempt still counts (blocks switching mid-attempt too).
    const otherAttempt = await pool.query(
      'SELECT paper_code FROM practice_exam_attempts WHERE email = $1 AND paper_code != $2 LIMIT 1',
      [cleanEmail, paperCode]
    );
    if (otherAttempt.rows.length > 0) {
      return res.status(200).json({ success: false, already_used: true, paper_code: otherAttempt.rows[0].paper_code });
    }

    const existing = await pool.query(
      'SELECT completed_at FROM practice_exam_attempts WHERE email = $1 AND paper_code = $2',
      [cleanEmail, paperCode]
    );
    if (existing.rows.length > 0 && existing.rows[0].completed_at !== null) {
      return res.status(200).json({ success: false, already_used: true, paper_code: paperCode });
    }
```

Nothing else in the file changes — `verify-code`, `chat`, and `complete` stay scoped by `(email, paper_code)` exactly as before, and don't need the cross-class check (by the time a code is verified, the requesting call already guaranteed this is the only paper on file for that email).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd fsa-agent/server && npm test -- practiceExamRoute`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Run the full backend test suite to check for regressions**

Run: `cd fsa-agent/server && npm test`
Expected: PASS — in particular `papersForClass.test.js` and `papersForClassRoute.test.js` (unrelated route, but confirms shared config still intact).

- [ ] **Step 6: Commit**

```bash
cd fsa-agent
git add server/src/routes/practiceExam.js server/tests/practiceExamRoute.test.js
git commit -m "feat(practice-exam): wire 4th class into free-exam route + cross-class exclusivity gate"
```

---

### Task 2: Frontend — `FreePracticeExamPage.jsx` 4th class support

**Files:**
- Modify: `fsa-agent/client-v2/src/pages/FreePracticeExamPage.jsx`

**Interfaces:**
- Consumes: `POST /api/practice-exam/request-code` now returning `paper_code` in its `already_used` response (Task 1).
- Produces: no exports change — this is a leaf page component, nothing downstream depends on its internals beyond the route it's mounted on.

- [ ] **Step 1: Add 4th-class options and the class→paper map**

Replace:

```js
const CLASS_OPTIONS = [
  { value: 'second', label: '2nd Class' },
  { value: 'third', label: '3rd Class' },
];
```

with:

```js
const CLASS_OPTIONS = [
  { value: 'second', label: '2nd Class' },
  { value: 'third', label: '3rd Class' },
  { value: 'fourth_a', label: '4th Class – Part A' },
  { value: 'fourth_b', label: '4th Class – Part B' },
];

// 4th Class is sold as two standalone papers, not a subscription with a
// paper grid inside it — picking the class IS picking the paper.
const FOURTH_CLASS_PAPER = { fourth_a: '4A', fourth_b: '4B' };
```

- [ ] **Step 2: Add `alreadyUsedPaperCode` state**

Change:

```js
  const [alreadyUsed, setAlreadyUsed] = useState(false);
```

to:

```js
  const [alreadyUsed, setAlreadyUsed] = useState(false);
  const [alreadyUsedPaperCode, setAlreadyUsedPaperCode] = useState(null);
```

- [ ] **Step 3: Update `AlreadyUsedNotice` to show which paper was already used**

Replace the `AlreadyUsedNotice` component:

```jsx
function AlreadyUsedNotice() {
  return (
    <div>
      <p style={{ color: '#F4F5F7', fontSize: '14px', lineHeight: 1.6, textAlign: 'center' }}>
        Looks like you've already used your free practice exam for this paper.
        Subscribe to get unlimited adaptive practice exams across every paper,
        full course content, and AI tutoring.
      </p>
      <a href={ENROLL_URL} style={{ ...styles.button, display: 'block', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}>
        Subscribe Now →
      </a>
    </div>
  );
}
```

with:

```jsx
function AlreadyUsedNotice({ existingPaperCode }) {
  return (
    <div>
      <p style={{ color: '#F4F5F7', fontSize: '14px', lineHeight: 1.6, textAlign: 'center' }}>
        {existingPaperCode
          ? `Looks like you've already used your one free practice exam (${existingPaperCode}).`
          : `Looks like you've already used your free practice exam for this paper.`}{' '}
        Subscribe to get unlimited adaptive practice exams across every paper,
        full course content, and AI tutoring.
      </p>
      <a href={ENROLL_URL} style={{ ...styles.button, display: 'block', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}>
        Subscribe Now →
      </a>
    </div>
  );
}
```

- [ ] **Step 4: Make `handleClassToggle` skip the paper grid for 4th class**

Replace:

```js
  function handleClassToggle(cls) {
    if (cls === classCode) return;
    setClassCode(cls);
    setPaperCode(null);
    fetchPapersForClass(cls);
  }
```

with:

```js
  function handleClassToggle(cls) {
    if (cls === classCode) return;
    setClassCode(cls);
    setAlreadyUsed(false);
    setAlreadyUsedPaperCode(null);
    setRequestError('');

    if (FOURTH_CLASS_PAPER[cls]) {
      // 4th Class: the class IS the paper — no paper-grid step, go
      // straight to signup like handleSelectPaper does for 2nd/3rd.
      setPaperCode(FOURTH_CLASS_PAPER[cls]);
      setPhase('signup');
      return;
    }

    setPaperCode(null);
    fetchPapersForClass(cls);
  }
```

- [ ] **Step 5: Reset `alreadyUsedPaperCode` alongside `alreadyUsed` in `handleSelectPaper`**

Replace:

```js
  function handleSelectPaper(paper) {
    setPaperCode(paper);
    setAlreadyUsed(false);
    setRequestError('');
    setPhase('signup');
  }
```

with:

```js
  function handleSelectPaper(paper) {
    setPaperCode(paper);
    setAlreadyUsed(false);
    setAlreadyUsedPaperCode(null);
    setRequestError('');
    setPhase('signup');
  }
```

- [ ] **Step 6: Handle the 4th-class deep-link case in the init effect**

Replace the `init` function body inside the mount `useEffect`:

```js
    async function init() {
      const urlClass = searchParams.get('class');
      const urlPaper = searchParams.get('paper');

      const validClass = urlClass === 'second' || urlClass === 'third';
      if (!validClass) {
        setInitializing(false);
        return;
      }

      setClassCode(urlClass);
      const list = await fetchPapersForClass(urlClass);
      if (urlPaper && list.includes(urlPaper)) {
        setPaperCode(urlPaper);
        setPhase('signup');
      }
      setInitializing(false);
    }
```

with:

```js
    async function init() {
      const urlClass = searchParams.get('class');
      const urlPaper = searchParams.get('paper');

      if (FOURTH_CLASS_PAPER[urlClass]) {
        // 4th Class deep link: class IS the paper, no papers-for-class
        // fetch needed — go straight to signup.
        setClassCode(urlClass);
        setPaperCode(FOURTH_CLASS_PAPER[urlClass]);
        setPhase('signup');
        setInitializing(false);
        return;
      }

      const validClass = urlClass === 'second' || urlClass === 'third';
      if (!validClass) {
        setInitializing(false);
        return;
      }

      setClassCode(urlClass);
      const list = await fetchPapersForClass(urlClass);
      if (urlPaper && list.includes(urlPaper)) {
        setPaperCode(urlPaper);
        setPhase('signup');
      }
      setInitializing(false);
    }
```

- [ ] **Step 7: Capture `paper_code` from `already_used` responses**

In `handleSignupSubmit`, replace:

```js
      if (data.success === false && data.already_used) {
        setAlreadyUsed(true);
        return;
      }
```

with:

```js
      if (data.success === false && data.already_used) {
        setAlreadyUsed(true);
        setAlreadyUsedPaperCode(data.paper_code || null);
        return;
      }
```

In `handleResend`, apply the identical change (same `if` block, same replacement).

In `handleVerifySubmit`, replace:

```js
      if (data.success === false && data.already_used) {
        setAlreadyUsed(true);
        return;
      }
```

with:

```js
      if (data.success === false && data.already_used) {
        setAlreadyUsed(true);
        // verify-code's already_used is always for the currently-selected
        // paper (it doesn't return paper_code) — clear any stale value
        // from an earlier request-code call so the notice falls back to
        // the generic "for this paper" wording, not a wrong one.
        setAlreadyUsedPaperCode(null);
        return;
      }
```

- [ ] **Step 8: Update the signup-phase header and back-link copy, and pass `existingPaperCode` through**

Replace:

```jsx
            <button type="button" style={styles.backLink} onClick={() => { setAlreadyUsed(false); setPhase('picker'); }}>
              ← Choose a different paper
            </button>
            <p style={styles.hint}>
              {classCode === 'third' ? '3rd Class' : '2nd Class'} — {paperCode}
            </p>
            {alreadyUsed ? (
              <AlreadyUsedNotice />
            ) : (
```

with:

```jsx
            <button type="button" style={styles.backLink} onClick={() => { setAlreadyUsed(false); setAlreadyUsedPaperCode(null); setPhase('picker'); }}>
              ← Start over
            </button>
            <p style={styles.hint}>
              {CLASS_OPTIONS.find(opt => opt.value === classCode)?.label || classCode} — {paperCode}
            </p>
            {alreadyUsed ? (
              <AlreadyUsedNotice existingPaperCode={alreadyUsedPaperCode} />
            ) : (
```

("Choose a different paper" no longer fits 4th class, where the class IS the paper — "Start over" reads correctly for all four options.)

And in the verify phase, replace:

```jsx
            {alreadyUsed ? (
              <AlreadyUsedNotice />
            ) : (
              <form onSubmit={handleVerifySubmit}>
```

with:

```jsx
            {alreadyUsed ? (
              <AlreadyUsedNotice existingPaperCode={alreadyUsedPaperCode} />
            ) : (
              <form onSubmit={handleVerifySubmit}>
```

- [ ] **Step 9: Lint and build**

Run: `cd fsa-agent/client-v2 && npm run lint`
Expected: no new errors.

Run: `cd fsa-agent/client-v2 && npm run build`
Expected: build succeeds.

- [ ] **Step 10: Manual smoke test**

After Task 4's deploy, visit `https://learn.fullsteamahead.ca/free-practice-exam` directly (no query params) and confirm all four class options render, selecting "4th Class – Part A" skips straight to the signup form with "4th Class – Part A — 4A" shown, and `https://learn.fullsteamahead.ca/free-practice-exam?class=fourth_b&paper=4B` deep-links straight to signup for Part B.

- [ ] **Step 11: Commit**

```bash
cd fsa-agent
git add client-v2/src/pages/FreePracticeExamPage.jsx
git commit -m "feat(free-practice-exam): add 4th Class Part A/B to the picker and deep-link handling"
```

---

### Task 3: Website — `free-practice-exam.html` 4th class cards + one-free-exam copy correction

**Files:**
- Modify: `fsa-website/free-practice-exam.html`

**Interfaces:**
- Consumes: nothing new — the deep-link URL shape (`?class=<class>&paper=<paper>[&am_id=...]`) it builds already matches what Task 2's `FreePracticeExamPage.jsx` expects.
- Produces: nothing consumed elsewhere in this codebase — this is the top-of-funnel landing page.

**Note before starting:** reading this file surfaced a real copy bug independent of the 4th-class work — the current FAQ ("Can I do more than one paper?") and Step 2 subtext both claim a lead can free-attempt *every* paper "once each," which was already loosely true before (nothing enforced it) but becomes actively false once Task 1's cross-class exclusivity ships. This task fixes that alongside adding 4th class.

- [ ] **Step 1: Add the two 4th-class picker cards**

In the `#fpe-class-picker` block, after the existing "3rd Class" card (`</div>` closing `data-class="third"`), add:

```html
        <div class="pillar-card amber-top fpe-class-card" data-class="fourth_a" role="button" tabindex="0" aria-pressed="false">
          <div class="pillar-icon">📙</div>
          <div class="pillar-title">4th Class – Part A</div>
          <p class="pillar-desc">Paper 4A, the whole exam. Your one free practice run for this certificate.</p>
        </div>
        <div class="pillar-card green-top fpe-class-card" data-class="fourth_b" role="button" tabindex="0" aria-pressed="false">
          <div class="pillar-icon">📙</div>
          <div class="pillar-title">4th Class – Part B</div>
          <p class="pillar-desc">Paper 4B, the whole exam. Your one free practice run for this certificate.</p>
        </div>
```

(`amber-top`/`green-top` are existing `.pillar-card` modifier classes already defined in `styles-v2.css` alongside the `orange-top`/`steel-top` used by 2nd/3rd — no new CSS needed.)

- [ ] **Step 2: Update the JS picker to treat 4th class as "class IS the paper"**

Replace the `selectClass` function:

```js
      function selectClass(classCard) {
        selectedClass = classCard.dataset['class'];
        selectedPaper = null;

        classPicker.querySelectorAll('.fpe-class-card').forEach(function (card) {
          var on = card === classCard;
          card.classList.toggle('is-selected', on);
          card.setAttribute('aria-pressed', on ? 'true' : 'false');
        });

        papersSecond.classList.toggle('fpe-hidden', selectedClass !== 'second');
        papersThird.classList.toggle('fpe-hidden', selectedClass !== 'third');
        paperStep.classList.remove('fpe-hidden');

        var activeGrid = selectedClass === 'second' ? papersSecond : papersThird;
        activeGrid.querySelectorAll('.fpe-paper-card').forEach(function (card) {
          card.classList.remove('is-selected');
          card.setAttribute('aria-pressed', 'false');
        });

        ctaStep.classList.add('fpe-hidden');
      }
```

with:

```js
      var FOURTH_CLASS_PAPER = { fourth_a: '4A', fourth_b: '4B' };

      function selectClass(classCard) {
        selectedClass = classCard.dataset['class'];
        selectedPaper = null;

        classPicker.querySelectorAll('.fpe-class-card').forEach(function (card) {
          var on = card === classCard;
          card.classList.toggle('is-selected', on);
          card.setAttribute('aria-pressed', on ? 'true' : 'false');
        });

        if (FOURTH_CLASS_PAPER[selectedClass]) {
          // 4th Class: the class IS the paper — no Step 2 grid, straight to CTA.
          selectedPaper = FOURTH_CLASS_PAPER[selectedClass];
          paperStep.classList.add('fpe-hidden');
          updateCta();
          return;
        }

        papersSecond.classList.toggle('fpe-hidden', selectedClass !== 'second');
        papersThird.classList.toggle('fpe-hidden', selectedClass !== 'third');
        paperStep.classList.remove('fpe-hidden');

        var activeGrid = selectedClass === 'second' ? papersSecond : papersThird;
        activeGrid.querySelectorAll('.fpe-paper-card').forEach(function (card) {
          card.classList.remove('is-selected');
          card.setAttribute('aria-pressed', 'false');
        });

        ctaStep.classList.add('fpe-hidden');
      }
```

(`updateCta()` and the deep-link builder underneath it are already class-agnostic — no changes needed there.)

- [ ] **Step 3: Fix the one-free-exam copy throughout (title, meta, OG, intro, Step labels, FAQ, JSON-LD)**

Replace the `<title>`:
`Free Practice Exam – Power Engineering (2nd &amp; 3rd Class) | Full Steam Ahead`
with:
`Free Practice Exam – Power Engineering (2nd, 3rd &amp; 4th Class) | Full Steam Ahead`

Replace the meta description:
`Take a free practice exam for any 2nd or 3rd Class Power Engineering paper. Pick your paper, answer 25, 50, or 100 real exam-format questions, and get a full chapter-by-chapter AI debrief. No credit card, no commitment.`
with:
`Take one free practice exam for 2nd Class, 3rd Class, or 4th Class Part A/B Power Engineering. Pick your paper, answer 25, 50, or 100 real exam-format questions, and get a full chapter-by-chapter AI debrief. No credit card, no commitment.`

Replace `og:title`:
`Free Practice Exam – Power Engineering (2nd &amp; 3rd Class) – Full Steam Ahead`
with:
`Free Practice Exam – Power Engineering (2nd, 3rd &amp; 4th Class) – Full Steam Ahead`

Replace `og:description`:
`Pick any paper for your 2nd or 3rd Class certificate, take 25, 50, or 100 real exam-format questions, and get a chapter-by-chapter debrief with AI feedback. No credit card, no commitment.`
with:
`Pick one paper — 2nd Class, 3rd Class, or 4th Class Part A/B — take 25, 50, or 100 real exam-format questions, and get a chapter-by-chapter debrief with AI feedback. No credit card, no commitment.`

Replace the H1 intro paragraph:
`Textbooks and study guides tell you <em>what</em> to study. This tells you where you actually stand. Pick any paper for your 2nd or 3rd Class certificate, take 25, 50, or 100 real exam-format questions, and get a chapter-by-chapter debrief with AI feedback: the same experience full members get. No credit card, no commitment, just verify your email and go.`
with:
`Textbooks and study guides tell you <em>what</em> to study. This tells you where you actually stand. Pick one paper — 2nd Class, 3rd Class, or 4th Class Part A/B — take 25, 50, or 100 real exam-format questions, and get a chapter-by-chapter debrief with AI feedback: the same experience full members get. No credit card, no commitment, just verify your email and go.`

Replace the Step 1 subtext:
`Every 2nd and 3rd Class paper is available for a free practice run. Pick your certificate to see its papers.`
with:
`Every 2nd, 3rd, and 4th Class paper is available for a free practice run — but you only get one, so pick the paper you're least sure about.`

Replace the Step 2 subtext:
`Pick the paper you want to practice. You can come back and try the others too, once each, verified by email.`
with:
`Pick the paper you want to practice. This is your one free exam, verified by email, so choose carefully.`

Replace the FAQ question/answer pair (both the visible `.faq-card` block and the matching `application/ld+json` `FAQPage` entry — same text in both places):

Old question: `Can I do more than one paper?`
Old answer: `Yes: you can take a free practice exam on every paper listed on this page, once each, verified by email. It's a good way to see where you stand across your whole certificate before you commit to anything.`

New question: `Can I do more than one paper?`
New answer: `No — the free practice exam is one paper only, once, verified by email. Choose whichever paper you're least confident on: 2nd Class, 3rd Class, or 4th Class Part A or B. Want more than one? A subscription unlocks unlimited adaptive practice across every paper.`

- [ ] **Step 4: Visual/functional check**

Open `fsa-website/free-practice-exam.html` in a browser (or via the local dev server the `fsa-website-deploy` skill uses) and confirm: four class cards render (2nd, 3rd, 4th Part A, 4th Part B); clicking 2nd or 3rd still shows the Step 2 paper grid; clicking either 4th-class card skips straight to the CTA step with the correct deep link (`?class=fourth_a&paper=4A` / `?class=fourth_b&paper=4B`); FAQ and JSON-LD both read the corrected one-exam-only copy.

- [ ] **Step 5: Commit**

```bash
cd fsa-website
git add free-practice-exam.html
git commit -m "feat: add 4th Class Part A/B to free practice exam picker, fix one-exam-only copy"
```

---

### Task 4: Deploy fsa-agent (backend + frontend)

**Files:** none (deploy only).

- [ ] **Step 1: Build and deploy**

```bash
cd /home/debian/fsa-agent
cd client-v2 && npm run build && cd .. && \
docker compose --env-file /home/debian/.env build api && \
docker compose --env-file /home/debian/.env up -d api
```

- [ ] **Step 2: Verify against the live URL**

```bash
curl -s -X POST https://learn.fullsteamahead.ca/api/practice-exam/request-code \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Deploy Check","email":"deploy-check-4th-class@example.com","classCode":"fourth_a","paperCode":"4A"}'
```

Expected: `{"success":true}`. Then repeat with `"classCode":"fourth_b","paperCode":"4B"` for the *same* email — expected `{"success":false,"already_used":true,"paper_code":"4A"}`, confirming the cross-class gate is live in production.

Clean up the test rows afterward:

```bash
docker exec fsa-postgres psql -U postgres -d fsa_agent -c \
  "DELETE FROM practice_exam_attempts WHERE email = 'deploy-check-4th-class@example.com'"
```

---

### Task 5: Deploy fsa-website

**Files:** none (deploy only) — uses `fsa-website-deploy` skill, not raw commands, per that skill's docs (handles git, Docker rebuild, sitemap, Search Console, and Cloudflare cache purge in the correct order).

- [ ] **Step 1: Invoke the `fsa-website-deploy` skill** to publish `free-practice-exam.html`.

- [ ] **Step 2: Verify** — load `https://fullsteamahead.ca/free-practice-exam.html`, confirm the four class cards and corrected FAQ copy are live, and click through the 4th-class Part A deep link to `learn.fullsteamahead.ca` to confirm the two sides connect end to end.

---

### Task 6: Social — manual group drafts (organic, no pitch)

**Files:** none — content-only task, delivered as chat output, not a file in either repo (per `reddit-post-draft`/`GROUP-ENGAGEMENT.md` conventions, these are copy-paste blocks the owner posts by hand, not committed anywhere).

**Constraint (per Global Constraints and the owner's explicit choice):** these drafts must NOT mention FSA, Full Steam Ahead, any product, or include a link — the groups' no-self-promo rule stays intact. The actual "4th class now available" pitch runs only in Task 7.

- [ ] **Step 1: Draft one organic engagement post about 4th Class** — a genuine question or observation about 4th Class study/work (e.g. asking what 4th Class engineers found hardest, or a technical detail from the 4th Class syllabus), following `wiki/style-guide.md` and `GROUP-ENGAGEMENT.md`'s voice rules (specific equipment/numbers, no atmospheric scene-setting, no em dashes, close with a short direct question, no FSA mention or link). Present as a copy-paste block suitable for one of the Facebook groups (`pe-canada` preferred per its top-priority ranking) or r/PowerEngineering, per the owner's choice at post time.

- [ ] **Step 2: Deliver the draft to the owner** in the standard package shape (what it's for, target group/URL, `Copy/paste text:` label, plain-text code block) — no auto-posting, the owner pastes it manually.

---

### Task 7: Social — auto-scheduled LinkedIn + FB Page announcement

**Files:** `fsa-marketing/docs/content-plans/<date>-social-plan.json` (or whichever plan file `social-planner` is currently appending to — confirm the active filename by invoking the skill, don't assume).

- [ ] **Step 1: Invoke the `social-planner` skill** to add one LinkedIn (company page) post and one Facebook Page post announcing 4th Class free practice exams are now live, linking to `https://fullsteamahead.ca/free-practice-exam.html`, slotted into the existing content cadence. Follow the skill's own copy/voice and scheduling conventions (this is an FSA-owned channel, so — unlike Task 6 — naming the product and linking to the page is expected and normal here).

- [ ] **Step 2: Confirm scheduling** — verify both posts appear in the GHL scheduled-post queue for their assigned dates (per `social-planner`'s own verification steps).

---

## Self-Review Notes

- **Spec coverage:** Task 1 covers spec section A (backend); Task 2 covers section B (frontend); Task 3 covers section C (website) plus the FAQ/copy correction the design doc didn't explicitly call out but which follows directly from section A.2's exclusivity semantics; Tasks 6–7 cover section D (social), split per the owner's "organic drafts, no pitch" + "pitch only on FSA-owned channels" decision made after the design doc was written.
- **Type/shape consistency:** `already_used` response shape (`{ success: false, already_used: true, paper_code: '...' }`) is identical across Task 1's backend change and Task 2's frontend consumption of `data.paper_code`. `FOURTH_CLASS_PAPER`/`FOURTH_CLASS_CODES` naming: Task 1 reuses the existing `PAPERS_BY_CLASS`/`FOURTH_CLASS_CODES` from `papersForClass.js` (no new constant needed server-side beyond `VALID_CLASS_CODES`); Task 2 and Task 3 each define their own small local `fourth_a`/`fourth_b` → `4A`/`4B` map (`FOURTH_CLASS_PAPER`) since neither client-v2 nor the static site imports server config — intentional duplication of a 2-entry object, not worth sharing across a network boundary.
- **No placeholders** — every step has literal code/commands, not descriptions of code.
