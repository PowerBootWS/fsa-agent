/**
 * The marketing site's "Become an affiliate" button sends people to
 * /signup?next=/affiliate. These tests prove the next path survives signup,
 * the already-has-an-account (409) detour through login, and login itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import SignupPage from './SignupPage';
import LoginPage from './LoginPage';

const respond = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
}

function renderAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

function fillSignup() {
  fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Ann' } });
  fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Lee' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ann@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: /create free account/i }));
}

beforeEach(() => { globalThis.fetch = vi.fn(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('signup and login carry next=/affiliate', () => {
  it('signup with next=/affiliate navigates to /affiliate on 201', async () => {
    globalThis.fetch.mockResolvedValue(respond({ user: { id: 1, email: 'ann@example.com' } }, 201));
    renderAt('/signup?next=/affiliate');
    fillSignup();
    expect((await screen.findByTestId('where')).textContent).toBe('/affiliate');
  });

  it('the 409 message shows and the login link keeps next=/affiliate', async () => {
    globalThis.fetch.mockResolvedValue(
      respond({ error: 'An account with that email already exists. Try logging in instead.' }, 409)
    );
    renderAt('/signup?next=/affiliate');
    fillSignup();
    expect(await screen.findByText(/try logging in instead/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /log in/i }))
      .toHaveAttribute('href', '/login?next=%2Faffiliate');
  });

  it('login with next=/affiliate navigates to /affiliate on success', async () => {
    globalThis.fetch.mockResolvedValue(respond({ user: { id: 1, email: 'ann@example.com' } }));
    renderAt('/login?next=/affiliate');
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ann@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /^(log in|sign in)/i }));
    expect((await screen.findByTestId('where')).textContent).toBe('/affiliate');
  });
});
