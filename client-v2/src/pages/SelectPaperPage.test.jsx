/**
 * Switching papers is rate-limited server-side (PAPER_SWITCH_COOLDOWN_DAYS,
 * 7 in production) and POST /api/platform/switch-paper answers a blocked
 * attempt with 429 { error: 'Paper switch cooldown', days_remaining }.
 *
 * The page used to render `data.error` verbatim, so a student who tried to
 * move to their next paper too soon was shown the bare string "Paper switch
 * cooldown" — the name of an internal rule, with no indication of how long it
 * lasts or whether the paper they were already studying was still there. The
 * server was sending days_remaining the whole time and the client dropped it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SelectPaperPage from './SelectPaperPage';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => mockNavigate,
}));
vi.mock('../utils/usage', () => ({ track: vi.fn() }));

const respond = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

function renderPage() {
  return render(<MemoryRouter><SelectPaperPage /></MemoryRouter>);
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
  mockNavigate.mockClear();
  localStorage.setItem('fsa_user', JSON.stringify({ id: 1, class_code: 'second', active_paper: '2A1' }));
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('SelectPaperPage paper-switch cooldown', () => {
  it('translates a 429 into how long is left and what happens to the current paper', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(respond({ papers: ['2A1', '2A2'] }))
      .mockResolvedValueOnce(respond({ error: 'Paper switch cooldown', days_remaining: 3 }, 429));

    renderPage();
    await screen.findByText('2A2');
    fireEvent.click(screen.getByText('2A2').closest('button'));

    await waitFor(() => {
      expect(screen.getByText(/switch again in 3 days/i)).toBeTruthy();
    });
    expect(screen.getByText(/current paper stays open/i)).toBeTruthy();
    // The internal rule name must never reach the student.
    expect(screen.queryByText(/^Paper switch cooldown$/)).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('says "day" not "days" when one is left', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(respond({ papers: ['2A1', '2A2'] }))
      .mockResolvedValueOnce(respond({ error: 'Paper switch cooldown', days_remaining: 1 }, 429));

    renderPage();
    await screen.findByText('2A2');
    fireEvent.click(screen.getByText('2A2').closest('button'));

    await waitFor(() => {
      expect(screen.getByText(/switch again in 1 day\b/i)).toBeTruthy();
    });
  });

  it('still explains itself if the server omits days_remaining', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(respond({ papers: ['2A1', '2A2'] }))
      .mockResolvedValueOnce(respond({ error: 'Paper switch cooldown' }, 429));

    renderPage();
    await screen.findByText('2A2');
    fireEvent.click(screen.getByText('2A2').closest('button'));

    await waitFor(() => {
      expect(screen.getByText(/current paper stays open in the meantime/i)).toBeTruthy();
    });
    expect(screen.queryByText(/^Paper switch cooldown$/)).toBeNull();
  });

  it('re-enables the buttons after a refused switch so another paper can be picked', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(respond({ papers: ['2A1', '2A2'] }))
      .mockResolvedValueOnce(respond({ error: 'Paper switch cooldown', days_remaining: 2 }, 429));

    renderPage();
    await screen.findByText('2A2');
    fireEvent.click(screen.getByText('2A2').closest('button'));

    await waitFor(() => {
      expect(screen.getByText(/switch again in 2 days/i)).toBeTruthy();
    });
    expect(screen.getByText('2A1').closest('button').disabled).toBe(false);
  });

  it('navigates to the lobby on a successful switch', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(respond({ papers: ['2A1', '2A2'] }))
      .mockResolvedValueOnce(respond({ ok: true, active_paper: '2A2' }));

    renderPage();
    await screen.findByText('2A2');
    fireEvent.click(screen.getByText('2A2').closest('button'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/lobby', { replace: true });
    });
    expect(JSON.parse(localStorage.getItem('fsa_user')).active_paper).toBe('2A2');
  });
});
