import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useInstall } from '../hooks/useInstall';
import './AppShell.css';

const COOLDOWN_DAYS = 7;

export default function AppShell({ children }) {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('fsa_user') || '{}');

  // Authoritative account info (class_code/active_paper/last_paper_switch_at) —
  // localStorage's fsa_user is a point-in-time snapshot from login/signup and can
  // go stale; /api/platform/me is the same source ProfilePage already trusts.
  const [accountInfo, setAccountInfo] = useState(null);
  const hasCourse = !!accountInfo?.class_code;

  const [menuOpen, setMenuOpen] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [showIosInstall, setShowIosInstall] = useState(false);
  const menuRef = useRef(null);

  const { canPrompt, isIOS, isStandalone, promptInstall } = useInstall();
  const showInstall = !isStandalone && (canPrompt || isIOS);

  useEffect(() => {
    fetch('/api/platform/me', { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data) setAccountInfo(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // ignore
    }
    localStorage.removeItem('fsa_user');
    navigate('/login', { replace: true });
  }

  async function handleOpenBillingPortal() {
    setMenuOpen(false);
    setBillingLoading(true);
    try {
      const res = await fetch('/api/platform/billing-portal', {
        method: 'POST',
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not open billing portal');
      window.open(d.url, '_blank', 'noopener');
    } catch (err) {
      alert(err.message);
    } finally {
      setBillingLoading(false);
    }
  }

  function handleInstallClick() {
    setMenuOpen(false);
    if (canPrompt) {
      promptInstall();
    } else {
      setShowIosInstall(true);
    }
  }

  let daysUntilSwitch = 0;
  if (accountInfo?.last_paper_switch_at) {
    const diffMs = Date.now() - new Date(accountInfo.last_paper_switch_at).getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    daysUntilSwitch = Math.max(0, Math.ceil(COOLDOWN_DAYS - diffDays));
  }

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

        <div className="as-user-menu-wrap" ref={menuRef}>
          <button
            className="as-user-menu-btn"
            onClick={() => setMenuOpen(o => !o)}
            aria-expanded={menuOpen}
          >
            {user.first_name && user.last_name
              ? `${user.first_name} ${user.last_name}`
              : user.first_name || user.email}
            {' '}▾
          </button>
          {menuOpen && (
            <div className="as-user-menu-dropdown">
              {hasCourse && (
                <button
                  className="as-menu-item"
                  onClick={handleOpenBillingPortal}
                  disabled={billingLoading}
                >
                  {billingLoading ? 'Opening…' : 'Subscription'}
                </button>
              )}
              {hasCourse && (
                daysUntilSwitch > 0 ? (
                  <>
                    <button className="as-menu-item--disabled" disabled>
                      Switch Paper
                    </button>
                    <div className="as-menu-note">Available in {daysUntilSwitch} day{daysUntilSwitch !== 1 ? 's' : ''}</div>
                  </>
                ) : (
                  <button
                    className="as-menu-item"
                    onClick={() => { setMenuOpen(false); navigate('/select-paper'); }}
                  >
                    Switch Paper
                  </button>
                )
              )}
              {showInstall && (
                <button className="as-menu-item" onClick={handleInstallClick}>
                  📲 Install app
                </button>
              )}
              <div className="as-menu-divider" />
              <button className="as-menu-item--danger" onClick={handleLogout}>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </nav>
      <div className="as-content">{children}</div>

      {showIosInstall && (
        <div className="as-install-modal-overlay" onClick={() => setShowIosInstall(false)}>
          <div className="as-install-modal" onClick={e => e.stopPropagation()}>
            <div className="as-install-modal-title">Install Full Steam Ahead</div>
            <p className="as-install-modal-text">
              Add the app to your home screen for quick, full-screen access:
            </p>
            <ol className="as-install-steps">
              <li>Tap the <strong>Share</strong> button <span className="as-ios-share" aria-hidden="true">⎋</span> in Safari's toolbar.</li>
              <li>Scroll down and choose <strong>Add to Home Screen</strong>.</li>
              <li>Tap <strong>Add</strong> — the FSA icon appears on your home screen.</li>
            </ol>
            <button className="as-btn-primary" onClick={() => setShowIosInstall(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
