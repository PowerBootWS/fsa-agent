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
