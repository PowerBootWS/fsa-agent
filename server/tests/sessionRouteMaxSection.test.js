/**
 * The furthest slide a student has reached by Next (2026-10-14). The lesson
 * player uses it so a check-in card is shown once, not again every time the
 * student goes back and steps forward over the same slides.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../src/services/database', () => ({ updateLearnerSession: jest.fn(), getLearnerSession: jest.fn() }));
const db = require('../src/services/database');
const sessionRouter = require('../src/routes/v2/session');

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { id: 1, email: 'owner@example.com' }; next(); });
  a.use('/api/v2/session', sessionRouter);
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  db.updateLearnerSession.mockResolvedValue({ id: 's1', max_section: 8 });
  db.getLearnerSession.mockResolvedValue({ id: 's1', learner_id: 'owner@example.com' });
});

describe('PATCH /api/v2/session/:id — max_section', () => {
  it('passes a slide number through', async () => {
    await request(app()).patch('/api/v2/session/s1').send({ last_section: 8, max_section: 8 }).expect(200);
    expect(db.updateLearnerSession).toHaveBeenCalledWith('s1', expect.objectContaining({ lastSection: 8, maxSection: 8 }));
  });

  it('leaves it alone when absent or not a non-negative integer', async () => {
    for (const max_section of [undefined, '8', -1, 2.5, null]) {
      db.updateLearnerSession.mockClear();
      await request(app()).patch('/api/v2/session/s1').send({ last_section: 3, max_section }).expect(200);
      expect(db.updateLearnerSession.mock.calls[0][1].maxSection).toBeUndefined();
    }
  });
});
