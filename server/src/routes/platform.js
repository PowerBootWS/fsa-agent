const express = require('express');
const crypto = require('crypto');
const { pool, getCourseOutline } = require('../services/database');
const { sendMagicLink, sendDeactivationReview } = require('../services/email');
const { CREDIT_PACKS, PACK_ORDER } = require('../config/creditPacks');
const credits = require('../services/credits');

// While the LMS transition stabilizes, automated deactivations are held for operator
// confirmation instead of pulling access immediately. Default ON; set to 'false' to resume
// auto-deactivation (now correctly scoped — see webhook-listener subscription.deleted handler).
const DEACTIVATION_REQUIRES_CONFIRMATION =
  (process.env.DEACTIVATION_REQUIRES_CONFIRMATION || 'true').toLowerCase() !== 'false';
const requireAuth = require('../middleware/requireAuth');
const ghl = require('../services/gohighlevel');

const router = express.Router();

const PAPER_SWITCH_COOLDOWN_DAYS = parseInt(process.env.PAPER_SWITCH_COOLDOWN_DAYS || '7', 10);

/**
 * Middleware: verify x-internal-secret header matches INTERNAL_SECRET env var.
 */
function requireInternalSecret(req, res, next) {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret || req.headers['x-internal-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// POST /api/platform/provision-user
router.post('/provision-user', requireInternalSecret, async (req, res) => {
  try {
    const { email, first_name, last_name, class_code, stripe_subscription_id, phone, address } = req.body;

    if (!email || !first_name || !class_code) {
      return res.status(400).json({ error: 'email, first_name, and class_code are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Upsert platform_users — RETURNING id tells us if the row was just created
    const userInsert = await pool.query(
      `INSERT INTO platform_users (email, first_name, last_name, phone, address)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [normalizedEmail, first_name, last_name || null, phone || null, address || null]
    );
    const userIsNew = userInsert.rowCount > 0;

    const userResult = await pool.query(
      `SELECT id FROM platform_users WHERE email = $1`,
      [normalizedEmail]
    );
    const user = userResult.rows[0];

    // For a returning contact (no insert above), still backfill phone/address from
    // Stripe when provided — COALESCE keeps any existing value if a field is null.
    if (!userIsNew && (phone || address)) {
      await pool.query(
        `UPDATE platform_users
            SET phone = COALESCE($2, phone), address = COALESCE($3, address)
          WHERE id = $1`,
        [user.id, phone || null, address || null]
      );
    }

    // Insert active subscription if none exists — RETURNING id tells us if it was just created.
    // Covers both new subscribers and re-enrollment after cancellation.
    const subInsert = await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper, stripe_subscription_id)
       SELECT $1, $2, 'active', NULL, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM subscriptions
         WHERE user_id = $1 AND status = 'active'
       )
       RETURNING id`,
      [user.id, class_code, stripe_subscription_id || null]
    );
    const subIsNew = subInsert.rowCount > 0;

    // Only send magic link when something was actually new — prevents duplicate emails
    // on Stripe's at-least-once re-delivery of the same checkout event.
    if (userIsNew || subIsNew) {
      const token = crypto.randomUUID();
      await pool.query(
        `INSERT INTO auth_tokens (user_id, token, type, expires_at)
         VALUES ($1, $2, 'magic_link', now() + interval '48 hours')`,
        [user.id, token]
      );
      await sendMagicLink(normalizedEmail, first_name, token);
    } else {
      console.log(`provision-user: idempotent re-delivery for ${normalizedEmail}, skipping magic link`);
    }

    return res.json({ ok: true, user_id: user.id });
  } catch (err) {
    console.error('POST /api/platform/provision-user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/platform/deactivate-user
// Body: { email, cancel_at? }
// cancel_at (Unix timestamp or ISO string): if provided and in the future, schedules deactivation
// at that time rather than deactivating immediately. Access continues until cancel_at.
router.post('/deactivate-user', requireInternalSecret, async (req, res) => {
  try {
    const { email, cancel_at, stripe_subscription_id, force_immediate } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const userResult = await pool.query(
      `SELECT id, first_name, last_name FROM platform_users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Record the cancelled subscription id on the affected active row for traceability,
    // without changing access. (No-op if it was already linked.)
    if (stripe_subscription_id) {
      await pool.query(
        `UPDATE subscriptions SET stripe_subscription_id = $2
         WHERE user_id = $1 AND status = 'active'
           AND (stripe_subscription_id IS NULL OR stripe_subscription_id = '')`,
        [user.id, stripe_subscription_id]
      );
    }

    const cancelAt = cancel_at ? new Date(typeof cancel_at === 'number' ? cancel_at * 1000 : cancel_at) : null;
    const isGracePeriod = cancelAt && cancelAt > new Date();

    if (isGracePeriod) {
      // Subscription canceled but paid through cancel_at — keep status active, set cancel_at.
      // Access is not pulled here, so this path is not gated; the eventual expiry is.
      await pool.query(
        `UPDATE subscriptions SET cancel_at = $2 WHERE user_id = $1 AND status = 'active'`,
        [user.id, cancelAt]
      );
      console.log(`deactivate-user: grace period set for ${email} until ${cancelAt.toISOString()}`);
      return res.json({ ok: true, grace_period: true, cancel_at: cancelAt });
    }

    // Immediate deactivation path.
    // force_immediate bypasses the confirmation gate. Two callers today:
    // (1) fsa-webhook-listener, for trial cancellations — no payment was taken and there is
    //     no paying customer to protect, so the gate that guards paying customers does not apply.
    // (2) fsa-dashboard's reconcile_subscriptions.py, a daily cron job that revokes access for
    //     paying customers with no matching active Stripe subscription — a deliberate, narrower,
    //     owner-authorized bypass (2026-07-11) with its own independent safeguards (safety cap,
    //     stripe_customer_id-or-email matching, fail-closed on any fetch error). See that repo's
    //     reconcile_subscriptions.py docstring and wiki/log.md for the authorization record.
    if (DEACTIVATION_REQUIRES_CONFIRMATION && !force_immediate) {
      // Gate on: do NOT pull access. Notify the operator and keep the customer active.
      const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
      try {
        await sendDeactivationReview({
          name,
          email: email.toLowerCase().trim(),
          stripeSubscriptionId: stripe_subscription_id || null,
          reason: 'Stripe subscription cancelled (no remaining active subscription)',
        });
      } catch (mailErr) {
        console.error('deactivate-user: review email failed:', mailErr.message);
      }
      console.log(`deactivate-user: HELD for confirmation (gate on) — ${email}`);
      return res.json({ ok: true, pending: true });
    }

    await pool.query(
      `UPDATE subscriptions SET status = 'inactive', deactivated_at = now(), cancel_at = NULL
       WHERE user_id = $1 AND status = 'active'`,
      [user.id]
    );
    await pool.query(
      `UPDATE platform_users SET current_session_token = NULL WHERE id = $1`,
      [user.id]
    );
    console.log(`deactivate-user: immediate deactivation for ${email}`);

    return res.json({ ok: true, grace_period: false, cancel_at: null });
  } catch (err) {
    console.error('POST /api/platform/deactivate-user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/platform/expire-grace-periods
// Called daily by cloud routine — finalises deactivation for subscriptions whose cancel_at has passed.
router.post('/expire-grace-periods', requireInternalSecret, async (req, res) => {
  try {
    if (DEACTIVATION_REQUIRES_CONFIRMATION) {
      // Gate on: don't pull access. Email a digest of expired grace periods for confirmation
      // and leave the rows active until the operator confirms.
      const due = await pool.query(
        `SELECT s.user_id, s.stripe_subscription_id, pu.email, pu.first_name, pu.last_name
         FROM subscriptions s JOIN platform_users pu ON pu.id = s.user_id
         WHERE s.status = 'active' AND s.cancel_at IS NOT NULL AND s.cancel_at <= NOW()`
      );
      const pending = due.rowCount;
      if (pending > 0) {
        try {
          await sendDeactivationReview(
            due.rows.map((r) => ({
              name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim(),
              email: r.email,
              stripeSubscriptionId: r.stripe_subscription_id,
              reason: 'Grace period expired (subscription cancelled, paid time ended)',
            }))
          );
        } catch (mailErr) {
          console.error('expire-grace-periods: review email failed:', mailErr.message);
        }
        console.log(`expire-grace-periods: HELD ${pending} subscription(s) for confirmation (gate on)`);
      }
      return res.json({ ok: true, deactivated: 0, pending });
    }

    const result = await pool.query(
      `UPDATE subscriptions
       SET status = 'inactive', deactivated_at = now(), cancel_at = NULL
       WHERE status = 'active' AND cancel_at IS NOT NULL AND cancel_at <= NOW()
       RETURNING user_id`
    );
    const count = result.rowCount;
    if (count > 0) {
      const userIds = result.rows.map(r => r.user_id);
      await pool.query(
        `UPDATE platform_users SET current_session_token = NULL WHERE id = ANY($1)`,
        [userIds]
      );
      console.log(`expire-grace-periods: deactivated ${count} subscription(s), user_ids: ${userIds.join(', ')}`);
    }
    return res.json({ ok: true, deactivated: count });
  } catch (err) {
    console.error('POST /api/platform/expire-grace-periods error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/platform/switch-paper
router.post('/switch-paper', requireAuth, async (req, res) => {
  try {
    const { paper } = req.body;

    if (!paper) {
      return res.status(400).json({ error: 'paper is required' });
    }

    const { subscription_id, last_paper_switch_at } = req.user;

    if (!subscription_id) {
      return res.status(403).json({ error: 'An active subscription is required to select a paper.' });
    }

    if (last_paper_switch_at) {
      const switchedAt = new Date(last_paper_switch_at);
      const now = new Date();
      const diffMs = now - switchedAt;
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      if (diffDays < PAPER_SWITCH_COOLDOWN_DAYS) {
        const daysRemaining = Math.ceil(PAPER_SWITCH_COOLDOWN_DAYS - diffDays);
        return res.status(429).json({ error: 'Paper switch cooldown', days_remaining: daysRemaining });
      }
    }

    await pool.query(
      `UPDATE subscriptions SET active_paper = $1, last_paper_switch_at = now() WHERE id = $2`,
      [paper, subscription_id]
    );

    return res.json({ ok: true, active_paper: paper });
  } catch (err) {
    console.error('POST /api/platform/switch-paper error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/platform/papers-for-class
router.get('/papers-for-class', requireAuth, async (req, res) => {
  const { class_code } = req.user;
  const papers = class_code === 'second'
    ? ['2A1', '2A2', '2A3', '2B1', '2B2', '2B3']
    : ['3A1', '3A2', '3B1', '3B2'];
  return res.json({ papers, class_code });
});

// GET /api/platform/lobby-data
router.get('/lobby-data', requireAuth, async (req, res) => {
  try {
    const { email, active_paper } = req.user;

    if (!active_paper) {
      return res.status(400).json({ error: 'No active paper selected' });
    }

    // 1. Count total objectives for this paper
    const totalObjectivesResult = await pool.query(
      `SELECT COUNT(*) FROM lessons WHERE lesson_code LIKE $1`,
      [`${active_paper}-%`]
    );
    const totalObjectives = parseInt(totalObjectivesResult.rows[0].count);

    // 2. Count completed objectives
    const completedObjectivesResult = await pool.query(
      `SELECT COUNT(*) FROM user_progress
       WHERE user_email = $1 AND lesson_code LIKE $2 AND completed = true`,
      [email, `${active_paper}-%`]
    );
    const completedObjectives = parseInt(completedObjectivesResult.rows[0].count);

    // 3. Last visited lesson
    const lastVisitedResult = await pool.query(
      `SELECT up.lesson_code, l.title, up.last_accessed
       FROM user_progress up
       LEFT JOIN lessons l ON l.lesson_code = up.lesson_code
       WHERE up.user_email = $1 AND up.lesson_code LIKE $2
       ORDER BY up.last_accessed DESC LIMIT 1`,
      [email, `${active_paper}-%`]
    );
    const lastVisited = lastVisitedResult.rows[0] || null;

    // 4. Chapter quiz data — for each chapter, get the latest quiz score
    const chapterQuizResult = await pool.query(
      `SELECT
         qr.chapter_id,
         COUNT(*) as total_questions,
         SUM(CASE WHEN qr.correct THEN 1 ELSE 0 END) as correct_count,
         MAX(qr.answered_at) as last_attempt
       FROM question_responses qr
       WHERE qr.user_email = $1 AND qr.course_id = $2 AND qr.session_type = 'chapter_quiz'
       GROUP BY qr.chapter_id
       ORDER BY qr.chapter_id`,
      [email, active_paper]
    );

    const passingThreshold = parseInt(process.env.QUIZ_PASSING_THRESHOLD || '75', 10);
    const chapterQuizzes = chapterQuizResult.rows.map(row => {
      const score = Math.round((parseInt(row.correct_count) / parseInt(row.total_questions)) * 100);
      return {
        chapter_id: row.chapter_id,
        score,
        total: parseInt(row.total_questions),
        correct: parseInt(row.correct_count),
        last_attempt: row.last_attempt,
        passed: score >= passingThreshold,
      };
    });

    // 5. Practice exam history — last attempt
    const lastExamResult = await pool.query(
      `SELECT
         qr.chapter_id,
         COUNT(*) as total,
         SUM(CASE WHEN qr.correct THEN 1 ELSE 0 END) as correct,
         DATE_TRUNC('minute', MAX(qr.answered_at)) as exam_date
       FROM question_responses qr
       WHERE qr.user_email = $1 AND qr.course_id = $2 AND qr.session_type = 'practice_exam'
         AND qr.answered_at = (
           SELECT MAX(answered_at) FROM question_responses
           WHERE user_email = $1 AND course_id = $2 AND session_type = 'practice_exam'
         )
       GROUP BY qr.chapter_id`,
      [email, active_paper]
    );

    // 6. Total chapters for this paper
    const totalChaptersResult = await pool.query(
      `SELECT COUNT(DISTINCT chapter_num) FROM chapters WHERE course_id = $1`,
      [active_paper]
    );
    const totalChapters = parseInt(totalChaptersResult.rows[0].count);

    const quizzesPassed = chapterQuizzes.filter(q => q.passed).length;
    const avgQuizScore = chapterQuizzes.length > 0
      ? Math.round(chapterQuizzes.reduce((sum, q) => sum + q.score, 0) / chapterQuizzes.length)
      : null;

    // Calculate last exam total score
    let lastExam = null;
    if (lastExamResult.rows.length > 0) {
      const totalCorrect = lastExamResult.rows.reduce((sum, r) => sum + parseInt(r.correct), 0);
      const totalQs = lastExamResult.rows.reduce((sum, r) => sum + parseInt(r.total), 0);
      lastExam = {
        score: Math.round((totalCorrect / totalQs) * 100),
        date: lastExamResult.rows[0].exam_date,
        chapters: lastExamResult.rows.map(r => ({
          chapter_id: r.chapter_id,
          score: Math.round((parseInt(r.correct) / parseInt(r.total)) * 100),
        })),
      };
    }

    // Next quiz ready = first chapter in sequence not yet passed
    const nextQuizChapterId = (() => {
      for (let i = 1; i <= totalChapters; i++) {
        const chapterId = `${active_paper}-${i}`;
        const quiz = chapterQuizzes.find(q => q.chapter_id === chapterId);
        if (!quiz || !quiz.passed) return chapterId;
      }
      return null;
    })();

    return res.json({
      paper: active_paper,
      last_paper_switch_at: req.user.last_paper_switch_at || null,
      progress: {
        completed_objectives: completedObjectives,
        total_objectives: totalObjectives,
        percent: totalObjectives > 0 ? Math.round((completedObjectives / totalObjectives) * 100) : 0,
        last_visited: lastVisited,
      },
      stats: {
        objectives_done: completedObjectives,
        quizzes_passed: quizzesPassed,
        avg_quiz_score: avgQuizScore,
        total_chapters: totalChapters,
      },
      chapter_quizzes: chapterQuizzes,
      next_quiz_chapter_id: nextQuizChapterId,
      last_exam: lastExam,
    });
  } catch (err) {
    console.error('GET /api/platform/lobby-data error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/platform/course-structure/:paperCode
router.get('/course-structure/:paperCode', requireAuth, async (req, res) => {
  try {
    const { email } = req.user;
    const { paperCode } = req.params;
    const PASSING_THRESHOLD = parseInt(process.env.QUIZ_PASSING_THRESHOLD || '75');

    // Get course outline (chapters + objectives)
    const outline = await getCourseOutline(paperCode);

    // Get completed objectives for this user
    const progressResult = await pool.query(
      `SELECT lesson_code FROM user_progress WHERE user_email = $1 AND lesson_code LIKE $2 AND completed = true`,
      [email, `${paperCode}-%`]
    );
    const completedLessons = new Set(progressResult.rows.map(r => r.lesson_code));

    // Get chapter quiz scores
    const quizResult = await pool.query(
      `SELECT chapter_id,
         COUNT(*) as total,
         SUM(CASE WHEN correct THEN 1 ELSE 0 END) as correct
       FROM question_responses
       WHERE user_email = $1 AND course_id = $2 AND session_type = 'chapter_quiz'
       GROUP BY chapter_id`,
      [email, paperCode]
    );
    const quizMap = {};
    for (const row of quizResult.rows) {
      const score = Math.round((parseInt(row.correct) / parseInt(row.total)) * 100);
      quizMap[row.chapter_id] = { score, passed: score >= PASSING_THRESHOLD };
    }

    // Free navigation (2026-06-16): sequential gating disabled — every chapter
    // and objective is unlocked. We still surface `completed` and quiz scores so
    // the UI can show progress, but `locked` is always false.
    const chapters = outline.chapters.map((chapter) => {
      const chapterId = `${paperCode}-${chapter.chapter_num}`;
      const quiz = quizMap[chapterId];
      const quizPassed = quiz?.passed || false;

      const objectives = chapter.objectives.map((obj) => ({
        ...obj,
        completed: completedLessons.has(obj.lesson_code),
        locked: false,
      }));

      return {
        ...chapter,
        chapter_id: chapterId,
        locked: false,
        quiz_score: quiz?.score || null,
        quiz_passed: quizPassed,
        objectives,
      };
    });

    return res.json({ paper: paperCode, chapters });
  } catch (err) {
    console.error('GET /api/platform/course-structure error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/platform/lesson-preview/:lessonCode
// No auth required — used for exam debrief lesson preview
router.get('/lesson-preview/:lessonCode', async (req, res) => {
  try {
    const { lessonCode } = req.params;
    const result = await pool.query(
      `SELECT lesson_code, title, narration_text, summary, key_points
       FROM lessons WHERE lesson_code = $1`,
      [lessonCode]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/platform/lesson-preview error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/platform/check-access
// Query params: type ('lesson'|'chapter_quiz'), lesson_code or chapter_id
// Returns: { allowed: boolean, reason: string|null, required_lesson_code?: string, required_chapter_id?: string }
router.get('/check-access', requireAuth, async (req, res) => {
  // Free navigation (2026-06-16): sequential gating disabled — all access allowed.
  return res.json({ allowed: true });

  /* eslint-disable no-unreachable */
  const { type, lesson_code, chapter_id } = req.query;
  const { email } = req.user;

  const { isChapterQuizPassed, areAllObjectivesComplete } = require('../middleware/platformGate');

  try {
    if (type === 'lesson' && lesson_code) {
      const parts = lesson_code.split('-');
      if (parts.length < 3) return res.json({ allowed: true });

      const courseId = parts[0];
      const chapterNum = parseInt(parts[1], 10);
      const objectiveNum = parseInt(parts[2], 10);

      // Objective 1 of Chapter 1: always unlocked
      if (chapterNum === 1 && objectiveNum === 1) return res.json({ allowed: true });

      // Objective 1 of Chapter N (N>1): require previous chapter quiz passed
      if (objectiveNum === 1 && chapterNum > 1) {
        const prevChapterId = `${courseId}-${chapterNum - 1}`;
        const passed = await isChapterQuizPassed(email, prevChapterId);
        if (!passed) {
          return res.json({ allowed: false, reason: 'chapter_quiz', required_chapter_id: prevChapterId });
        }
        return res.json({ allowed: true });
      }

      // Objective N (N>1): require objective N-1 completed
      const prevLessonCode = `${courseId}-${chapterNum}-${objectiveNum - 1}`;
      const result = await pool.query(
        `SELECT completed FROM user_progress WHERE user_email = $1 AND lesson_code = $2`,
        [email, prevLessonCode]
      );
      const allowed = result.rows.length > 0 && result.rows[0].completed === true;
      return res.json({
        allowed,
        reason: allowed ? null : 'previous_objective',
        required_lesson_code: allowed ? undefined : prevLessonCode,
      });
    }

    if (type === 'chapter_quiz' && chapter_id) {
      const parts = chapter_id.split('-');
      if (parts.length < 2) return res.json({ allowed: true });
      const courseId = parts[0];
      const chapterNum = parseInt(parts[1], 10);
      const allDone = await areAllObjectivesComplete(email, courseId, chapterNum);
      return res.json({
        allowed: allDone,
        reason: allDone ? null : 'objectives_incomplete',
      });
    }

    // Unknown type or missing params — allow through
    return res.json({ allowed: true });
  } catch (err) {
    console.error('GET /api/platform/check-access error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
  /* eslint-enable no-unreachable */
});

// GET /api/platform/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const u = req.user;
    return res.json({
      id: u.id,
      email: u.email,
      first_name: u.first_name,
      last_name: u.last_name,
      phone: u.phone || null,
      address: u.address || null,
      active_paper: u.active_paper,
      class_code: u.class_code,
      status: u.status,
      last_paper_switch_at: u.last_paper_switch_at,
    });
  } catch (err) {
    console.error('GET /api/platform/me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/platform/profile
router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const { first_name, last_name, phone, address } = req.body;
    const userId = req.user.id;

    if (!first_name?.trim() || !last_name?.trim()) {
      return res.status(400).json({ error: 'First and last name are required' });
    }

    const cleanFirst = first_name.trim();
    const cleanLast = last_name.trim();
    const cleanPhone = phone?.trim() || null;
    const cleanAddress = address?.trim() || null;

    await pool.query(
      `UPDATE platform_users SET first_name = $1, last_name = $2, phone = $3, address = $4 WHERE id = $5`,
      [cleanFirst, cleanLast, cleanPhone, cleanAddress, userId]
    );

    // Keep the GoHighLevel contact current so marketing/onboarding/win-back
    // workflows have the latest contact info. GHL is a secondary sink — Postgres
    // is the system of record — so a GHL failure must not fail the save.
    ghl.upsertContact({
      email: req.user.email,
      firstName: cleanFirst,
      lastName: cleanLast,
      phone: cleanPhone,
      address: cleanAddress,
    }).catch(err => {
      console.error('GHL contact sync failed for', req.user.email, '-', err.message);
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/platform/profile error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/platform/credits/packs
// Lists all purchasable credit packs in fixed order (Spark, Full Steam, Locomotive).
router.get('/credits/packs', requireAuth, async (req, res) => {
  const packs = PACK_ORDER.map((id) => {
    const pack = CREDIT_PACKS[id];
    return { id, displayName: pack.displayName, priceLabel: pack.priceLabel, credits: pack.credits };
  });
  return res.json({ packs });
});

// POST /api/platform/credits/checkout
router.post('/credits/checkout', requireAuth, async (req, res) => {
  const { packId } = req.body;
  const pack = CREDIT_PACKS[packId];
  if (!pack) {
    return res.status(400).json({ error: 'Unknown packId' });
  }
  const priceId = process.env[pack.priceIdEnvVar];
  if (!priceId) {
    console.error(`POST /api/platform/credits/checkout: ${pack.priceIdEnvVar} not set`);
    // 500, not 502 — Cloudflare's edge overrides 502/504/52x response bodies with its own
    // HTML error page even for a well-formed origin JSON response (see wiki/projects/fsa-agent.md).
    return res.status(500).json({ error: 'This pack is not available right now. Please try again later.' });
  }

  try {
    const Stripe = require('stripe');
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    let customerId = req.user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: `${req.user.first_name} ${req.user.last_name}`.trim(),
        metadata: { userId: String(req.user.id) },
      });
      customerId = customer.id;
      await pool.query(
        `UPDATE platform_users SET stripe_customer_id = $1 WHERE id = $2 AND stripe_customer_id IS NULL`,
        [customerId, req.user.id]
      );
    }

    const baseUrl = process.env.PLATFORM_BASE_URL || 'https://learn.fullsteamahead.ca';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userId: String(req.user.id), packId, purpose: 'credit_pack' },
      success_url: `${baseUrl}/credits?purchase=success`,
      cancel_url: `${baseUrl}/credits?purchase=cancelled`,
    });

    return res.status(201).json({ url: session.url });
  } catch (err) {
    console.error('POST /api/platform/credits/checkout error:', err);
    return res.status(500).json({ error: "Couldn't start checkout. Please try again." });
  }
});

// POST /api/platform/billing-portal
// Creates a Stripe Customer Portal session and returns the URL.
router.post('/billing-portal', requireAuth, async (req, res) => {
  try {
    const stripeSubId = req.user.stripe_subscription_id;
    if (!stripeSubId) {
      return res.status(400).json({ error: 'No Stripe subscription on file. Contact support@fullsteamahead.ca.' });
    }

    const Stripe = require('stripe');
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    const subscription = await stripe.subscriptions.retrieve(stripeSubId);
    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

    const returnUrl = `${process.env.PLATFORM_BASE_URL || 'https://learn.fullsteamahead.ca'}/lobby`;
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('POST /api/platform/billing-portal error:', err);
    return res.status(500).json({ error: 'Failed to open billing portal. Please contact support@fullsteamahead.ca.' });
  }
});

// POST /api/platform/credits/grant-purchase
router.post('/credits/grant-purchase', requireInternalSecret, async (req, res) => {
  const { userId, packId, stripeSessionId } = req.body;
  const pack = CREDIT_PACKS[packId];
  if (!userId || !pack || !stripeSessionId) {
    return res.status(400).json({ error: 'userId, a valid packId, and stripeSessionId are required' });
  }

  try {
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      result = await credits.addCredits(client, userId, pack.credits, 'stripe_purchase', stripeSessionId);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return res.status(result.alreadyProcessed ? 200 : 201).json({ ok: true, alreadyProcessed: result.alreadyProcessed });
  } catch (err) {
    console.error('POST /api/platform/credits/grant-purchase error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
