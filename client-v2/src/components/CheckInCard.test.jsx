/** Check-in card (lesson tutor redesign, slice 4). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CheckInCard } from './CheckInCard';

const CHECKIN = {
  from_slide: 19, after_slide: 22,
  recap_points: ['Nuclear plants use four casing cross compound units.', 'Cross compound means two shafts.'],
  exercise_prompt: 'Want to try a few quick questions on casing arrangements?',
};
const QUESTION = { id: 1458, question_text: 'Which arrangement for nuclear?', options: ['Tandem', 'Cross'], correct_answer: 1 };

beforeEach(() => { globalThis.fetch = vi.fn(); });

describe('CheckInCard', () => {
  it('shows the recap, the question and both ways on', () => {
    render(<CheckInCard checkin={CHECKIN} question={QUESTION} lessonCode="2B1-1-1"
      onAnswer={() => {}} onExercise={() => {}} onContinue={() => {}} />);
    expect(screen.getByText(/four casing cross compound/)).toBeInTheDocument();
    expect(screen.getByText('Which arrangement for nuclear?')).toBeInTheDocument();
    expect(screen.getByText(CHECKIN.exercise_prompt)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /quick exercise/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue the lesson/i })).toBeInTheDocument();
  });

  it('works with a recap and no question, and with a question and no recap', () => {
    const { rerender } = render(<CheckInCard checkin={CHECKIN} question={null} lessonCode="x" onContinue={() => {}} />);
    expect(screen.queryByText(/practice question/i)).not.toBeInTheDocument();
    rerender(<CheckInCard checkin={null} question={QUESTION} lessonCode="x" onAnswer={() => {}} onContinue={() => {}} />);
    expect(screen.queryByRole('heading', { name: /what you just covered/i })).not.toBeInTheDocument();
    expect(screen.getByText('Which arrangement for nuclear?')).toBeInTheDocument();
  });

  it('hides the exercise when there is no tutor', () => {
    render(<CheckInCard checkin={CHECKIN} question={null} lessonCode="x" onContinue={() => {}} />);
    expect(screen.queryByRole('button', { name: /quick exercise/i })).not.toBeInTheDocument();
    expect(screen.queryByText(CHECKIN.exercise_prompt)).not.toBeInTheDocument();
  });

  it('reports answers and button presses', () => {
    const onAnswer = vi.fn(); const onExercise = vi.fn(); const onContinue = vi.fn();
    render(<CheckInCard checkin={CHECKIN} question={QUESTION} lessonCode="x"
      onAnswer={onAnswer} onExercise={onExercise} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cross' }));
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ question_id: 1458, answer_index: 1, correct: true }));
    fireEvent.click(screen.getByRole('button', { name: /quick exercise/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue the lesson/i }));
    expect(onExercise).toHaveBeenCalledOnce();
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
