# client-v2 — FSA platform front end

React (Vite) front end for the Full Steam Ahead learning platform, served at **learn.fullsteamahead.ca** (and `/v2/*`). This is the **only active** client — `../client/` is retired v1 dead code.

See `../CLAUDE.md` and `wiki/projects/fsa-agent.md` for the full picture.

## Build & deploy

```bash
npm run build          # outputs to build/ (Vite base: /v2/)
# then rebuild the api image from the repo root — see ../CLAUDE.md
```

The Express API serves `build/` at the site root on `learn.*` (and at `/v2`). Build assets are referenced from `/v2/assets/`; files in `public/` (manifest, service worker, icons) land at `build/` root and are served at the **site root**.

## Conventions

- **Styling:** the lesson-player/exam stack uses global classes in `src/index.css`. **Page screens use co-located `*.css` files** (`pages/<Page>.css`, global classes with per-page prefixes `lb-`/`pf-`/`sp-`/`ac-`/`er-`). Do **not** use JS inline-style objects for layout — they can't carry `@media` and break responsive/mobile.
- **Mobile:** lesson player switches to a Lesson / AI Tutor tab toggle `≤768px`; pages have their own breakpoints. Verify changes at ~390px width.
- **PWA:** `public/manifest.webmanifest`, `public/sw.js` (root-scoped service worker), `public/offline.html`, and icons. SW registration + `beforeinstallprompt` capture are in `src/main.jsx`; install UI is in `pages/LobbyPage.jsx` (`hooks/useInstall.js`). SW is network-first for navigations, cache-first for immutable `/v2/assets/`; not offline-capable for lessons/tutor/exams by design.

## Structure

```
index.html            PWA <head> (manifest, theme-color, apple meta) + GA4 tag
public/               manifest.webmanifest, sw.js, offline.html, icons
src/
  main.jsx            mount + SW registration + install-prompt capture
  App.jsx             routing
  index.css           global + lesson-player/exam styles + mobile breakpoints
  LessonPlayer.jsx    lesson player (Content/AI-tutor tabs on mobile)
  ExamRouter.jsx      exam/quiz mode
  hooks/              useAudio, useNarrationSync, useInstall
  components/         ContentPanel, TutorPanel, NavigationHeader, ProtectedRoute, ...
  pages/              Login, Setup, ForgotPassword, SelectPaper, Lobby, Profile,
                      AllChapters, LessonPlayer, ExamResults (each with a co-located .css)
```
