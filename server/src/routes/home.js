// Home page (/home): one call for all six cards. Every section is computed
// independently and comes back null on its own failure, so a slow affiliate
// service or jobs API never takes the page down.
const express = require('express');
const { pool } = require('../services/database');
const requireAuth = require('../middleware/requireAuth');
const credits = require('../services/credits');
const affiliateClient = require('../services/affiliateClient');
const { getNewJobsCount } = require('../services/newJobsCount');
const { getCourseSection, getJobsSection, hasResumeOnFile } = require('../services/homeSummary');
const { sendAffiliateWelcome } = require('../services/email');

const router = express.Router();

async function settle(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`GET /api/platform/home ${label} error:`, err);
    return null;
  }
}

router.get('/home', requireAuth, async (req, res) => {
  const u = req.user;
  const [course, jobs, balance, resumeOnFile, newJobs, affiliate] = await Promise.all([
    settle('course', () => getCourseSection(pool, u.id, u.email)),
    settle('jobs', () => getJobsSection(pool, u.id)),
    settle('credits', () => credits.getBalance(u.id)),
    settle('resume', () => hasResumeOnFile(pool, u.id)),
    getNewJobsCount(),
    affiliateClient.getSummary(u.email),
  ]);
  return res.json({
    first_name: u.first_name,
    course,
    jobs,
    credits: balance === null ? null : { balance },
    resume_on_file: resumeOnFile,
    new_jobs_7d: newJobs,
    affiliate,
  });
});

router.post('/affiliate/join', requireAuth, async (req, res) => {
  const u = req.user;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
  let result;
  try {
    result = await affiliateClient.join({ name, email: u.email });
  } catch (err) {
    console.error('POST /api/platform/affiliate/join error:', err.message);
    return res.status(502).json({ error: "Couldn't join right now, try again in a minute." });
  }

  if (!result || !result.affiliate) {
    console.error('POST /api/platform/affiliate/join: service returned no affiliate');
    return res.status(502).json({ error: "Couldn't join right now, try again in a minute." });
  }

  try {
    if (result.affiliate.status !== 'active') {
      return res.status(409).json({
        error: "Your referral account is paused. Reply to any Full Steam Ahead email and we'll sort it out.",
      });
    }

    if (result.created) {
      try {
        await sendAffiliateWelcome(u.email, u.first_name, result.affiliate.code);
      } catch (err) {
        console.error('affiliate welcome email failed for user', u.id, '-', err.message);
      }
    }

    const summary = await affiliateClient.getSummary(u.email);
    const affiliate = summary && summary.is_affiliate ? summary : {
      is_affiliate: true,
      code: result.affiliate.code,
      referral_url: `https://fullsteamahead.ca/?am_id=${result.affiliate.code}`,
      referred_count: 0,
      paying_referrals_count: 0,
      earned_cents: 0,
    };
    return res.json({ affiliate });
  } catch (err) {
    console.error('POST /api/platform/affiliate/join post-join error:', err.message);
    return res.status(502).json({ error: "Couldn't join right now, try again in a minute." });
  }
});

module.exports = router;
