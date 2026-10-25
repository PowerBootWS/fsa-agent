# Affiliate Dashboard in the Portal: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the full affiliate dashboard from `fullsteamahead.ca/affiliate-dashboard` into the portal at `learn.fullsteamahead.ca/affiliate`, behind the portal's normal login. Every way of joining the affiliate program then goes through a portal account.

**Architecture:** fsa-affiliate-program keeps all affiliate data and maths. It gains two server-to-server endpoints keyed by email (`x-affiliate-secret`), which reuse the existing dashboard functions. fsa-agent's API proxies them for the logged-in user (`requireAuth`, the user's own email only), and a new client-v2 page renders them. The website's signup form and dashboard become links and redirects into the portal, so nothing emailed so far breaks.

**Tech Stack:** fsa-affiliate-program (Express, `node --test`), fsa-agent server (Express, jest against `fsa_agent_test`), client-v2 (React, vitest), fsa-website (static HTML), fsa-nurture templates.

**Spec:** this plan carries its own design (below). It was agreed with Russ on 2026-10-25 and builds on `docs/superpowers/specs/2026-09-30-home-dashboard-design.md` (Home Referrals card, one-click Join).

## Design decisions

1. **Portal page `/affiliate`**, in the sidebar as **Referrals**, for every logged-in account. Non-affiliates see a short pitch and the existing one-click **Join** (`POST /api/platform/affiliate/join`). Affiliates see these sections, top to bottom:
   - referral link with program deep links
   - stats
   - Discount Codes
   - Media Kit
   - Leads
   - Customers
   - Commissions
2. **Website affiliate signup creates a portal account.** "Become an affiliate" on `affiliate.html` and the dashboard page goes to `https://learn.fullsteamahead.ca/signup?next=/affiliate`: the existing free signup (name, email, password), then the `/affiliate` page with Join. Someone who already has an account uses the page's existing "log in" link, which keeps `next`. No new account-creation code.
3. **Joining in the portal starts the affiliate email sequence.** `in_app` joins now enrol in fsa-nurture `affiliate` at `startStep: 1`, as website self-signups do today, because the join sends its own welcome. *Owner to confirm:* this also applies to students joining from the Home card.
4. **The old website dashboard becomes a redirect** to `https://learn.fullsteamahead.ca/affiliate`. It stays a redirect for good, because many sent emails link to it. The affiliate service's magic-link and website-signup endpoints stay working but unused for one release, then come out (Task 8).
5. **The 5 affiliates with no portal account** (3 `refgrow_import`, 1 `self_signup`, 1 `manual`) get one through `provision-user`'s magic-link path. No subscription is created. Russ approves the list and the email before anything is sent.
6. **Media Kit links stay** on `affiliates.fullsteamahead.ca` (same four links as the website dashboard today).

## Global Constraints

- Production DB safety (root `CLAUDE.md`): server tests run only with `POSTGRES_DB=fsa_agent_test POSTGRES_HOST=localhost POSTGRES_PORT=5434` plus `POSTGRES_PASSWORD` taken by a one-variable grep from `.env.shared`. Never `source` that file. Back up (`sudo /usr/local/bin/fsa-backup.sh daily`) before Task 7 writes.
- The fsa-agent API may only ever request affiliate data for `req.user.email`. No email parameter from the client is accepted.
- Affiliate service calls from fsa-agent use the existing 2-second `AbortSignal.timeout` and `AFFILIATE_INTERNAL_URL`/`AFFILIATE_INTERNAL_SECRET`. A failure in a display call returns `null` and never throws to the page.
- **Copy rules:**
  - no em dashes
  - "20% of every payment", never "recurring"
  - 4th Class copy never mentions a tutor or lessons
  - prices only via `fsa-website/pricing.js`, never hand-typed
- **Deploy rules:** fsa-agent api builds need `GITHUB_TOKEN=$(gh auth token)`; client-v2 is built before the api image. fsa-website uses the `fsa-website-deploy` skill (purge must exit 0). Do not merge or deploy from an implementer subagent: the orchestrator deploys.

## Review Focus

