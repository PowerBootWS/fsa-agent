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
    ];
    if (!origin || allowedOrigins.some(o => origin.includes(o.replace('https://', '')))) {
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

// Apply requireAuth only when request comes from learn.* (platform mode)
function platformAuth(req, res, next) {
  if (req.isPlatformMode) return requireAuth(req, res, next);
  return next();
}

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

app.use('/api', limiter);
app.use('/api/validate', validateRouter);
app.use('/api/lesson', platformAuth, lessonRouter);
app.use('/api/chat', platformAuth, chatRouter);
app.use('/api/progress', progressRouter);
app.use('/api/chat-history', chatHistoryRouter);
app.use('/api/enroll', enrollRouter);
app.use('/api/responses', responsesRouter);
app.use('/api/demo', demoRouter);

const diagnosticRouter = require('./routes/diagnostic');
app.use('/api/diagnostic', diagnosticRouter);

const examRouter = require('./routes/exam');
app.use('/api/exam', examRouter);
app.use('/api/preview', previewRouter);

// v2 routes
const v2LessonRouter = require('./routes/v2/lesson');
const { gateLessonAccess } = require('./middleware/platformGate');
app.use('/api/v2/lesson', platformAuth, gateLessonAccess, v2LessonRouter);

const v2SessionRouter = require('./routes/v2/session');
app.use('/api/v2/session', platformAuth, v2SessionRouter);

const v2CheckpointRouter = require('./routes/v2/checkpoint');
app.use('/api/v2/checkpoint', platformAuth, v2CheckpointRouter);

const v2CourseRouter = require('./routes/v2/course');
app.use('/api/v2/course', platformAuth, v2CourseRouter);

const v2ProgressRouter = require('./routes/v2/progress');
app.use('/api/v2/progress', platformAuth, v2ProgressRouter);

const authRouter = require('./routes/auth');
const platformRouter = require('./routes/platform');
const adminRouter = require('./routes/admin');
const documentsRouter = require('./routes/documents');
const jobsRouter = require('./routes/jobs');

app.use('/api/auth', authRouter);
app.use('/api/platform', platformRouter);
app.use('/api/platform', documentsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/jobs', jobsRouter);

// Persistent storage for user-uploaded resumes/cover letters (distinct from MEDIA_DIR,
// which is read-only lesson content, not user uploads).
const USER_UPLOADS_DIR = process.env.USER_UPLOADS_DIR || '/srv/fsa-user-uploads';
fs.mkdirSync(USER_UPLOADS_DIR, { recursive: true });

// Serve lesson media files (bind-mounted from host)
const MEDIA_DIR = process.env.MEDIA_DIR || '/srv/fsa-media';
app.use('/media', express.static(MEDIA_DIR, { maxAge: '5m' }));

// Serve client-v2 at /v2 (always — for iframe embed on fsachat.*)
app.use('/v2', express.static(path.join(__dirname, '../client-v2/build')));
app.get('/v2/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client-v2/build/index.html'));
});

// For learn.* serve client-v2 as root; for fsachat.* serve client v1 as root
app.use((req, res, next) => {
  if (req.isPlatformMode) {
    return express.static(path.join(__dirname, '../client-v2/build'))(req, res, next);
  }
  return express.static(path.join(__dirname, '../client/build'))(req, res, next);
});

// Catch-all for React routing
app.get('*', (req, res) => {
  if (req.isPlatformMode) {
    return res.sendFile(path.join(__dirname, '../client-v2/build/index.html'));
  }
  return res.sendFile(path.join(__dirname, '../client/build/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`fsa-agent server running on port ${PORT}`);
});

module.exports = app;