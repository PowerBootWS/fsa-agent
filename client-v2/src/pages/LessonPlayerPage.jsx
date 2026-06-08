import { useParams, useNavigate } from 'react-router-dom';
import { LessonPlayer } from '../LessonPlayer';

export default function LessonPlayerPage() {
  const { lessonCode } = useParams();
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('fsa_user') || '{}');

  return (
    <div style={{ background: '#0D1117', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Barlow', -apple-system, sans-serif" }}>
      <div style={{ padding: '12px 24px', background: '#1C2333', borderBottom: '1px solid #252F42', display: 'flex', alignItems: 'center', borderBottom: '2px solid #E8720C' }}>
        <button
          onClick={() => navigate('/chapters')}
          style={{ background: 'none', border: 'none', color: '#a8b4c0', cursor: 'pointer', fontSize: '14px', fontFamily: 'inherit' }}
        >
          ← Back to Chapters
        </button>
      </div>
      <LessonPlayer lessonCode={lessonCode} learnerId={user.email || ''} />
    </div>
  );
}
