import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GoalsPage from './GoalsPage';

const respond = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const state = {
  eligible: true, show_invite: true, goal: null, papers: ['2A1', '2A2'], active_paper: '2A1',
  options: {
    shift_patterns: { days: 'Straight days', fourteen_on_fourteen_off: '14-on/14-off', other: 'Something else' },
    study_places: { night_shift: 'Night shift at work', home: 'At home' },
    weekly_sessions: [2, 3, 4, 5],
  },
};

afterEach(() => { vi.restoreAllMocks(); });

describe('GoalsPage', () => {
  it('walks the four steps and saves the goal', async () => {
    let saved;
    globalThis.fetch = vi.fn().mockImplementation((url, init) => {
      if (init?.method === 'PUT') {
        saved = JSON.parse(init.body);
        return Promise.resolve(respond({ goal: { ...saved, target_date: `${saved.target_date}-01` } }));
      }
      return Promise.resolve(respond(state));
    });
    render(<MemoryRouter><GoalsPage /></MemoryRouter>);

    expect(await screen.findByText(/which paper, and when/i)).toBeInTheDocument();
    const next = () => screen.getByRole('button', { name: 'Next' });
    expect(next()).toBeDisabled();
    const month = screen.getByRole('combobox');
    fireEvent.change(month, { target: { value: month.options[3].value } });
    fireEvent.click(next());

    fireEvent.click(screen.getByRole('button', { name: '14-on/14-off' }));
    fireEvent.click(next());

    fireEvent.click(screen.getByRole('button', { name: 'Night shift at work' }));
    fireEvent.click(screen.getByRole('button', { name: 'At home' }));
    fireEvent.click(next());

    fireEvent.click(screen.getByRole('button', { name: '3 a week' }));
    fireEvent.click(screen.getByRole('button', { name: /save my goal/i }));

    expect(await screen.findByText(/here's your plan/i)).toBeInTheDocument();
    expect(saved).toMatchObject({
      paper: '2A1', date_is_exact: false, exam_booked: false,
      shift_pattern: 'fourteen_on_fourteen_off', study_places: ['night_shift', 'home'], weekly_sessions: 3,
    });
    expect(screen.getByText(/I'll check in about that in two weeks/)).toBeInTheDocument();
  });

  it('"Something else" needs a description before moving on', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ ...state, goal: {
      paper: '2A1', target_date: '2099-03-01', date_is_exact: false, exam_booked: true,
      shift_pattern: 'days', study_places: ['home'], weekly_sessions: 2,
    } }));
    render(<MemoryRouter><GoalsPage /></MemoryRouter>);
    expect(await screen.findByText(/update your goal/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Something else' }));
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '5 days on, 2 off, some nights' } });
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
  });

  it('a 4th Class student is told it is not for them yet', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond({ eligible: false }));
    render(<MemoryRouter><GoalsPage /></MemoryRouter>);
    expect(await screen.findByText(/for 2nd and 3rd Class students/i)).toBeInTheDocument();
  });
});
