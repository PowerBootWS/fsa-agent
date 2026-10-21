import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import FlagQuestion from './FlagQuestion';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('FlagQuestion', () => {
  it('posts the question id and reason', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    render(<FlagQuestion questionId={107} lessonCode="2A1-11" />);
    fireEvent.click(screen.getByRole('button', { name: /Think this question is wrong/ }));
    fireEvent.change(screen.getByPlaceholderText(/What looks wrong/), { target: { value: 'key is off' } });
    fireEvent.click(screen.getByRole('button', { name: 'Report it' }));
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(String(url)).toContain('/api/v2/question-flag');
    expect(JSON.parse(opts.body)).toMatchObject({ question_id: 107, lesson_code: '2A1-11', reason: 'key is off' });
    expect(screen.getByText(/Russ will look at this one/)).toBeTruthy();
  });

  it('renders nothing without a question id', () => {
    const { container } = render(<FlagQuestion questionId={null} />);
    expect(container.innerHTML).toBe('');
  });
});
