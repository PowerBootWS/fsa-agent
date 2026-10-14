/**
 * Backlog #68 — the tutor's failure path.
 *
 * `/api/chat` answering 500 with `{"error":"..."}` used to parse fine, so the
 * student saw "Sorry, I could not respond right now." — a message that reads
 * like the tutor declining, not like the platform being broken. The Cloudflare
 * HTML case was worse: `res.json()` threw from inside a parse nobody expected
 * to fail. Both now reach the connection-error path the component already had.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TutorPanel, screenQuestionFrom } from './TutorPanel';

const CONNECTION_ERROR = /connection error/i;

function ask(question = 'what is superheat?') {
  render(<TutorPanel lessonCode="2A2-1-1" learnerId="student@test.example" sectionIndex={0} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: /send/i }));
}

beforeEach(() => { globalThis.fetch = vi.fn(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('TutorPanel', () => {
  it('reports a connection problem when the chat API 500s', async () => {
    // `json` is deliberately present and working: without it the pre-#68 code
    // would blow up on `res.json is not a function` and land in the same catch,
    // and the test would pass against the bug it exists to catch.
    const body = { error: 'ai-service unreachable' };
    globalThis.fetch.mockResolvedValue({
      ok: false, status: 500,
      text: async () => JSON.stringify(body),
      json: async () => body,
    });

    ask();

    expect(await screen.findByText(CONNECTION_ERROR)).toBeInTheDocument();
  });

  it('reports a connection problem on a Cloudflare HTML gateway error', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false, status: 502,
      text: async () => '<!DOCTYPE html><title>502 Bad Gateway</title>',
    });

    ask();

    expect(await screen.findByText(CONNECTION_ERROR)).toBeInTheDocument();
  });

  it('shows the tutor\'s reply when the call succeeds', async () => {
    const body = { tutor_response: 'Superheat is heat above saturation.' };
    globalThis.fetch.mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
    });

    ask();

    expect(await screen.findByText(/heat above saturation/i)).toBeInTheDocument();
    expect(screen.queryByText(CONNECTION_ERROR)).not.toBeInTheDocument();
  });
});

/**
 * First NPS response (2026-10-13): the chat was wiped on every slide, and the
 * tutor had no idea which slide or practice card the student was looking at.
 */
