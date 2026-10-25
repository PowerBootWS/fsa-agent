/**
 * 2026-09-04: a new 2nd Class student set her password successfully at 13:49,
 * tapped the "Set Up My Account" button in the welcome email again two minutes
 * later, and got:
 *
 *   "This setup link is invalid or has expired. Please contact support."
 *
 * She contacted support, because the page told her to. Setup links are
 * single-use and re-tapping one is ordinary behaviour, so the spent-link state
 * has to reassure and offer a sign-in button — never dead-end into support.
 *
 * These tests pin the recovery affordance for each failure reason.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SetupPage from './SetupPage';

const respond = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

function renderAt(token = 'a-token') {
  return render(
    <MemoryRouter initialEntries={[`/setup?token=${token}`]}>
      <SetupPage />
    </MemoryRouter>
  );
}

beforeEach(() => { globalThis.fetch = vi.fn(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('SetupPage — a link that did not work', () => {
  it('tells an already-set-up student to sign in, and never mentions support', async () => {
    globalThis.fetch.mockResolvedValue(
      respond({ error: 'Invalid or expired link', reason: 'already_used' }, 400)
    );

    renderAt();

    expect(await screen.findByText(/already set your password/i)).toBeInTheDocument();
    const signIn = screen.getByRole('link', { name: /sign in/i });
    expect(signIn).toHaveAttribute('href', '/login');
    expect(screen.queryByText(/contact support/i)).not.toBeInTheDocument();
  });

  it('sends an expired link to forgot-password for a fresh one', async () => {
    globalThis.fetch.mockResolvedValue(
      respond({ error: 'Invalid or expired link', reason: 'expired' }, 400)
    );

    renderAt();

    expect(await screen.findByText(/has expired/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /new link/i })).toHaveAttribute(
      'href',
      '/forgot-password'
    );
  });

  it('still offers a way forward for a genuinely bad link', async () => {
    globalThis.fetch.mockResolvedValue(
      respond({ error: 'Invalid or expired link', reason: 'invalid' }, 400)
    );

    renderAt();

    expect(await screen.findByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: /new link/i })).toHaveAttribute(
      'href',
      '/forgot-password'
    );
    expect(screen.queryByText(/contact support/i)).not.toBeInTheDocument();
  });

  it('falls back to the invalid panel when the server sends no reason', async () => {
    globalThis.fetch.mockResolvedValue(respond({ error: 'Invalid or expired link' }, 400));

    renderAt();

    expect(await screen.findByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });

  it('shows the password form for a good token', async () => {
    globalThis.fetch.mockResolvedValue(respond({ ok: true, first_name: 'Allison' }));

    renderAt();

    expect(await screen.findByText(/Welcome, Allison/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });
});

describe('SetupPage: where a finished setup lands', () => {
  function renderSetupThenSubmit(url) {
    globalThis.fetch
      .mockResolvedValueOnce(respond({ ok: true, first_name: 'Sam' }))
      .mockResolvedValueOnce(respond({ user: { id: 1, class_code: null } }));
    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/affiliate" element={<div>Referrals page</div>} />
          <Route path="/home" element={<div>Home page</div>} />
        </Routes>
      </MemoryRouter>
    );
  }

  async function submit() {
    await screen.findByText(/Welcome, Sam/i);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough1' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
  }

  it('honours a same-origin next, e.g. the affiliate setup email', async () => {
    renderSetupThenSubmit('/setup?token=t&next=%2Faffiliate');
    await submit();
    expect(await screen.findByText('Referrals page')).toBeInTheDocument();
  });

  it('ignores an off-site next', async () => {
    renderSetupThenSubmit('/setup?token=t&next=%2F%2Fevil.example');
    await submit();
    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });
});
