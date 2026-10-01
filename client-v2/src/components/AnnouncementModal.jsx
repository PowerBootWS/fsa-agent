import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { track } from '../utils/usage';
import './AnnouncementModal.css';

// One check per full page load: AppShell remounts on every in-app navigation,
// and a "visit" should get at most one pop-up.
let checkedThisLoad = false;
export function _resetAnnouncementCheck() { checkedThisLoad = false; }

function post(url, body) {
  return fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true, // survives the page leaving right after a CTA click
  });
}

export default function AnnouncementModal() {
  const navigate = useNavigate();
  const [announcement, setAnnouncement] = useState(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);

  useEffect(() => {
    if (checkedThisLoad) return;
    checkedThisLoad = true;
    // Only a 200 counts as "checked"; a 401 (session displaced) or a network
    // error must let the next mount try again after the user logs back in.
    fetch('/api/platform/announcements/next', { credentials: 'include' })
      .then(res => {
        if (!res.ok) { checkedThisLoad = false; return null; }
        return res.json();
      })
      .then(data => {
        if (data?.announcement) {
          setAnnouncement(data.announcement);
          track('feature_use', { action: 'announcement_shown', props: { id: data.announcement.id } });
        }
      })
      .catch(() => { checkedThisLoad = false; });
  }, []);

  function recordSeen(action) {
    post(`/api/platform/announcements/${announcement.id}/seen`, { action }).catch(() => {});
  }

  function dismiss() {
    recordSeen('dismissed');
    setAnnouncement(null);
  }

  // Latest dismiss for the key listener without re-binding it on every keystroke.
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    if (!announcement) return undefined;
    const previous = document.activeElement;
    dialogRef.current?.focus();
    function onKey(e) { if (e.key === 'Escape') dismissRef.current(); }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, [announcement]);

  if (!announcement) return null;

  function handleCta() {
    recordSeen('cta');
    track('feature_use', { action: 'announcement_cta', props: { id: announcement.id } });
    const url = announcement.cta_url;
    setAnnouncement(null);
    if (url.startsWith('/')) navigate(url);
    // jsdom can't spy on location.assign; window.open(url, '_self') is the same navigation.
    else window.open(url, '_self');
  }

  async function handleSend() {
    setSending(true);
    setError('');
    try {
      const res = await post(`/api/platform/announcements/${announcement.id}/feedback`, { message: message.trim() });
      if (!res.ok) throw new Error('send failed');
      track('feature_use', { action: 'announcement_feedback', props: { id: announcement.id } });
      setSent(true);
    } catch {
      setError("Couldn't send that, try again.");
    } finally {
      setSending(false);
    }
  }

  const paragraphs = announcement.body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const titleId = `an-title-${announcement.id}`;

  return (
    <div className="an-backdrop">
      <div
        className="an-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
      >
        <button className="an-close" aria-label="Close" onClick={dismiss}>✕</button>
        <span className="an-badge">New</span>
        <h2 className="an-title" id={titleId}>{announcement.title}</h2>
        {paragraphs.map((p, i) => <p className="an-body" key={i}>{p}</p>)}
        {announcement.cta_label && announcement.cta_url && (
          <button className="an-cta" onClick={handleCta}>{announcement.cta_label}</button>
        )}

        <div className="an-feedback">
          {sent ? (
            <p className="an-thanks">Thanks, Russ reads every one of these.</p>
          ) : (
            <>
              <label className="an-feedback-label" htmlFor={`an-fb-${announcement.id}`}>
                Got an idea or something that would make this better? Tell us.
              </label>
              <textarea
                id={`an-fb-${announcement.id}`}
                className="an-textarea"
                rows={3}
                maxLength={2000}
                value={message}
                onChange={e => setMessage(e.target.value)}
              />
              {error && <p className="an-error">{error}</p>}
              <button className="an-send" onClick={handleSend} disabled={sending || !message.trim()}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </>
          )}
        </div>

        <button className="an-done" onClick={dismiss}>Got it</button>
      </div>
    </div>
  );
}
