import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CoachingCard, { examCountdown } from './CoachingCard';

const respond = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const options = { shift_patterns: { days: 'Straight days' }, study_places: { home: 'At home' }, weekly_sessions: [2, 3] };

function renderCard(state) {
  globalThis.fetch = vi.fn().mockImplementation((url) =>
    Promise.resolve(url === '/api/platform/coaching' ? respond(state) : respond({ reply: 'Nice. Booking it is the step', link: '/goals' })));
  return render(<MemoryRouter><CoachingCard /></MemoryRouter>);
}

afterEach(() => { vi.restoreAllMocks(); });

describe('CoachingCard', () => {
  it('renders nothing for a student who is not eligible', async () => {
    const { container } = renderCard({ eligible: false });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('invites, and "No thanks" records the answer and hides the card', async () => {
    renderCard({ eligible: true, show_invite: true, goal: null, options });
    expect(await screen.findByText(/want a hand setting a goal/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /let's do it/i })).toHaveAttribute('href', '/goals');
    fireEvent.click(screen.getByRole('button', { name: /no thanks/i }));
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/platform/coaching/invite', expect.objectContaining({ body: JSON.stringify({ answer: 'declined' }) }));
    expect(screen.queryByText(/want a hand/i)).not.toBeInTheDocument();
  });

  it('shows the plan and a question from Russ, and an answer shows his reply', async () => {
    renderCard({
      eligible: true, show_invite: false, options,
      goal: { paper: '2A1', target_date: '2099-01-15', date_is_exact: true, exam_booked: false, weekly_sessions: 3 },
      plan: { sessions_this_week: 1, weekly_target: 3 },
      message: { id: 7, kind: 'commitment', body: 'Quick one: have you booked 2A1 yet?', answers: [{ key: 'yes', label: 'Yes, booked' }, { key: 'not_yet', label: 'Not yet' }] },
    });
    expect(await screen.findByText(/have you booked 2A1 yet/i)).toBeInTheDocument();
    expect(screen.getByText(/This week: 1 of 3 sessions/)).toBeInTheDocument();
    expect(screen.getByText(/Not booked yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /yes, booked/i }));
    expect(await screen.findByText(/Booking it is the step/)).toBeInTheDocument();
  });
});

describe('a note with a link', () => {
  it('shows the link as a button', async () => {
    renderCard({
      eligible: true, show_invite: false, options,
      goal: { paper: '2A1', target_date: '2099-01-15', date_is_exact: true, exam_booked: true, weekly_sessions: 3 },
      plan: { sessions_this_week: 0, weekly_target: 3 },
      message: { id: 9, kind: 'commitment', body: 'Two weeks to go until 2A1.', answers: null, link_url: 'https://fullsteamahead.ca/two-weeks-out', link_label: 'Open the two-weeks-out plan' },
    });
    expect(await screen.findByRole('link', { name: 'Open the two-weeks-out plan' })).toHaveAttribute('href', 'https://fullsteamahead.ca/two-weeks-out');
    expect(screen.getByRole('button', { name: /got it/i })).toBeInTheDocument();
  });
});

describe('examCountdown', () => {
  const today = new Date(2026, 9, 22);
  it('counts days to an exact date', () => {
    expect(examCountdown({ paper: '2A1', target_date: '2026-11-01', date_is_exact: true }, today)).toBe('2A1 exam in 10 days');
    expect(examCountdown({ paper: '2A1', target_date: '2026-10-23', date_is_exact: true }, today)).toBe('2A1 exam tomorrow');
  });
  it('names the month when only a month is known', () => {
    expect(examCountdown({ paper: '3B1', target_date: '2027-02-01', date_is_exact: false }, today)).toBe('3B1 exam in February 2027');
  });
});

describe('TextOptIn', () => {
  const texting = { on: false, offer: true, consent_text: 'Russ from Full Steam Ahead can text you about your studying. Reply STOP anytime to stop.' };

  it('needs a number and the consent box before it will set up texts', async () => {
    renderCard({
      eligible: true, show_invite: false, options, texting,
      goal: { paper: '2A1', target_date: '2099-01-15', date_is_exact: true, exam_booked: true, weekly_sessions: 3 },
      plan: { sessions_this_week: 0, weekly_target: 3 }, message: null,
    });
    expect(await screen.findByText(/want me to text you now and then/i)).toBeInTheDocument();
    expect(screen.queryByText(/SMS/)).not.toBeInTheDocument();
    const yes = screen.getByRole('button', { name: /yes, text me/i });
    expect(yes).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: '780 555 0123' } });
    expect(yes).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(yes).not.toBeDisabled();
  });

  it('shows when texts are on, with a way to turn them off', async () => {
    renderCard({
      eligible: true, show_invite: false, options, texting: { on: true, phone_last4: '0123', offer: false },
      goal: { paper: '2A1', target_date: '2099-01-15', date_is_exact: true, exam_booked: true, weekly_sessions: 3 },
      plan: { sessions_this_week: 0, weekly_target: 3 }, message: null,
    });
    expect(await screen.findByText(/Text check-ins are on \(number ending 0123\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /turn off/i })).toBeInTheDocument();
  });
});
