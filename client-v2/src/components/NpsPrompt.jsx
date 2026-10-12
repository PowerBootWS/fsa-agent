import { useEffect, useRef, useState } from 'react';
import { track } from '../utils/usage';
import { isAnnouncementShowing } from './AnnouncementModal';
import './AnnouncementModal.css';
import './NpsPrompt.css';

// NPS survey (backlog #127). The server decides eligibility (21+ days, real use,
// not asked in 90 days, not closed in 14). A 9 or 10 rolls into "have you got
// your affiliate link?". Reuses the announcement card's an-* styles.
let checkedThisLoad = false;
export function _resetNpsCheck() { checkedThisLoad = false; }

const WAIT_MS = 4000; // let the announcement check land first; never stack two pop-ups

function post(url, body) {
  return fetch(url, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
}

export default function NpsPrompt({ waitMs = WAIT_MS }) {
  const [step, setStep] = useState(null); // null | 'score' | 'affiliate' | 'link' | 'thanks'
  const [score, setScore] = useState(null);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (checkedThisLoad) return undefined;
    checkedThisLoad = true;
    let fired = false;
    const t = setTimeout(() => {
      fired = true;
      if (isAnnouncementShowing()) return;
      fetch('/api/platform/nps/next', { credentials: 'include' })
        .then(res => (res.ok ? res.json() : null))
        .then(d => { if (d?.ask) { setStep('score'); track('feature_use', { action: 'nps_shown' }); } })
        .catch(() => {});
    }, waitMs);
    // AppShell remounts on every in-app navigation: a page left inside the
    // wait gets another try on the next mount instead of losing this visit.
    return () => { clearTimeout(t); if (!fired) checkedThisLoad = false; };
  }, [waitMs]);

  useEffect(() => { if (step) dialogRef.current?.focus(); }, [step]);

  if (!step) return null;

  function close() {
    if (step === 'score') post('/api/platform/nps/dismiss').catch(() => {});
    setStep(null);
  }

  async function submit() {
    setError('');
    try {
      const res = await post('/api/platform/nps', { score, reason: reason.trim() });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setResult(d);
      track('feature_use', { action: 'nps_answered', props: { score } });
      setStep(d.promoter && d.affiliate ? 'affiliate' : 'thanks');
    } catch {
      setError("Couldn't send that, try again.");
    }
  }

  function answerLink(hadLink) {
    post(`/api/platform/nps/${result.id}/affiliate-link`, { had_link: hadLink }).catch(() => {});
    setStep(hadLink ? 'thanks' : 'link');
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(result.affiliate.referral_url); setCopied(true); } catch { /* shown anyway */ }
  }

  return (
    <div className="an-backdrop">
      <div className="an-card" role="dialog" aria-modal="true" aria-labelledby="nps-title" tabIndex={-1} ref={dialogRef}
        onKeyDown={e => { if (e.key === 'Escape') close(); }}>
        <button className="an-close" aria-label="Close" onClick={close}>✕</button>

        {step === 'score' && (
          <>
            <h2 className="an-title" id="nps-title">Quick question</h2>
            <p className="an-body">How likely are you to recommend Full Steam Ahead to a friend or co-worker?</p>
            <div className="nps-scale" role="radiogroup" aria-label="Score from 0 to 10">
              {Array.from({ length: 11 }, (_, n) => (
                <button key={n} type="button" role="radio" aria-checked={score === n}
                  className={`nps-num${score === n ? ' nps-num--on' : ''}`} onClick={() => setScore(n)}>{n}</button>
              ))}
            </div>
            <div className="nps-ends"><span>Not likely</span><span>Very likely</span></div>
            {score !== null && (
              <>
                <label className="an-feedback-label" htmlFor="nps-reason">
                  {score >= 9 ? "What's the main thing you'd tell them? (optional)" : 'What would make it better? (optional)'}
                </label>
                <textarea id="nps-reason" className="an-textarea" rows={3} maxLength={2000}
                  value={reason} onChange={e => setReason(e.target.value)} />
              </>
            )}
            {error && <p className="an-error">{error}</p>}
            <button className="an-cta" onClick={submit} disabled={score === null}>Send</button>
          </>
        )}

        {step === 'affiliate' && (
          <>
            <h2 className="an-title" id="nps-title">Thanks, that means a lot</h2>
            <p className="an-body">
              Every student gets their own referral link. Anyone who signs up through it earns you 20% of what they
              pay, 4th Class papers included. Have you got yours?
            </p>
            <div className="nps-choices">
              <button className="an-cta" onClick={() => answerLink(true)}>Yes, I've got it</button>
              <button className="an-send" onClick={() => answerLink(false)}>No, show me</button>
            </div>
          </>
        )}

        {step === 'link' && (
          <>
            <h2 className="an-title" id="nps-title">Here's your link</h2>
            <p className="an-body">Share it with anyone you'd recommend us to. You earn 20% of what they pay.</p>
            <code className="nps-link">{result.affiliate.referral_url}</code>
            <div className="nps-choices">
              <button className="an-cta" onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
              <a className="an-send nps-dash" href="https://fullsteamahead.ca/affiliate-dashboard" target="_blank" rel="noopener">Your referral dashboard</a>
            </div>
            <button className="an-done" onClick={() => setStep(null)}>Done</button>
          </>
        )}

        {step === 'thanks' && (
          <>
            <h2 className="an-title" id="nps-title">Thank you</h2>
            <p className="an-thanks">Russ reads every one of these.</p>
            <button className="an-done" onClick={() => setStep(null)}>Close</button>
          </>
        )}
      </div>
    </div>
  );
}
