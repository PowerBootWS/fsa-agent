// "Contact support" from inside the platform (backlog #31, 2026-10-12).
//
// Until now the only way to reach us from a lesson was to dig up the support@
// address, and students were replying to nurture mail or writing to Russ's own
// inbox instead. This turns a short form into an email in support@, with
// Reply-To set to the student so answering it is just "Reply", plus a Telegram
// ping so it is seen the same day.
//
// It is sent FROM support@, so fsa-customer-support's pipeline treats the
// thread as "last sender is us" and does not auto-triage it. That is the
// intent: these are course-content reports and suggestions for Russ to read,
// not routine tickets for an automated reply.
const express = require('express');
const { email, telegram } = require('fsa-common');
const requireAuth = require('../middleware/requireAuth');
const { createRateLimiter } = require('../utils/rateLimit');

const router = express.Router();
const limiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

const SUPPORT = 'support@fullsteamahead.ca';
const MAX_MESSAGE = 4000;
const CATEGORIES = {
  problem: 'Something is not working',
  content: 'Error in the course material',
  suggestion: 'Suggestion',
  other: 'Other',
};

function clip(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

router.post('/support-message', requireAuth, async (req, res) => {
  const category = CATEGORIES[req.body?.category] ? req.body.category : 'other';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > MAX_MESSAGE) {
    return res.status(400).json({ error: `Message must be 1 to ${MAX_MESSAGE} characters` });
  }
  if (!limiter.check(String(req.user.id))) {
    return res.status(429).json({ error: 'That is a lot of messages at once. Try again in a bit, or email support@fullsteamahead.ca.' });
  }

  const u = req.user;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || '(no name)';
  const page = clip(req.body?.page, 200);
  const lesson = clip(req.body?.lesson_code, 40);
  const label = CATEGORIES[category];
  const firstLine = message.split('\n')[0].slice(0, 60);

  const text = [
    message,
    '',
    '---',
    `From: ${name} <${u.email}>`,
    `Type: ${label}`,
    page && `Page: ${page}`,
    lesson && `Lesson: ${lesson}`,
    'Sent with the Contact support form on learn.fullsteamahead.ca. Reply to answer the student directly.',
  ].filter(Boolean).join('\n');

  try {
    await email.sendEmail({
      from: `Full Steam Ahead <${SUPPORT}>`,
      to: SUPPORT,
      replyTo: `${name} <${u.email}>`,
      subject: `[In-app] ${label}: ${firstLine}`,
      text,
    });
  } catch (err) {
    console.error('POST /api/platform/support-message send failed:', err);
    return res.status(502).json({ error: "Couldn't send that. Please email support@fullsteamahead.ca." });
  }
  res.status(201).json({ ok: true });

  // After the response: nothing here may reject unhandled.
  telegram.notifyOwner(
    `📨 In-app message (${label})\n\nFrom: ${name} <${u.email}>` +
    (lesson ? `\nLesson: ${lesson}` : '') + (page ? `\nPage: ${page}` : '') +
    `\n\n${message.slice(0, 1500)}\n\nIt's in support@; reply there.`
  ).catch(err => console.error('support message notify failed (non-fatal):', err.message));
});

module.exports = router;
