# fsa-agent

**The primary product of Full Steam Ahead** — a self-hosted learning platform and AI tutoring agent for Power Engineering exam prep (SOPEEC 2nd & 3rd Class).

- **Live:** https://learn.fullsteamahead.ca (authenticated platform — the only active front end)
- **Stack:** React (`client-v2/`) · Express.js API (`server/`) · Python Flask AI service (`ai-service/`) · PostgreSQL (`fsa-postgres`)
- **Canonical docs:** the business wiki — `wiki/projects/fsa-agent.md` (served at https://wiki.fullsteamahead.ca). This README is a quick orientation; the wiki is the source of truth for architecture, API, schema, and decisions.

## What it does

Students subscribe via Stripe, are provisioned automatically (magic-link onboarding), then study chapter-by-chapter: slide-based lessons with audio narration, an AI tutor, gated progression, chapter quizzes, and practice exams with full AI debriefs. GoHighLevel is **not** part of course delivery — it's a one-way marketing/onboarding/win-back sink only.

## Layout

```
server/      Express API — auth, platform, lessons, exams, admin (host-header routing)
client-v2/   React platform front end (learn.* at /, also /v2/*) — the only active client
client/      Legacy v1 React (GHL iframe) — RETIRED 2026-06-13, dead code, do not modify
ai-service/  Python Flask AI agent (orchestrator, tutor, researcher)
migrations/  SQL migrations (server/migrations/00N_*.sql)
```

## Platform essentials

- **Auth:** magic-link onboarding → password; `HttpOnly` `fsa_session` cookie (30-day rolling). **Single-session** — a new login overwrites `current_session_token`, signing the other device out (intentional; device-switch frequency is instrumented — see below).
- **Host routing:** `learn.*` = platform mode (auth required); the legacy `fsachat.*` / client-v1 path is retired (wired but no live traffic).
- **Progression:** objective N+1 locks until N is complete; chapter quiz locks until all objectives done; next chapter locks until the quiz passes ≥ `QUIZ_PASSING_THRESHOLD` (75%). Practice exams are always open.

## Mobile & PWA

The platform is responsive and **installable to a phone/desktop home screen (PWA)**.

- **Lesson player on phones (`≤768px`):** the Content + AI-tutor panels stack into one full-width panel toggled by a **Lesson / AI Tutor** tab bar (desktop keeps the 60/40 split).
- **Styling note:** page screens use **co-located `*.css` files** (per-page prefixes `lb-`/`pf-`/`sp-`/`ac-`/`er-`), not inline-style objects — inline styles can't carry `@media`, which previously broke mobile. New page styling must follow the co-located-CSS pattern.
- **PWA:** `client-v2/public/` holds `manifest.webmanifest`, `sw.js` (service worker), `offline.html`, and icons. They're served at the **site root** because Express mounts `client-v2/build` at `/` on `learn.*` — so the SW gets root scope. Strategy: network-first for navigations, cache-first for immutable `/v2/assets/`, never caches `/api`/`/media`. Not offline-capable for lessons/tutor/exams (network-dependent) — installability + fast shell only.
- **Install prompts:** a dismissible lobby banner + a user-menu **"Install app"** entry — one-tap on Android/Chromium, Share → Add to Home Screen instructions on iOS.
- **Native app:** deferred; a Capacitor wrapper of this PWA is the path if pursued.

## Deploy

Always pass the shared env file. Build the React client first if `client-v2/` source changed.

```bash
# Node API + React client
cd client-v2 && npm run build && cd .. && \
docker compose --env-file /home/debian/.env build api && \
docker compose --env-file /home/debian/.env up -d api

# Python AI service (rarely changes)
docker compose --env-file /home/debian/.env build ai-service && \
docker compose --env-file /home/debian/.env up -d ai-service
```

- **Networking:** reachable only via the Cloudflare Tunnel → `fsa-agent-api-1:3000`. Never test via `localhost`/container IP — use the public URL.
- **DB / migrations:** `docker exec fsa-postgres psql -U postgres -d fsa_agent -f /path/to/migration.sql`.

## Ops scripts

```bash
# Account-sharing review (login IPs)
docker exec fsa-agent-api-1 node src/scripts/login_audit.js [--user <id|email>] [--days N]

# Mobile↔desktop switch report (emailed monthly to sysadmin@powerboot.ca via host cron)
docker exec fsa-agent-api-1 node src/scripts/device_switch_report.js [--days N] [--email <addr>]
```

> The monthly device-switch email is a **host crontab** entry (1st of month, 08:00 MDT) — host state, not in this repo. See `wiki/projects/fsa-agent.md`.
