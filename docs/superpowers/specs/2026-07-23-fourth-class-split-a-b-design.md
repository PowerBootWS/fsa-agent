# Split 4th Class into Two Independently-Purchasable Products (4A / 4B)

**Date:** 2026-07-23
**Status:** Approved, implementing
**Repo touched:** `fsa-agent` (`server`, `client-v2`) — `ai-service` and `fsa-webhook-listener` are unaffected/out of scope, see below.

## Problem

The 4th Class feature (already built and deployed in this branch) sells access to both
`4A` and `4B` as a single bundled product, `class_code='fourth'`. The owner wants to sell
them as two separate annual subscriptions instead — a student can buy just `4A`, just
`4B`, or both (via two separate purchases at different times). This requires a student
to be able to hold two simultaneously-active subscriptions for the first time in this
platform's history — every other product (`second`, `third`, and the original bundled
`fourth`) is mutually exclusive with everything else, enforced by a database constraint
built earlier in this same branch specifically to guarantee "exactly one active
subscription per user."

## Goals

1. Two independently-purchasable products, `class_code='fourth_a'` and `'fourth_b'`,
   each an annual subscription (same commercial pattern as the original combined
   `'fourth'` design: `cancel_at_period_end` set immediately post-checkout so it runs
   one paid year and never auto-renews — this part doesn't change, just applied to two
   products instead of one).
2. A student can hold `fourth_a` and `fourth_b` active at the same time (bought
   separately, in either order) — this is the one new case the data model has to support.
3. A student can still never hold a 4th Class paper alongside a 2nd/3rd Class
   subscription (`second`/`third`) — that mutual exclusivity is unchanged.
4. The 4th Class lobby shows only the paper(s) a student actually owns — one card if
   they bought one, two if they bought both.
5. **Minimal blast radius.** The rest of the app (2nd/3rd Class, `requireAuth`, every
   route that isn't 4th-Class-specific) keeps assuming "one subscription drives one
   `class_code`" exactly as it does today. The "can hold two at once" case is handled
   entirely inside the one endpoint that already does its own direct query
   (`quiz-lobby-data`) rather than by making the whole app multi-subscription-aware.

## Non-goals

- Redesigning the Stripe/webhook-listener side. That work was scoped in an earlier
  design (`docs/superpowers/specs/2026-07-13-fourth-class-platform-integration-design.md`
  §2) for a single combined `'fourth'` product and was never built. It needs revising for
  two products instead of one, but that's a separate, later piece of work — this spec is
  entirely about the `fsa-agent` platform side (data model, auth gating, the lobby).
- Any change to 2nd/3rd Class's subscription model, mutual-exclusivity behavior, or the
  general assumption (everywhere except the one 4th-Class-specific endpoint) that a user
  has at most one active `class_code`.
- Migrating any existing `class_code='fourth'` data — 4th Class hasn't launched/sold yet,
  so the only `'fourth'` row in the database is the test account used throughout this
  branch's development, which gets updated directly (not via a migration script) once
  this ships.

## Part A — Data model (`server/`)

### Migration

Replace the existing `subscriptions_one_active_per_user` unique index (built earlier in
this branch: `UNIQUE (user_id) WHERE status='active'`) with one scoped to
`(user_id, class_code)`:

```sql
DROP INDEX IF EXISTS subscriptions_one_active_per_user;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_active_per_user_class
  ON subscriptions (user_id, class_code) WHERE status = 'active';
```

This alone stops a duplicate purchase of the *same* paper from creating two rows, but no
longer blocks `fourth_a` + `fourth_b` from coexisting (different `class_code` values).
It does **not**, by itself, stop a `second`/`third` subscription from coexisting with a
`fourth_a`/`fourth_b` one — that cross-tier exclusivity has to live in application code
(see below), because "these two specific values are mutually exclusive with each other
and with everything else, but not with one another" isn't expressible as a single
partial unique index.

### `provision-user` guard (`server/src/routes/platform.js`)

Today's guard (already broadened once in this branch, from Task 1 of the original 4th
Class plan) blocks a new active subscription if the user has *any* active row at all,
full stop. The new logic:

- Buying `second` or `third`: blocked if the user has **any** active subscription row of
  **any** `class_code` — unchanged from today.
