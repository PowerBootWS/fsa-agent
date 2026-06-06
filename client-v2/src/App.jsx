// fsa-agent/client-v2/src/App.jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import SelectPaperPage from './pages/SelectPaperPage';
import LobbyPage from './pages/LobbyPage';
import AllChaptersPage from './pages/AllChaptersPage';
import LessonPlayerPage from './pages/LessonPlayerPage';
import ProtectedRoute from './components/ProtectedRoute';
import { LessonPlayer } from './LessonPlayer';
import { ExamRouter } from './ExamRouter';

export default function App() {
  // Legacy iframe mode — fsachat.fullsteamahead.ca or localhost dev with lessonId param
  const isLegacyMode =
    window.location.hostname.includes('fsachat') ||
    (window.location.hostname === 'localhost' &&
      new URLSearchParams(window.location.search).has('lessonId'));

  if (isLegacyMode) {
    const params = new URLSearchParams(window.location.search);
    const lessonCode = params.get('lessonId') || params.get('lesson_code') || params.get('lesson');
    const learnerId = params.get('contact_id') || params.get('learner_id') || params.get('user');
    const mode = params.get('mode');
    if (!lessonCode)
      return <div style={{ padding: '32px', color: '#c92a2a' }}>No lesson code provided.</div>;
    if (mode === 'exam') return <ExamRouter courseId={lessonCode} learnerId={learnerId} />;
    return <LessonPlayer lessonCode={lessonCode} learnerId={learnerId} />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route
        path="/select-paper"
        element={
          <ProtectedRoute>
            <SelectPaperPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/lobby"
        element={
          <ProtectedRoute>
            <LobbyPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/chapters"
        element={
          <ProtectedRoute>
            <AllChaptersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/lesson/:lessonCode"
        element={
          <ProtectedRoute>
            <LessonPlayerPage />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/lobby" replace />} />
      <Route path="*" element={<Navigate to="/lobby" replace />} />
    </Routes>
  );
}
