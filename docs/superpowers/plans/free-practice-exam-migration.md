# Free Practice Exam — migrate practice-preview to client-v2/learn.*

## Context (read this before any task)

A lead magnet called "Practice Preview" already exists, live, at
`https://fsachat.fullsteamahead.ca?mode=practice_preview`, served by the
legacy `client/` (React v1) front end plus `server/src/routes/preview.js`
and `server/src/routes/exam.js` (both host-agnostic, unauthenticated) and
`ai-service/agents/orchestrator.py` (the real adaptive exam engine, driven
entirely through `POST /api/chat`). It already does: name+email opt-in,
class-aware paper picker (2nd: 2A1-2B3, 3rd: 3A1-3B2, self-healing via
`GET /api/preview/papers?class=`), 25/50-question single-paper timed exam,
chapter debrief with Strong/Developing/Needs Review + per-objective AI
teaching notes, results email, and a $149/month enrollment pitch baked into
the orchestrator's lead-magnet debrief prompt (`orchestrator.py:1265-1285`,
triggered by `examConfig.lead_magnet: true`).

It works today for one reason only: `PracticePreviewFlow.jsx` is served
from `fsachat.fullsteamahead.ca`, where `req.isPlatformMode` is `false`
(host-based, `server/src/index.js:68-71`), so `platformAuth`
(`index.js:88-91`) and `requireActiveSubscription` both no-op on
`/api/chat`. There is **no** `lead_magnet`-aware auth exemption anywhere —
the bypass is purely host-based and does not carry over if this flow is
served from `learn.fullsteamahead.ca` (client-v2's host), where
`isPlatformMode` is `true` and `/api/chat` would 401 any unauthenticated
caller via `requireAuth`.

**This plan migrates the flow to client-v2/`learn.*`** (retiring this one
piece of `client/` for real) and adds the parts that never existed:
a dedicated marketing landing page, affiliate-attribution + nurture-pipeline
wiring, a proper once-per-paper-ever gate enforced by 6-digit email
verification (replacing the current naive "any row in `question_responses`
for this email, any paper" check in `preview.js:32-39`), and
distractor-specific wrong-answer coaching layered onto the existing
per-objective teaching notes.

**Reused as-is, do not rebuild:**
- `GET /api/preview/papers?class=second|third` — already returns exactly
  the right class-aware, self-healing paper list. Call it directly.
- `GET /api/exam/:courseId/chapters` — already unauthenticated, used by the
  lobby for the locked-chapter list.
- The entire adaptive question-sampling/exam-state-machine/debrief engine in
  `ai-service/agents/researcher.py` + `orchestrator.py`, entered via
  `POST /agent/chat` (called from Node's `/api/chat`-shaped forwarding).
  It already keys everything off an email string + `course_id`, already
  writes `question_responses` with `session_type='practice_exam'` (already
  inside the live `question_responses_session_type_check` allowed set — no
  migration needed for that), and already returns a `display_update` object
  whose fields (`score`, `total`, `score_pct`, `chapter_stats`,
  `objective_breakdowns`, `next_attempt_allocation`, `question_review`) are
  a byte-for-byte match to client-v2's `ResultsPanel` prop contract
  (`client-v2/src/ExamRouter.jsx:120-122`). No translation layer needed.
- `server/src/services/gohighlevel.js`'s `upsertContact()` — NOT reused for
  this flow. Lead capture for this flow goes through the same
  `fsa-lead-capture` → GHL + affiliate + nurture pipeline everything else
  uses (a separate plan/repo), not fsa-agent's own direct GHL call. Do not
  add a second, competing GHL upsert in the new route.

**Genuinely new work (this plan):**
1. A `practice_exam_attempts` table + verification-code flow, replacing the
   naive email-only reuse check.
2. A token-gated proxy route (`/api/practice-exam/chat`) so the exam state
   machine works without a `platform_users` session, safely, on `learn.*`.
3. Distractor-specific coaching, added to the orchestrator's existing
   lead-magnet debrief branch.
4. New unauthenticated client-v2 route/page wiring the above together,
   reusing `ExamRouter`/`PracticeExamLobby`/`ResultsPanel`.
5. Lead-magnet UI behavior in `ResultsPanel`/`PracticeExamLobby` (enroll CTA,
   hide retake, locked chapters) — the vestigial `leadMagnetMode` prop on
   `PracticeExamLobby.jsx:9` currently does nothing but skip a fetch
   (line 26); it needs the rest of its intended behavior added.

## Global Constraints

- **Route path is `/free-practice-exam`, not `/practice-exam`.**
  `client-v2/src/App.jsx:102-109` already has an *authenticated*
  `<Route path="/practice-exam">` for paying students
  (`ProtectedRoute`-wrapped `PracticeExamPage`). Do not collide with it.
- **Never trust client-declared identity or correctness.** The token issued
  by `/verify-code` is the only source of truth for `email`/`classCode`/
  `paperCode` in every subsequent call. Question correctness is already
  computed server-side in `orchestrator.py` — nothing in this plan
  recomputes it in Node.
- **No changes to `/api/chat`, `chat.js`, `platformAuth`, or
  `requireActiveSubscription`.** The new lead-magnet flow gets its own
  route file and its own token-based middleware. Do not add a
  `lead_magnet`-flag-based exemption to the existing authenticated chat
  path — that would let any client self-declare `lead_magnet: true` in a
  request body to bypass subscription checks.
- **Do not touch `server/src/routes/diagnostic.js`, `preview.js`, or
  `client/` (legacy v1).** They keep serving live traffic at
  `fsachat.fullsteamahead.ca` until this migration is verified end-to-end;
  deprecating them is an explicit follow-up decision for the human owner,
  out of scope here.
- **Migration numbering:** next file is `server/migrations/015_*.sql`
  (last existing is `014_fourth_class_split.sql`). Follow the existing
  convention: prose comment block explaining why, referencing prior
  migrations, then plain DDL, no down-migration, no explicit transaction
  wrapper (matches `014_fourth_class_split.sql`'s style).
- **Env vars this plan introduces** (add to `/home/debian/.env`, document in
  wiki — do not hardcode secrets): `PRACTICE_EXAM_TOKEN_SECRET` (HMAC
  signing key, Node `crypto`), `LEAD_CAPTURE_URL` (base URL for
  `fsa-lead-capture`, e.g. `https://fsa-lead-capture.powerboot.workers.dev`),
  `LEAD_CAPTURE_SHARED_SECRET` (sent as `x-internal-secret` header to
  `fsa-lead-capture`'s new `/practice-exam` endpoint — this plan only
  *consumes* it from fsa-agent's side; a sibling plan in `fsa-lead-capture`
  defines the receiving end and the actual secret value gets set via
  `wrangler secret put` there, coordinate the same value).
- **Test/verify only against the public URL** (`https://learn.fullsteamahead.ca/...`)
  through Cloudflare, per repo convention — never `localhost`/container IP.
  Each task's implementer should still run whatever local/unit-level checks
  make sense (node syntax checks, `npm run build` for client-v2, python
  import checks for orchestrator changes); full live-endpoint verification
  happens after deploy, coordinated by the controller, not inside each task.

## Task 1 — `practice_exam_attempts` table + shared paper-list export

**Files:** `server/migrations/015_practice_exam_attempts.sql` (new),
`server/src/routes/preview.js` (small export addition only).

Create `server/migrations/015_practice_exam_attempts.sql`:

```sql
-- Free Practice Exam verification-gated attempts. Deliberately separate
-- from platform_users/subscriptions (see migration 006 auth tables) —
-- keeps free/unverified leads decoupled from the paying-student schema.
-- Replaces the naive "any question_responses row for this email" reuse
-- check in preview.js with a real once-per-(email,paper)-ever gate,
-- enforced by 6-digit email verification rather than a bare email field.

CREATE TABLE IF NOT EXISTS practice_exam_attempts (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  class_code VARCHAR(10) NOT NULL,
  paper_code VARCHAR(10) NOT NULL,
  verification_code VARCHAR(6) NOT NULL,
  code_expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (email, paper_code)
);

CREATE INDEX IF NOT EXISTS idx_practice_exam_attempts_email
  ON practice_exam_attempts (email);
```

In `server/src/routes/preview.js`, change the two `const PAPERS_SECOND = [...]`
/ `const PAPERS_THIRD = [...]` declarations (currently around line 68-69) so
they are also exported, without changing their values or any other
behavior in this file:

```js
module.exports = router;
module.exports.PAPERS_SECOND = PAPERS_SECOND;
module.exports.PAPERS_THIRD = PAPERS_THIRD;
```

(Node allows attaching extra properties to a function/object export like
this — `router` is a function, so `require('./preview')` still works
exactly as before for existing callers, and `require('./preview').PAPERS_SECOND`
becomes available for Task 2.)

Apply the migration against the live DB the same way prior migrations were
applied (`docker cp` + `docker exec fsa-postgres psql -U postgres -d fsa_agent -f ...`,
per repo convention in `/home/debian/CLAUDE.md`) and confirm the table
exists (`\d practice_exam_attempts`).

**Done when:** migration file exists and matches repo migration-file style;
applied successfully against `fsa-postgres`/`fsa_agent` with the unique
constraint and index confirmed via `\d practice_exam_attempts`; `preview.js`'s
existing `/signup`, `/papers`, `/send-results` routes still behave
identically (no regression — this is an additive export only).

## Task 2 — token signing + rate limiter utilities

**Files:** `server/src/services/practiceExamTokens.js` (new),
`server/src/utils/rateLimit.js` (new).

Create `server/src/utils/rateLimit.js` — port this verbatim (only the
module path/comment reference changes) from `fsa-affiliate-program`'s
`src/rateLimit.js`:

```js
// server/src/utils/rateLimit.js — simple in-memory sliding-window limiter,
// ported from fsa-affiliate-program's src/rateLimit.js. Fine at fsa-agent's
// scale (single Express process); not meant to survive a restart or work
// across replicas.

function createRateLimiter({ windowMs, max }) {
  const hits = new Map(); // key -> array of hit timestamps (ms)

  function pruneExpired(now) {
    for (const [key, timestamps] of hits) {
      const fresh = timestamps.filter((t) => now - t < windowMs);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  }

  function check(key) {
    const now = Date.now();
    const timestamps = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (timestamps.length >= max) {
      hits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    hits.set(key, timestamps);
    return true;
  }

  const sweepTimer = setInterval(() => pruneExpired(Date.now()), windowMs);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

  return { check };
}

module.exports = { createRateLimiter };
```

Create `server/src/services/practiceExamTokens.js` — HMAC-SHA256 token
sign/verify with an embedded expiry (extends the pattern in
`fsa-nurture/lib/tokens.js`, which has no expiry; this needs one since the
token scopes access to a specific paid-feature-adjacent flow for up to a
few hours):

```js
const crypto = require('crypto');

const SECRET = process.env.PRACTICE_EXAM_TOKEN_SECRET;
if (!SECRET) {
  throw new Error('PRACTICE_EXAM_TOKEN_SECRET is not set');
}

function toBase64Url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + padding, 'base64');
}

// ttlMs defaults to 3 hours — enough for a 50-question timed exam plus
// some slack, short enough that a leaked token isn't a long-lived credential.
function sign({ email, classCode, paperCode }, ttlMs = 3 * 60 * 60 * 1000) {
  const payload = JSON.stringify({ email, classCode, paperCode, exp: Date.now() + ttlMs });
  const payloadBuf = Buffer.from(payload, 'utf8');
  const sig = crypto.createHmac('sha256', SECRET).update(payloadBuf).digest();
  return `${toBase64Url(payloadBuf)}.${toBase64Url(sig)}`;
}

function verify(token) {
  try {
    const [payloadPart, sigPart] = String(token).split('.');
    if (!payloadPart || !sigPart) return null;
    const payloadBuf = fromBase64Url(payloadPart);
    const providedSig = fromBase64Url(sigPart);
    const expectedSig = crypto.createHmac('sha256', SECRET).update(payloadBuf).digest();
    if (providedSig.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(expectedSig, providedSig)) return null;
    const parsed = JSON.parse(payloadBuf.toString('utf8'));
    if (!parsed.email || !parsed.classCode || !parsed.paperCode || !parsed.exp) return null;
    if (Date.now() > parsed.exp) return null;
    return parsed; // { email, classCode, paperCode, exp }
  } catch {
    return null;
  }
}

module.exports = { sign, verify };
```

**Done when:** both files exist, `node -e "require('./server/src/services/practiceExamTokens.js')"`
fails cleanly with the "not set" error when `PRACTICE_EXAM_TOKEN_SECRET` is
unset (confirms the guard works) and succeeds when it is set; a short
inline sign→verify round-trip (write a throwaway script, run it, delete it —
do not leave test scripts in the repo) confirms a valid token verifies and
returns the original payload, an expired token (`ttlMs: -1000`) returns
`null`, and a tampered token (flip one character in the signature part)
returns `null`.

## Task 3 — `sendPracticeExamCode` email

**Files:** `server/src/services/email.js`.

Add a new function following the exact shape/conventions of the existing
`sendPasswordReset` (same file, transporter already defined at the top of
the file, `FROM` and blue-button style already established):

```js
async function sendPracticeExamCode(email, firstName, code) {
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `Your Full Steam Ahead verification code: ${code}`,
    html: `<p>Hi ${firstName},</p><p>Your verification code for your free practice exam is:</p><p style="font-size:32px;font-weight:700;letter-spacing:0.1em;color:#1d4ed8;">${code}</p><p>Enter this code to start your exam. This code expires in 10 minutes.</p><p>If you didn't request this, ignore this email.</p>`,
    text: `Hi ${firstName},\n\nYour verification code is: ${code}\n\nThis code expires in 10 minutes.`,
  });
}
```

Add `sendPracticeExamCode` to the file's existing `module.exports` object
(alongside `sendMagicLink`, `sendPasswordReset`, `sendDeactivationReview`,
`sendOpsEmail`).

**Done when:** function added, exported, matches the existing file's style
(same transporter, same `FROM`, same inline-button-blue `#1d4ed8` accent
color used for the code, no new dependencies). Do not send a real test
email as part of this task — that happens during the controller's
end-to-end verification pass after everything is wired together.