1. **An affiliate whose service record is `paused`** opens `/affiliate`. Expected: a plain "your referral account is paused, contact support" state, no discount button, no 500. *Test in Task 2.*
2. **The affiliate service is down or slow.** Expected: `/affiliate` shows "Couldn't load your referral dashboard right now" and the rest of the portal works. *Test in Task 2 (client timeout → null → 503 body) and Task 4 (null render).*
3. **The discount limit is reached (3/day).** Expected: the service's 429 message reaches the user verbatim, not "something went wrong". *Test in Task 2 (status and message passthrough) and Task 4 (message shown).*
4. **Signing up with an email that already has a portal account**, from the website link. Expected: the existing 409 "Try logging in instead". The login link keeps `next=/affiliate`, so they still land on the page. *Test in Task 5.*
5. **An old link `fullsteamahead.ca/affiliate-dashboard?token=…`** from a sent email. Expected: lands on `learn.fullsteamahead.ca/affiliate` (login if needed), never a dead page. *Verified in Task 6.*

---

### Task 1: Affiliate service, email-keyed dashboard endpoints

**Files:**
- Create: `fsa-affiliate-program/src/handlers/internalDashboard.js`
- Modify: `fsa-affiliate-program/src/app.js` (wire 2 routes, `requireInternalSecret`, `asyncHandler`)
- Test: `fsa-affiliate-program/tests/internalDashboard.test.js`, plus `tests/appRoutes.test.js` (add both paths)

**Interfaces:**
- Consumes: `findByEmailAnyStatus(pool, email)` (`src/affiliates.js`); `getDashboardSummary`, `getDashboardLeads`, `getDashboardCustomers`, `getDashboardCommissions` (`src/handlers/dashboard.js`); `listDiscountCodes`, `createDiscountCode`, `DiscountCodeError` (`src/handlers/discountCodes.js`)
- Produces:
  - `GET /internal/affiliates/dashboard?email=` → `200 {is_affiliate:false}` | `200 {is_affiliate:true, status, summary, leads, customers, commissions, discountCodes}`. `status` is the affiliate's status; when it isn't `'active'` the other fields are omitted.
  - `POST /internal/affiliates/discount-codes {email}` → `201 {code, expiresAt}` | `404 {error}` (no affiliate) | `403`/`429 {error}` (from `DiscountCodeError`, message unchanged)

- [ ] **Step 1:** Write the tests in `internalDashboard.test.js` (fake pool, fake fetch):
  - `dashboard returns is_affiliate false for an unknown email`
  - `dashboard returns all five sections for an active affiliate`: assert the keys `summary, leads, customers, commissions, discountCodes`, and that every query was called with the resolved affiliate id
  - `dashboard returns status only for a paused affiliate`: `{is_affiliate:true, status:'inactive'}`, no other keys
  - `discount-codes 404s for an unknown email`
  - `discount-codes passes a 429 DiscountCodeError message through`: status 429, body `{error: <message>}`
  - `email is lower-cased and trimmed before lookup`
- [ ] **Step 2:** Run `cd fsa-affiliate-program && npm test`. Expected: the new tests FAIL (module missing).
- [ ] **Step 3:** Implement `handleInternalDashboard(pool)` and `handleInternalDiscountCode(pool, {logger})` in `internalDashboard.js`. Wire `GET /internal/affiliates/dashboard` and `POST /internal/affiliates/discount-codes` in `app.js`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass (220 + new).
- [ ] **Step 5:** Commit: `Internal email-keyed dashboard and discount-code endpoints for the portal`.

### Task 2: fsa-agent API, `/api/platform/affiliate`

**Files:**
- Modify: `fsa-agent/server/src/services/affiliateClient.js` (add 2 functions)
- Modify: `fsa-agent/server/src/routes/home.js` (add 2 routes beside `/affiliate/join`)
- Test: `fsa-agent/server/tests/affiliateClient.test.js`, `fsa-agent/server/tests/home.test.js`

**Interfaces:**
- Consumes: Task 1 endpoints.
- Produces:
  - `affiliateClient.getDashboard(email) -> Promise<object|null>`: never throws; `null` on timeout, non-2xx or missing config.
  - `affiliateClient.createDiscountCode(email) -> Promise<{status:number, body:object}>`: throws only on network or timeout failure.
  - `GET /api/platform/affiliate` (requireAuth) → `200 <service body>` | `503 {error:"Couldn't load your referral dashboard right now."}` when `getDashboard` returns null.
  - `POST /api/platform/affiliate/discount-codes` (requireAuth) → the service's status and body unchanged; `502 {error:"Couldn't create a code right now. Try again in a minute."}` on throw.
  - Both routes use `req.user.email` only.

