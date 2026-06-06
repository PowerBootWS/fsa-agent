// Redirects unauthenticated users to /login.
// Also enforces active_paper routing when requirePaper=true (default).
import { Navigate } from 'react-router-dom';

export default function ProtectedRoute({ children, requirePaper = true }) {
  const user = JSON.parse(localStorage.getItem('fsa_user') || 'null');

  // Not logged in → login
  if (!user) return <Navigate to="/login" replace />;

  // Logged in but no paper selected → paper picker
  if (requirePaper && !user.active_paper) return <Navigate to="/select-paper" replace />;

  // On /select-paper but already has a paper → lobby
  if (!requirePaper && user.active_paper) return <Navigate to="/lobby" replace />;

  return children;
}
