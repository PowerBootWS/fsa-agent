# Announcements ("What's new") — Design

**Date:** 2026-09-30
**Status:** Approved in conversation; awaiting spec review
**Repo:** `fsa-agent` only

## Goal

When a major feature ships, tell the people it matters to. The next time they open the LMS,
an upbeat pop-up announces it, invites feedback, and never appears again once they've dealt
with it.

Success means:
- An eligible user sees the announcement once, on their next visit, on any device.
- Anyone it doesn't apply to never sees it.
- Feedback typed into it reaches Russ on Telegram and is stored.

## Decisions (from the owner)

- **Authoring:** Claude writes each announcement as part of shipping a feature. Russ approves
  the wording in chat before it's published. No admin UI.
- **Audience is set per announcement**, and **before every publish Claude confirms the
  audience with Russ**. It's part of the copy approval, never assumed.
- **Feedback:** an optional text box in the pop-up. Each message is saved and sent to Russ on
  Telegram.
- **"Seen" is tracked in the database**, not a cookie, so it holds across devices and can be
  reported on.

## Audiences

An announcement targets one or more groups. A user is eligible if they are in **any** of them.

| Group | Who |
|---|---|
| `everyone` | Every logged-in account |
| `students` | Accounts with a live subscription (status `active`, `cancel_at` null or in the future; same test as `requireAuth`) |
| `second`, `third`, `fourth_a`, `fourth_b` | Accounts with a live subscription of that `class_code` |
| `affiliates` | Accounts whose email has an active affiliate record (fsa-affiliate-program `/internal/affiliates/summary` → `is_affiliate: true`) |
| `job_seekers` | Accounts with at least one non-archived saved job, **or** job-only accounts (never had any subscription) |

The affiliate lookup is only made when a pending announcement actually targets `affiliates`.
If the lookup fails, the user is treated as not in that group, and the announcement shows on a
later visit once the lookup works.

## Other eligibility rules

- **Publish window:** the announcement shows only between its `starts_at` and `ends_at`.
  `ends_at` defaults to 30 days after `starts_at`.
- **Existing users only:** an account created after `starts_at` never sees that announcement.
  To a new user everything is new.
- **Once per person:** after a user has dismissed it, clicked its button, or sent feedback, it
  never shows to them again.
- **One pop-up per visit:** if several are pending, show only the newest (latest `starts_at`).
  The others wait for later visits. A "visit" is one page load of the app: the check runs
  once per full page load, not on every in-app navigation.

## Data (migration `022_announcements.sql`)

```
announcements
  id            SERIAL PK
  slug          TEXT UNIQUE NOT NULL          -- matches the source file name, e.g. 2026-10-home-dashboard
  title         TEXT NOT NULL
  body          TEXT NOT NULL                 -- plain text; blank lines become paragraphs
  cta_label     TEXT                          -- optional, e.g. "Check it out"
  cta_url       TEXT                          -- optional; an in-app path (/home) or https URL
  audiences     TEXT[] NOT NULL               -- values from the Audiences table, CHECK-constrained
  starts_at     TIMESTAMPTZ NOT NULL
  ends_at       TIMESTAMPTZ NOT NULL
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()

announcement_views
  announcement_id  INT FK → announcements ON DELETE CASCADE
  user_id          INT FK → platform_users ON DELETE CASCADE
  action           TEXT NOT NULL CHECK (action IN ('dismissed','cta','feedback'))
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  PRIMARY KEY (announcement_id, user_id)       -- first action wins; later ones are no-ops

announcement_feedback
  id               SERIAL PK
  announcement_id  INT FK → announcements ON DELETE CASCADE
  user_id          INT FK → platform_users ON DELETE CASCADE
  message          TEXT NOT NULL              -- trimmed, 1..2000 chars
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
```

## Authoring and publishing

- Source of truth: one JSON file per announcement in
  `server/src/announcements/<slug>.json` (under `src/`, because the api image copies only `server/src/`), committed to git:
  `{ "slug", "title", "body", "cta_label"?, "cta_url"?, "audiences": [...], "starts_at"?, "ends_at"? }`.
  A missing `starts_at` means now; a missing `ends_at` means `starts_at` + 30 days.
- Publish: `docker exec fsa-agent-api-1 node src/scripts/publish_announcement.js src/announcements/<slug>.json`.
  - It validates the file (audience values, copy length, `cta_url` is `/…` or `https://…`, no
    em dashes, never "tailor").
  - It upserts by `slug`, so re-running updates the copy.
  - It prints how many accounts are currently eligible, as a sanity check before it goes out.
  - Live immediately; no redeploy.
  - A new announcement file ships with the next api image build. To publish before that, `docker cp` the file into the running container first; the git commit stays the record.
