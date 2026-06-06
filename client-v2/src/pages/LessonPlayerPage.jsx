import { useParams, useNavigate } from 'react-router-dom';
import { LessonPlayer } from '../LessonPlayer';

export default function LessonPlayerPage() {
  const { lessonCode } = useParams();
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('fsa_user') || '{}');

  return (
    <div style={{ background: '#0f172a', minHeight: '100vh' }}>
      <div style={{ padding: '12px 24px', background: '#1e293b', borderBottom: '1px solid #334155' }}>
        <button
          onClick={() => navigate('/chapters')}
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '14px' }}
        >
          ← Back to Chapters
        </button>
      </div>
      <LessonPlayer lessonCode={lessonCode} learnerId={user.email || ''} />
    </div>
  );
}
