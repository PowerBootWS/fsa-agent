// Redirects unauthenticated users to /login.
// requirePaper=true (default) also enforces active_paper routing.
// redirectIfHasPaper is a separate flag — only /select-paper needs "if you already
// have a paper, don't let you revisit the picker, send you to /lobby instead." Routes
// that are simply optional-paper (Profile, Jobs) must NOT set this, or every existing
// paid student (who has an active_paper) gets bounced away from those pages too.
import { Navigate } from 'react-router-dom';

export default function ProtectedRoute({ children, requirePaper = true, redirectIfHasPaper = false }) {
  const user = JSON.parse(localStorage.getItem('fsa_user') || 'null');

  // Not logged in → login
  if (!user) return <Navigate to="/login" replace />;

  // Logged in but no paper selected → paper picker (only when this route requires one)
  if (requirePaper && !user.active_paper) return <Navigate to="/select-paper" replace />;

  // On /select-paper but already has a paper → lobby (opt-in only, via redirectIfHasPaper)
  if (redirectIfHasPaper && user.active_paper) return <Navigate to="/lobby" replace />;

  return children;
}
