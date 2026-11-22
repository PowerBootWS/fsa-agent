import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ResultsPanel } from './ExamRouter';

const leveled = {
  topics: [{ topic_key: 'a', name: 'Boilers', weight: 50, level: 2, level_name: 'Core', new_level: 3, new_level_name: 'Exam-Level', correct: 9, total: 10 }],
  predicted_pct: 72, band: 'solid', message: 'You have a solid grasp and would likely pass comfortably.',
  holding_back: [], pass_pct: 65,
};

function panel(dc) {
  return render(<MemoryRouter><ResultsPanel displayContent={dc} isExam onRetry={() => {}} user="s@example.com" /></MemoryRouter>);
}

describe('ResultsPanel', () => {
  it('shows the leveled results and a plain retake for a leveled exam', () => {
    panel({ type: 'exam_done', score: 9, total: 10, score_pct: 90, question_review: [], leveled });
    expect(screen.getByText('Core → Exam-Level')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retake Exam' })).toBeInTheDocument();
    expect(screen.queryByText('Chapter')).not.toBeInTheDocument();
  });

  it('keeps the adaptive retake for the adaptive exam', () => {
    panel({ type: 'exam_done', score: 9, total: 10, score_pct: 90, question_review: [],
            chapter_stats: [{ chapter: '2B1-1', correct: 9, total: 10, pct: 90, status: 'Strong' }] });
    expect(screen.getByRole('button', { name: 'Retake Exam (Adaptive)' })).toBeInTheDocument();
    expect(screen.getByText('Chapter')).toBeInTheDocument();
  });
});
