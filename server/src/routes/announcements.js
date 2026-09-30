// "What's new" pop-up API. A failure on the read path answers "nothing to
// show": an announcement must never get in the way of someone's course.
const express = require('express');
const { telegram } = require('fsa-common');
const { pool } = require('../services/database');
const requireAuth = require('../middleware/requireAuth');
const affiliateClient = require('../services/affiliateClient');
const { createRateLimiter } = require('../utils/rateLimit');
const {
  findNextForUser, recordView, saveFeedback, announcementExists,
} = require('../services/announcements');

const router = express.Router();
const feedbackLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
const MAX_FEEDBACK = 2000;

function parseId(raw) {
  return /^\d+$/.test(String(raw)) ? Number(raw) : null;
}

router.get('/announcements/next', requireAuth, async (req, res) => {
  try {
    const announcement = await findNextForUser(pool, req.user, {
      isAffiliate: async (email) => (await affiliateClient.getSummary(email))?.is_affiliate === true,
    });
    return res.json({ announcement });
  } catch (err) {
    console.error('GET /api/platform/announcements/next error:', err);
    return res.json({ announcement: null });
  }
});

router.post('/announcements/:id/seen', requireAuth, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null || !(await announcementExists(pool, id))) return res.status(404).json({ error: 'Not found' });
    const action = req.body?.action;
    if (action !== 'dismissed' && action !== 'cta') return res.status(400).json({ error: 'action must be dismissed or cta' });
    await recordView(pool, id, req.user.id, action);
    return res.status(204).end();
  } catch (err) {
    console.error('POST /api/platform/announcements/:id/seen error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/announcements/:id/feedback', requireAuth, async (req, res) => {
  let announcement;
  let message;
  try {
    const id = parseId(req.params.id);
    announcement = id === null ? null : await announcementExists(pool, id);
    if (!announcement) return res.status(404).json({ error: 'Not found' });
    message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message || message.length > MAX_FEEDBACK) {
      return res.status(400).json({ error: `Feedback must be 1 to ${MAX_FEEDBACK} characters` });
    }
    if (!feedbackLimiter.check(String(req.user.id))) {
      return res.status(429).json({ error: 'That is a lot of feedback at once. Try again in a bit.' });
    }
    await saveFeedback(pool, announcement.id, req.user.id, message);
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('POST /api/platform/announcements/:id/feedback error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  // After the response: nothing here may reject unhandled.
  const u = req.user;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
  telegram.notifyOwner(
    `💡 Feedback on "${announcement.title}"\n\n` +
    `From: ${name || '(no name)'} <${u.email}>\n\n` +
    message
  ).catch(err => console.error('announcement feedback notify failed (non-fatal):', err.message));
});

module.exports = router;
