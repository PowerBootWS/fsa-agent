import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ExamLengthPicker from './ExamLengthPicker';

describe('ExamLengthPicker', () => {
  it('offers 50 and 100 only', () => {
    render(<ExamLengthPicker value={50} onChange={() => {}} />);
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['50', '100']);
    expect(screen.queryByText('25')).not.toBeInTheDocument();
  });

  it('reports the choice', () => {
    const onChange = vi.fn();
    render(<ExamLengthPicker value={50} onChange={onChange} />);
    fireEvent.click(screen.getByText('100'));
    expect(onChange).toHaveBeenCalledWith(100);
  });

  it('explains the leveled exam when it applies', () => {
    const { rerender } = render(<ExamLengthPicker value={50} onChange={() => {}} />);
    expect(screen.queryByText(/typical real-exam mix/)).not.toBeInTheDocument();
    rerender(<ExamLengthPicker value={50} onChange={() => {}} leveled />);
    expect(screen.getByText('Follows the typical real-exam mix. Difficulty adapts to your level in each topic.')).toBeInTheDocument();
  });
});
