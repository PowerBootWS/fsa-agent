/**
 * ProtectedRoute lets anyone with an `fsa_user` in localStorage onto /lobby,
 * but the session itself is the httpOnly `fsa_session` cookie. When those two
 * disagree — cookie dropped by an in-app browser, session displaced by a login
 * on another device — `/api/platform/me` 401s and the old code rendered a bare
 * "Failed to load your account" string with nothing to click. A student who
 * has just set a password and lands there has no way to tell whether anything
 * worked, and the obvious next move is to go back to the welcome email and tap
 * the (now spent) setup link again — which is what happened on 2026-09-04.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LobbyPage from './LobbyPage';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => mockNavigate,
}));

const respond = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

function renderLobby() {
  return render(<MemoryRouter><LobbyPage /></MemoryRouter>);
}

beforeEach(() => {
  // jsdom has no matchMedia; useInstall (PWA install prompt) calls it on mount.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  globalThis.fetch = vi.fn();
  mockNavigate.mockClear();
  localStorage.setItem('fsa_user', JSON.stringify({ id: 1, class_code: 'second', active_paper: '2A1' }));
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('LobbyPage — session and account state disagree', () => {
  it('clears the stale user and redirects to /login on a 401', async () => {
    globalThis.fetch.mockResolvedValue(respond({ error: 'Not authenticated' }, 401));

    renderLobby();

    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true }));
    expect(localStorage.getItem('fsa_user')).toBeNull();
  });

  it('never leaves a 401 sitting on the dead-end error card', async () => {
    globalThis.fetch.mockResolvedValue(respond({ error: 'Not authenticated' }, 401));

    renderLobby();

    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(screen.queryByText(/failed to load your account/i)).not.toBeInTheDocument();
  });

  it('gives a non-401 failure a Try Again button instead of a bare message', async () => {
    globalThis.fetch.mockResolvedValue(respond({ error: 'Boom' }, 500));

    renderLobby();

    expect(await screen.findByText(/failed to load your account/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
