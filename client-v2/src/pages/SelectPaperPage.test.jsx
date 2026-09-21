/**
 * Papers can be switched freely — there is no cooldown (owner decision
 * 2026-09-21). The server used to answer a too-soon switch with
 * 429 { error: 'Paper switch cooldown', days_remaining }, and this page
 * translated that into customer-readable copy. Both sides are gone; what is
 * left to protect is that a real failure still says something useful and does
 * not strand the student on a page with every button disabled.
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

describe('SelectPaperPage', () => {
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

  it('switches straight away with no cooldown message', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(respond({ papers: ['2A1', '2A2', '2A3'] }))
      .mockResolvedValueOnce(respond({ ok: true, active_paper: '2A3' }));

    renderPage();
    await screen.findByText('2A3');
    fireEvent.click(screen.getByText('2A3').closest('button'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/lobby', { replace: true });
    });
    expect(screen.queryByText(/switch again in/i)).toBeNull();
    expect(screen.queryByText(/cooldown/i)).toBeNull();
  });

  it('re-enables the buttons after a failed switch so another paper can be picked', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(respond({ papers: ['2A1', '2A2'] }))
      .mockResolvedValueOnce(respond({ error: 'Internal server error' }, 500));

    renderPage();
    await screen.findByText('2A2');
    fireEvent.click(screen.getByText('2A2').closest('button'));

    await waitFor(() => {
      expect(screen.getByText(/Internal server error/i)).toBeTruthy();
    });
    expect(screen.getByText('2A1').closest('button').disabled).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
