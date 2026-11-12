import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BodyContent, ContentPanel, parseBody } from './ContentPanel';
import { MathContent } from './MathContent';

// Final fix 3: every verified body line is shown, including plain lines after a bullet.
describe('ContentPanel body', () => {
  const body = 'A series circuit has 30 Ω and 110 Ω.\n- Inductive reactance pushes one way\n'
    + '- Capacitive reactance pushes the other\nQ uses the magnitude of X, never its sign.\n'
    + '- A last bullet';

  it('parses paragraphs and bullet lists in order, dropping nothing', () => {
    expect(parseBody(body)).toEqual([
      { type: 'text', lines: ['A series circuit has 30 Ω and 110 Ω.'] },
      { type: 'bullets', lines: ['Inductive reactance pushes one way', 'Capacitive reactance pushes the other'] },
      { type: 'text', lines: ['Q uses the magnitude of X, never its sign.'] },
      { type: 'bullets', lines: ['A last bullet'] },
    ]);
  });

  it('renders the line after the bullets', () => {
    render(<BodyContent body={body} chunkType="principle" />);
    expect(screen.getByText('Q uses the magnitude of X, never its sign.')).toBeTruthy();
    expect(screen.getByText('A series circuit has 30 Ω and 110 Ω.')).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Inductive reactance pushes one way', 'Capacitive reactance pushes the other', 'A last bullet',
    ]);
  });

  it('keeps the old shape for a seed line then bullets', () => {
    expect(parseBody('Seed one\nseed two\n\n- b1\n* b2\n• b3')).toEqual([
      { type: 'text', lines: ['Seed one', 'seed two'] },
      { type: 'bullets', lines: ['b1', 'b2', 'b3'] },
    ]);
  });

  it('shows every non-empty line of any body', () => {
    const lines = body.split('\n').map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
    const shown = parseBody(body).flatMap((b) => b.lines);
    expect(shown).toEqual(lines);
  });
});

// Mobile player (2026-11-12): one compact bar of icon-only buttons on phones.
// jsdom has no media queries, so these check the markup the CSS relies on.
describe('ContentPanel controls', () => {
  const section = { slide_number: 1, title: 'T', body: 'Body', audio_url: '/a.mp3', narration_timing: null };
  const panel = (over = {}) => render(
    <ContentPanel section={section} sectionIndex={0} totalSections={3} onNext={() => {}} onBack={() => {}}
      isComplete={false} hideNarration {...over} />,
  );

  it('renders the controls in one .player-controls bar with labelled icon buttons', () => {
    const { container } = panel({ onToggleAutoAdvance: () => {} });
    const bar = container.querySelector('.player-controls');
    expect(bar).toBeTruthy();
    const b = within(bar);
    for (const name of ['Back', 'Play narration', 'Next']) {
      const btn = b.getByRole('button', { name });
      expect(btn.getAttribute('aria-label')).toBe(name);
      expect(btn.querySelector('.ctl-icon svg')).toBeTruthy();
    }
    expect(b.getByRole('combobox', { name: 'Speed' })).toBeTruthy();
    expect(b.getByRole('checkbox', { name: /Mute audio/ })).toBeTruthy();
    expect(b.getByRole('checkbox', { name: /Autoplay/ })).toBeTruthy();
    expect(b.getByText('1 of 3')).toBeTruthy();
  });

  it('keeps the desktop text labels', () => {
    const { container } = panel();
    const text = [...container.querySelectorAll('.player-controls .ctl-text')].map((e) => e.textContent);
    expect(text).toEqual(expect.arrayContaining(['▶ Play', 'Speed', 'Mute audio', '← Back', 'Next →']));
  });

  it('names the last-slide button by its label and shows the short label on phones', () => {
    const { container } = panel({ sectionIndex: 2, lastSlideLabel: 'Practice question →', lastSlideShortLabel: 'Practice' });
    const next = screen.getByRole('button', { name: 'Practice question' });
    expect(next.querySelector('.ctl-text').textContent).toBe('Practice question →');
    expect(next.querySelector('.ctl-icon').textContent).toBe('Practice');
    expect(container.querySelector('.player-controls--last')).toBeTruthy();
  });

  it('defaults the last slide to Finish Objective / Finish', () => {
    panel({ sectionIndex: 2 });
    const next = screen.getByRole('button', { name: 'Finish Objective' });
    expect(next.querySelector('.ctl-icon').textContent).toBe('Finish');
  });

  it('disables Back on the first slide and has no play button without audio', () => {
    panel({ section: { ...section, audio_url: null } });
    expect(screen.getByRole('button', { name: 'Back' }).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Play narration/ })).toBeNull();
  });
});

describe('formula wrappers', () => {
  it('wraps a display formula in a .math-display scroll box', () => {
    const { container } = render(<BodyContent body={'Seed\n$$Z = \\sqrt{R^2 + X^2}$$'} chunkType="example" />);
    const box = container.querySelector('.math-display');
    expect(box).toBeTruthy();
    expect(box.querySelector(':scope > .katex-display')).toBeTruthy();
  });

  it('marks inline math in options and explanations', () => {
    const { container } = render(<MathContent text={'So $X = -80\\ \\Omega$ and $$Q = I^2 X$$'} />);
    expect(container.querySelector('.math-inline .katex')).toBeTruthy();
    expect(container.querySelector('.math-display .katex-display')).toBeTruthy();
  });
});
