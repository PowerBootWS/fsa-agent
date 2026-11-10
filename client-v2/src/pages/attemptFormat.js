// Shared labels for the attempt history pages.

export function attemptTitle(a) {
  if (a.kind === 'practice_exam') return 'Practice exam';
  const num = a.chapter_id && /-(\d+)$/.exec(a.chapter_id);
  if (a.kind === 'retry_wrong') {
    return num ? `Retry of missed Chapter ${num[1]} questions` : 'Retry of missed questions';
  }
  return num ? `Chapter ${num[1]} quiz` : 'Chapter quiz';
}

export function attemptDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function attemptScore(a) {
  return `${a.score}/${a.question_count}`;
}

// Link into the history page, pre-filtered to one paper / type / chapter.
export function pastAttemptsHref({ course, kind, chapter } = {}) {
  const q = new URLSearchParams();
  if (course) q.set('course', course);
  if (kind) q.set('kind', kind);
  if (chapter) q.set('chapter', chapter);
  const s = q.toString();
  return s ? `/attempts?${s}` : '/attempts';
}

// "Retry the ones I got wrong": runs on the chapter-quiz screen with the
// lesson id <PAPER>-R<attemptId>.
export function retryWrongHref(course, attemptId) {
  if (!course || !attemptId) return null;
  return `/practice-exam?paper=${encodeURIComponent(course)}&quiz=${encodeURIComponent(`${course}-R${attemptId}`)}`;
}

export function retryWrongLabel(n) {
  return `Retry the ${n} question${n === 1 ? '' : 's'} you got wrong`;
}

function chapterNumber(chapterId) {
  const m = chapterId && /-(\d+)$/.exec(chapterId);
  return m ? m[1] : null;
}

// "No past ... on record ..." for whatever the page is filtered to. New
// subscribers and anyone who hasn't finished that piece yet land here.
export function emptyMessage({ paper, kind, chapter }) {
  let what = 'past practice exams or chapter quizzes';
  if (kind === 'practice_exam') what = 'past practice exams';
  else if (kind === 'chapter_quiz' || chapter) {
    const n = chapterNumber(chapter);
    what = n ? `past Chapter ${n} quizzes` : 'past chapter quizzes';
  }
  return `No ${what} on record${paper ? ` for ${paper}` : ''} yet. Once you finish one, it will show up here.`;
}

export const NO_REVIEW = "Question review isn't available for this one. It was taken before we started saving every question.";
