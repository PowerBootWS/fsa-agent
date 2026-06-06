// Redirects unauthenticated users to /login
import { Navigate } from 'react-router-dom';

export default function ProtectedRoute({ children }) {
  // Check for session — uses a localStorage flag set on login.
  // HttpOnly cookies can't be read from JS; a /api/auth/me check will be wired in a later task.
  const isAuthenticated = localStorage.getItem('fsa_user') !== null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}
