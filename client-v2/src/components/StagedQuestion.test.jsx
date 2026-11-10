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
    expect(screen.getByRole('button', { name: /S1 B/ }).className).toContain('sq-correct');
    expect(screen.getByRole('button', { name: /S1 A/ }).className).toContain('sq-wrong');
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

  it('resets when the question prop changes', () => {
    const { rerender } = setup();
    fireEvent.click(screen.getByRole('button', { name: /S1 B/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    const Q2 = { question_text: 'Second problem', step_data: { steps: [mk(9)] } };
    rerender(<StagedQuestion question={Q2} number={2} total={3} onDone={() => {}} />);
    expect(screen.getByText('Second problem')).toBeTruthy();
    expect(screen.getByText('Step 9 question')).toBeTruthy();
    expect(screen.getByRole('button', { name: /S9 A/ }).disabled).toBe(false);
  });
});