## Task 4 — `server/src/routes/practiceExam.js` + mount it

**Files:** `server/src/routes/practiceExam.js` (new), `server/src/index.js`
(mount only).

This is the core new route file. Depends on Tasks 1-3 (the table, the
token service, the rate limiter, the email function) — read those files
before starting if resuming after a context reset.

Read `server/src/routes/chat.js` first (small file) to match its axios
call shape to the Python service exactly — this route's `/chat` proxy must
forward to the same `PYTHON_SERVICE_URL`/`/agent/chat` endpoint the same
way.

Implement four routes on an `express.Router()`:

### `POST /request-code`
Body: `{ firstName, email, classCode, paperCode, affiliateCode? }`.

1. Validate: `firstName` non-empty (trim, max 100 chars like `preview.js`'s
   `cleanName` pattern), `email` matches
   `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` (same regex `preview.js` uses),
   `classCode` is `'second'` or `'third'`, `paperCode` is a member of
   `require('./preview').PAPERS_SECOND` or `.PAPERS_THIRD` matching
   `classCode` (import from `./preview` per Task 1's export). Reject with
   400 + a plain `{ error: '...' }` message on any failure, mirroring
   `preview.js`'s validation style.
2. Rate-limit: construct a module-level
   `const requestCodeLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 })`
   at the top of the file (5 requests per 15 minutes per key). Key:
   `` `${req.ip}:${email.toLowerCase()}` ``. On limit hit, respond
   `429 { error: 'Too many requests, try again later.' }` exactly like the
   `fsa-affiliate-program` precedent.
3. Look up existing row: `SELECT completed_at FROM practice_exam_attempts WHERE email = $1 AND paper_code = $2`.
   - If a row exists and `completed_at IS NOT NULL`: respond
     `200 { success: false, already_used: true }` (same shape
     `preview.js:38` already uses, so the client can reuse its existing
     `already_used` branch/copy) — the plan's "friendly message pointing at
     the subscription CTA instead of a generic error" is a client-side
     concern (Task 8), not this route's job.
   - Otherwise (no row, or a row with `completed_at IS NULL` — e.g. an
     abandoned prior attempt on this paper): generate a 6-digit code via
     `crypto.randomInt(100000, 1000000)` (zero-padding not needed, range
     guarantees 6 digits), `code_expires_at = now + 10 minutes`, and
     `INSERT ... ON CONFLICT (email, paper_code) DO UPDATE SET
     verification_code = EXCLUDED.verification_code,
     code_expires_at = EXCLUDED.code_expires_at,
     first_name = EXCLUDED.first_name,
     class_code = EXCLUDED.class_code,
     verified_at = NULL` (resets verification on a fresh code request, but
     never touches `completed_at`, which the `ON CONFLICT` clause simply
     doesn't list — the unique constraint from Task 1 is exactly
     `(email, paper_code)`).
4. Send the code: `await sendPracticeExamCode(email, cleanFirstName, code)`
   from `../services/email.js`. If this throws, respond
   `500 { error: 'Failed to send verification code' }` and log the error —
   do not leave the row silently un-emailed with no client feedback.
5. Fire-and-forget lead capture (do not `await`, do not let it affect the
   response): `POST ${process.env.LEAD_CAPTURE_URL}/practice-exam` via
   `fetch`, headers `{ 'Content-Type': 'application/json', 'x-internal-secret': process.env.LEAD_CAPTURE_SHARED_SECRET }`,
   body `{ email, firstName: cleanFirstName, affiliateCode: affiliateCode || '', classCode, paperCode }`.
   Wrap in `.catch(err => console.error('practice-exam lead-capture error:', err.message))`
   — this endpoint doesn't exist yet (built in a sibling plan in
   `fsa-lead-capture`); a failure here must never block or fail the
   verification-code flow.
