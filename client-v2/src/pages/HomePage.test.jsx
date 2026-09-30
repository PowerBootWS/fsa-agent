import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './HomePage';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => mockNavigate,
}));

const respond = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

const base = {
  first_name: 'Taylor',
  course: { state: 'none', subscriptions: [] },
  jobs: { saved_count: 0, custom_resumes_count: 0 },
  credits: { balance: 1 },
  resume_on_file: true,
  new_jobs_7d: 14,
  affiliate: { is_affiliate: false },
};

function renderHome(data) {
  globalThis.fetch = vi.fn().mockResolvedValue(respond(data));
  return render(<MemoryRouter><HomePage /></MemoryRouter>);
}

beforeEach(() => { mockNavigate.mockClear(); localStorage.setItem('fsa_user', '{"id":1}'); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('HomePage', () => {
  it('not enrolled: points to the courses', async () => {
    renderHome(base);
    expect(await screen.findByText(/not currently enrolled/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /have a look at the courses/i }))
      .toHaveAttribute('href', 'https://fullsteamahead.ca/enroll');
  });

  it('active student: shows paper, exam line and Continue to /lobby', async () => {
    renderHome({ ...base, course: { state: 'active', subscriptions: [{
      class_code: 'second', paper: '2A3', pct_complete: 40, last_exam_score: 72,
      weakest_chapter: { chapter_id: '2A3-6', title: 'Boilers', score: 40 } }] } });
    expect(await screen.findByText(/2nd Class/)).toBeInTheDocument();
    expect(screen.getByText(/2A3/)).toBeInTheDocument();
    expect(screen.getByText(/Last practice exam 72%/)).toBeInTheDocument();
    expect(screen.getByText(/Boilers/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /continue/i })).toHaveAttribute('href', '/lobby');
  });

  it('student with no paper picked: links to the picker', async () => {
    renderHome({ ...base, course: { state: 'active', subscriptions: [{
      class_code: 'third', paper: null, pct_complete: null, last_exam_score: null, weakest_chapter: null }] } });
    expect(await screen.findByRole('link', { name: /pick your paper/i })).toHaveAttribute('href', '/select-paper');
  });

  it('lapsed: welcome back', async () => {
    renderHome({ ...base, course: { state: 'lapsed', subscriptions: [] } });
    expect(await screen.findByText(/welcome back, taylor/i)).toBeInTheDocument();
  });

  it('credits with saved jobs: points to saved jobs by name', async () => {
    renderHome({ ...base, jobs: { saved_count: 3, custom_resumes_count: 0 } });
    expect(await screen.findByText(/let's go, taylor/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /pick a saved job/i })).toHaveAttribute('href', '/jobs');
  });

  it('credits, no saved jobs: points to the job board', async () => {
    renderHome(base);
    expect(await screen.findByText(/find a job worth going after first/i)).toBeInTheDocument();
  });

  it('no credits: offers more credits', async () => {
    renderHome({ ...base, credits: { balance: 0 } });
    expect(await screen.findByRole('link', { name: /get more credits/i })).toHaveAttribute('href', '/credits');
  });

  it('shows the resume upload nudge only without a resume', async () => {
    renderHome({ ...base, resume_on_file: false });
    expect(await screen.findByText(/upload your resume/i)).toBeInTheDocument();
  });

  it('hides the new-jobs card when the count is unavailable', async () => {
    renderHome({ ...base, new_jobs_7d: null });
    await screen.findByText(/not currently enrolled/i);
    expect(screen.queryByText(/new postings/i)).not.toBeInTheDocument();
  });

  it('shows the rolling new-jobs count', async () => {
    renderHome(base);
    expect(await screen.findByText(/14 new postings in the last 7 days/i)).toBeInTheDocument();
  });

  it('affiliate: shows earnings and the referral link', async () => {
    renderHome({ ...base, affiliate: { is_affiliate: true, code: 'TAY1', referral_url: 'https://fullsteamahead.ca/?am_id=TAY1',
      referred_count: 4, enrolled_count: 2, earned_cents: 5960 } });
    expect(await screen.findByText('$59.60')).toBeInTheDocument();
    expect(screen.getByText('https://fullsteamahead.ca/?am_id=TAY1')).toBeInTheDocument();
  });

  it('affiliate section failed: shows the fallback line', async () => {
    renderHome({ ...base, affiliate: null });
    expect(await screen.findByText(/couldn't load your referral stats/i)).toBeInTheDocument();
  });

  it('Join flips the card to the referral link', async () => {
    renderHome(base);
    await screen.findByText(/earn 20% of every 2nd or 3rd class referral, every month/i);
    globalThis.fetch.mockResolvedValueOnce(respond({ affiliate: { is_affiliate: true, code: 'TAY1',
      referral_url: 'https://fullsteamahead.ca/?am_id=TAY1', referred_count: 0, enrolled_count: 0, earned_cents: 0 } }));
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(await screen.findByText('https://fullsteamahead.ca/?am_id=TAY1')).toBeInTheDocument();
  });

  it('Join failure shows the server message', async () => {
    renderHome(base);
    await screen.findByText(/earn 20%/i);
    globalThis.fetch.mockResolvedValueOnce(respond({ error: "Couldn't join right now, try again in a minute." }, 502));
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(await screen.findByText(/couldn't join right now/i)).toBeInTheDocument();
  });

  it('Join with a non-JSON 502 shows the friendly fallback', async () => {
    renderHome(base);
    await screen.findByText(/earn 20%/i);
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(await screen.findByText(/couldn't join right now/i)).toBeInTheDocument();
  });

  it('weakest chapter with null id and title renders without crashing', async () => {
    renderHome({ ...base, course: { state: 'active', subscriptions: [{ class_code: 'second', paper: '2A3',
      pct_complete: 50, last_exam_score: 55, weakest_chapter: { chapter_id: null, title: null, score: 10 } }] } });
    expect(await screen.findByText(/last practice exam 55%/i)).toBeInTheDocument();
    expect(screen.queryByText(/weakest/i)).not.toBeInTheDocument();
  });

  it('singular new posting', async () => {
    renderHome({ ...base, new_jobs_7d: 1 });
    expect(await screen.findByText(/^1 new posting in the last 7 days\.$/i)).toBeInTheDocument();
  });

  it('lapsed keeps the Your course title and a normal welcome paragraph', async () => {
    renderHome({ ...base, course: { state: 'lapsed', subscriptions: [] } });
    const p = await screen.findByText(/welcome back, taylor/i);
    expect(p.tagName).toBe('P');
    expect(screen.getByText('Your course')).toBeInTheDocument();
  });

  it('401 clears the stale user and goes to /login', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ error: 'x' }, 401));
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true }));
    expect(localStorage.getItem('fsa_user')).toBeNull();
  });

  it('never says tailor', async () => {
    const { container } = renderHome({ ...base, resume_on_file: false, credits: { balance: 0 } });
    await screen.findByText(/not currently enrolled/i);
    expect(container.textContent).not.toMatch(/tailor/i);
  });
});
