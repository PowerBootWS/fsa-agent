require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Cloudflare as the first proxy so express-rate-limit can read the real client IP
app.set('trust proxy', 1);

const LEARN_DOMAIN = process.env.LEARN_DOMAIN || 'learn.fullsteamahead.ca';
const LEGACY_DOMAIN = process.env.LEGACY_DOMAIN || 'fsachat.fullsteamahead.ca';

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      frameAncestors: [`'self'`, process.env.PARENT_DOMAIN || 'localhost', `https://${LEARN_DOMAIN}`],
      scriptSrc: ["'self'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://static.cloudflareinsights.com"],
    },
  },
  frameguard: false,
}));

// Override X-Frame-Options to allow embedding from parent domain
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  next();
});

// CORS - allow parent domain and both platform domains
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.PARENT_DOMAIN || 'http://localhost:8080',
      `https://${LEARN_DOMAIN}`,
      `https://${LEGACY_DOMAIN}`,
      // fsa-website's public jobs board (jobs.html) calls
      // POST /api/jobs/capture-stash directly from the browser, before the
      // user has any FSA session.
      'https://fullsteamahead.ca',
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};
app.use(cors(corsOptions));

// Rate limiting — applied to /api only so media/static fetches don't count
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // limit each IP to 300 API requests per windowMs
});

// Parse cookies
app.use(cookieParser());

// Detect which frontend is being served based on Host header
app.use((req, res, next) => {
  const host = req.headers.host || '';
  req.isPlatformMode = host.includes(LEARN_DOMAIN);
  req.isLegacyMode = host.includes(LEGACY_DOMAIN) || !req.isPlatformMode;
  next();
});

// Parse JSON bodies
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Auth middleware
const requireAuth = require('./middleware/requireAuth');
const requireActiveSubscription = require('./middleware/requireActiveSubscription');

// platformAuth used to call requireAuth only when the Host header contained
// LEARN_DOMAIN, and pass through otherwise. Because fsachat.fullsteamahead.ca
// is routed to this same container, that made every route below anonymously
// readable from the public internet — verified 2026-08-16 with a 265 KB paid
// lesson payload. Auth is not conditional on a request header. There is no
// legacy caller to preserve: client/ (v1) was retired 2026-06-13.

// Routes
const validateRouter = require('./routes/validate');
const lessonRouter = require('./routes/lesson');
const chatRouter = require('./routes/chat');
const progressRouter = require('./routes/progress');
const enrollRouter = require('./routes/enroll');
const demoRouter = require('./routes/demo');
const previewRouter = require('./routes/preview');

// requireLearnHost is mounted AFTER the rate limiter (fix round 1, 2026-08-16
// review): mounting it first would let a flood of requests on a forged/legacy
// Host bypass the 300-per-15-min cap entirely and each get logged via
// console.warn — with no log rotation configured in docker-compose.yml, that
// is an unbounded log-growth vector. Rate-limiting first means a flood is
// capped before the host guard ever runs, so it can only ever log ~300
// warnings per IP per window.
app.use('/api', limiter);
const requireLearnHost = require('./middleware/requireLearnHost');
app.use('/api', requireLearnHost);
app.use('/api/validate', validateRouter);
app.use('/api/lesson', requireAuth, requireActiveSubscription, lessonRouter);
app.use('/api/chat', requireAuth, requireActiveSubscription, chatRouter);
// requireAuth unconditionally: this route was reachable with no credentials on
// BOTH learn.* and fsachat.*, and platformAuth (now removed) passed through on
// the legacy host, so it would have left the hole open there. Nothing in
// client/, client-v2/ or ai-service/ calls this route, so there is no legacy
// caller to preserve. Entitlement gate matches /api/lesson and /api/chat.
app.use('/api/progress', requireAuth, requireActiveSubscription, progressRouter);
// /api/chat-history (server/src/routes/chat-history.js) and /api/responses
// (server/src/routes/responses.js, both POST / and GET
// /chapter-weights/:user/:courseId) were deleted outright (backlog #88,
// 2026-08-16): both were unauthenticated and DB-backed — POST /api/responses
// let anyone write question responses under any email, feeding
// isChapterQuizPassed, and GET /chapter-weights/:user/:courseId returned a
// named student's per-chapter accuracy to anyone. `grep -rl` for
// "/api/chat-history", "/api/responses" and "chapter-weights" across
// client-v2/src, the compiled client-v2/build/assets bundle, the retired
// client/, ai-service/, and server/src outside the route files themselves
// found zero callers — see server/tests/idorRoutes.test.js for the same
// search recorded as a comment. Deleted rather than authenticated, matching
// the lesson-preview precedent from earlier today (mediaAuth.test.js).
app.use('/api/enroll', enrollRouter);
app.use('/api/demo', demoRouter);

