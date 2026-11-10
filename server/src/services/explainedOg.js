// Server-side Open Graph tags for /explained/<slug>. Social crawlers do not
// run JS, so the tags must be in the served index.html itself.
const ROBOTS = '<meta name="robots" content="noindex">';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inject(html, tags) {
  const block = tags.join('\n    ') + '\n  ';
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, () => block + '</head>') : block + html;
}

// lesson: PublicMiniLesson (og_image_url already carries ?preview= for drafts) or null.
function renderExplainedHtml(indexHtml, lesson, baseUrl) {
  if (!lesson) return inject(indexHtml, [ROBOTS]);
  const image = lesson.og_image_url ? baseUrl + lesson.og_image_url : baseUrl + '/pwa-512.png';
  const meta = (p, c) => `<meta property="${p}" content="${esc(c)}">`;
  return inject(indexHtml, [
    meta('og:title', lesson.title),
    meta('og:description', lesson.description),
    meta('og:image', image),
    meta('og:url', `${baseUrl}/explained/${lesson.slug}`),
    meta('og:type', 'article'),
    '<meta name="twitter:card" content="summary_large_image">',
    ROBOTS,
  ]);
}

module.exports = { renderExplainedHtml };