6. Respond `200 { success: true }`.

### `POST /verify-code`
Body: `{ email, paperCode, code }`.

1. Rate-limit similarly: separate limiter instance,
   `createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 })`, same key
   pattern.
2. `SELECT * FROM practice_exam_attempts WHERE email = $1 AND paper_code = $2`.
   - No row → `400 { error: 'No verification code found for this email and paper. Request a new one.' }`.
   - `code_expires_at < NOW()` → `400 { error: 'This code has expired. Request a new one.' }`.
   - `verification_code !== code` (string compare, trim input) →
     `400 { error: 'Incorrect code.' }`.
   - `completed_at IS NOT NULL` → `200 { success: false, already_used: true }`
     (defensive — shouldn't normally be reachable since `request-code`
     already gates this, but a stale open tab could hit this race).
3. On success: `UPDATE practice_exam_attempts SET verified_at = NOW() WHERE id = $1`,
   then issue a token: `practiceExamTokens.sign({ email, classCode: row.class_code, paperCode })`.
4. Respond `200 { success: true, token, firstName: row.first_name }`.

### `POST /chat`
Body: `{ message }`. Header: `Authorization: Bearer <token>`.

1. Extract token from the `Authorization` header (`Bearer <token>` —
   reject `401 { error: 'Missing or invalid token' }` if absent/malformed).
