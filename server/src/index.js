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
const chatHistoryRouter = require('./routes/chat-history');
const enrollRouter = require('./routes/enroll');
const responsesRouter = require('./routes/responses');
const demoRouter = require('./routes/demo');
const previewRouter = require('./routes/preview');

const requireLearnHost = require('./middleware/requireLearnHost');
app.use('/api', requireLearnHost);
app.use('/api', limiter);
app.use('/api/validate', validateRouter);
app.use('/api/lesson', requireAuth, requireActiveSubscription, lessonRouter);
app.use('/api/chat', requireAuth, requireActiveSubscription, chatRouter);
// requireAuth unconditionally: this route was reachable with no credentials on
// BOTH learn.* and fsachat.*, and platformAuth (now removed) passed through on
// the legacy host, so it would have left the hole open there. Nothing in
// client/, client-v2/ or ai-service/ calls this route, so there is no legacy
// caller to preserve. Entitlement gate matches /api/lesson and /api/chat.
app.use('/api/progress', requireAuth, requireActiveSubscription, progressRouter);
app.use('/api/chat-history', chatHistoryRouter);
app.use('/api/enroll', enrollRouter);
app.use('/api/responses', responsesRouter);
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
app.use('/media', express.static(MEDIA_DIR, { maxAge: '5m' }));
// A missing media file is a missing media file. Without this it fell through to
// the SPA catch-all below and came back as 200 + index.html.
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