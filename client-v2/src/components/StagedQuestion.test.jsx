import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StagedQuestion } from './StagedQuestion';

const mk = (n) => ({
  type: 'calc', context: `Context ${n}`, question: `Step ${n} question`,
  options: [`S${n} A`, `S${n} B`, `S${n} C`], correct: 1, explanation: `Because ${n}`,
});
const Q = { question_text: 'Overall problem', step_data: { steps: [mk(1), mk(2), mk(3)] } };

function setup(props = {}) {
  const onDone = vi.fn();
  const utils = render(<StagedQuestion question={Q} number={1} total={3} onDone={onDone} {...props} />);
  return { onDone, ...utils };
}

describe('StagedQuestion', () => {
  it('renders step 1 only', () => {
    setup();
    expect(screen.getByText('Overall problem')).toBeTruthy();
    expect(screen.getByText('Context 1')).toBeTruthy();
    expect(screen.getByText('Step 1 question')).toBeTruthy();
    expect(screen.queryByText('Step 2 question')).toBeNull();
    expect(screen.queryByText('Because 1')).toBeNull();
  });

  it('wrong pick shows explanation, marks correct option, disables the others', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /S1 A/ }));
    expect(screen.getByText('Because 1')).toBeTruthy();
    expect(screen.getByText('Not quite')).toBeTruthy();
    expect(screen.getByRole('button', { name: /S1 B.*\(correct answer\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /S1 A.*\(your answer\)/ })).toBeTruthy();
    expect(screen.queryByText(/S1 C.*\(/)).toBeNull();
    expect(screen.getByRole('button', { name: /S1 C/ }).disabled).toBe(true);
  });

  it('Next step shows step 2', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /S1 B/ }));
    expect(screen.getByText('Correct')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByText('Step 2 question')).toBeTruthy();
    expect(screen.queryByText('Step 1 question')).toBeNull();
  });

  it('empty context renders nothing for it', () => {
    const q = { question_text: 'T', step_data: { steps: [{ ...mk(1), context: '' }] } };
    const { container } = render(<StagedQuestion question={q} number={1} total={2} onDone={() => {}} />);
    expect(container.querySelector('.sq-context')).toBeNull();
  });

  it('finishing 3 steps with one wrong calls onDone({2,3})', () => {
    const { onDone } = setup();
    fireEvent.click(screen.getByRole('button', { name: /S1 A/ })); // wrong
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    fireEvent.click(screen.getByRole('button', { name: /S2 B/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    fireEvent.click(screen.getByRole('button', { name: /S3 B/ }));
    expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
    expect(onDone).toHaveBeenCalledWith({ stepsCorrect: 2, steps: 3 });
  });

  it('final button reads Finish when number === total', () => {
    setup({ number: 3, total: 3 });
    for (let n = 1; n <= 3; n++) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`S${n} B`) }));
      if (n < 3) fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    }
    expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Next question' })).toBeNull();
  });

  it('resets when rendered with a different key', () => {
    const { rerender } = render(<StagedQuestion key={1} question={Q} number={1} total={3} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /S1 B/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    const Q2 = { question_text: 'Second problem', step_data: { steps: [mk(9)] } };
    rerender(<StagedQuestion key={2} question={Q2} number={2} total={3} onDone={() => {}} />);
    expect(screen.getByText('Second problem')).toBeTruthy();
    expect(screen.getByText('Step 9 question')).toBeTruthy();
    expect(screen.getByRole('button', { name: /S9 A/ }).disabled).toBe(false);
  });

  it('Finish calls onDone', () => {
    const { onDone } = setup({ number: 3, total: 3, question: { question_text: 'T', step_data: { steps: [mk(1)] } } });
    fireEvent.click(screen.getByRole('button', { name: /S1 B/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onDone).toHaveBeenCalledWith({ stepsCorrect: 1, steps: 1 });
  });

  it('single-step question shows the done label straight away', () => {
    setup({ question: { question_text: 'T', step_data: { steps: [mk(1)] } } });
    fireEvent.click(screen.getByRole('button', { name: /S1 A/ }));
    expect(screen.getByRole('button', { name: 'Next question' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
  });

  it('correct index 0 works', () => {
    const step = { ...mk(1), correct: 0 };
    const { onDone } = setup({ number: 3, total: 3, question: { question_text: 'T', step_data: { steps: [step] } } });
    fireEvent.click(screen.getByRole('button', { name: /S1 A/ }));
    expect(screen.getByText('Correct')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onDone).toHaveBeenCalledWith({ stepsCorrect: 1, steps: 1 });
  });

  it('moves focus to the Next button after a pick; status excludes the button', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /S1 B/ }));
    const next = screen.getByRole('button', { name: 'Next step' });
    expect(document.activeElement).toBe(next);
    expect(screen.getByRole('status').contains(next)).toBe(false);
  });
});

// Owner ruling 2026-11-12: a mini lesson ends with one practice question
describe('StagedQuestion with a single question', () => {
  it('shows "Practice question", never "Question 1 of 1", and keeps "Step k of N" for N > 1', () => {
    render(<StagedQuestion question={Q} number={1} total={1} onDone={() => {}} />);
    expect(screen.getByText('Practice question')).toBeTruthy();
    expect(screen.queryByText(/Question 1 of 1/)).toBeNull();
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
  });

  it('a one-step question shows no step counter', () => {
    const one = { question_text: 'Concept check', step_data: { steps: [mk(1)] } };
    render(<StagedQuestion question={one} number={1} total={1} onDone={() => {}} />);
    expect(screen.getByText('Practice question')).toBeTruthy();
    expect(screen.queryByText(/Step 1 of 1/)).toBeNull();
  });

  it('keeps the multi-question label when there are several', () => {
    render(<StagedQuestion question={Q} number={2} total={3} onDone={() => {}} />);
    expect(screen.getByText('Question 2 of 3')).toBeTruthy();
    expect(screen.queryByText('Practice question')).toBeNull();
  });
});
