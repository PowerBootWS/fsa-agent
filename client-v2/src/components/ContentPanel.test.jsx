import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BodyContent, parseBody } from './ContentPanel';

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
