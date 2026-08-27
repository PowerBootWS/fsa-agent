/**
 * Backlog #68 — the tutor's failure path.
 *
 * `/api/chat` answering 500 with `{"error":"..."}` used to parse fine, so the
 * student saw "Sorry, I could not respond right now." — a message that reads
 * like the tutor declining, not like the platform being broken. The Cloudflare
 * HTML case was worse: `res.json()` threw from inside a parse nobody expected
 * to fail. Both now reach the connection-error path the component already had.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TutorPanel } from './TutorPanel';

const CONNECTION_ERROR = /connection error/i;

function ask(question = 'what is superheat?') {
  render(<TutorPanel lessonCode="2A2-1-1" learnerId="student@test.example" sectionIndex={0} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: /send/i }));
}

beforeEach(() => { globalThis.fetch = vi.fn(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('TutorPanel', () => {
  it('reports a connection problem when the chat API 500s', async () => {
    // `json` is deliberately present and working: without it the pre-#68 code
    // would blow up on `res.json is not a function` and land in the same catch,
    // and the test would pass against the bug it exists to catch.
    const body = { error: 'ai-service unreachable' };
    globalThis.fetch.mockResolvedValue({
      ok: false, status: 500,
      text: async () => JSON.stringify(body),
      json: async () => body,
    });

    ask();

    expect(await screen.findByText(CONNECTION_ERROR)).toBeInTheDocument();
  });

  it('reports a connection problem on a Cloudflare HTML gateway error', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false, status: 502,
      text: async () => '<!DOCTYPE html><title>502 Bad Gateway</title>',
    });

    ask();

    expect(await screen.findByText(CONNECTION_ERROR)).toBeInTheDocument();
  });

  it('shows the tutor\'s reply when the call succeeds', async () => {
    const body = { tutor_response: 'Superheat is heat above saturation.' };
    globalThis.fetch.mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
    });

    ask();

    expect(await screen.findByText(/heat above saturation/i)).toBeInTheDocument();
    expect(screen.queryByText(CONNECTION_ERROR)).not.toBeInTheDocument();
  });
});