2. `const claims = practiceExamTokens.verify(token)`; `401` with the same
   message if `null`.
3. `SELECT verified_at, completed_at, first_name FROM practice_exam_attempts WHERE email = $1 AND paper_code = $2`
   using `claims.email`/`claims.paperCode`. If no row, or `verified_at IS NULL`,
   or `completed_at IS NOT NULL` → `403 { error: 'This practice exam session is no longer valid.' }`.
4. Forward to the Python service exactly like `chat.js` does, but with
   identity forced from the verified claims, never from the request body:
   ```js
   const axios = require('axios'); // match chat.js's import style
   const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL;
   const payload = {
     user: claims.email,
     lessonId: claims.paperCode,
     message: req.body.message,
     examConfig: { lead_magnet: true, first_name: row.first_name },
   };
   const response = await axios.post(`${PYTHON_SERVICE_URL}/agent/chat`, payload);
   res.json(response.data);
   ```
   Note `examConfig` is only meaningful on the first ("hello") call per the
   existing v1 flow's behavior (`App.jsx:415-423` sends it once, subsequent
   turns omit it) — sending it on every call here is harmless (the
   orchestrator only reads it at session init, per the research: state is
   set once and `examConfig` is otherwise ignored on later turns), so
   always including it is simpler and cannot cause harm; do not add
   conditional logic to omit it on later calls.
