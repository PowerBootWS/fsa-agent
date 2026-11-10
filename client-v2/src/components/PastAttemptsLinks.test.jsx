import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PracticeExamLobby } from './PracticeExamLobby';
import { ResultsPanel } from '../ExamRouter';
import QuizOnlyLobbyPage from '../pages/QuizOnlyLobbyPage';
import AppShell from './AppShell';

const respond = (body, status = 200) => ({
  ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body,
});

afterEach(() => { vi.restoreAllMocks(); });

describe('Past attempts entry points', () => {
  it('practice exam lobby links to past practice exams and past chapter quizzes for the paper', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ chapters: ['2B1-1'], available: false }));
    render(<MemoryRouter><PracticeExamLobby courseId="2B1" user="s@example.com" onStartExam={() => {}} onSelectChapter={() => {}} /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: /past practice exams/i }))
      .toHaveAttribute('href', '/attempts?course=2B1&kind=practice_exam');
    expect(screen.getByRole('link', { name: /past chapter quizzes/i }))
      .toHaveAttribute('href', '/attempts?course=2B1&kind=chapter_quiz');
  });

  it('the free (lead magnet) lobby has no past-attempt links', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ chapters: ['2B1-1'] }));
    render(<MemoryRouter><PracticeExamLobby courseId="2B1" leadMagnetMode onStartExam={() => {}} onSelectChapter={() => {}} /></MemoryRouter>);
    await screen.findByText(/chapter 1/i);
    expect(screen.queryByRole('link', { name: /past/i })).toBeNull();
  });

  it('results panel shows the link it is given, and none in lead-magnet mode', () => {
    const dc = { score: 3, total: 4, score_pct: 75, question_review: [] };
    const { unmount } = render(
      <MemoryRouter>
        <ResultsPanel displayContent={dc} isExam={false} onRetry={() => {}} pastAttemptsHref="/attempts?course=2B1&kind=chapter_quiz&chapter=2B1-3" />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: /past attempts at this quiz/i }))
      .toHaveAttribute('href', '/attempts?course=2B1&kind=chapter_quiz&chapter=2B1-3');
    unmount();
    render(
      <MemoryRouter>
        <ResultsPanel displayContent={dc} isExam leadMagnetMode pastAttemptsHref="/attempts?course=2B1&kind=practice_exam" />
      </MemoryRouter>
    );
    expect(screen.queryByRole('link', { name: /past/i })).toBeNull();
  });

  it('results panel offers to retry the wrong ones when it has an attempt id', () => {
    const dc = { score: 1, total: 3, score_pct: 33, attempt_id: 44, question_review: [
      { correct: true }, { correct: false }, { correct: false },
    ] };
    render(
      <MemoryRouter>
        <ResultsPanel displayContent={dc} isExam onRetry={() => {}} retryWrongHref="/practice-exam?paper=2B1&quiz=2B1-R44" />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: /retry the 2 questions you got wrong/i }))
      .toHaveAttribute('href', '/practice-exam?paper=2B1&quiz=2B1-R44');
  });

  it('a retry session offers to retry what is still missed, not a fresh quiz', () => {
    const dc = { score: 1, total: 2, score_pct: 50, question_review: [] };
    render(<MemoryRouter><ResultsPanel displayContent={dc} isExam={false} onRetry={() => {}} retryOfMissed /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /retry what i still missed/i })).toBeInTheDocument();
  });

  it('4th Class lobby links each paper to its past attempts', async () => {
    const paper = { total_chapters: 2, chapter_quizzes: [], quizzes_passed: 0, avg_quiz_score: null, next_quiz_chapter_id: null, last_exam: null };
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ papers: { '4A': paper, '4B': paper } }));
    render(<MemoryRouter><QuizOnlyLobbyPage /></MemoryRouter>);
    const links = await screen.findAllByRole('link', { name: /past attempts/i });
    expect(links.map(l => l.getAttribute('href'))).toEqual(['/attempts?course=4A', '/attempts?course=4B']);
  });

  it('the sidebar has a Past attempts item for a subscriber', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ class_code: 'second' }));
    localStorage.setItem('fsa_user', JSON.stringify({ email: 's@example.com' }));
    render(<MemoryRouter><AppShell><div /></AppShell></MemoryRouter>);
    expect(await screen.findByRole('link', { name: /past attempts/i })).toHaveAttribute('href', '/attempts');
  });

  it('no Past attempts item without a course (jobs-only or lapsed account)', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ class_code: null }));
    localStorage.setItem('fsa_user', JSON.stringify({ email: 's@example.com' }));
    render(<MemoryRouter><AppShell><div /></AppShell></MemoryRouter>);
    await screen.findByRole('link', { name: /home/i });
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryByRole('link', { name: /past attempts/i })).toBeNull();
  });
});
