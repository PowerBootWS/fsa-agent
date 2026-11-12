import { memo, useLayoutEffect, useMemo, useRef } from 'react';
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
//
// Long formulas on a phone. A display formula is shrunk to fit its column, but
// never below MIN_FIT (about 14px type: still legible); past that it scrolls
// sideways inside its own .math-display box, with a fade on the side that has
// more. An inline formula that cannot wrap and is wider than its line gets the
// same treatment. Before this, a long display formula scrolled inside KaTeX's
// own .katex-display, which overflowed vertically as well (scrollHeight 44 vs
// clientHeight 37 at 375px), so it was a two-axis scroller; and an inline
// formula wider than its line ran past the card, where .ex-page's
// overflow-x: hidden cut it off with nothing to scroll.
export const MIN_FIT = 0.7;
// KaTeX boxes carry a px or two that does not scale with the font; treat an
// overflow that small as a fit rather than shrinking to the floor or showing
// a scroll cue for it.
const SLACK = 3;

function setCue(box) {
  const more = box.scrollWidth - box.clientWidth;
  if (more > SLACK) {
    box.dataset.scroll = [
      box.scrollLeft > 1 ? 'left' : '',
      box.scrollLeft < more - 1 ? 'right' : '',
    ].filter(Boolean).join(' ') || 'none';
  } else {
    delete box.dataset.scroll;
  }
}

// The block an inline formula has to fit in.
function lineBox(el) {
  let p = el.parentElement;
  while (p && getComputedStyle(p).display.startsWith('inline')) p = p.parentElement;
  return p;
}

function fit(box, displayMode) {
  // Scale the formula, not its box: the box's 1em margins stay as they were.
  const inner = displayMode ? (box.firstElementChild || box) : box;
  inner.style.fontSize = '';
  delete box.dataset.wide;
  let avail;
  if (displayMode) {
    avail = box.clientWidth;
  } else {
    const line = lineBox(box);
    if (!line) return;
    const cs = getComputedStyle(line);
    avail = line.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (!avail || box.getBoundingClientRect().width <= avail + SLACK) { setCue(box); return; }
    box.dataset.wide = '';
    avail = box.clientWidth;
  }
  const need = box.scrollWidth;
  if (!avail || need <= avail + SLACK) { setCue(box); return; }
  let scale = Math.max(MIN_FIT, Math.floor((avail / need) * 100) / 100);
  inner.style.fontSize = `${scale * 100}%`;
  // KaTeX widths are almost, not exactly, linear in font size.
  for (let i = 0; i < 4 && scale > MIN_FIT && box.scrollWidth > box.clientWidth + SLACK; i++) {
    scale = Math.max(MIN_FIT, scale - 0.02);
    inner.style.fontSize = `${scale * 100}%`;
  }
  setCue(box);
}

// One observer for every formula on the page; refit only when the width changes
// (refitting changes the height, which would otherwise loop). Several inline
// formulas can share one line box, so each element keeps a set of callbacks.
const watched = new WeakMap();
let observer = null;
function observe(el, cb) {
  if (typeof ResizeObserver === 'undefined') return () => {};
  if (!observer) {
    observer = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = watched.get(e.target);
        if (!w) continue;
        const width = Math.round(e.contentRect.width);
        if (width === w.width) continue;
        w.width = width;
        w.cbs.forEach((f) => f());
      }
    });
  }
  let w = watched.get(el);
  if (!w) {
    w = { width: null, cbs: new Set() };
    watched.set(el, w);
    observer.observe(el);
  }
  w.cbs.add(cb);
  return () => {
    w.cbs.delete(cb);
    if (!w.cbs.size) { observer.unobserve(el); watched.delete(el); }
  };
}

export const KatexSpan = memo(function KatexSpan({ math, displayMode }) {
  const ref = useRef(null);
  const html = useMemo(() => {
    try {
      return katex.renderToString(math, { displayMode, throwOnError: false });
    } catch (e) {
      return math;
    }
  }, [math, displayMode]);

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    // React reuses this element for the formula in the same place on the next
    // slide: start that one from its left edge, not where the last was left.
    box.scrollLeft = 0;
    const refit = () => fit(box, displayMode);
    refit();
    // KaTeX's fonts arrive after first paint and change every width.
    let live = true;
    document.fonts?.ready?.then(() => { if (live) refit(); });
    // An inline formula fits its line, not itself: watch the line.
    const target = displayMode ? box : (lineBox(box) || box);
    const stop = observe(target, refit);
    const onScroll = () => setCue(box);
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => { live = false; stop(); box.removeEventListener('scroll', onScroll); };
  }, [html, displayMode]);

  const Tag = displayMode ? 'div' : 'span';
  return (
    <Tag
      ref={ref}
      className={displayMode ? 'math-display' : 'math-inline'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

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
