import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { CountdownTimer } from './CountdownTimer';

afterEach(() => { vi.useRealTimers(); });

describe('CountdownTimer', () => {
  it('calls onExpire once when time runs out', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(<CountdownTimer totalSeconds={3} onExpire={onExpire} />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onExpire).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('works without onExpire (keeps counting over)', () => {
    vi.useFakeTimers();
    const { container } = render(<CountdownTimer totalSeconds={1} />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(container.textContent).toContain('+0:02');
  });
});