- [ ] **Step 1:** Write the tests:
  - `getDashboard returns null when the service times out`
  - `getDashboard returns null on a 500`
  - `createDiscountCode returns status and body for a 429`
  - home.test: `GET /affiliate uses the session user's email, ignoring ?email=`
  - home.test: `GET /affiliate is 503 when the service is unavailable`
  - home.test: `POST /affiliate/discount-codes passes 429 and its message through`
  - home.test: `POST /affiliate/discount-codes requires auth` (401)
- [ ] **Step 2:** Run `cd fsa-agent/server && POSTGRES_DB=fsa_agent_test POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-) npx jest tests/affiliateClient.test.js tests/home.test.js`. Expected: new tests FAIL.
- [ ] **Step 3:** Implement both client functions (same `config()`/timeout pattern as `getSummary`) and both routes.
- [ ] **Step 4:** Re-run the Step 2 command. Expected: PASS. Then run the full `npm test` with the same env. Expected: no new failures.
- [ ] **Step 5:** Commit: `Portal API for the affiliate dashboard (session user only)`.

### Task 3: Portal joins enrol in the affiliate email sequence (decision 3)

**Files:**
- Modify: `fsa-agent/server/src/routes/home.js` (`POST /affiliate/join`, newly-created branch only)
- Modify: `fsa-agent/server/src/services/nurture.js` if it has no `affiliate` enrol helper. Same `/intake` payload shape as `fsa-affiliate-program/src/nurture.js` `enrolInNurture` (`sequence: 'affiliate'`, `startStep: 1`, first name fallback).
- Test: `fsa-agent/server/tests/home.test.js`

**Interfaces:**
- Produces: on `created === true`, one fire-and-forget call to fsa-nurture `/intake` with `{email, first_name, sequence:'affiliate', startStep:1}`. No call on an existing affiliate. A nurture failure is logged and never fails the join.

- [ ] **Step 1:** Write the tests:
  - `join enrols a newly created affiliate in the affiliate sequence at step 1`
  - `join does not enrol when the affiliate already existed`
  - `join still returns 200 when nurture intake fails`
- [ ] **Step 2:** Run the home tests (env as in Task 2). Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `In-app affiliate join starts the affiliate nurture sequence`.

### Task 4: client-v2 Affiliate page and sidebar

**Files:**
- Create: `fsa-agent/client-v2/src/pages/AffiliatePage.jsx`, `AffiliatePage.css`, `AffiliatePage.test.jsx`
- Modify:
  - `client-v2/src/App.jsx`: route `/affiliate`, `ProtectedRoute requirePaper={false}`, inside `AppShell`
  - `client-v2/src/components/AppShell.jsx`: NavLink **Referrals** → `/affiliate`, after Jobs
  - `client-v2/src/pages/HomePage.jsx`: `AFFILIATE_DASHBOARD_URL` becomes the internal `/affiliate` link (router `Link`, same tab)
  - `client-v2/src/components/NpsPrompt.jsx`: "Your referral dashboard" → `/affiliate`

**Interfaces:**
- Consumes: Task 2 routes; existing `POST /api/platform/affiliate/join` (returns `{affiliate}`).
- Page states:
  - loading
  - `503` → "Couldn't load your referral dashboard right now."
  - `is_affiliate:false` → pitch + Join (after joining, reload the dashboard)
  - status not active → "Your referral account is paused. Email support@fullsteamahead.ca if you think that's a mistake."
  - active → the sections in decision 1
- Section content is the same as the live website dashboard (`fsa-website/affiliate-dashboard.html`); copy each section's text verbatim from there:
  - discount terms list
  - copy-ready message template
  - Media Kit link targets
  - status labels Active / "Active until <date>" / Ended / Paid <date> / Unpaid / No commission
  - refunds as negative money
- Deep links shown under the referral link: `/2nd-class-complete`, `/3rd-class-complete` and `/4th-class-complete`, each with `?am_id=<code>`.

- [ ] **Step 1:** Write the tests in `AffiliatePage.test.jsx` (mock fetch):
  - `shows Join for a non-affiliate and loads the dashboard after joining`
  - `shows the paused message and no Generate button for an inactive affiliate`
  - `shows the load error on 503`
  - `Generate a Code shows the code, expiry and copy message`
  - `shows the service's 429 message verbatim`
  - `renders a refund row as negative and a $0 row as No commission`
  - `sidebar has a Referrals link to /affiliate` (AppShell test, or in this file)