5. On any axios error, respond `502 { error: 'AI service error' }` and log
   it (mirror `chat.js`'s error handling style if it has any; if it has
   none, add a minimal try/catch — do not let an unhandled rejection crash
   the process).

### `POST /complete`
Body: none required. Header: `Authorization: Bearer <token>`.

1. Verify token same as `/chat`.
2. `UPDATE practice_exam_attempts SET completed_at = NOW() WHERE email = $1 AND paper_code = $2 AND completed_at IS NULL`
   (idempotent — a second call is a harmless no-op, do not error on it).
3. Respond `200 { success: true }`.

### Mounting
In `server/src/index.js`, near the existing `previewRouter`/`examRouter`
mounts (around line 118-119), add:
```js
const practiceExamRouter = require('./routes/practiceExam');
app.use('/api/practice-exam', practiceExamRouter);
```
No `platformAuth`/`requireActiveSubscription` — this route file is
self-contained and does its own auth via the bearer token, exactly as
designed above. Do not add any global middleware to this mount that isn't
already applied to all of `/api/*` (e.g. the existing `app.use('/api', limiter)`
rate limiter and `express.json()` still apply automatically; nothing
route-specific needed here beyond what the route handlers do themselves).

**Done when:** the file exists with all four routes; `server/src/index.js`
mounts it; the API container's dependency graph is sound (`node -c
server/src/routes/practiceExam.js` or equivalent syntax check passes,
`require`s resolve — check for a missing `axios`/`pg` import the file
might need that isn't already a project dependency, e.g. confirm `axios`
is already in `server/package.json` since `chat.js` uses it). Do not deploy
or restart the live container as part of this task — that happens once the
whole fsa-agent plan is complete, coordinated by the controller.

## Task 5 — orchestrator distractor coaching

**Files:** `ai-service/agents/orchestrator.py`.

Read `_call_llm_for_teaching_tips` (around line 1036-1080) and
`_generate_exam_debrief`'s lead-magnet branch (around line 1265-1299)
before starting — this task extends both, following their exact
conventions (batched single OpenRouter call via `requests.Session()`,
`raise_for_status()`, try/except → graceful empty-result fallback, using
`self._api_key`/`self._model`/`self._base_url` already set in `__init__`).

Add a new method, sibling to `_call_llm_for_teaching_tips`:

```python
def _call_llm_for_distractor_coaching(self, prompt, expected_count):
    """
    Single batched LLM call returning distractor-trap coaching for wrong
    answers on a lead-magnet exam. Returns dict {1: 'coaching text', ...}.
    Falls back to empty dict on any error.
    """
    if not self._api_key or expected_count == 0:
        return {}
    try:
        session = requests.Session()
        session.headers.update({
            'Authorization': f'Bearer {self._api_key}',
            'Content-Type': 'application/json',
        })
        response = session.post(
            f'{self._base_url}/chat/completions',
            json={
                'model': self._model,
                'max_tokens': max(150, 100 * expected_count),
                'messages': [
                    {'role': 'system', 'content': 'You are an expert 2nd Class Power Engineering instructor explaining why a wrong multiple-choice answer looked tempting.'},
                    {'role': 'user', 'content': prompt},
                ],
            },
            timeout=30,
        )
        response.raise_for_status()
        content = response.json()['choices'][0]['message']['content'].strip()
        tips = {}
        pattern = re.compile(r'^\s*(\d+)\.\s+(.+?)(?=^\s*\d+\.|\Z)', re.MULTILINE | re.DOTALL)
        for m in pattern.finditer(content):
            tips[int(m.group(1))] = m.group(2).strip()
        return tips
    except Exception as e:
        print(f'Orchestrator._call_llm_for_distractor_coaching error: {e}')
        return {}
