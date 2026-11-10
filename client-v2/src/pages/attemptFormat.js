// Shared labels for the attempt history pages.

export function attemptTitle(a) {
  if (a.kind === 'practice_exam') return 'Practice exam';
  const num = a.chapter_id && /-(\d+)$/.exec(a.chapter_id);
  const chapter = num ? `Chapter ${num[1]} quiz` : 'Chapter quiz';
  return a.kind === 'retry_wrong' ? `Retry: ${chapter}` : chapter;
}

export function attemptDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function attemptScore(a) {
  return `${a.score}/${a.question_count}`;
}

export const NO_REVIEW = "Question review isn't available for this one. It was taken before we started saving every question.";
