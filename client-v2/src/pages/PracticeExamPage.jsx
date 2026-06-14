import { useSearchParams, useNavigate } from 'react-router-dom';
import { ExamRouter } from '../ExamRouter';

export default function PracticeExamPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const paper = params.get('paper') || '';
  const count = parseInt(params.get('count') || '50', 10);
  const timed = params.get('timed') === 'true';

  const user = JSON.parse(localStorage.getItem('fsa_user') || '{}');

  return (
    <ExamRouter
      courseId={paper}
      learnerId={user.email}
      initialConfig={{ count, timed }}
      onExit={() => navigate('/lobby')}
      onComplete={(debrief) =>
        navigate(`/exam/results?paper=${encodeURIComponent(paper)}`, { state: { debrief } })
      }
    />
  );
}