```

In `_generate_exam_debrief`'s lead-magnet branch (the `if exam_lead_magnet:`
block around line 1265), after the existing teaching-tips logic runs and
`question_review` is available in scope (it's already built earlier in the
same method per the researched `display_update` construction around
line 1339-1349 — find where `question_review` is assembled, this addition
must run before `display_update` is constructed so the new field can be
included in it), add:

```python
wrong_reviews = [q for q in question_review if not q.get('correct')]
distractor_coaching = {}
if wrong_reviews and exam_lead_magnet:
    numbered_lines = []
    for i, q in enumerate(wrong_reviews, 1):
        options = q.get('options') or []
        selected_idx = q.get('selected_index')
        correct_idx = q.get('correct_index')
        selected_text = options[selected_idx] if selected_idx is not None and selected_idx < len(options) else 'unknown'
        correct_text = options[correct_idx] if correct_idx is not None and correct_idx < len(options) else 'unknown'
        explanation = q.get('explanation') or 'No additional context available.'
        numbered_lines.append(
            f"{i}. Question: {q.get('question_text', '')}\n"
            f"   Student picked: \"{selected_text}\" (wrong)\n"
            f"   Correct answer: \"{correct_text}\"\n"
            f"   Explanation: {explanation}"
        )
    batch_prompt = (
        "A student took a free practice exam and got these questions wrong. "
        "For each, write a 1-2 sentence note explaining why the wrong option "
        "they picked is a common trap or misconception — not just restating "
        "the correct answer, but naming the specific misunderstanding that "
        "makes the wrong option tempting.\n\n"
        + '\n\n'.join(numbered_lines)
    )
    raw_coaching = self._call_llm_for_distractor_coaching(batch_prompt, len(wrong_reviews))
    # Re-key from 1-based batch index back to the wrong question's original
    # position/id so the client can match coaching text to the right card.
    for i, q in enumerate(wrong_reviews, 1):
        if i in raw_coaching:
            key = q.get('id') or q.get('question_text')
            distractor_coaching[key] = raw_coaching[i]
```

Add `'distractor_coaching': distractor_coaching` to the `display_update`
dict literal (alongside the existing `'objective_breakdowns':
objective_breakdowns` etc. — find the exact dict construction near
line 1339-1349 and add this one key). Use whatever key each `question_review`
entry already carries to identify a question (check the actual dict shape
built earlier in the method — the research found `question_review` entries
as `{question_text, options, correct_index, selected_index, correct,
explanation}` with no explicit `id` shown, so keying by `question_text`
is the safe default unless you find a question id already present in
scope — check before assuming). On the empty-dict/failure path,
`distractor_coaching` stays `{}` and the client should treat that as "no
panel to render" (this is the client's job in Task 8, not this task's).

Guard this whole block so it **only** runs when `exam_lead_magnet` is
`True` — paying students never get this LLM call or field (matches the
existing teaching-tips lead-magnet/non-lead-magnet branch structure).

**Done when:** the new method and the wiring exist; `python3 -c "import ast; ast.parse(open('ai-service/agents/orchestrator.py').read())"`
(or equivalent) confirms no syntax errors; a manual read confirms the
non-lead-magnet debrief path is completely untouched (no new fields, no
new LLM calls) and the lead-magnet path's existing teaching-tips behavior
is unchanged (only additive). Do not restart the ai-service container as
part of this task.

## Task 6 — client-v2: lead-magnet chat endpoint + token support in ExamRouter

**Files:** `client-v2/src/ExamRouter.jsx`.

Read the full `ExamRouter` component (`client-v2/src/ExamRouter.jsx`,
~800+ lines) before starting, focusing on: the `POST /api/chat` call sites
(`QuizExamChatSection`, the exam-init "hello" call, and each answer-submit
call — there are multiple fetch call sites hitting `/api/chat`, not just
one), the `ExamRouter` component's top-level prop signature
(`export function ExamRouter({ courseId, learnerId, classCode,
initialConfig, onExit, onComplete })`), and `ResultsPanel`'s signature
(`export function ResultsPanel({ displayContent, isExam, onRetry,
onSelectChapter, user })`).

Add two new optional props to `ExamRouter`: `leadMagnetToken` (string,
the bearer token from `/verify-code`) and `onExamDone` (callback, fired
once when `display_update.type === 'exam_done'` is first received — Task 8
uses this to call `/api/practice-exam/complete`).

Everywhere the component currently does
`fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({...}) })`,
change it so that when `leadMagnetToken` is present, it instead does:
```js
fetch('/api/practice-exam/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${leadMagnetToken}`,
  },
  body: JSON.stringify({ message: userMessage }), // no user/lessonId/examConfig — the server derives these from the token
})
```
When `leadMagnetToken` is absent (the existing authenticated-student path),
behavior must be byte-for-byte unchanged from today — do not alter the
existing `/api/chat` call shape, headers, or body for that path. The
cleanest way to do this without duplicating every call site is a small
local helper near the top of the component, e.g.:
```js
function postChatMessage(message, { leadMagnetToken, user, lessonId, examConfig }) {
  if (leadMagnetToken) {
    return fetch('/api/practice-exam/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${leadMagnetToken}` },
      body: JSON.stringify({ message }),
    });
  }
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, lessonId, message, ...(examConfig ? { examConfig } : {}) }),
  });
}
```
then replace each existing call site with a call to this helper, passing
through whatever `user`/`lessonId`/`examConfig` that call site already
computes today (do not change what gets computed, only how it's sent).
Find every call site via `grep -n "'/api/chat'" client-v2/src/ExamRouter.jsx`
first — the research identified at least the init/"hello" call and the
per-answer call inside what's referred to as `QuizExamChatSection`; verify
there are no others before finishing.

Wire `onExamDone`: find where the component currently detects
`display_update.type === 'exam_done'` (this is also where `ResultsPanel`
gets rendered, per the research at `ExamRouter.jsx:244-252`) and, if
`onExamDone` is provided and hasn't already fired for this session, call
it once (guard with a ref or state flag so it can't double-fire on a
re-render).

**Done when:** `cd client-v2 && npm run build` succeeds with no new errors;
every `/api/chat` call site in this file is confirmed (via the grep above,
paste the grep output in the task report) to be routed through the new
helper; a manual read confirms the non-lead-magnet path's request shape is
unchanged.

## Task 7 — client-v2: lead-magnet UI in ResultsPanel + PracticeExamLobby

**Files:** `client-v2/src/ExamRouter.jsx` (contains `ResultsPanel`),
`client-v2/src/components/PracticeExamLobby.jsx`, new file
`client-v2/src/components/DistractorCoaching.jsx`.

Depends on Task 6 landing first (same file, avoid merge conflicts — if
dispatched out of order, coordinate by reading Task 6's actual diff before
starting).

**`ResultsPanel`:** add a `leadMagnetMode` boolean prop (default `false`).
When `true`:
- Do not render whatever button/handler currently lets a student retake
  the exam or return to the lobby with saved progress (`onRetry`) — this
  flow has no lobby to return to in the authenticated sense. Instead render
  a subscription CTA block: a prominent link/button to
  `https://enrollment.fullsteamahead.ca`, copy along the lines of "Ready
  for unlimited practice exams across every paper? Subscribe for $149/month."
  (match the tone of the existing orchestrator lead-magnet debrief prompt —
  don't invent new pricing or terms).
- Render a new `<DistractorCoaching />` panel (see below) when
  `displayContent.distractor_coaching` is a non-empty object, placed near
  the existing `question_review`/`TeachingNotes` rendering — after the
  chapter-stats table, alongside or below `TeachingNotes` if
  `objective_breakdowns` is also present. If `distractor_coaching` is
  empty/absent, render nothing extra (no empty panel, no placeholder).

Create `client-v2/src/components/DistractorCoaching.jsx`:
```jsx
export function DistractorCoaching({ coaching, questionReview }) {
  const entries = Object.entries(coaching || {});
  if (entries.length === 0) return null;
  return (
    <div className="distractor-coaching">
      <h3 className="distractor-coaching-title">Watch out for these traps</h3>
      {entries.map(([key, text]) => (
        <div key={key} className="distractor-coaching-item">
          <p className="distractor-coaching-question">{key}</p>
          <p className="distractor-coaching-text">{text}</p>
        </div>
      ))}
    </div>
  );
}
```
This matches the key produced by Task 5's Python change (keyed by
`question_text` unless Task 5's implementer found a real id in scope — if
so, use whatever key Task 5 actually used; check its report). Add minimal
co-located CSS following the mobile/PWA styling rule already documented in
this repo's `CLAUDE.md` ("co-located `*.css` files... do not add new JS
inline-style objects for layout") — add a small `DistractorCoaching.css`
import if the component needs layout styling beyond what's inherited, or
inline only non-layout accent styling if trivial (a colored left-border on
`.distractor-coaching-item`, matching the amber/red accent conventions
used elsewhere in `ExamRouter.jsx`'s results styling — check the existing
`results-row--weak` class for the color to match).

