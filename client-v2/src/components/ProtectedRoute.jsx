// Redirects unauthenticated users to /login.
// requirePaper=true (default) also enforces active_paper routing.
// requireCourse is a separate flag — only /select-paper needs "if this account has no
// active subscription at all, there's no class to pick a paper for — send it to /lobby
// instead," which now handles the no-course case itself (an enroll prompt). Routes that
// are simply optional-paper (Profile, Jobs) must NOT set this.
import { Navigate } from 'react-router-dom';

export default function ProtectedRoute({ children, requirePaper = true, requireCourse = false }) {
  const user = JSON.parse(localStorage.getItem('fsa_user') || 'null');

  // Not logged in → login
  if (!user) return <Navigate to="/login" replace />;

  // Logged in but no paper selected → paper picker (only when this route requires one)
  if (requirePaper && !user.active_paper) return <Navigate to="/select-paper" replace />;

  // No active subscription at all → nothing to pick a paper for, back to /lobby
  // (used only by /select-paper — reached both for first-time selection and for
  // "Switch Paper", so it must NOT redirect away just because active_paper is set)
  if (requireCourse && !user.class_code) return <Navigate to="/lobby" replace />;

  return children;
}
