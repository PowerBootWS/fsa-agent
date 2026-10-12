import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ContactSupportModal from './ContactSupportModal';

const respond = (body, status) => ({ ok: status < 400, status, json: async () => body });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ContactSupportModal', () => {
  it('sends category, message and lesson context, then thanks the student', async () => {
    globalThis.fetch = vi.fn(async () => respond({ ok: true }, 201));
    render(<ContactSupportModal onClose={() => {}} defaultCategory="content" lessonCode="2A1-1-3" />);
    expect(screen.getByLabelText("What's it about?").value).toBe('content');
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: ' Slide 4 is wrong ' } });
    fireEvent.click(send);
    expect(await screen.findByText(/it's on its way/)).toBeTruthy();
    const [url, opts] = globalThis.fetch.mock.calls.find(([u]) => String(u).endsWith('/support-message'));
    expect(url).toBe('/api/platform/support-message');
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({ category: 'content', message: 'Slide 4 is wrong', lesson_code: '2A1-1-3' });
  });

  it('shows the server error and keeps the form', async () => {
    globalThis.fetch = vi.fn(async (u) => String(u).endsWith('/support-message')
      ? respond({ error: 'That is a lot of messages at once.' }, 429) : respond({}, 204));
    render(<ContactSupportModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('That is a lot of messages at once.')).toBeTruthy();
    expect(screen.getByLabelText('Your message').value).toBe('hi');
  });
});