const diagnosticRouter = require('./routes/diagnostic');
app.use('/api/diagnostic', diagnosticRouter);

const examRouter = require('./routes/exam');
app.use('/api/exam', examRouter);
app.use('/api/preview', previewRouter);

const practiceExamRouter = require('./routes/practiceExam');
app.use('/api/practice-exam', practiceExamRouter);

// v2 routes
const v2LessonRouter = require('./routes/v2/lesson');
const { gateLessonAccess } = require('./middleware/platformGate');
app.use('/api/v2/lesson', requireAuth, requireActiveSubscription, gateLessonAccess, v2LessonRouter);

const v2SessionRouter = require('./routes/v2/session');
app.use('/api/v2/session', requireAuth, requireActiveSubscription, v2SessionRouter);

const v2CheckpointRouter = require('./routes/v2/checkpoint');
app.use('/api/v2/checkpoint', requireAuth, requireActiveSubscription, v2CheckpointRouter);

const v2CourseRouter = require('./routes/v2/course');
app.use('/api/v2/course', requireAuth, requireActiveSubscription, v2CourseRouter);

const v2ProgressRouter = require('./routes/v2/progress');
app.use('/api/v2/progress', requireAuth, requireActiveSubscription, v2ProgressRouter);

const authRouter = require('./routes/auth');
const platformRouter = require('./routes/platform');
const adminRouter = require('./routes/admin');
const documentsRouter = require('./routes/documents');
const tailoringRouter = require('./routes/tailoring');
const jobsRouter = require('./routes/jobs');

app.use('/api/auth', authRouter);
app.use('/api/platform', platformRouter);
app.use('/api/platform', documentsRouter);
app.use('/api/platform', tailoringRouter);
app.use('/api/admin', adminRouter);
app.use('/api/jobs', jobsRouter);

// Unmatched /api paths are 404s, not React. Must sit after every /api mount and
// before the SPA fallbacks below — otherwise `app.get('*')` answered every
// unknown API path with 200 + index.html, so a typo'd or removed endpoint looked
// like a successful request to any caller that didn't parse the body.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Persistent storage for user-uploaded resumes/cover letters (distinct from MEDIA_DIR,
// which is read-only lesson content, not user uploads).
const USER_UPLOADS_DIR = process.env.USER_UPLOADS_DIR || '/srv/fsa-user-uploads';
fs.mkdirSync(USER_UPLOADS_DIR, { recursive: true });

