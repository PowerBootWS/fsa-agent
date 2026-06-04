import { InlineMath, BlockMath } from 'react-katex';

export function MathContent({ text }) {
  if (!text) return null;

  const parts = [];
  const blockRegex = /\$\$([\s\S]+?)\$\$/g;
  const inlineRegex = /\$((?:[^$]|\\.)+?)\$/g;

  const blockMatches = [...text.matchAll(blockRegex)];
  const inlineMatches = [...text.matchAll(inlineRegex)];

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
    if (seg.start > cursor) parts.push(<span key={`t${i}`}>{text.slice(cursor, seg.start)}</span>);
    if (seg.type === 'block') parts.push(<BlockMath key={`b${i}`} math={seg.math} />);
    else parts.push(<InlineMath key={`il${i}`} math={seg.math} />);
    cursor = seg.end;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);

  return parts.length > 0 ? <>{parts}</> : <span>{text}</span>;
}
