import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ObjectiveComplete } from './ObjectiveComplete';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => mockNavigate,
}));

function renderIt(props) {
  return render(
    <MemoryRouter>
      <ObjectiveComplete onContinue={() => {}} onReview={() => {}} {...props} />
    </MemoryRouter>
  );
}

describe('ObjectiveComplete chapter quiz prompt', () => {
  it('offers the chapter quiz after the last objective of a chapter', () => {
    renderIt({ activeLessonCode: '2B3-4-6', nextLessonCode: '2B3-5-1', nextChapter: { label: 'Chapter 5' } });
    expect(screen.getByText("You've completed the objective. Give the chapter quiz a try.")).toBeTruthy();
    fireEvent.click(screen.getByText('Start Chapter 4 Quiz →'));
    expect(mockNavigate).toHaveBeenCalledWith('/practice-exam?paper=2B3&quiz=2B3-4');
    expect(screen.getByText('Start Chapter 5 →')).toBeTruthy();
  });

  it('offers the chapter quiz after the final objective of the course', () => {
    renderIt({ activeLessonCode: '3A1-15-3', nextLessonCode: null });
    expect(screen.getByText('Start Chapter 15 Quiz →')).toBeTruthy();
  });

  it('does not offer the quiz mid-chapter', () => {
    renderIt({ activeLessonCode: '2B3-4-2', nextLessonCode: '2B3-4-3' });
    expect(screen.queryByText(/chapter quiz/)).toBeNull();
    expect(screen.getByText('Continue to Objective 3 →')).toBeTruthy();
  });
});