- Buying `fourth_a` or `fourth_b`: blocked if the user already has an active row with
  that **exact same** `class_code` (duplicate/idempotent-retry protection, same as
  today's semantics just narrowed to match), **or** has an active `second`/`third` row
  (cross-tier exclusion). **Not** blocked by already having the *other* `fourth_x` code
  active — that's the one case that's now allowed.

Read the current active `class_code`s for the user first, then decide in application
code whether the insert is allowed — clearer to write and test than one large
conditional SQL `WHERE NOT EXISTS` clause, and this is exactly the kind of branching
logic that's easy to get subtly wrong in raw SQL. Exact implementation is a plan-stage
decision; the required behavior is what's specified above.

## Part B — Lobby endpoint (`server/src/routes/platform.js`, `GET /api/platform/quiz-lobby-data`)

Today this endpoint checks `class_code !== 'fourth'` for its entry gate, then always
builds a response for both `4A` and `4B` (`PAPERS_BY_CLASS.fourth`, a fixed two-element
array). Both parts change:

- **Entry gate**: `class_code` must be `'fourth_a'` or `'fourth_b'` (i.e., "some flavor
  of 4th Class"), not literally `'fourth'` (that value stops being issued at all once
  this ships).
- **Which papers to build**: query the user's own active subscriptions directly
  (`SELECT class_code FROM subscriptions WHERE user_id = $1 AND status = 'active' AND
  class_code IN ('fourth_a', 'fourth_b')`) and build the response only for the paper(s)
  corresponding to the class_codes found — `4A` for `fourth_a`, `4B` for `fourth_b`. A
  student who owns only one gets a `papers` object with one key; a student who owns both
  gets two, exactly as today.

`requireAuth`'s single-row-per-user assumption (used everywhere else in the app) is
deliberately **not** touched — it will pick *one* of the user's active rows arbitrarily
if they happen to have two, and that's fine, because nothing outside this one endpoint
needs to know about the second one. This endpoint is the only place that queries
`subscriptions` directly rather than trusting `req.user.class_code`.

**`QuizOnlyLobbyPage.jsx` needs no changes at all** — it already renders
`Object.entries(data.papers).map(...)`, so it already handles one or two entries
correctly; the only work is making the *endpoint* return the right set.

## Part C — "Is this a 4th Class user" checks (mechanical, ~6 files)

Every place that currently checks `class_code === 'fourth'` needs to recognize both new
values instead. Search for the literal string `'fourth'` across `client-v2/src` and
`server/src` to find them all — as of this spec, the known call sites are:

- `client-v2/src/App.jsx` (`LobbyRoute` — routes to `QuizOnlyLobbyPage` vs `LobbyPage`)
- `client-v2/src/components/ProtectedRoute.jsx` (the `active_paper` requirement carve-out)
- `client-v2/src/pages/LoginPage.jsx`, `SetupPage.jsx`, `SignupPage.jsx` (post-auth
  routing straight to `/lobby`)
- `client-v2/src/ExamRouter.jsx` (`isFourthClass` — hides the AI tutor during practice
  exams, keeps it during chapter quizzes)
- `client-v2/src/pages/ExamResultsPage.jsx` (same tutor-hiding gate, standalone page)
- `server/src/routes/platform.js` (`quiz-lobby-data`'s entry gate, Part B above)

Each becomes a check against a small constant set (e.g. `FOURTH_CLASS_CODES =
['fourth_a', 'fourth_b']`, one shared definition per language/runtime — don't duplicate
the literal array in six places) instead of a single string-equality check. Behavior is
otherwise identical to today for every one of these — same gating, same UI, just
triggered by either of two values instead of one.

`ai-service/agents/orchestrator.py`'s `FOURTH_CLASS_COURSES = {'4A', '4B'}` is keyed on
**`course_id`**, not `class_code`, and is therefore entirely unaffected by this change —
confirmed during the original 4th Class work that the AI service never sees `class_code`
at all.

`server/src/config/papersForClass.js` (`PAPERS_BY_CLASS`) currently has a `fourth: ['4A',
'4B']` entry, consumed only by `GET /api/platform/papers-for-class` (the 2nd/3rd Class
paper-picker route — not used by the 4th Class lobby flow, which builds its own response
directly per Part B). For consistency, replace the single `fourth` key with
`fourth_a: ['4A']` and `fourth_b: ['4B']`, so that route's fallback behavior for an
unrecognized `class_code` doesn't silently do the wrong thing if it's ever hit for a 4th
Class account.

## Verification

- A student who purchases only `fourth_a` sees just the `4A` card on `/lobby`; buying
  `fourth_b` later adds the `4B` card without disturbing the first.
- Attempting to (re-)provision an already-owned paper is a no-op (idempotent), matching
  today's re-delivery behavior.
- A student with an active `second` or `third` subscription cannot also provision
  `fourth_a`/`fourth_b`, and vice versa — cross-tier exclusion holds in both directions.
- Every one of the six "is this a 4th Class user" call sites correctly recognizes both
  `fourth_a` and `fourth_b` — spot-check at least the login-routing and
  tutor-hiding paths live, since those were the two places bugs were found during the
  original 4th Class live-testing round.
- 2nd/3rd Class behavior is completely unaffected — the migration only changes 4th Class
  provisioning; the mechanical `=== 'fourth'` → "is 4th Class" changes are a strict
  behavioral no-op for any `second`/`third` account.
