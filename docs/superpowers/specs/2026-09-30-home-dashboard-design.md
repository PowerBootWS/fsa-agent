# Home Dashboard — Design

**Date:** 2026-09-30
**Status:** Approved in conversation; awaiting spec review
**Repos touched:** `fsa-agent` (primary), `fsa-affiliate-program`, `fsa-nurture`, `fsa-website`

## Goal

One landing page, shown to every logged-in user, that makes every part of FSA visible: the course,
the job board, custom resumes and the affiliate program. It appears even when the user hasn't used
a given part yet, so they know it exists and can get to it in one click.

Success = every account type (active student, 4th Class, lapsed student, job-only) lands on `/home`
after login and sees all six cards with state-correct copy and a working next action.

## Decisions (from the owner)

- **New `/home` page in front of `/lobby`**, not merged into it. `/lobby` (and `QuizOnlyLobbyPage`
  for 4th Class) are unchanged; the course card's Continue button goes there.
- **Affiliate card is soft**: real numbers for existing affiliates; for everyone else a quiet
  "earn 20%" line and a Join button — not a big pitch. (Consistent with the standing rule that
  advocacy asks come after experience.)
- **One-click affiliate join in the app**, no form.
- **Affiliate stats come from the affiliate service**, not direct SQL on the `affiliate` schema —
  earnings maths stays in one place.
- **New-jobs count is a rolling 7 days** (now minus 7×24h), not a calendar week.
- **"Tailoring" is retired from all student-facing copy** → "custom resume" / "customize your
  resume". Code identifiers, DB columns and analytics event names stay as they are.
- **Every platform account gets the 1 free custom-resume credit**, including paid enrollments
  (currently missed — see Piece 2).

## Piece 1 — `/home` page (fsa-agent)

### Routing

- New route `/home`, wrapped in `AppShell`, `requirePaper={false}`.
- "Home" becomes the first sidebar item in `AppShell` (above Courses / Jobs / Profile).
- Post-login defaults change from `/lobby` / `/jobs` to `/home` in: `DefaultRedirect` (`App.jsx`),
  `LoginPage.jsx`, `SignupPage.jsx`, `SetupPage.jsx`. Unchanged: an explicit `?next=` still wins
  (keeps `/jobs/capture`), and the `/select-paper` step for a multi-paper student with no
  `active_paper` still comes first, then `/home`.
- PWA `manifest.webmanifest` `start_url` → `/home`.

### API — `GET /api/platform/home` (session auth)

One call, returns everything the page renders. Each section is computed independently; a failing
section returns `null` + the page shows that card's error state instead of failing the whole page.

```
{
  first_name,
  course: {
    state: 'active' | 'lapsed' | 'none',
    subscriptions: [{ class_code, paper, pct_complete, last_exam_score, weakest_chapter }]
  },
  jobs:     { saved_count, custom_resumes_count },
  credits:  { balance },
  resume_on_file: boolean,
  new_jobs_7d: number | null,
  affiliate: { is_affiliate: false } |
             { is_affiliate: true, code, referral_url, referred_count,
               paying_referrals_count, earned_cents } | null
}
```

- `course`: `active` = a live subscription (same condition as `requireAuth`); `lapsed` = had a
  subscription (existing `/me.had_subscription` logic); else `none`. 4th Class A and B both
  listed when both held. `pct_complete` / exam score / weakest chapter reuse the queries behind
  `/api/platform/lobby-data` and the quiz-lobby — extract shared helpers, don't duplicate SQL.
- `jobs.custom_resumes_count` = the user's resume generations in `generated_documents`.
- `new_jobs_7d`: from `https://jobs-api.fullsteamahead.ca/jobs`, count of jobs with
  `first_seen >= now() - interval '7 days'`. Cached in-process for 10 minutes. On fetch failure,
  `null` → card hidden.
- `affiliate`: call the new affiliate-service endpoint (Piece 3) with a 2-second timeout.
  Timeout/error → `null`.

### API — `POST /api/platform/affiliate/join` (session auth)

- Calls `POST /internal/affiliates/create` `{name, email, source: 'in_app'}` (create-or-get;
  idempotent — a double click or an existing affiliate is safe).
- Sends the welcome email (referral link + dashboard URL) via `fsa-common` `sendEmail`, same content
  pattern as the `add-affiliate` skill. Only on actual creation, not on a "get".
- Returns the same `affiliate` object as `/home`, so the card flips in place without a reload.

### Page — `client-v2/src/pages/HomePage.jsx` + `HomePage.css` (prefix `hm-`)

Co-located CSS file per the client-v2 rule; top row 3 cards, second row 3 smaller cards; stacks to
one column ≤768px.

**Top row**

