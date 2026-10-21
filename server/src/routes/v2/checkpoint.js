// fsa-agent/server/src/routes/v2/checkpoint.js
const express = require('express');
const router = express.Router();
const db = require('../../services/database');
const { requirePaperEntitlement } = require('../../middleware/requirePaperEntitlement');

// Sessions belong to the signed-in student. The learner id used to come from the
// request body (the client sent its own email), so any subscriber could read or
// rewrite another student's lesson session. Student-access audit, 2026-10-21.
const sameLearner = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// POST /api/v2/checkpoint
// Body: { session_id, lesson_code }
//
// Returns a practice question, plus the check-in recap card for this point in
// the lesson when one exists (`checkin`, else null). There used to be an
// LLM-written check-in message alongside it ("Try this practice question to
// test your understanding…"), generated before we knew whether a question was
// actually available — so an exhausted question pool produced a chatty message
// pointing at a question that never rendered. The question card introduces
// itself; the blurb added length, latency and an OpenRouter call for nothing.
router.post('/', requirePaperEntitlement(req => req.body && req.body.lesson_code), async (req, res) => {
  const { session_id, lesson_code } = req.body;
  if (!session_id || !lesson_code) {
    return res.status(400).json({ error: 'session_id and lesson_code required' });
  }

  try {
    const session = await db.getLearnerSession(session_id);
    if (!session || !sameLearner(session.learner_id, req.user && req.user.email)) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // The learner's progress is right here on the session and used to be
    // thrown away: the pool was queried without it, so a checkpoint four
    // slides in could offer a question whose formula appears ten slides later
    // (backlog #102). `??` rather than `||` so slide 0 stays slide 0.
    // The player sends the slide it is arriving at, because its last_section
    // PATCH is fire-and-forget and can land after this request. Fall back to
    // the session's copy for older clients.
    const { slide_number } = req.body;
    const lastSection = Number.isInteger(slide_number) ? slide_number : (session.last_section ?? null);

    // The recap card for this checkpoint (slice 3 of the lesson tutor
    // redesign). Optional by construction: a missing card, a missing table or
    // a failed query must never cost the student the practice question.
    let checkin = null;
    try {
      checkin = await db.getCheckinForSlide(lesson_code, lastSection);
    } catch (err) {
      console.error('checkpoint checkin lookup failed:', err.message);
    }

    const questions = await db.getCheckpointQuestionPool(lesson_code, lastSection);
    if (questions.length === 0) return res.json({ question: null, checkin });

    const askedIds = (session.checkpoint_log || [])
      .map(e => e.question_id)
      .filter(Boolean);

    // Prefer one they have never seen; otherwise recycle the one asked longest
    // ago (position in the log is the ordering — it is append-only).
    let question = questions.find(q => !askedIds.includes(q.id));
    if (!question) {
      const lastAskedAt = new Map(questions.map(q => [q.id, -1]));
      askedIds.forEach((id, i) => {
        if (lastAskedAt.has(id)) lastAskedAt.set(id, i);
      });
      question = questions.reduce(
        (oldest, q) => (lastAskedAt.get(q.id) < lastAskedAt.get(oldest.id) ? q : oldest),
        questions[0]
      );
    }

    res.json({ question, checkin });
  } catch (err) {
    console.error('checkpoint error:', err.message);
    res.status(500).json({ error: 'Checkpoint failed' });
  }
});

module.exports = router;
