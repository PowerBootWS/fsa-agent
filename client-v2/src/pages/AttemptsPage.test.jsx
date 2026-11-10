import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AttemptsPage from './AttemptsPage';
import AttemptDetailPage from './AttemptDetailPage';

const respond = (body, status = 200) => ({
  ok: status < 400, status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

const attempts = [
  {
    id: '12', course_id: '2B1', chapter_id: '2B1-3', chapter_title: 'Boiler Design', kind: 'chapter_quiz',
    started_at: '2026-11-05T17:00:00Z', finished_at: '2026-11-05T17:20:00Z',
    score: 12, question_count: 15, score_pct: 80, source: 'live', review_available: true,
  },
  {
    id: '7', course_id: '2A1', chapter_id: null, chapter_title: null, kind: 'practice_exam',
    started_at: '2026-10-01T16:00:00Z', finished_at: '2026-10-01T18:00:00Z',
    score: 61, question_count: 100, score_pct: 61, source: 'pre_history', review_available: false,
  },
];

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/attempts" element={<AttemptsPage />} />
        <Route path="/attempts/:id" element={<AttemptDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => { vi.restoreAllMocks(); });

describe('AttemptsPage', () => {
  it('lists attempts with type, paper and score; only reviewable ones link', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ attempts }));
    renderAt('/attempts');

    const quiz = await screen.findByRole('link', { name: /chapter 3 quiz/i });
    expect(quiz).toHaveAttribute('href', '/attempts/12');
    expect(within(quiz).getByText('12/15')).toBeInTheDocument();
    expect(within(quiz).getByText(/Boiler Design/)).toBeInTheDocument();

    const exam = screen.getByText('Practice exam').closest('.at-row');
    expect(exam.tagName).not.toBe('A');
    expect(within(exam).getByText('61/100')).toBeInTheDocument();
    expect(within(exam).getByText(/question review isn't available/i)).toBeInTheDocument();
    expect(globalThis.fetch.mock.calls[0][0]).toMatch(/^\/api\/attempts/);
  });

  it('filters by paper and type', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ attempts }));
    renderAt('/attempts');
    await screen.findByRole('link', { name: /chapter 3 quiz/i });

    fireEvent.change(screen.getByLabelText(/paper/i), { target: { value: '2A1' } });
    expect(screen.queryByRole('link', { name: /chapter 3 quiz/i })).toBeNull();
    expect(screen.getByText('Practice exam')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/paper/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: 'chapter_quiz' } });
    expect(screen.getByRole('link', { name: /chapter 3 quiz/i })).toBeInTheDocument();
    expect(screen.queryByText('Practice exam')).toBeNull();
  });

  it('preselects the paper from ?course=', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ attempts }));
    renderAt('/attempts?course=2A1');
    expect(await screen.findByText('Practice exam')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /chapter 3 quiz/i })).toBeNull();
  });

  it('shows an empty state', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ attempts: [] }));
    renderAt('/attempts');
    expect(await screen.findByText(/no finished practice exams or chapter quizzes yet/i)).toBeInTheDocument();
  });

  it('shows an error when loading fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ error: 'boom' }, 500));
    renderAt('/attempts');
    expect(await screen.findByText(/couldn't load your attempts/i)).toBeInTheDocument();
  });
});

describe('AttemptDetailPage', () => {
  const questions = [
    { question_text: 'What is a drum?', options: ['A vessel', 'A pump', 'A fan', 'A valve'],
      correct_index: 0, selected_index: 0, correct: true, explanation: 'It holds water.' },
    { question_text: 'What is a header?', options: ['A pipe', 'A pump', 'A fan', 'A valve'],
      correct_index: 0, selected_index: 2, correct: false, explanation: 'It distributes flow.' },
  ];

  it('renders the attempt header and every question as shown', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({
      attempt: attempts[0], review_available: true, questions,
    }));
    renderAt('/attempts/12');
    expect(await screen.findByText('What is a drum?')).toBeInTheDocument();
    expect(screen.getByText('What is a header?')).toBeInTheDocument();
    expect(screen.getByText(/It distributes flow/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /chapter 3 quiz/i })).toBeInTheDocument();
    expect(screen.getByText('12/15')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /all attempts/i })).toHaveAttribute('href', '/attempts');
    expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/attempts/12');
  });

  it('says so when the review was not saved', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({
      attempt: attempts[1], review_available: false, questions: [],
    }));
    renderAt('/attempts/7');
    expect(await screen.findByText(/question review isn't available/i)).toBeInTheDocument();
  });

  it('a missing attempt shows not found', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ error: 'Not found' }, 404));
    renderAt('/attempts/999');
    expect(await screen.findByText(/couldn't find that attempt/i)).toBeInTheDocument();
  });
});
