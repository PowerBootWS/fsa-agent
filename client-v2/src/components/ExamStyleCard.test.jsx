import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ExamStyleCard from './ExamStyleCard';

afterEach(() => { vi.restoreAllMocks(); });

describe('ExamStyleCard', () => {
  it('renders nothing when the leveled exam is not available for the paper', () => {
    const { container } = render(<ExamStyleCard available={false} engine={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the two styles with leveled selected by default', () => {
    render(<ExamStyleCard available engine={null} />);
    expect(screen.getByText('Practice exam style')).toBeInTheDocument();
    expect(screen.getByLabelText('Leveled (recommended)')).toBeChecked();
    expect(screen.getByLabelText('Previous adaptive exam')).not.toBeChecked();
  });

  it('saves the choice', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ exam_engine: 'adaptive' }) });
    render(<ExamStyleCard available engine={null} />);
    fireEvent.click(screen.getByLabelText('Previous adaptive exam'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/platform/exam-engine', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ engine: 'adaptive' }),
    })));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByLabelText('Previous adaptive exam')).toBeChecked();
  });

  it('puts the choice back and says so when saving fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<ExamStyleCard available engine="leveled" />);
    fireEvent.click(screen.getByLabelText('Previous adaptive exam'));
    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Leveled (recommended)')).toBeChecked();
  });
});
