import { NavLink } from 'react-router-dom';
import './AppShell.css';

export default function AppShell({ children }) {
  return (
    <div className="as-shell">
      <nav className="as-sidebar">
        <div className="as-brand">Full Steam Ahead</div>
        <NavLink to="/lobby" className={({ isActive }) => `as-nav-item${isActive ? ' as-nav-item--active' : ''}`}>
          📚 Courses
        </NavLink>
        <NavLink to="/jobs" className={({ isActive }) => `as-nav-item${isActive ? ' as-nav-item--active' : ''}`}>
          💼 Jobs
        </NavLink>
        <NavLink to="/profile" className={({ isActive }) => `as-nav-item${isActive ? ' as-nav-item--active' : ''}`}>
          👤 Profile
        </NavLink>
      </nav>
      <div className="as-content">{children}</div>
    </div>
  );
}
