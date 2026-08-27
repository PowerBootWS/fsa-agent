/**
 * Backlog #68 — the failure this whole task exists to make visible.
 *
 * `CreditsPage` already had the right error message written. It just never
 * reached it: `balanceRes.json()` parses a 401's `{"error":"Not authenticated"}`
 * perfectly happily, so `setBalance(undefined)` ran, the catch never fired, and
 * the student got a blank credits panel with no explanation.
 *
 * These tests fail against the pre-#68 component and pass after it goes through
 * `getJson`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CreditsPage from './CreditsPage';

const ERROR_TEXT = /could not load credits/i;

const respond = (body, status = 200) => ({
  ok: status < 400,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

function renderPage() {
  return render(<MemoryRouter><CreditsPage /></MemoryRouter>);
}

beforeEach(() => { globalThis.fetch = vi.fn(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('CreditsPage', () => {
  it('shows its error message when the credits call is unauthenticated', async () => {
    globalThis.fetch.mockResolvedValue(respond({ error: 'Not authenticated' }, 401));

    renderPage();

    expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument();
  });

  it('shows its error message when the server 500s', async () => {
    globalThis.fetch.mockResolvedValue(respond({ error: 'boom' }, 500));

    renderPage();

    expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument();
  });

  it('shows its error message when Cloudflare returns an HTML 502', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false, status: 502,
      text: async () => '<!DOCTYPE html><title>502 Bad Gateway</title>',
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    });

    renderPage();

    expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument();
  });

  it('renders the balance when the call succeeds', async () => {
    globalThis.fetch.mockImplementation((url) =>
      Promise.resolve(url.includes('/packs')
        ? respond({ packs: [] })
        : respond({ balance: 42 })));

    renderPage();

    // Rendered as one text node: "Current balance: 42 credits".
    expect(await screen.findByText(/current balance: 42 credits/i)).toBeInTheDocument();
    expect(screen.queryByText(ERROR_TEXT)).not.toBeInTheDocument();
  });
});
