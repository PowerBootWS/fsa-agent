import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminUsagePage from './AdminUsagePage';
import { getJson } from '../utils/api';

vi.mock('../utils/api', () => ({ getJson: vi.fn(), ApiError: class extends Error {} }));

const PAYLOAD = {
  window_days: 30,
  active_learners: [{ day: '2026-09-03', learners: 4 }],
  screens: [{ screen: '/lobby', views: 12, viewers: 5 }],
  features: [{ action: 'paper_switched', uses: 3, users: 2 }],
  activity: {
    questions_answered: 120, questions_correct: 90, lessons_touched: 8,
    exams_attempted: 2, jobs_saved: 5, tutor_conversations_started: 4, subscribers_active: 15,
  },
};

beforeEach(() => vi.clearAllMocks());

function renderPage() {
  return render(<MemoryRouter><AdminUsagePage /></MemoryRouter>);
}

describe('AdminUsagePage', () => {
  it('renders screen, feature and activity figures', async () => {
    getJson.mockResolvedValue(PAYLOAD);
    renderPage();
    expect(await screen.findByText('/lobby')).toBeInTheDocument();
    expect(await screen.findByText('paper_switched')).toBeInTheDocument();
    expect(await screen.findByText(/120/)).toBeInTheDocument();
  });

  it('shows a clear message when the API refuses', async () => {
    getJson.mockRejectedValue(new Error('Forbidden'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/could not load usage/i)).toBeInTheDocument());
  });

  it('shows an empty state rather than a blank page when there is no data', async () => {
    getJson.mockResolvedValue({ ...PAYLOAD, screens: [], features: [], active_learners: [] });
    renderPage();
    expect(await screen.findByText(/no usage recorded/i)).toBeInTheDocument();
  });
});
