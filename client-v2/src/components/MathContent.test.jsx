import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MathContent, tokenizeMath } from './MathContent';

const kinds = (text) => tokenizeMath(text).map((s) => (s.type === 'text' ? `t:${s.text}` : `${s.type}:${s.math}`));

describe('tokenizeMath', () => {
  it('reads an inline formula after a display formula', () => {
    expect(kinds('$$a$$ then $b$')).toEqual(['block:a', 't: then ', 'inline:b']);
  });

  it('handles inline, display, inline in one string', () => {
    expect(kinds('$x$ and $$y$$ and $z$')).toEqual(['inline:x', 't: and ', 'block:y', 't: and ', 'inline:z']);
  });

  it('handles a display formula immediately followed by an inline one', () => {
    expect(kinds('$$a$$$b$')).toEqual(['block:a', 'inline:b']);
  });

  it('leaves dollar amounts as text', () => {
    expect(kinds('It costs $240,000 to $480,000 a year.')).toEqual(['t:It costs $240,000 to $480,000 a year.']);
    expect(kinds('Between $5 and $10 each')).toEqual(['t:Between $5 and $10 each']);
  });

  it('still finds math after a dollar amount', () => {
    expect(kinds('Pay $5 and solve $x^2$.')).toEqual(['t:Pay $5 and solve ', 'inline:x^2', 't:.']);
  });

  it('keeps a lone or unclosed dollar as text', () => {
    expect(kinds('$5')).toEqual(['t:$5']);
    expect(kinds('$$a')).toEqual(['t:$$a']);
  });
});

describe('MathContent', () => {
  it('renders no raw LaTeX after a display formula', () => {
    const { container } = render(
      <MathContent text={'Square both sides: $$Z = \\sqrt{R^2 + X^2}$$ The sign of $X = -80\\ \\Omega$ disappears.'} />,
    );
    expect(container.querySelectorAll('.math-display .katex')).toHaveLength(1);
    expect(container.querySelectorAll('.math-inline .katex')).toHaveLength(1);
    expect(container.textContent).not.toContain('$');
  });
});
