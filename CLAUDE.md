# fsa-agent Project

Full Steam Ahead's self-hosted learning platform + AI tutoring agent for Power Engineering students. Live at **https://learn.fullsteamahead.ca**.

> **Canonical docs:** `wiki/projects/fsa-agent.md` (the business wiki). Read it before non-trivial work — it has the current architecture, API reference, DB schema, and decisions. This file is agent working-guidance; `client-v2/README.md` covers the front end.

## Architecture

```
fsa-agent/
├── server/       - Express.js API (host-header routing, auth, platform, lessons, exams)
├── client-v2/    - React platform front end (learn.* at /, also /v2/*) — THE ONLY ACTIVE CLIENT
├── client/       - Legacy v1 React (GHL iframe) — RETIRED 2026-06-13, dead code, do NOT modify
├── ai-service/   - Python Flask AI agent service
├── migrations/   - SQL migrations (00N_*.sql)
└── docker-compose.yml
```

## Key facts (don't get these wrong)

1. **`client-v2/` is the only live front end.** `client/` (v1) and the `fsachat.*` GHL-iframe path are retired — wired in code but zero live traffic. Do new work in `client-v2/`. **"Retired" never meant "closed":** until 2026-08-16 the `fsachat.*` host skipped `requireAuth` and `requireActiveSubscription` outright and served the whole paid library anonymously. Auth is now unconditional and `/api` returns 421 on any host that is not `learn.fullsteamahead.ca` (`server/src/middleware/requireLearnHost.js`).
2. **Platform mode, not iframe.** On `learn.*` the server runs in platform mode with `requireAuth` (session cookie) on lesson/chat/v2 routes. The old "iframe-only / validate parent domain" model is gone.
3. **DB:** PostgreSQL container **`fsa-postgres`**, database `fsa_agent`. All DB access goes through the Express API. `docker exec fsa-postgres psql -U postgres -d fsa_agent ...`
4. **Single-session auth:** each login overwrites `platform_users.current_session_token`; the other device gets a 401. Intentional — device-switch frequency is instrumented (`login_events.device_type` + `displaced_active_session`, migration 007).
5. **GHL is not the LMS/CRM.** It's a one-way marketing/onboarding/win-back sink. Courses + paying customers are self-hosted (this service + `fsa-crm`/`fsa-postgres`).

## Mobile / PWA (added 2026-06-16)

- The platform is responsive and **installable (PWA)**. Lesson player goes to a **Lesson / AI Tutor tab toggle** `≤768px` (desktop keeps the 60/40 split).
- **Styling rule:** page-level screens (`LobbyPage`, `ProfilePage`, `SelectPaperPage`, `AllChaptersPage`, `ExamResultsPage`) use **co-located `*.css` files** (global classes, per-page prefixes `lb-`/`pf-`/`sp-`/`ac-`/`er-`). Do **not** add new JS inline-style objects for layout — they can't carry `@media` and previously broke mobile. The lesson-player/exam stack uses `index.css`.
- **PWA files** live in `client-v2/public/` (`manifest.webmanifest`, `sw.js`, `offline.html`, icons) and are served at the **site root** (Express mounts `client-v2/build` at `/` on `learn.*` → root scope for the SW). SW = network-first navigations, cache-first immutable `/v2/assets/`, never `/api`/`/media`. Not offline-capable for lessons/tutor/exams by design.

## Deploy

Container env comes from two files (`env_file:` in the compose): `/home/debian/.env.shared` (shared layer) and `fsa-agent/.env` (project-specific). **`--env-file` is no longer needed** (env-split Step 8, 2026-08-24) — the remaining `${VAR}` interpolations are volume paths that resolve from the auto-loaded `fsa-agent/.env`. **`/home/debian/.env` is retired (Step 10, mode `000`, deleted 2026-08-27); never source or pass it.**

```bash
# Node API + React client
cd client-v2 && npm run build && cd .. && \
GITHUB_TOKEN=$(gh auth token) \
  docker compose build api && \
docker compose up -d api

# Python AI service (rarely changes)
docker compose build ai-service && \
docker compose up -d ai-service
```

**Never test via `localhost`/container IP** — only the public URL via the Cloudflare Tunnel (→ `fsa-agent-api-1:3000`) reaches the right container.

## Question DB rules

`options` JSONB never empty/null · `question_type`: `objective_practice` or `chapter_quiz` · calculation questions are staged multi-step MCQ only · questions must be self-contained. LaTeX: `$...$` inline, `$$...$$` display, never nest delimiters.

## Environment

Two layers: `/home/debian/.env.shared` + `fsa-agent/.env`. Key vars: `LEARN_DOMAIN`, `INTERNAL_SECRET` (webhook → provision/deactivate), `ADMIN_API_KEY`, `SUPPORT_GMAIL_SA`/`EMAIL_FROM` (all outbound mail — Gmail API, no SMTP), `PLATFORM_BASE_URL`, `PAPER_SWITCH_COOLDOWN_DAYS`, `QUIZ_PASSING_THRESHOLD`, `POSTGRES_*`, `PYTHON_SERVICE_URL`. See the wiki for the full table.