- To pull one early: run the same script with `--end-now`, which sets `ends_at = now()`.
- **Process rule (in the wiki):** before publishing, Claude shows Russ the title, body, button,
  and audience list, and publishes only after he approves.

## API (session auth, mounted at `/api/platform`)

- `GET /announcements/next` → `{ announcement: { id, title, body, cta_label, cta_url } }` or
  `{ announcement: null }`. It returns the newest eligible, unseen, in-window announcement for
  this user.
- `POST /announcements/:id/seen` with body `{ action: 'dismissed' | 'cta' }` → `204`.
  Idempotent (`ON CONFLICT DO NOTHING`).
- `POST /announcements/:id/feedback` with body `{ message }` → `201`.
  - Validates the message: trimmed, 1–2000 chars, otherwise `400`.
  - Records a `feedback` view (if none exists yet) and saves the message.
  - Fire-and-forget `telegram.notifyOwner(...)` (fsa-common). The message includes the
    announcement title, the user's name and email, and their text. A Telegram failure is
    logged and never fails the request.
  - Rate limit: 5 feedback posts per user per hour.
- The seen and feedback routes return `404` if the announcement doesn't exist.

## Client

- `client-v2/src/components/AnnouncementModal.jsx` + `AnnouncementModal.css` (prefix `an-`).
- Mounted once inside `AppShell`, so it appears on Home, the course lobby, Jobs, Profile and
  Credits. It never appears in the lesson player or exams, which aren't wrapped in `AppShell`.
- On mount, a module-level flag ensures the check runs only once per page load. It calls
  `/announcements/next`, and does nothing on any error.
- Layout:
  - A "NEW" badge, then the title, then the body paragraphs.
  - The optional button: in-app paths use the router, https opens normally.
  - An optional feedback textarea ("Got an idea or something that would make this better?
    Tell us.") with a **Send** button, and a **Got it** button.
- Behaviour:
  - **Got it**, the ✕ close button, or the Escape key all record `dismissed` and close it.
  - The button records `cta` and then navigates.
  - **Send** posts the feedback and shows "Thanks, Russ reads every one of these." The next
    click closes it.
  - Clicking outside the card does **not** close it, so the pop-up isn't lost by accident.
- Accessibility:
  - `role="dialog"`, `aria-modal`, and the heading is its label.
  - Focus moves into it on open and returns on close.
- Styling matches the Home page tokens. On phone widths (≤600px) it takes the full width with
  a 16px gutter.
- Analytics: add `announcement_shown`, `announcement_cta` and `announcement_feedback` to the
  usage taxonomy. Both copies must stay identical.

## Reporting

`node src/scripts/announcement_report.js <slug>` prints the eligible, seen, CTA-click and
dismiss counts, plus every feedback message with its sender and date. Run on request.

## First announcement

Once this ships, draft `2026-10-home-dashboard` and bring it to Russ for copy and audience
approval before publishing:
- Covers Home plus custom resumes.
- Suggested audience: `everyone`.

## Error handling

- Any failure on the announcements path: no pop-up, the page works normally.
- A feedback save failure: the pop-up shows "Couldn't send that, try again" and stays open.
- A Telegram failure: logged only.

## Testing

- **Server** (runs only against `fsa_agent_test`):
  - Eligibility for each audience group, including `affiliates` with a mocked lookup and
    `job_seekers` both ways.
  - The window and existing-users-only rules.
  - Newest-first ordering, and seen-once behaviour across all three actions.
  - Feedback: validation, rate limit, and a Telegram failure that is swallowed.
  - `404` for an unknown id.
  - The publish script: validation failures, and an upsert that updates the copy.
- **Client:**
  - Renders the announcement and doesn't render for `null`.
  - Got it / ✕ / Escape each record `dismissed`.
  - The button records `cta` and navigates.
  - Feedback: success, error, and the empty-message guard.
  - Clicking outside does not close it.
  - Only one fetch per page load.
- **Manual:** publish a test announcement (audience `everyone`, `ends_at` 1 hour ahead) and
  view it logged in as `russ@fullsteamahead.ca` on desktop and at 375px. Send one feedback
  message and confirm it arrives on Telegram. Then end the test announcement with `--end-now`.

## Out of scope

- An admin UI or a Telegram publishing path; both can be added later.
- Images or video in announcements.
- Email or push delivery of announcements.
- Showing a past-announcements list ("changelog") in the app.