**`PracticeExamLobby`:** the `leadMagnetMode` prop already exists
(`client-v2/src/components/PracticeExamLobby.jsx:9`) and already skips the
last-results fetch (line 26). Extend it: when `leadMagnetMode` is `true`,
render the chapter-quiz option buttons in a visibly locked/disabled state
(add a 🔒 indicator and `disabled`/non-interactive styling — do not remove
them entirely, the point is to show what members get, matching the
existing live v1 behavior described in the practice-preview docs) instead
of whatever normal enabled behavior they have today. Do not change any
other `leadMagnetMode === false` behavior in this file.

**Done when:** `npm run build` succeeds; a manual read confirms
`leadMagnetMode=false` (the default, used by every existing caller) is
completely behaviorally unchanged in both files; the new component exists
and is exported in a way Task 8 can import it if needed (it's used from
within `ExamRouter.jsx`, so a plain named export is sufficient, no barrel
file needed unless one already exists — check first).

## Task 8 — client-v2: `FreePracticeExamPage` + route

**Files:** `client-v2/src/pages/FreePracticeExamPage.jsx` (new),
`client-v2/src/App.jsx` (route registration only).

Depends on Tasks 6 and 7. Read `client-v2/src/pages/JobsCapturePage.jsx`
first — it's the existing precedent for an unauthenticated route with its
own manual state machine (`App.jsx:85`, `<Route path="/jobs/capture"
element={<JobsCapturePage />} />`, no `<ProtectedRoute>` wrapper). Also
read `client-v2/src/pages/PracticeExamPage.jsx` (the *authenticated*
`/practice-exam` page) for how it currently wires `ExamRouter` — this new
page does the same wiring but for the lead-magnet path.

Build `FreePracticeExamPage.jsx` as a local state machine with phases:
`'picker' | 'signup' | 'verify' | 'exam'`.