- [ ] **Step 2:** Run `cd fsa-agent/client-v2 && npx vitest run src/pages/AffiliatePage.test.jsx`. Expected: FAIL.
- [ ] **Step 3:** Implement the page, route, nav item and the two link changes. Follow `HomePage.jsx`/`.css` card styling (`hm-card` patterns). Must work at 375px with no horizontal page scroll; tables scroll inside their wrapper.
- [ ] **Step 4:** Run `npm test` in client-v2. Expected: all pass, including the existing `HomePage.test.jsx` and `NpsPrompt.test.jsx` after their link assertions are updated.
- [ ] **Step 5:** Commit: `Referrals page in the portal: full affiliate dashboard`.

### Task 5: Signup with `next=/affiliate`

**Files:**
- Test: `fsa-agent/client-v2/src/pages/SignupPage.test.jsx` (create if absent)

`SignupPage` and `LoginPage` already honour `?next=` through `postLoginPath`. This task proves the path rather than changing it.

- [ ] **Step 1:** Write the tests:
  - `signup with next=/affiliate navigates to /affiliate on 201`
  - `the 409 message shows and the login link keeps next=/affiliate`
- [ ] **Step 2:** Run. Expected: PASS. `utils/postLoginPath.js` already accepts any same-site path that starts with `/` and not `//`, so no code change is expected.
- [ ] **Step 3:** Commit: `Prove signup/login carry next=/affiliate`.

### Task 6: Deploy the portal, then point the website at it

Order matters: the portal page must be live before any link points at it.

**Files:**
- Modify: `fsa-website/affiliate-dashboard.html`. Replace the page body with a redirect: `<meta http-equiv="refresh" content="0; url=https://learn.fullsteamahead.ca/affiliate">` plus a visible link, and keep the `INCLUDE:nav`/`INCLUDE:footer` markers.
- Modify: `fsa-website/affiliate.html`. Every "sign up" / "log in to your dashboard" CTA goes to `https://learn.fullsteamahead.ca/signup?next=/affiliate` (sign up) or `https://learn.fullsteamahead.ca/affiliate` (existing affiliates).
- Modify: `fsa-website/affiliate-confirmation.html`, if still reachable: same CTA change.

- [ ] **Step 1:** Deploy fsa-affiliate-program (Task 1), then fsa-agent (client-v2 build, then api build with `GITHUB_TOKEN`). Check: `curl -s -o /dev/null -w '%{http_code}' https://learn.fullsteamahead.ca/api/platform/affiliate` → `401`.
- [ ] **Step 2:** Live check as russ@ (`FSA_RUSS_LMS_PASSWORD` vault key; russ@ is affiliate `RUSSWEBB6740`):
  - `/affiliate` renders every section at 1440px and 375px
  - Generate a Code works; deactivate that promo code in Stripe and delete its `affiliate.discount_codes` row afterwards
  - the sidebar Referrals link works, and the Home card link goes to `/affiliate`
- [ ] **Step 3:** Make the website changes and deploy with the `fsa-website-deploy` skill. Purge must exit 0.
- [ ] **Step 4:** Check that `https://fullsteamahead.ca/affiliate-dashboard?token=abc` lands on `learn.fullsteamahead.ca/affiliate` (Review Focus 5), and that the signup CTA lands on signup with `next` kept.
- [ ] **Step 5:** Commit each repo.

### Task 7: Accounts for the 5 affiliates without one (needs Russ)

**Files:**
- Create: `fsa-agent/server/scripts/provision-affiliate-accounts.js`. It runs a dry run by default and writes only with `--apply`.

**Interfaces:**
- Consumes: the email/first-name rows from `affiliate.affiliates a LEFT JOIN public.platform_users pu ON lower(pu.email)=lower(a.email) WHERE a.status='active' AND pu.id IS NULL`.
- Produces: one `platform_users` row each, with no subscription and the signup credit, plus a 48h `magic_link` `auth_tokens` row and `sendMagicLink`, exactly as `provision-user` does for a new user. It prints one line per person: created, or skipped because the account already exists.

- [ ] **Step 1:** Run the dry run against production (read-only) and show Russ the list and the setup email text. **Stop for approval.**
- [ ] **Step 2:** Run `--apply` against `fsa_agent_scratch` (guard: `SELECT 1 FROM _scratch_meta`) with `EMAIL_REDIRECT_TO=russ@fullsteamahead.ca`. Expected: 5 created, 5 mails to russ@ tagged `[TEST to …]`.
- [ ] **Step 3:** Back up, then run `--apply` on production. Expected: 5 created. A second run reports 5 skipped.
- [ ] **Step 4:** Commit the script.