describe('TutorPanel — thread and grounding', () => {
  const ok = body => ({
    ok: true, status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
  const lastBody = () => JSON.parse(globalThis.fetch.mock.calls.at(-1)[1].body);

  it('keeps the conversation when the student moves to another slide', async () => {
    globalThis.fetch.mockResolvedValue(ok({ tutor_response: 'Superheat is heat above saturation.' }));
    const { rerender } = render(<TutorPanel lessonCode="2A2-1-1" learnerId="s@test.example" slideNumber={3} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'what is superheat?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText(/heat above saturation/i);

    rerender(<TutorPanel lessonCode="2A2-1-1" learnerId="s@test.example" slideNumber={4} />);

    expect(screen.getByText(/heat above saturation/i)).toBeInTheDocument();
    expect(screen.getByText('what is superheat?')).toBeInTheDocument();
  });

  it('sends the slide the student is on', async () => {
    globalThis.fetch.mockResolvedValue(ok({ tutor_response: 'ok' }));
    render(<TutorPanel lessonCode="2B1-1-1" learnerId="s@test.example" slideNumber={22} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'which arrangement?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('ok');

    expect(lastBody().slideNumber).toBe(22);
    expect(lastBody().screenQuestion).toBeUndefined();
  });

  it('reports the on-screen card, with the answer only once it is picked', () => {
    const question = { id: 9, question_text: 'Which?', options: ['a', 'b', 'c', 'd'], correct_answer: 3 };
    expect(screenQuestionFrom([{ type: 'question', question }])).toEqual({
      question_text: 'Which?', options: ['a', 'b', 'c', 'd'], selected_index: null, correct_answer: null,
    });
    expect(screenQuestionFrom([{ type: 'question', question, answerIndex: 1 }, { type: 'tutor', text: 'x' }]))
      .toEqual({ question_text: 'Which?', options: ['a', 'b', 'c', 'd'], selected_index: 1, correct_answer: 3 });
    expect(screenQuestionFrom([{ type: 'tutor', text: 'x' }])).toBeUndefined();
  });
});

describe('TutorPanel — drawer mode', () => {
  const ok = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });
  const chatBodies = () => globalThis.fetch.mock.calls
    .filter(([url]) => url === '/api/chat').map(([, opts]) => JSON.parse(opts.body));

  it('shows the saved conversation for the objective', async () => {
    globalThis.fetch.mockImplementation(async url => (
      url.startsWith('/api/chat/history/')
        ? ok({ messages: [{ role: 'user', content: 'call me Garlock' }, { role: 'assistant', content: 'You got it, Garlock.' }] })
        : ok({})
    ));
    render(<TutorPanel drawer lessonCode="2B1-1-1" learnerId="s@test.example" slideNumber={5} onClose={() => {}} />);
    expect(await screen.findByText('You got it, Garlock.')).toBeInTheDocument();
    expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/chat/history/2B1-1-1');
  });

  it('runs a quick exercise: card per question, graded click sent back, done button at the end', async () => {
    const q = n => ({ question_text: `Question ${n}?`, options: ['a', 'b', 'c', 'd'], correct_answer: 1, explanation: 'because' });
    let turn = 0;
    globalThis.fetch.mockImplementation(async url => {
      if (url !== '/api/chat') return ok({ messages: [] });
      turn += 1;
      if (turn <= 4) return ok({ tutor_response: `Reply ${turn}`, exercise_question: q(turn) });
      return ok({ tutor_response: 'Nice work, 4 of 4.', exercise_question: null, exercise_done: true });
    });
    const onFinish = vi.fn();
    const card = { question_text: 'Card?', options: ['x', 'y'], selected_index: null, correct_answer: null };
    render(<TutorPanel drawer lessonCode="2B1-1-1" learnerId="s" slideNumber={23} screenQuestion={card}
      exerciseStart={{ id: 1, from_slide: 19, after_slide: 22, recap_points: ['p'] }}
      onFinishExercise={onFinish} onClose={() => {}} />);

    for (let n = 1; n <= 4; n += 1) {
      expect(await screen.findByText(`Question ${n}?`)).toBeInTheDocument();
      expect(screen.getByText(`Question ${n} of 4`)).toBeInTheDocument();
      const options = screen.getAllByRole('button', { name: 'b' });
      fireEvent.click(options[options.length - 1]);
    }
    fireEvent.click(await screen.findByRole('button', { name: /back to the lesson/i }));
    expect(onFinish).toHaveBeenCalledOnce();

    const bodies = chatBodies();
    expect(bodies[0]).toMatchObject({ message: "Let's do the quick exercise.", slideNumber: 23, screenQuestion: card,
      exercise: { from_slide: 19, after_slide: 22, asked: 0, correct: 0, recap_points: ['p'] } });
    expect(bodies[1].message).toBe('I picked B.');
    expect(bodies[1].exercise).toMatchObject({ asked: 1, correct: 1,
      last: { question_text: 'Question 1?', correct_index: 1, selected_index: 1, explanation: 'because' } });
    expect(bodies[4].exercise).toMatchObject({ asked: 4, correct: 4 });
    expect(bodies).toHaveLength(5);
  });

  it('leaves the flag link off generated questions', async () => {
    globalThis.fetch.mockImplementation(async url => (url === '/api/chat'
      ? ok({ tutor_response: 'Go', exercise_question: { question_text: 'Gen?', options: ['a', 'b', 'c', 'd'], correct_answer: 0 } })
      : ok({ messages: [] })));
    render(<TutorPanel drawer lessonCode="x" learnerId="s" exerciseStart={{ id: 2, from_slide: 0, after_slide: 3 }} onClose={() => {}} />);
    await screen.findByText('Gen?');
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    expect(screen.queryByText(/think this question is wrong/i)).not.toBeInTheDocument();
  });

  it('closes', () => {
    globalThis.fetch.mockResolvedValue(ok({ messages: [] }));
    const onClose = vi.fn();
    render(<TutorPanel drawer lessonCode="2B1-1-1" learnerId="s" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close tutor/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

