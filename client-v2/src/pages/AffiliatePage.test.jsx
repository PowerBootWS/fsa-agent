import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AffiliatePage from './AffiliatePage';
import AppShell from '../components/AppShell';

const respond = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

const active = {
  is_affiliate: true,
  status: 'active',
  summary: { code: 'TAY1', totalClicks: 12, totalLeads: 3, totalEarnedCents: 5960, totalPaidCents: 0, outstandingCents: 5960 },
  leads: [{ email: 'lead@example.com', firstName: 'Lee', attributedAt: '2026-10-01T12:00:00Z', enrollmentStatus: 'not_enrolled' }],
  customers: [{ email: 'c@example.com', firstName: 'Cam', since: '2026-10-02T12:00:00Z', program: '2nd Class', status: 'active', endsAt: null, earnedCents: 2980 }],
  commissions: [
    { date: '2026-10-03T12:00:00Z', email: 'c@example.com', firstName: 'Cam', type: 'payment', paymentCents: 14900, commissionCents: 2980, paidAt: null },
    { date: '2026-10-04T12:00:00Z', email: 'c@example.com', firstName: 'Cam', type: 'refund', paymentCents: -14900, commissionCents: -2980, paidAt: null },
    { date: '2026-10-05T12:00:00Z', email: 'd@example.com', firstName: 'Dee', type: 'discount', paymentCents: 11900, commissionCents: 0, paidAt: null },
  ],
  discountCodes: [],
};

function renderPage(impl) {
  globalThis.fetch = vi.fn().mockImplementation(impl);
  return render(<MemoryRouter><AffiliatePage /></MemoryRouter>);
}

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('AffiliatePage', () => {
  it('shows Join for a non-affiliate and loads the dashboard after joining', async () => {
    let joined = false;
    renderPage((url, init) => {
      if (init?.method === 'POST') { joined = true; return Promise.resolve(respond({ affiliate: { is_affiliate: true } })); }
      return Promise.resolve(respond(joined ? active : { is_affiliate: false }));
    });
    fireEvent.click(await screen.findByRole('button', { name: /join/i }));
    expect(await screen.findByText('https://fullsteamahead.ca/?am_id=TAY1')).toBeInTheDocument();
  });

  it('shows the paused message and no Generate button for an inactive affiliate', async () => {
    renderPage(() => Promise.resolve(respond({ is_affiliate: true, status: 'inactive' })));
    expect(await screen.findByText(/your referral account is paused/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate a code/i })).toBeNull();
  });

  it('shows the load error on 503', async () => {
    renderPage(() => Promise.resolve(respond({ error: "Couldn't load your referral dashboard right now." }, 503)));
    expect(await screen.findByText("Couldn't load your referral dashboard right now.")).toBeInTheDocument();
  });

  it('Generate a Code shows the code, expiry and copy message', async () => {
    renderPage((url, init) => {
      if (init?.method === 'POST') return Promise.resolve(respond({ code: 'FSA-ABC123', expiresAt: '2026-10-27T18:00:00Z' }, 201));
      return Promise.resolve(respond(active));
    });
    fireEvent.click(await screen.findByRole('button', { name: /generate a code/i }));
    expect(await screen.findByText('FSA-ABC123')).toBeInTheDocument();
    expect(screen.getByText(/^Expires /)).toBeInTheDocument();
    const msg = screen.getByLabelText(/message to send/i);
    expect(msg.value).toContain('Enter code FSA-ABC123');
    expect(msg.value).toContain('https://fullsteamahead.ca/?am_id=TAY1');
  });

  it('keeps the dashboard and new code when the refresh after Generate fails', async () => {
    let gets = 0;
    renderPage((url, init) => {
      if (init?.method === 'POST') return Promise.resolve(respond({ code: 'FSA-KEEP99', expiresAt: '2026-10-27T18:00:00Z' }, 201));
      gets += 1;
      return Promise.resolve(gets === 1 ? respond(active) : respond({ error: 'down' }, 503));
    });
    fireEvent.click(await screen.findByRole('button', { name: /generate a code/i }));
    expect(await screen.findByText('FSA-KEEP99')).toBeInTheDocument();
    await waitFor(() => expect(gets).toBeGreaterThan(1));
    expect(screen.getByText('FSA-KEEP99')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your referral dashboard right now.")).toBeNull();
  });

  it('labels an enrolled lead with the class name, not the raw code', async () => {
    const lead = { email: 'f@example.com', firstName: 'Fay', attributedAt: '2026-10-01T12:00:00Z', enrollmentStatus: 'enrolled:fourth_a' };
    renderPage(() => Promise.resolve(respond({ ...active, leads: [lead] })));
    expect(await screen.findByText('Enrolled – 4th Class 4A')).toBeInTheDocument();
    expect(screen.queryByText(/fourth_a/)).toBeNull();
  });

  it("shows the service's 429 message verbatim", async () => {
    renderPage((url, init) => {
      if (init?.method === 'POST') return Promise.resolve(respond({ error: 'You can generate 3 codes per day.' }, 429));
      return Promise.resolve(respond(active));
    });
    fireEvent.click(await screen.findByRole('button', { name: /generate a code/i }));
    expect(await screen.findByText('You can generate 3 codes per day.')).toBeInTheDocument();
  });

  it('renders a refund row as negative and a $0 row as No commission', async () => {
    renderPage(() => Promise.resolve(respond(active)));
    const refund = (await screen.findByText(/Cam \(refund\)/)).closest('tr');
    expect(within(refund).getByText('-$29.80')).toBeInTheDocument();
    const disc = screen.getByText(/Dee \(discount code, first month\)/).closest('tr');
    expect(within(disc).getByText('No commission')).toBeInTheDocument();
  });

  it('shows deep links with the affiliate code', async () => {
    renderPage(() => Promise.resolve(respond(active)));
    await screen.findByText('https://fullsteamahead.ca/?am_id=TAY1');
    expect(screen.getByText('https://fullsteamahead.ca/4th-class-complete?am_id=TAY1')).toBeInTheDocument();
  });
});

describe('AppShell sidebar', () => {
  it('has a Referrals link to /affiliate', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    globalThis.fetch = vi.fn().mockResolvedValue(respond({}));
    localStorage.setItem('fsa_user', '{"id":1}');
    render(<MemoryRouter><AppShell><div /></AppShell></MemoryRouter>);
    expect(screen.getByRole('link', { name: /referrals/i })).toHaveAttribute('href', '/affiliate');
  });
});
