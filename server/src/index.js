require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      frameAncestors: [`'self'`, process.env.PARENT_DOMAIN || 'localhost'],
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

// CORS - restrict to parent domain only
const corsOptions = {
  origin: process.env.PARENT_DOMAIN || 'http://localhost:8080',
  credentials: true,
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Parse JSON bodies
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Routes
const validateRouter = require('./routes/validate');
const lessonRouter = require('./routes/lesson');
const chatRouter = require('./routes/chat');
const progressRouter = require('./routes/progress');
const chatHistoryRouter = require('./routes/chat-history');
const enrollRouter = require('./routes/enroll');

app.use('/api/validate', validateRouter);
app.use('/api/lesson', lessonRouter);
app.use('/api/chat', chatRouter);
app.use('/api/progress', progressRouter);
app.use('/api/chat-history', chatHistoryRouter);
app.use('/api/enroll', enrollRouter);

// Serve React app from client build
app.use(express.static(path.join(__dirname, '../client/build')));

// Handle React routing - return index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/build/index.html'));
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