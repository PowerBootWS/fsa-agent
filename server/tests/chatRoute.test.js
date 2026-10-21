/**
 * /api/chat forwards to the ai-service. Two things it must get right now that
 * the tutor reads saved transcripts and a cross-objective memory (2026-10-13):
 *
 *  - the student is the session owner, never the request body, or one student
 *    could read another's conversations by naming their email;
 *  - the lesson player's slide position and on-screen checkpoint card are
 *    passed through, shape-checked.
 */
const express = require('express');
const request = require('supertest');

jest.mock('axios', () => ({ post: jest.fn() }));
// Entitlement has its own real-DB suite (paperEntitlement.test.js); pass through here.
jest.mock('../src/middleware/requirePaperEntitlement', () => ({ requirePaperEntitlement: () => (req, res, next) => next() }));
jest.mock('../src/services/database', () => ({ getChatTranscript: jest.fn() }));
const axios = require('axios');
const db = require('../src/services/database');
const chatRouter = require('../src/routes/chat');

function app(user = { email: 'owner@example.com' }) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = user; next(); });
  a.use('/api/chat', chatRouter);
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  axios.post.mockResolvedValue({ data: { tutor_response: 'ok' } });
});

const sent = () => axios.post.mock.calls[0][1];

describe('POST /api/chat', () => {
  it('uses the session owner, ignoring a user named in the body', async () => {
    await request(app()).post('/api/chat')
      .send({ user: 'someone-else@example.com', lessonId: '2B1-1-1', message: 'hi' })
      .expect(200);
    expect(sent().user).toBe('owner@example.com');
  });

  it('works when the body names no user at all', async () => {
    await request(app()).post('/api/chat')
      .send({ lessonId: '2B1-1-1', message: 'hi' }).expect(200);
    expect(sent().user).toBe('owner@example.com');
  });

  it('passes the slide number through', async () => {
    await request(app()).post('/api/chat')
      .send({ lessonId: '2B1-1-1', message: 'hi', slideNumber: 22 }).expect(200);
    expect(sent().slideNumber).toBe(22);
  });

  it('drops a slide number that is not a non-negative integer', async () => {
    await request(app()).post('/api/chat')
      .send({ lessonId: '2B1-1-1', message: 'hi', slideNumber: '22' }).expect(200);
    expect(sent()).not.toHaveProperty('slideNumber');
  });

  it('passes a well-formed screen question through', async () => {
    const screenQuestion = {
      question_text: 'Which arrangement?', options: ['a', 'b', 'c', 'd'],
      selected_index: 1, correct_answer: 3,
    };
    await request(app()).post('/api/chat')
      .send({ lessonId: '2B1-1-1', message: 'why?', screenQuestion }).expect(200);
    expect(sent().screenQuestion).toEqual(screenQuestion);
  });

  it('nulls out-of-range indexes and drops a question with no text', () => {
    const clean = chatRouter.cleanScreenQuestion;
    expect(clean({ question_text: 'q', options: ['a'], selected_index: 4, correct_answer: -1 }))
      .toEqual({ question_text: 'q', options: ['a'], selected_index: null, correct_answer: null });
    expect(clean({ question_text: '  ', options: [] })).toBeUndefined();
    expect(clean('nope')).toBeUndefined();
  });
});

describe('POST /api/chat — quick exercise state', () => {
  const last = { question_text: 'Q?', options: ['a', 'b', 'c', 'd'], correct_index: 1, selected_index: 2, explanation: 'why' };

  it('passes a well-formed exercise through', async () => {
    const exercise = { from_slide: 19, after_slide: 22, asked: 2, correct: 1, recap_points: ['p'], last };
    await request(app()).post('/api/chat')
      .send({ lessonId: '2B1-1-1', message: 'I picked C.', exercise }).expect(200);
    expect(sent().exercise).toEqual(exercise);
  });

  it('drops a bad slide range and a malformed last question', () => {
    const clean = chatRouter.cleanExercise;
    expect(clean({ from_slide: 9, after_slide: 3 })).toBeUndefined();
    expect(clean(null)).toBeUndefined();
    const out = clean({ from_slide: 0, after_slide: 3, last: { ...last, options: ['a', 'b'] } });
    expect(out).not.toHaveProperty('last');
    expect(out.asked).toBe(0);
  });
});

describe('GET /api/chat/history/:lessonCode', () => {
  it('returns the session owner\'s conversation for that objective', async () => {
    const messages = [{ role: 'user', content: 'call me Garlock' }, { role: 'assistant', content: 'Will do.' }];
    db.getChatTranscript.mockResolvedValue(messages);

    const res = await request(app()).get('/api/chat/history/2B1-1-1').expect(200);

    expect(db.getChatTranscript).toHaveBeenCalledWith('owner@example.com', '2B1-1-1');
    expect(res.body.messages).toEqual(messages);
  });

  it('cannot be pointed at another student', async () => {
    db.getChatTranscript.mockResolvedValue([]);
    await request(app()).get('/api/chat/history/2B1-1-1?user=someone-else@example.com').expect(200);
    expect(db.getChatTranscript).toHaveBeenCalledWith('owner@example.com', '2B1-1-1');
  });

  it('answers 500 when the lookup fails', async () => {
    db.getChatTranscript.mockRejectedValue(new Error('boom'));
    await request(app()).get('/api/chat/history/2B1-1-1').expect(500);
  });
});
