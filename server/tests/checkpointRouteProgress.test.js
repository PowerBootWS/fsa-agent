/**
 * Backlog #102 — the checkpoint route knew the learner's progress and threw it away.
 *
 * `learner_sessions.last_section` is PATCHed by the player on every slide
 * advance, and the route already loads the session to read `checkpoint_log`.
 * It just never passed the slide number to the pool query, so the pool could
 * offer a question from material the student had not reached.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../src/services/database', () => ({
  getLearnerSession: jest.fn(),
  getCheckpointQuestionPool: jest.fn(),
  getCheckinForSlide: jest.fn(),
}));
// Entitlement has its own real-DB suite (paperEntitlement.test.js); pass through here.
jest.mock('../src/middleware/requirePaperEntitlement', () => ({ requirePaperEntitlement: () => (req, res, next) => next() }));
const db = require('../src/services/database');
const checkpointRouter = require('../src/routes/v2/checkpoint');

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { id: 1, email: 'owner@example.com' }; next(); });
  a.use('/api/v2/checkpoint', checkpointRouter);
  return a;
}

const QUESTION = { id: 1, question_text: 'q', options: ['a', 'b'], correct_answer: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  db.getCheckinForSlide.mockResolvedValue(null);
});

describe('POST /api/v2/checkpoint', () => {
  it('passes the learner\'s current slide to the question pool', async () => {
    db.getLearnerSession.mockResolvedValue({ learner_id: 'owner@example.com', id: 7, checkpoint_log: [], last_section: 5 });
    db.getCheckpointQuestionPool.mockResolvedValue([QUESTION]);

    await request(app()).post('/api/v2/checkpoint')
      .send({ session_id: 7, lesson_code: '2A2-1-1' }).expect(200);

    expect(db.getCheckpointQuestionPool).toHaveBeenCalledWith('2A2-1-1', 5);
  });

  it('passes null when the session has no recorded slide', async () => {
    // A session created but never advanced. Null means unrestricted rather
    // than "slide 0", which would filter the pool down to nothing.
    db.getLearnerSession.mockResolvedValue({ learner_id: 'owner@example.com', id: 7, checkpoint_log: [] });
    db.getCheckpointQuestionPool.mockResolvedValue([QUESTION]);

    await request(app()).post('/api/v2/checkpoint')
      .send({ session_id: 7, lesson_code: '2A2-1-1' }).expect(200);

    expect(db.getCheckpointQuestionPool).toHaveBeenCalledWith('2A2-1-1', null);
  });

  it('still returns a question', async () => {
    db.getLearnerSession.mockResolvedValue({ learner_id: 'owner@example.com', id: 7, checkpoint_log: [], last_section: 20 });
    db.getCheckpointQuestionPool.mockResolvedValue([QUESTION]);

    const res = await request(app()).post('/api/v2/checkpoint')
      .send({ session_id: 7, lesson_code: '2A2-1-1' }).expect(200);

    expect(res.body.question.id).toBe(1);
  });

  it('returns question: null when the lesson has no questions at all', async () => {
    db.getLearnerSession.mockResolvedValue({ learner_id: 'owner@example.com', id: 7, checkpoint_log: [], last_section: 5 });
    db.getCheckpointQuestionPool.mockResolvedValue([]);

    const res = await request(app()).post('/api/v2/checkpoint')
      .send({ session_id: 7, lesson_code: '2A2-1-1' }).expect(200);

    expect(res.body.question).toBeNull();
  });

  it('returns the check-in card for the learner\'s slide alongside the question', async () => {
    const card = { id: 3, after_slide: 3, recap_points: ['a', 'b'], exercise_prompt: 'Try some?' };
    db.getLearnerSession.mockResolvedValue({ learner_id: 'owner@example.com', id: 7, checkpoint_log: [], last_section: 4 });
    db.getCheckpointQuestionPool.mockResolvedValue([QUESTION]);
    db.getCheckinForSlide.mockResolvedValue(card);

    const res = await request(app()).post('/api/v2/checkpoint')
      .send({ session_id: 7, lesson_code: '2A2-1-1' }).expect(200);

    expect(db.getCheckinForSlide).toHaveBeenCalledWith('2A2-1-1', 4);
    expect(res.body.checkin).toEqual(card);
    expect(res.body.question.id).toBe(1);
  });

  it('still serves the question when the check-in lookup fails', async () => {
    db.getLearnerSession.mockResolvedValue({ learner_id: 'owner@example.com', id: 7, checkpoint_log: [], last_section: 4 });
    db.getCheckpointQuestionPool.mockResolvedValue([QUESTION]);
    db.getCheckinForSlide.mockRejectedValue(new Error('relation "lesson_checkins" does not exist'));

    const res = await request(app()).post('/api/v2/checkpoint')
      .send({ session_id: 7, lesson_code: '2A2-1-1' }).expect(200);

    expect(res.body.question.id).toBe(1);
    expect(res.body.checkin).toBeNull();
  });

  it('prefers the slide number the player sends over the session copy', async () => {
    db.getLearnerSession.mockResolvedValue({ learner_id: 'owner@example.com', id: 7, checkpoint_log: [], last_section: 3 });
    db.getCheckpointQuestionPool.mockResolvedValue([QUESTION]);

    await request(app()).post('/api/v2/checkpoint')
      .send({ session_id: 7, lesson_code: '2A2-1-1', slide_number: 8 }).expect(200);

    expect(db.getCheckinForSlide).toHaveBeenCalledWith('2A2-1-1', 8);
    expect(db.getCheckpointQuestionPool).toHaveBeenCalledWith('2A2-1-1', 8);
  });
});
