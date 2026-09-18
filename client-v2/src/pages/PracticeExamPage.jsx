import { useSearchParams, useNavigate } from 'react-router-dom';
import { ExamRouter } from '../ExamRouter';

export default function PracticeExamPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const paper = params.get('paper') || '';
  const countParam = params.get('count');
  const timed = params.get('timed') === 'true';
  // ?quiz=<chapterId> (e.g. 2B3-4) → straight into that chapter quiz; the
  // platform lobby's Chapter Quizzes list links here.
  const quizChapter = params.get('quiz') || null;

  const user = JSON.parse(localStorage.getItem('fsa_user') || '{}');

  // No `count` in the URL → land on PracticeExamLobby (both the exam-count
  // picker AND the chapter-quiz grid) instead of auto-starting a full exam.
  // Every existing caller (LobbyPage, ExamResultsPage's retry, and
  // QuizOnlyLobbyPage's practice-exam launch) always passes an explicit
  // count, so this branch is new behavior only — nothing existing changes.
  const initialConfig = countParam ? { count: parseInt(countParam, 10), timed } : null;

  return (
    <ExamRouter
      courseId={paper}
      learnerId={user.email}
      classCode={user.class_code}
      initialConfig={quizChapter ? null : initialConfig}
      initialChapterId={quizChapter}
      onExit={() => navigate('/lobby')}
      onComplete={(debrief) =>
        navigate(`/exam/results?paper=${encodeURIComponent(paper)}`, { state: { debrief } })
      }
    />
  );
}
