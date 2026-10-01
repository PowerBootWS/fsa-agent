import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AnnouncementModal, { _resetAnnouncementCheck } from './AnnouncementModal';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => mockNavigate,
}));

const respond = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const ann = { id: 7, title: 'Meet your new Home page', body: 'Everything in one place.\n\nTake a look.', cta_label: 'Check it out', cta_url: '/home' };

function setup(announcement = ann) {
  globalThis.fetch = vi.fn(async (url, opts) => {
    if (String(url).endsWith('/announcements/next')) return respond({ announcement });
    return respond({ ok: true }, opts?.method === 'POST' && String(url).endsWith('/feedback') ? 201 : 204);
  });
  return render(<MemoryRouter><AnnouncementModal /></MemoryRouter>);
}
const posts = (suffix) => globalThis.fetch.mock.calls.filter(([u, o]) => String(u).endsWith(suffix) && o?.method === 'POST');

beforeEach(() => { _resetAnnouncementCheck(); mockNavigate.mockClear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('AnnouncementModal', () => {
  it('renders nothing when there is no announcement', async () => {
    setup(null);
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the announcement with its paragraphs, labelled by its title', async () => {
    setup();
    const dialog = await screen.findByRole('dialog', { name: 'Meet your new Home page' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Everything in one place.')).toBeInTheDocument();
    expect(screen.getByText('Take a look.')).toBeInTheDocument();
    expect(screen.getByText(/new/i, { selector: '.an-badge' })).toBeInTheDocument();
  });

  it('Got it records dismissed and closes', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /got it/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(JSON.parse(posts('/announcements/7/seen')[0][1].body)).toEqual({ action: 'dismissed' });
  });

  it('the close button and Escape also record dismissed', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /close/i }));
    expect(posts('/announcements/7/seen')).toHaveLength(1);
    cleanup(); _resetAnnouncementCheck();
    setup();
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts('/announcements/7/seen')).toHaveLength(1);
  });

  it('Escape while typing feedback still closes it', async () => {
    setup();
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: 'half a thought' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clicking the backdrop does not close it', async () => {
    const { container } = setup();
    await screen.findByRole('dialog');
    fireEvent.mouseDown(container.ownerDocument.querySelector('.an-backdrop'));
    fireEvent.click(container.ownerDocument.querySelector('.an-backdrop'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('the button records cta and navigates in-app', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Check it out' }));
    expect(JSON.parse(posts('/announcements/7/seen')[0][1].body)).toEqual({ action: 'cta' });
    expect(mockNavigate).toHaveBeenCalledWith('/home');
  });

  it('an https button opens that URL, not a router path', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    setup({ ...ann, cta_url: 'https://fullsteamahead.ca/jobs' });
    fireEvent.click(await screen.findByRole('button', { name: 'Check it out' }));
    expect(open).toHaveBeenCalledWith('https://fullsteamahead.ca/jobs', '_self');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('feedback: Send is disabled when empty, posts the text, then thanks', async () => {
    setup();
    const send = await screen.findByRole('button', { name: /send/i });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Add dark mode' } });
    fireEvent.click(send);
    expect(await screen.findByText(/thanks, russ reads every one of these/i)).toBeInTheDocument();
    expect(JSON.parse(posts('/announcements/7/feedback')[0][1].body)).toEqual({ message: 'Add dark mode' });
  });

  it('feedback failure shows a retry message and stays open', async () => {
    setup();
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'hello' } });
    globalThis.fetch.mockImplementationOnce(async () => respond({ error: 'x' }, 500));
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(await screen.findByText(/couldn't send that, try again/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('checks for an announcement only once per page load', async () => {
    setup(null);
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    cleanup();
    render(<MemoryRouter><AnnouncementModal /></MemoryRouter>);
    await new Promise(r => setTimeout(r, 0));
    expect(globalThis.fetch.mock.calls.filter(([u]) => String(u).endsWith('/announcements/next'))).toHaveLength(1);
  });

  it('never says tailor and has no em dash in its own copy', async () => {
    const { container } = setup();
    await screen.findByRole('dialog');
    expect(container.ownerDocument.body.textContent).not.toMatch(/tailor|—/i);
  });

  it('re-checks on the next mount after a 401 (no page reload)', async () => {
    globalThis.fetch = vi.fn(async () => respond({}, 401));
    render(<MemoryRouter><AnnouncementModal /></MemoryRouter>);
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    await new Promise(r => setTimeout(r, 0));
    cleanup();
    setup();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('sends the seen POST with keepalive so a CTA navigation cannot cancel it', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /dismiss|got it/i }));
    expect(posts('/announcements/7/seen')[0][1].keepalive).toBe(true);
  });
});
