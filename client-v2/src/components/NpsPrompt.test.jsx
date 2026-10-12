import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import NpsPrompt, { _resetNpsCheck } from './NpsPrompt';
import { _resetAnnouncementCheck } from './AnnouncementModal';

const respond = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const calls = (suffix) => globalThis.fetch.mock.calls.filter(([u]) => String(u).endsWith(suffix));

function setup({ ask = true, answer = { id: 5, promoter: true, affiliate: { code: 'PAT', referral_url: 'https://fullsteamahead.ca/?am_id=PAT' } } } = {}) {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.endsWith('/nps/next')) return respond({ ask });
    if (u.endsWith('/api/platform/nps')) return respond(answer, 201);
    return respond({}, 204);
  });
  return render(<NpsPrompt waitMs={0} />);
}

beforeEach(() => { _resetNpsCheck(); _resetAnnouncementCheck(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('NpsPrompt', () => {
  it('stays hidden when the server says not to ask', async () => {
    setup({ ask: false });
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText(/How likely are you/)).toBeNull();
  });

  it('a promoter without their link is shown it', async () => {
    setup();
    fireEvent.click(await screen.findByRole('radio', { name: '10' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(await screen.findByRole('button', { name: 'No, show me' }));
    expect(await screen.findByText('https://fullsteamahead.ca/?am_id=PAT')).toBeTruthy();
    const [, opts] = calls('/nps/5/affiliate-link')[0];
    expect(JSON.parse(opts.body)).toEqual({ had_link: false });
    expect(JSON.parse(calls('/api/platform/nps')[0][1].body)).toEqual({ score: 10, reason: '' });
  });

  it('a detractor gets a thank-you, no affiliate step', async () => {
    setup({ answer: { id: 6, promoter: false, affiliate: null } });
    fireEvent.click(await screen.findByRole('radio', { name: '3' }));
    fireEvent.change(screen.getByLabelText(/What would make it better/), { target: { value: 'More 2B2 questions' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Russ reads every one of these.')).toBeTruthy();
    expect(JSON.parse(calls('/api/platform/nps')[0][1].body)).toEqual({ score: 3, reason: 'More 2B2 questions' });
  });

  it('closing without answering records a dismissal', async () => {
    setup();
    await screen.findByText(/How likely are you/);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(calls('/nps/dismiss').length).toBe(1);
  });
});
