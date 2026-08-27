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
}));
const db = require('../src/services/database');
const checkpointRouter = require('../src/routes/v2/checkpoint');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v2/checkpoint', checkpointRouter);
  return a;
}

const QUESTION = { id: 1, question_text: 'q', options: ['a', 'b'], correct_answer: 0 };

beforeEach(() => jest.clearAllMocks());

describe('POST /api/v2/checkpoint', () => {
  it('passes the learner\'s current slide to the question pool', async () => {
    db.getLearnerSession.mockResolvedValue({ id: 7, checkpoint_log: [], last_section: 5 });
    db.getCheckpointQuestionPool.mockResolvedValue([QUESTION]);

    await request(app()).post('/api/v2/checkpoint')
      .send({ session_id: 7, lesson_code: '2A2-1-1' }).expect(200);

    expect(db.getCheckpointQuestionPool).toHaveBeenCalledWith('2A2-1-1', 5);
  });

  it('passes null when the session has no recorded slide', async () => {
    // A session created but never advanced. Null means unrestricted rather
    // than "slide 0", which would filter the pool down to nothing.
    db.getLearnerSession.mockResolvedValue({ id: 7, checkpoint_log: [] });
    db.getCheckpointQuestionPool.mockResolvedValue([QUESTION]);

    await request(app()).post('/api/v2/checkpoint')
      .send({ session_id: 7, lesson_code: '2A2-1-1' }).expect(200);

    expect(db.getCheckpointQuestionPool).toHaveBeenCalledWith('2A2-1-1', null);
  });

  it('still returns a question', async () => {
    db.getLearnerSession.mockResolvedValue({ id: 7, checkpoint_log: [], last_section: 20 });
    db.getCheckpointQuestionPool.mockResolvedValue([QUESTION]);

    const res = await request(app()).post('/api/v2/checkpoint')
      .send({ session_id: 7, lesson_code: '2A2-1-1' }).expect(200);

    expect(res.body.question.id).toBe(1);
  });

  it('returns question: null when the lesson has no questions at all', async () => {
    db.getLearnerSession.mockResolvedValue({ id: 7, checkpoint_log: [], last_section: 5 });
    db.getCheckpointQuestionPool.mockResolvedValue([]);

    const res = await request(app()).post('/api/v2/checkpoint')
      .send({ session_id: 7, lesson_code: '2A2-1-1' }).expect(200);

    expect(res.body.question).toBeNull();
  });
});
