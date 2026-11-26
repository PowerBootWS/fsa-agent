import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CountdownTimer } from './CountdownTimer';

describe('CountdownTimer', () => {
  it('shows the time left', () => {
    const { container } = render(<CountdownTimer totalSeconds={9000} elapsed={230} />);
    expect(container.textContent).toContain('2:26:10');
  });

  it('counts up past the limit instead of stopping', () => {
    const { container } = render(<CountdownTimer totalSeconds={60} elapsed={62} />);
    expect(container.textContent).toContain('+0:02');
    expect(container.querySelector('.exam-timer--over')).not.toBeNull();
  });

  it('marks itself paused', () => {
    const { container } = render(<CountdownTimer totalSeconds={60} elapsed={10} paused />);
    expect(container.textContent).toContain('Paused');
  });
});
