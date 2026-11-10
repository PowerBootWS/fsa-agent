// Soft invitation shown after a public mini lesson. No price, no em dashes.
// 4th Class has no AI tutor, so its copy never mentions one.
const SITE = 'https://fullsteamahead.ca';

export function paperLabel(classCode, paperCode) {
  if (classCode === 'fourth_a') return '4th Class Part A';
  if (classCode === 'fourth_b') return '4th Class Part B';
  return `the ${paperCode} course`;
}

export function MiniLessonPitch({ classCode, slug, paperCode }) {
  const fourth = classCode === 'fourth_a' || classCode === 'fourth_b';
  const href = `${SITE}/enroll?class=${encodeURIComponent(classCode)}&utm_source=mini-lesson&utm_campaign=${encodeURIComponent(slug)}`;
  return (
    <section className="ex-pitch">
      <h2>Want the rest of {paperLabel(classCode, paperCode)} explained like this?</h2>
      <p>
        {fourth
          ? "The full course gives you unlimited chapter tests and practice exams, with a breakdown of exactly where you're weak."
          : 'This is how every objective in the full course is taught: step-by-step slides, narration, practice questions, and an AI tutor when you get stuck.'}
      </p>
      <a className="ex-pitch-btn" href={href}>See the full course</a>
      <p className="ex-pitch-small">Free lesson from Full Steam Ahead. No sign-up needed.</p>
    </section>
  );
}
