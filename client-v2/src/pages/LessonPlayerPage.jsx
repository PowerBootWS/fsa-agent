// Wraps the existing LessonPlayer with lessonCode sourced from the route param
import { useParams } from 'react-router-dom';
import { LessonPlayer } from '../LessonPlayer';

export default function LessonPlayerPage() {
  const { lessonCode } = useParams();
  // learnerId will be sourced from auth context in a later task
  const user = JSON.parse(localStorage.getItem('fsa_user') || 'null');
  const learnerId = user?.contact_id || user?.id || null;

  return <LessonPlayer lessonCode={lessonCode} learnerId={learnerId} />;
}