1. On mount, read `?class=`, `?paper=`, `?am_id=` from the URL
   (`useSearchParams` or equivalent, matching whatever router hook the
   rest of client-v2 already uses — check `PracticeExamPage.jsx` for the
   pattern). If both `class` and `paper` are present and valid (call
   `GET /api/preview/papers?class=` to confirm `paper` is actually in the
   returned list — reuse this existing endpoint directly, no new one),
   skip straight to `'signup'` phase with those pre-selected. Otherwise
   start at `'picker'` phase: a simple class toggle (2nd/3rd) then a paper
   button grid (fetch `GET /api/preview/papers?class=` on toggle change,
   same as the picker step in `PracticePreviewFlow.jsx`), advancing to
   `'signup'` once both are chosen.
2. `'signup'` phase: first name + email form. On submit,
   `POST /api/practice-exam/request-code` with `{ firstName, email, classCode, paperCode, affiliateCode: am_id || '' }`.
   - `{ success: true }` → advance to `'verify'`.
   - `{ success: false, already_used: true }` → show the friendly
     already-used message with a link to `https://enrollment.fullsteamahead.ca`
     (the plan's "friendly message pointing at the subscription CTA"),
     stay on this phase (don't advance).
   - Any error response → show the error message inline, stay on this
     phase.
3. `'verify'` phase: single 6-digit code input + a "resend code" link
   (resend = re-call `request-code` with the same stored values). On
   submit, `POST /api/practice-exam/verify-code` with
   `{ email, paperCode, code }`.
   - `{ success: true, token, firstName }` → store `token` in component
     state (not `localStorage` — this is a short-lived, single-session
     credential, unlike `fsa_user`), advance to `'exam'`.
   - `{ success: false, already_used: true }` → same friendly message as
     above.
   - Error → show inline, stay on this phase.
4. `'exam'` phase: render `<ExamRouter courseId={paperCode} learnerId={email}
   classCode={classCode} leadMagnetToken={token}
   initialConfig={{ count: /* whatever default the lobby offers */ }}
   onExamDone={() => { fetch('/api/practice-exam/complete', { method: 'POST', headers: { Authorization: \`Bearer ${token}\` } }).catch(() => {}); }}
   onExit={() => setPhase('picker')} onComplete={() => {}} />`
   — check `ExamRouter`'s actual prop names/behavior from Tasks 6-7's
   final state before wiring this (they may have settled on slightly
   different names than assumed here; match what was actually built, don't
   guess). The `PracticeExamLobby` rendered inside `ExamRouter` needs
   `leadMagnetMode={true}` passed through — confirm `ExamRouter` forwards
   this down (check its render of `<PracticeExamLobby>` around line 711;
   if it doesn't currently accept/forward a `leadMagnetMode` prop from its
   own caller, that's a gap Task 6 or 7 should have closed — verify before
   assuming, and if genuinely missing, this task should add the one-line
   forward since it's the first caller that needs it).

Register the route in `client-v2/src/App.jsx`, no `<ProtectedRoute>`
wrapper, matching the `/jobs/capture` precedent exactly:
```jsx
<Route path="/free-practice-exam" element={<FreePracticeExamPage />} />
```

**Done when:** `npm run build` succeeds; a manual walkthrough of the state
machine logic (read-through, not a live browser test — that's the
controller's end-to-end verification pass later) confirms every phase
transition matches the spec above; the route is registered without a
`ProtectedRoute` wrapper; confirm (grep) this new route path
`/free-practice-exam` does not collide with the existing authenticated
`/practice-exam` route.

## Task 9 — wiki correction

**Files:** `/home/debian/wiki/projects/fsa-agent.md`,
`/home/debian/wiki/log.md` (append only, per repo convention).

Two of this wiki page's existing claims are stale and should be corrected
as part of this migration, not left to rot further:

1. The claim that `fsachat.fullsteamahead.ca`/`client/` "carries no live
   traffic" (appears at minimum at the lines the earlier research found:
   "the `fsachat.*` / client-v1 path remains wired in code, but it carries
   no live traffic") was already inaccurate before this plan (the
   practice-preview lead magnet has live traffic and was actively
   developed through 2026-06-15) and becomes fully resolved once this
   plan's migration is live and the old `client/` practice-preview flow is
   formally deprecated. Update the wording once this plan's work is
   deployed and verified (coordinate with the controller on timing — this
   task's edit should reflect the *end state*, so hold it until Tasks 1-8
   are deployed, or write it now describing the migration as in-progress
   if deploy timing is uncertain — use judgment, note which you did in the
   task report).
2. Add a new subsection (near the existing "Practice Preview Lead Magnet"
   section the research found around line 360) documenting the new
   `/free-practice-exam` flow: its route, the four new
   `/api/practice-exam/*` endpoints, the `practice_exam_attempts` table,
   and the fact that it supersedes the old `?mode=practice_preview` flow
   (state clearly whether the old flow was left running or removed, based
   on what actually happened by the time this task runs).

Append a `## [YYYY-MM-DD] feat | ...` line to `wiki/log.md` summarizing the
migration, per this repo's standard wiki-maintenance convention (see the
root `/home/debian/CLAUDE.md`).

**Done when:** both files are updated, no other wiki pages are touched,
the log.md append follows the existing format (check the last few entries
for exact style before writing the new one).
