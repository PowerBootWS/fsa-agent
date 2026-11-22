import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ExamResultsPage from './ExamResultsPage';

const leveledDebrief = {
  courseId: '2B1',
  tutor_response: 'Nice work on Boilers.',
  display_update: {
    type: 'exam_done', score: 9, total: 10, score_pct: 90, question_review: [], attempt_id: 5,
    leveled: {
      topics: [{ topic_key: 'a', name: 'Boilers', weight: 50, level: 2, level_name: 'Core', new_level: 3,
                 new_level_name: 'Exam-Level', correct: 9, total: 10 }],
      predicted_pct: 72, band: 'solid', message: 'You have a solid grasp and would likely pass comfortably.',
      holding_back: [], pass_pct: 65,
    },
  },
};

beforeEach(() => {
  localStorage.setItem('fsa_user', JSON.stringify({ email: 's@example.com', class_code: 'second' }));
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' });
});
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('ExamResultsPage', () => {
  it('shows the full leveled results straight after a leveled exam', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/exam/results', search: '?paper=2B1', state: { debrief: leveledDebrief } }]}>
        <Routes><Route path="/exam/results" element={<ExamResultsPage />} /></Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText('You have a solid grasp and would likely pass comfortably.')).toBeInTheDocument();
    expect(screen.getByText('Core → Exam-Level')).toBeInTheDocument();
  });
});