### Task 8: Point everything else at the portal, then retire the website auth paths

**Files:**
- Modify: `fsa-nurture/engine/templates/affiliate-d0.html`, `-d1`, `-d3`, `-d7`, `-d14`, `-d21`, `-d30`, `affiliate-invite-d0.html`, `onboarding-d21.html`, `jobs-d12.html`. "Access it through the Affiliates page on our website" becomes "the Referrals page in your Full Steam Ahead account: https://learn.fullsteamahead.ca/affiliate". Plain-text URL, as the 2026-09-08 rule requires (`lib/render.js` rewrites anchors).
- Modify:
  - `fsa-affiliate-program/src/handlers/signup.js` and `auth.js`: dashboard URL → `https://learn.fullsteamahead.ca/affiliate`
  - `fsa-agent/server/src/services/email.js` (`sendAffiliateWelcome`): dashboard URL → the portal page
- Modify:
  - `fsa-marketing/affiliate-kit/AFFILIATE-GUIDE.md` §1: dashboard login section → "log in to your Full Steam Ahead account, Referrals in the sidebar". Regenerate the PDF, copy it to the portal media, rebuild `fsa-affiliate-media`.
  - `affiliate-media-portal/templates/index.html`: footer "Back to your dashboard" → the portal URL
- Modify: `fsa-customer-support/playbook/rules-of-engagement.md` and `faq.md`. "Where to find it" and "Logging in to the full dashboard" become the portal Referrals page with normal login. Drop the magic-link and per-browser text.
- Modify: `~/.claude/skills/add-affiliate/SKILL.md`. A manual add also gets a portal account (Task 7 script) and the portal link.
- One release after Task 6, remove website-only code:
  - `POST /auth/request-link`, `/auth/redeem`, `/auth/signup` and the `/dashboard/*` routes in fsa-affiliate-program
  - `affiliate.magic_links`/`sessions` stay in the database (no destructive migration)
  - `appRoutes.test.js` updated

- [ ] **Step 1:** Change the nurture templates. Run `cd fsa-nurture && npm test && npm run preflight`. Expected: pass. Render d1 and check the URL is plain text.
- [ ] **Step 2:** Change the URLs in the affiliate service and fsa-agent email, and update their tests' expected strings. Run both suites. Expected: pass.
- [ ] **Step 3:** Update the guide, the media portal and the playbook. Dry-run Olivia on "where's my affiliate dashboard?" (call `call_openrouter` directly, as on 2026-10-25). Expected: `tier=safe`, and the answer names the portal Referrals page.
- [ ] **Step 4:** Deploy fsa-nurture (`GITHUB_TOKEN`), fsa-affiliate-program, fsa-agent api and fsa-affiliate-media.
- [ ] **Step 5 (one release later):** Remove the website-only routes. Run `npm test`. Before deploying, check `docker logs fsa-affiliate-program` for any call to those routes in the past 7 days. Use `rtk proxy` here, because rtk-filtered `docker logs` can return a false "0 errors" summary.
- [ ] **Step 6:** Update the wiki: `projects/fsa-affiliate-program.md`, `projects/fsa-agent.md` (route table, Referrals page), `projects/fsa-customer-support.md`, and `log.md`.

---

## Self-review notes

- **Every decision has a task:**

  | Decision | Task |
  |---|---|
  | 1 | Tasks 1, 2, 4 |
  | 2 | Tasks 5, 6 |
  | 3 | Task 3 |
  | 4 | Tasks 6, 8 |
  | 5 | Task 7 |
  | 6 | Task 4 |

- **Every Review Focus line has a test:**

  | Review Focus | Tests in |
  |---|---|
  | 1 | Tasks 2 and 4 |
  | 2 | Tasks 2 and 4 |
  | 3 | Tasks 2 and 4 |
  | 4 | Task 5 |
  | 5 | Task 6, Step 4 |

- **Names used across tasks:**
  - `getDashboard` / `createDiscountCode` (affiliateClient)
  - `/internal/affiliates/dashboard` and `/internal/affiliates/discount-codes`
  - `/api/platform/affiliate` and `/api/platform/affiliate/discount-codes`
  - the page route `/affiliate`
