import { useEffect, useRef, useState } from 'react';
import { track } from '../utils/usage';
import './AnnouncementModal.css';
import './ContactSupportModal.css';

// "Contact support" form (backlog #31). Posts to /api/platform/support-message,
// which emails support@ with Reply-To set to the student and pings Russ.
// Reuses the announcement pop-up's an-* card styles so the two dialogs match.
const CATEGORIES = [
  ['problem', 'Something is not working'],
  ['content', 'Error in the course material'],
  ['suggestion', 'Suggestion'],
  ['other', 'Other'],
];

export default function ContactSupportModal({ onClose, defaultCategory = 'problem', lessonCode = null }) {
  const [category, setCategory] = useState(defaultCategory);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    function onKey(e) { if (e.key === 'Escape') closeRef.current(); }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, []);

  async function handleSend() {
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/platform/support-message', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          message: message.trim(),
          page: window.location.pathname,
          lesson_code: lessonCode,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Couldn't send that. Please email support@fullsteamahead.ca.");
      }
      track('feature_use', { action: 'support_message_sent', props: { category } });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="an-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="an-card" role="dialog" aria-modal="true" aria-labelledby="cs-title" tabIndex={-1} ref={dialogRef}>
        <button className="an-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2 className="an-title" id="cs-title">Contact support</h2>
        {sent ? (
          <>
            <p className="an-thanks">Thanks, it's on its way. We'll reply to your email.</p>
            <button className="an-done" onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            <p className="an-body">
              Stuck on something, spotted a mistake in the material, or have an idea? Tell us here
              and we'll reply by email.{lessonCode ? ` We'll know you were on ${lessonCode}.` : ''}
            </p>
            <label className="an-feedback-label" htmlFor="cs-category">What's it about?</label>
            <select id="cs-category" className="cs-select" value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <label className="an-feedback-label" htmlFor="cs-message">Your message</label>
            <textarea
              id="cs-message"
              className="an-textarea"
              rows={5}
              maxLength={4000}
              value={message}
              onChange={e => setMessage(e.target.value)}
            />
            {error && <p className="an-error">{error}</p>}
            <button className="an-cta" onClick={handleSend} disabled={sending || !message.trim()}>
              {sending ? 'Sending…' : 'Send message'}
            </button>
            <p className="cs-alt">Or email <a href="mailto:support@fullsteamahead.ca">support@fullsteamahead.ca</a></p>
          </>
        )}
      </div>
    </div>
  );
}