// Serve lesson media files (bind-mounted from host)
const MEDIA_DIR = process.env.MEDIA_DIR || '/srv/fsa-media';
// Paid narration/slide media was reachable with no credentials whatsoever, on
// any host, and deliberately outside the /api rate limiter — verified live
// 2026-08-16: GET /media/2A1-1-1/slide-003.mp3 -> 200, audio/mpeg, 380,736
// bytes, no cookie. Paths are fully enumerable ({LESSON_CODE}/slide-NNN.{mp3,png}),
// so the whole narration/slide corpus for every paper was scrapeable in a loop.
// Gate it exactly like /api/lesson: requireAuth (identity) then
// requireActiveSubscription (entitlement) ahead of the static handler.
//
// Cache-Control is deliberately `private, max-age=300`, replacing the previous
// `{ maxAge: '5m' }` (which express.static emits as `public, max-age=300`).
// `private` is the actual security requirement here — it excludes Cloudflare
// and every other shared cache, so a request that reaches this handler is
// cached only in the requesting student's own browser, never re-servable to
// anyone else. `no-store` was considered and rejected on review (fix round 1,
// 2026-08-16): it buys only "not on the browser's disk cache", which isn't a
// meaningful control (a logged-in student can save the file regardless), and
// it costs a full narration re-download plus an extra Postgres auth
// round-trip every time a student navigates back to a slide, on mobile data.
// Cloudflare was caching this content at the edge under the old public/max-age
// header (cf-cache-status: REVALIDATED, cache-control: public, max-age=14400)
// — origin-side auth alone leaves those already-cached objects publicly
// retrievable straight from Cloudflare's cache regardless of this fix. A
// Cloudflare-side purge of the cached /media objects and a check of the edge
// cache rule for this path are still required and are tracked separately —
// not attempted here.
app.use(
  '/media',
  requireAuth,
  requireActiveSubscription,
  express.static(MEDIA_DIR, {
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'private, max-age=300');
    },
  })
);
// A missing media file is a missing media file. Without this it fell through to
// the SPA catch-all below and came back as 200 + index.html. Only reached once
// requireAuth/requireActiveSubscription above have already let the request
// through, so no auth duplication needed here.
app.use('/media', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Build output locations. Defaults match the container layout (WORKDIR /app,
// src/ + client-v2/build/ siblings); overridable so tests can point at the
// repo-root build without a rebuild.
const CLIENT_V2_BUILD = process.env.CLIENT_V2_BUILD_DIR || path.join(__dirname, '../client-v2/build');
const CLIENT_V1_BUILD = process.env.CLIENT_V1_BUILD_DIR || path.join(__dirname, '../client/build');

// Requests that name a file are static-asset requests: if the static middleware
// above didn't serve one, it genuinely does not exist and must 404. Only
// extensionless paths are SPA routes eligible for the index.html fallback.
// Returning index.html with a 200 for a missing asset is a soft-404: it hides
// broken references from monitoring, crawlers and cache purges alike.
const STATIC_ASSET_PATH = /\.(js|mjs|cjs|css|map|json|webmanifest|html|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|otf|mp3|mp4|webm|wav|pdf|txt|xml|zip|wasm)$/i;

function sendSpaOrNotFound(req, res, buildDir) {
  if (STATIC_ASSET_PATH.test(req.path)) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.sendFile(path.join(buildDir, 'index.html'));
}

// Serve client-v2 at /v2 (always — for iframe embed on fsachat.*)
app.use('/v2', express.static(CLIENT_V2_BUILD));
app.get('/v2/*', (req, res) => {
  sendSpaOrNotFound(req, res, CLIENT_V2_BUILD);
});

// Retired 2026-07-27: the old Practice Preview lead magnet (client v1,
// fsachat.*?mode=practice_preview) is superseded by the verification-gated
// /free-practice-exam flow on learn.*. Redirect (not delete) since old
// social posts/emails still link here in the wild.
app.get('/', (req, res, next) => {
  if (req.isLegacyMode && req.query.mode === 'practice_preview') {
    return res.redirect(302, 'https://fullsteamahead.ca/free-practice-exam');
  }
  next();
});

// For learn.* serve client-v2 as root; for fsachat.* serve client v1 as root
app.use((req, res, next) => {
  if (req.isPlatformMode) {
    return express.static(CLIENT_V2_BUILD)(req, res, next);
  }
  return express.static(CLIENT_V1_BUILD)(req, res, next);
});

// Catch-all for React routing
app.get('*', (req, res) => {
  return sendSpaOrNotFound(req, res, req.isPlatformMode ? CLIENT_V2_BUILD : CLIENT_V1_BUILD);
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Only bind a port when run as the entrypoint (`node src/index.js`, the
// container CMD). Importing this module in tests must not open a socket.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`fsa-agent server running on port ${PORT}`);
  });
}

module.exports = app;