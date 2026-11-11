import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import PracticeExamPage from './PracticeExamPage';

const respond = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function renderAt(path) {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  globalThis.fetch = vi.fn().mockResolvedValue(respond({ tutor_response: 'hi', display_update: null }));
  localStorage.setItem('fsa_user', JSON.stringify({ email: 's@example.com', class_code: 'second', active_paper: '2B1' }));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/practice-exam" element={<PracticeExamPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => { vi.restoreAllMocks(); });

describe('PracticeExamPage back button', () => {
  it('a retry of wrong answers goes back to its attempt', async () => {
    renderAt('/practice-exam?paper=2B1&quiz=2B1-R12');
    fireEvent.click(await screen.findByRole('button', { name: '← Back to attempt' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/attempts/12');
  });

  it('an ordinary chapter quiz still goes back to the lobby', async () => {
    renderAt('/practice-exam?paper=2B1&quiz=2B1-3');
    fireEvent.click(await screen.findByRole('button', { name: '← Back to Lobby' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/lobby');
  });
});
