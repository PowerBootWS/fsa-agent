import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { QuizExamView } from './ExamRouter';

let now;
let bodies;

function question(n, timing) {
  return {
    tutor_response: n === 1 ? 'Welcome' : null,
    display_update: {
      type: 'exam_question', title: `Question ${n} of 50`, question: `Question text ${n}`,
      options: [{ label: 'A', text: 'alpha' }, { label: 'B', text: 'beta' }],
      engine: 'leveled', question_id: n, progress: { current: n, total: 50 }, timing,
    },
    exam_progress: { current: n, total: 50 },
  };
}

function mockServer(responses) {
  global.fetch = vi.fn(async (_url, opts) => {
    bodies.push(JSON.parse(opts.body));
    const data = responses.shift();
    return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
  });
}

function View() {
  const [chatState, setChatState] = useState({ messages: [], displayContent: null, examProgress: null });
  return (
    <MemoryRouter>
      <QuizExamView lessonId="2B1" user="s@example.com" mode="practice_exam" chatState={chatState}
        setChatState={setChatState} examConfig={{ count: 50, timed: true }} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  now = 1_000_000;
  bodies = [];
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('timed leveled exam', () => {
  it('explains the time limit and the extra time for Max questions', async () => {
    mockServer([question(1, { limit_s: 9000, max_count: 30, elapsed_s: null })]);
    render(<View />);
    expect(await screen.findByText(/Your time limit is 2 h 30 min/)).toBeInTheDocument();
    expect(screen.getByText(/30 Max-level questions/)).toBeInTheDocument();
  });

  it('pauses: hides the question, stops the clock, and sends the time without the pause', async () => {
    mockServer([question(1, { limit_s: 9000, max_count: 0, elapsed_s: null }), question(2, { limit_s: 9000, max_count: 0, elapsed_s: 65 })]);
    render(<View />);
    await screen.findByRole('button', { name: /Pause/ });     // clock running
    now += 30_000;
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
    expect(screen.queryByText('Question text 1')).not.toBeInTheDocument();
    expect(screen.getByText(/Exam paused/)).toBeInTheDocument();
    now += 900_000;                                         // called away for 15 minutes
    fireEvent.click(screen.getByRole('button', { name: /Resume exam/ }));
    now += 35_000;
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    await screen.findByText('Question text 2');
    expect(bodies[1]).toMatchObject({ message: 'My answer is A', elapsedSeconds: 65 });
  });

  it('picks a refreshed sitting back up paused at the last answer', async () => {
    mockServer([question(7, { limit_s: 9000, max_count: 0, elapsed_s: 230 })]);
    render(<View />);
    expect(await screen.findByText(/Exam paused/)).toBeInTheDocument();
    expect(screen.getByText(/2:26:10/)).toBeInTheDocument();
  });

  it('keeps going past the limit and says so', async () => {
    mockServer([question(1, { limit_s: 60, max_count: 0, elapsed_s: null })]);
    render(<View />);
    await screen.findByRole('button', { name: /Pause/ });     // clock running
    now += 75_000;
    await act(() => new Promise(r => setTimeout(r, 1100)));       // one clock tick
    expect(screen.getByText(/\+0:15/)).toBeInTheDocument();
    expect(screen.getByText(/Time's up, but keep going/)).toBeInTheDocument();
    expect(screen.getByText('Question text 1')).toBeInTheDocument();
    expect(bodies.some(b => b.message === '__time_up__')).toBe(false);
  });
});
