/**
 * Lesson tutor redesign, slice 4: with tutor_v2 on, the chat panel is a drawer
 * opened on demand and a checkpoint shows a check-in card in place of the slide.
 * With it off, the player is unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LessonPlayer } from './LessonPlayer';

const SECTIONS = Array.from({ length: 6 }, (_, i) => ({
  slide_number: i, title: `Slide ${i}`, body: `Body ${i}`, chunk_type: 'content',
}));
const CHECKIN = { id: 1, from_slide: 0, after_slide: 3, recap_points: ['Point one.', 'Point two.'],
  exercise_prompt: 'Want to try a few quick questions?' };
const QUESTION = { id: 9, question_text: 'Which one?', options: ['A', 'B'], correct_answer: 1 };

function routes(tutorV2) {
  const ok = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });
  return vi.fn(async (url, opts = {}) => {
    if (url.startsWith('/api/v2/course/')) return ok({ chapters: [{ chapter_num: 1, objectives: [{ lesson_code: '2B1-1-1', title: 'T' }] }] });
    if (url.startsWith('/api/platform/course-structure')) return ok(null);
    if (url.startsWith('/api/v2/lesson/')) return ok({ sections: SECTIONS });
    if (url === '/api/v2/session') return ok({ id: 7 });
    if (url === '/api/platform/me') return ok({ email: 's@x', features: { tutor_v2: tutorV2 } });
    if (url === '/api/v2/checkpoint') return ok({ question: QUESTION, checkin: CHECKIN, _body: opts.body });
    if (url.startsWith('/api/chat/history/')) return ok({ messages: [] });
    if (url === '/api/chat') return ok({ tutor_response: 'Here is question one.' });
    return ok({});
  });
}

async function advanceToCheckpoint() {
  await screen.findByText('Slide 0');
  for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByRole('button', { name: /next/i }));
}

beforeEach(() => {
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
});

describe('LessonPlayer with tutor_v2', () => {
  it('starts with no chat panel and opens the drawer from "Ask about this slide"', async () => {
    globalThis.fetch = routes(true);
    render(<LessonPlayer lessonCode="2B1-1-1" learnerId="s@x" classCode="second" />);
    const ask = await screen.findByRole('button', { name: /ask about this slide/i });
    expect(screen.queryByText('AI Tutor')).not.toBeInTheDocument();
    fireEvent.click(ask);
    expect(screen.getByText('AI Tutor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close tutor/i }));
    expect(screen.queryByText('AI Tutor')).not.toBeInTheDocument();
  });

  it('shows the check-in card in place of the slide, then continues', async () => {
    globalThis.fetch = routes(true);
    render(<LessonPlayer lessonCode="2B1-1-1" learnerId="s@x" classCode="second" />);
    await screen.findByRole('button', { name: /ask about this slide/i });
    await advanceToCheckpoint();

    expect(await screen.findByText('Point one.')).toBeInTheDocument();
    expect(screen.queryByText('Body 4')).not.toBeInTheDocument();
    const call = globalThis.fetch.mock.calls.find(([u]) => u === '/api/v2/checkpoint');
    expect(JSON.parse(call[1].body)).toMatchObject({ lesson_code: '2B1-1-1', slide_number: 4 });

    fireEvent.click(screen.getByRole('button', { name: /continue the lesson/i }));
    expect(screen.getByText('Body 4')).toBeInTheDocument();
  });

  it('starts an exercise in the drawer with the card question on screen', async () => {
    globalThis.fetch = routes(true);
    render(<LessonPlayer lessonCode="2B1-1-1" learnerId="s@x" classCode="second" />);
    await screen.findByRole('button', { name: /ask about this slide/i });
    await advanceToCheckpoint();
    fireEvent.click(await screen.findByRole('button', { name: /quick exercise/i }));

    expect(await screen.findByText('Here is question one.')).toBeInTheDocument();
    const chat = globalThis.fetch.mock.calls.find(([u]) => u === '/api/chat');
    const body = JSON.parse(chat[1].body);
    expect(body.message).toMatch(/slides 0 to 3/);
    expect(body.screenQuestion).toEqual({ question_text: 'Which one?', options: ['A', 'B'], selected_index: null, correct_answer: null });
  });
});

describe('LessonPlayer without tutor_v2', () => {
  it('keeps the always-on panel and no check-in card', async () => {
    globalThis.fetch = routes(false);
    render(<LessonPlayer lessonCode="2B1-1-1" learnerId="s@x" classCode="second" />);
    await screen.findByText('Slide 0');
    await waitFor(() => expect(globalThis.fetch.mock.calls.some(([u]) => u === '/api/platform/me')).toBe(true));
    expect(screen.getByText('AI Tutor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ask about this slide/i })).not.toBeInTheDocument();
    await advanceToCheckpoint();
    expect(await screen.findByText('Which one?')).toBeInTheDocument();
    expect(screen.queryByText('Point one.')).not.toBeInTheDocument();
  });
});
