import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ExplainedPage from './ExplainedPage';

const step = (n) => ({
  type: 'calc', context: `Ctx ${n}`, question: `Step ${n} q`,
  options: ['A', 'B', 'C'], correct: 1, explanation: `Because ${n}`,
});
const lesson = (over = {}) => ({
  slug: '2b3-negative-reactance',
  title: 'Negative reactance',
  description: 'd',
  paper_code: '2B3',
  class_code: 'second',
  source_label: 'From 2B3 Chapter 1, Objective 7',
  og_image_url: null,
  version: 1,
  is_draft: false,
  sections: [
    { slide_number: 1, chunk_type: 'title', title: 'Slide one', body: '- first point', narration: 'n', audio_url: null, image_url: null, narration_timing: null },
    { slide_number: 2, chunk_type: 'content', title: 'Slide two', body: '- second point', narration: 'n', audio_url: null, image_url: null, narration_timing: null },
  ],
  questions: [
    { position: 2, question_text: 'Second Q', step_data: { steps: [step(1)] } },
    { position: 1, question_text: 'First Q', step_data: { steps: [step(1)] } },
  ],
  ...over,
});

let fetchMock;
function mockFetch(body, status = 200) {
  fetchMock = vi.fn().mockResolvedValue({ ok: status === 200, status, json: async () => body });
  global.fetch = fetchMock;
}
function renderAt(path = '/explained/2b3-negative-reactance') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/explained/:slug" element={<ExplainedPage />} /></Routes>
    </MemoryRouter>
  );
}
async function answerQuestion() {
  fireEvent.click(await screen.findByRole('button', { name: 'B' }));
  fireEvent.click(screen.getByRole('button', { name: /Next question|Finish/ }));
}

beforeEach(() => {
  localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe('ExplainedPage', () => {
  it('shows header, plays slides with next/back, practice button only on last slide', async () => {
    mockFetch(lesson());
    renderAt();
    expect(screen.getByText(/Loading lesson/)).toBeTruthy();
    expect(await screen.findByText('Slide one')).toBeTruthy();
    expect(screen.getByText('Negative reactance')).toBeTruthy();
    expect(screen.getByText('From 2B3 Chapter 1, Objective 7')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Practice questions/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('Slide two')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Practice questions/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByText('Slide one')).toBeTruthy();
  });

  it('answering all questions (in position order) shows the pitch with the enroll link', async () => {
    mockFetch(lesson());
    renderAt();
    await screen.findByText('Slide one');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Practice questions/ }));
    expect(await screen.findByText('First Q')).toBeTruthy();
    await answerQuestion();
    expect(await screen.findByText('Second Q')).toBeTruthy();
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    await answerQuestion();
    expect(await screen.findByText(/Want the rest of the 2B3 course explained like this\?/)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'See the full course' });
    expect(link.getAttribute('href')).toBe(
      'https://fullsteamahead.ca/enroll?class=second&utm_source=mini-lesson&utm_campaign=2b3-negative-reactance');
    expect(screen.getByText(/Free lesson from Full Steam Ahead\. No sign-up needed\./)).toBeTruthy();
    expect(screen.getByText(/AI tutor/)).toBeTruthy();
  });

  it('fourth_a pitch mentions no tutor and uses Part A', async () => {
    mockFetch(lesson({ slug: '4a-x', class_code: 'fourth_a', paper_code: '4A' }));
    const { container } = renderAt('/explained/4a-x');
    await screen.findByText('Slide one');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Practice questions/ }));
    await answerQuestion();
    await answerQuestion();
    expect(await screen.findByText(/4th Class Part A/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See the full course' }).getAttribute('href'))
      .toContain('class=fourth_a');
    expect(container.textContent.toLowerCase()).not.toContain('tutor');
  });

  it('no rendered text contains an em dash (lesson, questions, pitch)', async () => {
    mockFetch(lesson());
    const { container } = renderAt();
    await screen.findByText('Slide one');
    expect(container.textContent).not.toContain('—');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Practice questions/ }));
    await answerQuestion();
    await answerQuestion();
    await screen.findByText(/Want the rest/);
    expect(container.textContent).not.toContain('—');
  });

  it('zero questions: last slide offers Finish and goes straight to the pitch', async () => {
    mockFetch(lesson({ questions: [] }));
    renderAt();
    await screen.findByText('Slide one');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.queryByRole('button', { name: /Practice questions/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Finish/ }));
    expect(await screen.findByText(/Want the rest/)).toBeTruthy();
  });

  it('forwards ?preview= (encoded) to the fetch, and omits it otherwise', async () => {
    mockFetch(lesson());
    renderAt('/explained/2b3-negative-reactance?preview=a%20b');
    await screen.findByText('Slide one');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/explained/2b3-negative-reactance?preview=a%20b');
  });

  it('does not send preview when absent', async () => {
    mockFetch(lesson());
    renderAt();
    await screen.findByText('Slide one');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/explained/2b3-negative-reactance');
  });

  it('404 shows the not-available message with a link to the site', async () => {
    mockFetch({ error: 'nf' }, 404);
    renderAt();
    expect(await screen.findByText("This lesson isn't available.")).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://fullsteamahead.ca');
  });

  it('network error shows the same message', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('down'));
    renderAt();
    await waitFor(() => expect(screen.getByText("This lesson isn't available.")).toBeTruthy());
  });

  it('a lesson with one question: "Practice question" button and label, no counters', async () => {
    mockFetch(lesson({ questions: [{ position: 1, question_text: 'Only Q', step_data: { steps: [step(1)] } }] }));
    renderAt();
    await screen.findByText('Slide one');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.queryByRole('button', { name: /Practice questions/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Practice question' }));
    expect(await screen.findByText('Only Q')).toBeTruthy();
    expect(screen.getByText('Practice question')).toBeTruthy();
    expect(screen.queryByText(/Question 1 of 1/)).toBeNull();
    expect(screen.queryByText(/Step 1 of 1/)).toBeNull();
  });
});
