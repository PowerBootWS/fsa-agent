// fsa-agent/client-v2/src/App.jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import SetupPage from './pages/SetupPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import SelectPaperPage from './pages/SelectPaperPage';
import LobbyPage from './pages/LobbyPage';
import AllChaptersPage from './pages/AllChaptersPage';
import LessonPlayerPage from './pages/LessonPlayerPage';
import ExamResultsPage from './pages/ExamResultsPage';
import PracticeExamPage from './pages/PracticeExamPage';
import ProfilePage from './pages/ProfilePage';
import ProtectedRoute from './components/ProtectedRoute';
import AppShell from './components/AppShell';
import JobsPage from './pages/JobsPage';
import JobsCapturePage from './pages/JobsCapturePage';
import CreditsPage from './pages/CreditsPage';
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
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/select-paper"
        element={
          <ProtectedRoute requirePaper={false} requireCourse={true}>
            <SelectPaperPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/lobby"
        element={
          <ProtectedRoute requirePaper={false}>
            <AppShell>
              <LobbyPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/jobs"
        element={
          <ProtectedRoute requirePaper={false}>
            <AppShell>
              <JobsPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route path="/jobs/capture" element={<JobsCapturePage />} />
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
      <Route
        path="/practice-exam"
        element={
          <ProtectedRoute>
            <PracticeExamPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/exam/results"
        element={
          <ProtectedRoute>
            <ExamResultsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute requirePaper={false}>
            <AppShell>
              <ProfilePage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/credits"
        element={
          <ProtectedRoute requirePaper={false}>
            <AppShell>
              <CreditsPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<DefaultRedirect />} />
      <Route path="*" element={<DefaultRedirect />} />
    </Routes>
  );
}

// Job-only accounts (no active_paper, no class_code) have no course to land on —
// send them to /jobs instead of /lobby, which would otherwise bounce them to
// /select-paper. Everyone else keeps the existing default.
function DefaultRedirect() {
  const user = JSON.parse(localStorage.getItem('fsa_user') || 'null');
  if (user && !user.active_paper && !user.class_code) {
    return <Navigate to="/jobs" replace />;
  }
  return <Navigate to="/lobby" replace />;
}
