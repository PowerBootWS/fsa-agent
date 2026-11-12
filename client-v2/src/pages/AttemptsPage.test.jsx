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
    expect(await screen.findByText(
      "No past practice exams or chapter quizzes on record yet. Once you finish one, it will show up here."
    )).toBeInTheDocument();
  });

  it('says which piece has no attempts yet when arriving from a practice exam', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ attempts: [] }));
    renderAt('/attempts?course=2B3&kind=practice_exam');
    expect(await screen.findByText(
      'No past practice exams on record for 2B3 yet. Once you finish one, it will show up here.'
    )).toBeInTheDocument();
  });

  it('says which chapter has no attempts yet, even when other attempts exist', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ attempts }));
    renderAt('/attempts?course=2B1&kind=chapter_quiz&chapter=2B1-7');
    expect(await screen.findByText(
      'No past Chapter 7 quizzes on record for 2B1 yet. Once you finish one, it will show up here.'
    )).toBeInTheDocument();
    // The paper filter still offers the paper even though nothing from it matched.
    expect(screen.getByLabelText(/paper/i)).toHaveValue('2B1');
  });

  it('filters to one chapter and can widen back out', async () => {
    const more = [...attempts, { ...attempts[0], id: '13', chapter_id: '2B1-4', chapter_title: 'Pumps' }];
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ attempts: more }));
    renderAt('/attempts?course=2B1&kind=chapter_quiz&chapter=2B1-3');
    expect(await screen.findByRole('link', { name: /chapter 3 quiz/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /chapter 4 quiz/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /show all chapters/i }));
    expect(screen.getByRole('link', { name: /chapter 4 quiz/i })).toBeInTheDocument();
  });

  it('explains a 403 instead of calling it a loading error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ error: 'Active subscription required' }, 403));
    renderAt('/attempts');
    expect(await screen.findByText(/past attempts are part of an active subscription/i)).toBeInTheDocument();
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

describe('Phase D on the history pages', () => {
  const wrongAndRight = [
    { question_text: 'First question', options: ['a', 'b'], correct_index: 0, selected_index: 0, correct: true, explanation: '' },
    { question_text: 'Second question', options: ['a', 'b'], correct_index: 0, selected_index: 1, correct: false, explanation: '' },
  ];

  it('detail offers to retry the wrong ones', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ attempt: attempts[0], review_available: true, questions: wrongAndRight }));
    renderAt('/attempts/12');
    const link = await screen.findByRole('link', { name: /retry the 1 question you got wrong/i });
    expect(link).toHaveAttribute('href', '/practice-exam?paper=2B1&quiz=2B1-R12');
  });

  it('no retry link when everything was right', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ attempt: attempts[0], review_available: true, questions: [wrongAndRight[0]] }));
    renderAt('/attempts/12');
    await screen.findByText('First question');
    expect(screen.queryByRole('link', { name: /retry/i })).toBeNull();
  });

  it('shows weakest chapters for the selected paper', async () => {
    globalThis.fetch = vi.fn().mockImplementation(url => Promise.resolve(
      url.startsWith('/api/attempts/weak-chapters')
        ? respond({ exams: 2, chapters: [
          { chapter_id: '2A1-3', title: 'Boilers', correct: 2, total: 8, pct: 25 },
          { chapter_id: '2A1-5', title: null, correct: 4, total: 4, pct: 100 },
        ] })
        : respond({ attempts })
    ));
    renderAt('/attempts?course=2A1');
    expect(await screen.findByText(/weakest chapters/i)).toBeInTheDocument();
    expect(screen.getByText(/last 2 practice exams/i)).toBeInTheDocument();
    expect(screen.getByText('Chapter 3 · Boilers')).toBeInTheDocument();
    expect(screen.getByText('2/8 (25%)')).toBeInTheDocument();
    expect(globalThis.fetch.mock.calls.some(([u]) => u === '/api/attempts/weak-chapters?course=2A1')).toBe(true);
  });

  it('labels retry attempts', async () => {
    const retry = { ...attempts[0], id: '20', kind: 'retry_wrong', chapter_id: null, chapter_title: null };
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ attempts: [retry] }));
    renderAt('/attempts');
    expect(await screen.findByRole('link', { name: /retry of missed questions/i })).toBeInTheDocument();
  });
});
