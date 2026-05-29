// fsa-agent/client-v2/src/App.jsx
import { LessonPlayer } from './LessonPlayer';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const lessonCode = params.get('lessonId') || params.get('lesson_code');
  const learnerId = params.get('contact_id') || params.get('learner_id');

  if (!lessonCode) {
    return (
      <div style={{ padding: '32px', color: '#c92a2a' }}>
        No lesson code provided. Add <code>?lessonId=3A1-1-1</code> to the URL.
      </div>
    );
  }

  return <LessonPlayer lessonCode={lessonCode} learnerId={learnerId} />;
}
