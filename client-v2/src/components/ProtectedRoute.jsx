// Redirects unauthenticated users to /login.
// requirePaper=true (default) also enforces active_paper routing.
// requireCourse is a separate flag — only /select-paper needs "if this account has no
// active subscription at all, there's no class to pick a paper for — send it to /lobby
// instead," which now handles the no-course case itself (an enroll prompt). Routes that
// are simply optional-paper (Profile, Jobs) must NOT set this.
import { Navigate } from 'react-router-dom';
import { isFourthClassCode } from '../utils/fourthClass';

export default function ProtectedRoute({ children, requirePaper = true, requireCourse = false }) {
  const user = JSON.parse(localStorage.getItem('fsa_user') || 'null');

  // Not logged in → login
  if (!user) return <Navigate to="/login" replace />;

  // Logged in but no paper selected → paper picker (only when this route requires one)
  // 4th Class never has an active_paper (no paper-switching concept — both 4A and 4B
  // are reachable at once via QuizOnlyLobbyPage), so the paper-picker requirement
  // doesn't apply to it. See client-v2/src/pages/QuizOnlyLobbyPage.jsx.
  if (requirePaper && !user.active_paper && !isFourthClassCode(user.class_code)) return <Navigate to="/select-paper" replace />;

  // No active subscription at all → nothing to pick a paper for, back to /lobby
  // (used only by /select-paper — reached both for first-time selection and for
  // "Switch Paper", so it must NOT redirect away just because active_paper is set)
  if (requireCourse && !user.class_code) return <Navigate to="/lobby" replace />;

  return children;
}
