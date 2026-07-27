import katex from 'katex';

// Render one math segment via the top-level `katex` package directly,
// rather than through `react-katex` (which bundles its own separate nested
// `katex` copy — a different version than the one this app's KaTeX CSS,
// `katex/dist/katex.min.css`, is generated from). That version/bundling
// mismatch was silently breaking symbol lookups for real commands like
// `\alpha`/`\dfrac`/`\Delta`/`\times` in production (KaTeX's throwOnError:
// false default then renders the unresolved command as literal red text
// instead of failing loudly), even though the exact same LaTeX renders
// correctly via `katex.renderToString` outside a bundled browser build.
// Calling the top-level package directly — the same one whose CSS is
// already loaded, and the same integration style already proven to work
// for chat messages via `rehype-katex` — removes that mismatch entirely.
export function KatexSpan({ math, displayMode }) {
  let html;
  try {
    html = katex.renderToString(math, { displayMode, throwOnError: false });
  } catch (e) {
    html = math;
  }
  const Tag = displayMode ? 'div' : 'span';
  return <Tag dangerouslySetInnerHTML={{ __html: html }} />;
}

// Render a plain-text run, converting **bold** markdown to <strong>.
function renderText(str, keyPrefix) {
  return str.split(/(\*\*[^*]+\*\*)/g).map((p, j) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={`${keyPrefix}-b${j}`}>{p.slice(2, -2)}</strong>;
    }
    return <span key={`${keyPrefix}-s${j}`}>{p}</span>;
  });
}

// Question/option text uses `$` both for real LaTeX (per convention, inline
// `$...$`) and for plain currency amounts (e.g. "$240,000 to $480,000").
// A pair of `$` around currency text looks exactly like an inline-math match
// to a naive regex, so reject captures that look like currency/prose rather
// than math: real LaTeX never starts or ends with whitespace inside the
// delimiters, and never contains a thousands-separated number.
function looksLikeMath(content) {
  if (/^\s|\s$/.test(content)) return false;
  if (/\d,\d{3}/.test(content)) return false;
  return true;
}

export function MathContent({ text }) {
  if (!text) return null;

  const parts = [];
  const blockRegex = /\$\$([\s\S]+?)\$\$/g;
  const inlineRegex = /\$((?:[^$]|\\.)+?)\$/g;

  const blockMatches = [...text.matchAll(blockRegex)].filter(m => looksLikeMath(m[1]));
  const inlineMatches = [...text.matchAll(inlineRegex)].filter(m => looksLikeMath(m[1]));

  const segments = [];
  blockMatches.forEach(m => segments.push({ start: m.index, end: m.index + m[0].length, type: 'block', math: m[1] }));
  inlineMatches.forEach(m => {
    const insideBlock = blockMatches.some(b => m.index >= b.index && m.index < b.index + b[0].length);
    if (!insideBlock) {
      segments.push({ start: m.index, end: m.index + m[0].length, type: 'inline', math: m[1] });
    }
  });
  segments.sort((a, b) => a.start - b.start);

  let cursor = 0;
  segments.forEach((seg, i) => {
    if (seg.start > cursor) parts.push(<span key={`t${i}`}>{renderText(text.slice(cursor, seg.start), `t${i}`)}</span>);
    if (seg.type === 'block') parts.push(<KatexSpan key={`b${i}`} math={seg.math} displayMode />);
    else parts.push(<KatexSpan key={`il${i}`} math={seg.math} displayMode={false} />);
    cursor = seg.end;
  });
  if (cursor < text.length) parts.push(<span key="tail">{renderText(text.slice(cursor), 'tail')}</span>);

  return parts.length > 0 ? <>{parts}</> : <span>{renderText(text, 'only')}</span>;
}