| Card | State | Copy / action |
|---|---|---|
| Course | active | Class + current paper, % complete bar, one line "Last practice exam 72% · weakest: Ch 6 Boilers". **Continue** → `/lobby` |
| | lapsed | "Welcome back, {first_name}." Short line + **See courses** → `fullsteamahead.ca/enroll` |
| | none | "You're not currently enrolled. Have a look at the courses." → `fullsteamahead.ca/enroll` |
| Jobs | any | "{n} saved jobs · {m} custom resumes built". **View the job board** → `fullsteamahead.ca/jobs`; **Saved jobs** → `/jobs` |
| Affiliate | affiliate | Earned to date, people referred, paying referrals, referral link with Copy button, **Full dashboard** → `fullsteamahead.ca/affiliate-dashboard` |
| | not affiliate | "Earn 20% of every referral, every month." **Join** (one click → `/affiliate/join`) |
| | `null` | "Couldn't load your referral stats right now." |

**Second row**

| Card | Shown when | Copy / action |
|---|---|---|
| New jobs | `new_jobs_7d` not null | "{n} new postings in the last 7 days." → job board |
| Custom resume credits | always | balance > 0 and saved jobs > 0: "Let's go, {first_name}. You've got {n} free custom resume(s). Pick one of your saved jobs and we'll build it." → `/jobs` · balance > 0, no saved jobs: "You've got {n} free custom resume(s). Find a job worth going after first." → job board · balance 0: one line on what a custom resume is + **Get more credits** → `/credits` |
| Upload your resume | `resume_on_file === false` | "Upload your resume to unlock one-click custom resumes." → `/profile` |

Copy: plain language, no "tailor/tailoring", no em dashes.

## Piece 2 — free credit for paid enrollments (fsa-agent)

**Gap:** the 1-credit grant exists only in `POST /api/auth/signup` (`routes/auth.js`). Paid
accounts are created by `POST /api/platform/provision-user`, which grants nothing. As of
2026-09-30, **13 platform users** (all with a subscription, created 2026-08-16 → 2026-09-30) have
no `signup_grant` transaction and no `credit_balances` row.

- `provision-user`: when it creates a new `platform_users` row, insert the same `signup_grant`
  (`credit_balances` upsert + `credit_transactions` row) in the same transaction.
- Backfill (migration): the exact criterion is "platform user with no `credit_transactions` row
  where `reason='signup_grant'`" — mirrors migration 011's backfill. Upserts `credit_balances`
  (+1, `ON CONFLICT` add) rather than a bare insert. Take `fsa-backup.sh daily` first.

## Piece 3 — affiliate stats endpoint (fsa-affiliate-program)

- `GET /internal/affiliates/summary?email=` (`requireInternalSecret`) →
  `{is_affiliate:false}` or `{is_affiliate:true, code, referral_url, referred_count,
  paying_referrals_count, earned_cents}`. Reuses the same functions behind `/dashboard/summary`
  (`referred_count` = attributed leads, `paying_referrals_count` = `subscription_attributions`,
  `earned_cents` = ledger total) so the numbers match the website dashboard exactly.
- Add `in_app` to the allowed `source` values of `/internal/affiliates/create`.
- fsa-agent reaches it via the public URL `affiliate-api.fullsteamahead.ca` with the internal
  secret (new `AFFILIATE_API_URL` / `AFFILIATE_INTERNAL_SECRET` in `fsa-agent/.env` if not present).

## Piece 4 — retire "tailoring" from student-facing copy

Visible strings only (labels, headings, buttons, error text, email copy). Known locations:

- `fsa-agent/client-v2`: `JobsPage.jsx`, `JobDetailModal.jsx`, `CreditsPage.jsx`, plus a sweep of
  all `.jsx` for visible "tailor" text; server error messages returned to the client from
  `routes/tailoring.js`.
- `fsa-nurture/engine/templates`: `saved-jobs-d0/d3/d7.html`, `job-digest-d7.html`.
- `fsa-website/enrollment-confirmation.html` (one line) — deploy via `fsa-website-deploy`.

## Error handling

- `/home` never fails as a whole: per-section `null` → per-card fallback.
- Affiliate service down → affiliate card fallback; Join shows "Couldn't join right now, try again
  in a minute."
- Jobs API down → new-jobs card hidden.

## Testing

- Server (`fsa_agent_test` only, with explicit `POSTGRES_DB/HOST/PORT/PASSWORD` per CLAUDE.md):
  `/home` for each account type (active, 4th A+B, lapsed, job-only); affiliate `null` on timeout;
  `/affiliate/join` idempotent; `provision-user` grants exactly one credit; backfill touches only
  accounts without a `signup_grant`.
- Client: `HomePage.test.jsx` renders each card state; redirect tests for login/signup/setup →
  `/home`, `?next=` still honoured.
- Affiliate service: summary endpoint matches `/dashboard/summary` for the same affiliate.
- Manual: log in as each account type on `learn.fullsteamahead.ca`, check mobile width.

## Out of scope

- The announcement / "what's new" modal — separate design, next.
- Changes to `/lobby` or `QuizOnlyLobbyPage` content.
- Credits for non-student affiliates without a platform account (no account to hold a credit;
  the signup grant covers them if they create one).
