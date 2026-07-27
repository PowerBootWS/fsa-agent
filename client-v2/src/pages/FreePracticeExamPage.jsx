// fsa-agent/client-v2/src/pages/FreePracticeExamPage.jsx
//
// Unauthenticated free-practice-exam lead magnet. Local state machine —
// no ProtectedRoute, no localStorage session (the verification token is a
// short-lived, single-session credential, unlike fsa_user).
//
// Phases: 'picker' -> 'signup' -> 'verify' -> 'exam'
//   picker  — class toggle + paper grid (skipped if ?class= & ?paper= are
//             both present and valid for that class).
//   signup  — first name + email -> POST /api/practice-exam/request-code
//   verify  — 6-digit code -> POST /api/practice-exam/verify-code -> token
//   exam    — <ExamRouter leadMagnetToken=... /> with the lead-magnet UI
//             (locked chapter quizzes, enroll CTA, distractor coaching)
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExamRouter } from '../ExamRouter';

const CLASS_OPTIONS = [
  { value: 'second', label: '2nd Class' },
  { value: 'third', label: '3rd Class' },
];

const ENROLL_URL = 'https://enrollment.fullsteamahead.ca';

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0D1117',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    fontFamily: "'Barlow', -apple-system, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: '480px',
    background: '#1C2333',
    border: '1px solid #252F42',
    borderTop: '3px solid #E8720C',
    borderRadius: '4px',
    padding: '40px 32px',
  },
  brand: {
    color: '#E8720C',
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: '24px',
    fontWeight: '700',
    marginBottom: '6px',
    textAlign: 'center',
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
  },
  subtitle: {
    color: '#a8b4c0',
    fontSize: '13px',
    textAlign: 'center',
    marginBottom: '32px',
  },
  label: {
    display: 'block',
    color: '#a8b4c0',
    fontSize: '13px',
    marginBottom: '6px',
    fontWeight: '500',
  },
  input: {
    width: '100%',
    background: '#0D1117',
    border: '1px solid #252F42',
    borderRadius: '4px',
    color: '#F4F5F7',
    fontSize: '15px',
    padding: '10px 12px',
    marginBottom: '16px',
    boxSizing: 'border-box',
    outline: 'none',
    fontFamily: 'inherit',
  },
  button: {
    width: '100%',
    background: '#E8720C',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '15px',
    fontWeight: '600',
    padding: '12px 24px',
    cursor: 'pointer',
    marginTop: '8px',
    fontFamily: 'inherit',
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  error: {
    color: '#f87171',
    fontSize: '13px',
    marginTop: '12px',
    textAlign: 'center',
  },
  hint: {
    color: '#a8b4c0',
    fontSize: '13px',
    textAlign: 'center',
    marginTop: '12px',
  },
  link: {
    color: '#4da3ff',
    textDecoration: 'none',
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  classToggleRow: {
    display: 'flex',
    gap: '12px',
    marginBottom: '24px',
  },
  classToggleBtn: {
    flex: 1,
    background: '#0D1117',
    border: '2px solid #252F42',
    borderRadius: '4px',
    color: '#F4F5F7',
    fontSize: '15px',
    fontWeight: '600',
    padding: '14px 8px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  classToggleBtnActive: {
    borderColor: '#E8720C',
    background: 'rgba(232, 114, 12, 0.12)',
    color: '#E8720C',
  },
  paperGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '12px',
  },
  paperBtn: {
    background: '#0D1117',
    border: '2px solid #252F42',
    borderRadius: '4px',
    color: '#F4F5F7',
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: '20px',
    fontWeight: '700',
    padding: '20px 8px',
    cursor: 'pointer',
    letterSpacing: '0.5px',
  },
  backLink: {
    display: 'inline-block',
    color: '#a8b4c0',
    fontSize: '13px',
    textDecoration: 'none',
    marginBottom: '16px',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    padding: 0,
    fontFamily: 'inherit',
  },
  codeInput: {
    width: '100%',
    background: '#0D1117',
    border: '1px solid #252F42',
    borderRadius: '4px',
    color: '#F4F5F7',
    fontSize: '24px',
    letterSpacing: '8px',
    textAlign: 'center',
    padding: '12px',
    marginBottom: '16px',
    boxSizing: 'border-box',
    outline: 'none',
    fontFamily: 'inherit',
  },
};

function AlreadyUsedNotice() {
  return (
    <div>
      <p style={{ color: '#F4F5F7', fontSize: '14px', lineHeight: 1.6, textAlign: 'center' }}>
        Looks like you've already used your free practice exam for this paper.
        Subscribe to get unlimited adaptive practice exams across every paper,
        full course content, and AI tutoring.
      </p>
      <a href={ENROLL_URL} style={{ ...styles.button, display: 'block', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}>
        Subscribe Now →
      </a>
    </div>
  );
}

export default function FreePracticeExamPage() {
  const [searchParams] = useSearchParams();

  const [phase, setPhase] = useState('picker');
  const [initializing, setInitializing] = useState(true);

  const [classCode, setClassCode] = useState(null);
  const [paperCode, setPaperCode] = useState(null);
  const [papers, setPapers] = useState([]);
  const [papersLoading, setPapersLoading] = useState(false);
  // Lazy initializer, not an effect — am_id is a one-time capture off the
  // initial URL, not something that needs to react to later param changes.
  const [amId] = useState(() => searchParams.get('am_id') || '');

  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [signupSubmitting, setSignupSubmitting] = useState(false);
  const [requestError, setRequestError] = useState('');

  const [code, setCode] = useState('');
  const [verifySubmitting, setVerifySubmitting] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

  const [alreadyUsed, setAlreadyUsed] = useState(false);

  // Never persisted to localStorage — short-lived, single-session credential.
  const [token, setToken] = useState('');

  function fetchPapersForClass(cls) {
    setPapersLoading(true);
    return fetch(`/api/preview/papers?class=${encodeURIComponent(cls)}`)
      .then(r => r.json())
      .then(data => {
        const list = data.papers || [];
        setPapers(list);
        return list;
      })
      .catch(() => {
        setPapers([]);
        return [];
      })
      .finally(() => setPapersLoading(false));
  }

  // On mount: honor ?class=&paper=&am_id= — if both class and paper are
  // present and paper is actually offered for that class, skip straight to
  // signup. A valid class alone still pre-selects the toggle in the picker.
  // Wrapped in an async function (matching JobsCapturePage.jsx's
  // resolveAndSave precedent) rather than calling setState directly in the
  // effect body, which react-hooks/set-state-in-effect flags.
  useEffect(() => {
    async function init() {
      const urlClass = searchParams.get('class');
      const urlPaper = searchParams.get('paper');

      const validClass = urlClass === 'second' || urlClass === 'third';
      if (!validClass) {
        setInitializing(false);
        return;
      }

      setClassCode(urlClass);
      const list = await fetchPapersForClass(urlClass);
      if (urlPaper && list.includes(urlPaper)) {
        setPaperCode(urlPaper);
        setPhase('signup');
      }
      setInitializing(false);
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClassToggle(cls) {
    if (cls === classCode) return;
    setClassCode(cls);
    setPaperCode(null);
    fetchPapersForClass(cls);
  }

  function handleSelectPaper(paper) {
    setPaperCode(paper);
    setAlreadyUsed(false);
    setRequestError('');
    setPhase('signup');
  }

  async function handleSignupSubmit(e) {
    e.preventDefault();
    setRequestError('');
    setSignupSubmitting(true);
    try {
      const res = await fetch('/api/practice-exam/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, email, classCode, paperCode, affiliateCode: amId || '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRequestError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      if (data.success === false && data.already_used) {
        setAlreadyUsed(true);
        return;
      }
      if (data.success) {
        setAlreadyUsed(false);
        setVerifyError('');
        setResendMessage('');
        setPhase('verify');
        return;
      }
      setRequestError('Something went wrong. Please try again.');
    } catch {
      setRequestError('Network error. Please try again.');
    } finally {
      setSignupSubmitting(false);
    }
  }

  async function handleVerifySubmit(e) {
    e.preventDefault();
    setVerifyError('');
    setVerifySubmitting(true);
    try {
      const res = await fetch('/api/practice-exam/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, paperCode, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setVerifyError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      if (data.success === false && data.already_used) {
        setAlreadyUsed(true);
        return;
      }
      if (data.success) {
        setToken(data.token);
        if (data.firstName) setFirstName(data.firstName);
        setPhase('exam');
        return;
      }
      setVerifyError('Something went wrong. Please try again.');
    } catch {
      setVerifyError('Network error. Please try again.');
    } finally {
      setVerifySubmitting(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setVerifyError('');
    setResendMessage('');
    try {
      const res = await fetch('/api/practice-exam/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, email, classCode, paperCode, affiliateCode: amId || '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setVerifyError(data.error || 'Could not resend the code. Please try again.');
        return;
      }
      if (data.success === false && data.already_used) {
        setAlreadyUsed(true);
        return;
      }
      if (data.success) {
        setResendMessage('A new code has been sent to your email.');
      }
    } catch {
      setVerifyError('Network error. Please try again.');
    } finally {
      setResending(false);
    }
  }

  if (initializing) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.brand}>Full Steam Ahead</div>
          <div style={styles.hint}>Loading…</div>
        </div>
      </div>
    );
  }

  if (phase === 'exam') {
    return (
      <ExamRouter
        courseId={paperCode}
        learnerId={email}
        classCode={classCode}
        leadMagnetToken={token}
        onExamDone={() => {
          fetch('/api/practice-exam/complete', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }}
        onExit={() => setPhase('picker')}
        onComplete={() => {}}
      />
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>Full Steam Ahead</div>
        <div style={styles.subtitle}>Free Practice Exam</div>

        {phase === 'picker' && (
          <div>
            <div style={styles.classToggleRow}>
              {CLASS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleClassToggle(opt.value)}
                  style={{
                    ...styles.classToggleBtn,
                    ...(classCode === opt.value ? styles.classToggleBtnActive : {}),
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {classCode && (
              papersLoading ? (
                <div style={styles.hint}>Loading papers…</div>
              ) : papers.length === 0 ? (
                <div style={styles.hint}>No papers available for this class yet.</div>
              ) : (
                <div style={styles.paperGrid}>
                  {papers.map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleSelectPaper(p)}
                      style={styles.paperBtn}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )
            )}
          </div>
        )}

        {phase === 'signup' && (
          <div>
            <button type="button" style={styles.backLink} onClick={() => { setAlreadyUsed(false); setPhase('picker'); }}>
              ← Choose a different paper
            </button>
            <p style={styles.hint}>
              {classCode === 'third' ? '3rd Class' : '2nd Class'} — {paperCode}
            </p>
            {alreadyUsed ? (
              <AlreadyUsedNotice />
            ) : (
              <form onSubmit={handleSignupSubmit}>
                <label style={styles.label} htmlFor="fpe-firstName">First Name</label>
                <input
                  id="fpe-firstName"
                  type="text"
                  required
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  style={styles.input}
                  placeholder="Jordan"
                />
                <label style={styles.label} htmlFor="fpe-email">Email</label>
                <input
                  id="fpe-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  style={styles.input}
                  placeholder="you@example.com"
                />
                <button
                  type="submit"
                  disabled={signupSubmitting}
                  style={{ ...styles.button, ...(signupSubmitting ? styles.buttonDisabled : {}) }}
                >
                  {signupSubmitting ? 'Sending code…' : 'Send Verification Code'}
                </button>
                {requestError && <div style={styles.error}>{requestError}</div>}
              </form>
            )}
          </div>
        )}

        {phase === 'verify' && (
          <div>
            <p style={styles.hint}>We sent a 6-digit code to {email}. Enter it below to start your free practice exam.</p>
            {alreadyUsed ? (
              <AlreadyUsedNotice />
            ) : (
              <form onSubmit={handleVerifySubmit}>
                <label style={styles.label} htmlFor="fpe-code">Verification Code</label>
                <input
                  id="fpe-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  style={styles.codeInput}
                  placeholder="000000"
                />
                <button
                  type="submit"
                  disabled={verifySubmitting || code.length !== 6}
                  style={{ ...styles.button, ...((verifySubmitting || code.length !== 6) ? styles.buttonDisabled : {}) }}
                >
                  {verifySubmitting ? 'Verifying…' : 'Start Practice Exam'}
                </button>
                {verifyError && <div style={styles.error}>{verifyError}</div>}
                {resendMessage && !verifyError && <div style={styles.hint}>{resendMessage}</div>}
                <div style={{ textAlign: 'center', marginTop: '16px' }}>
                  <button type="button" style={styles.link} onClick={handleResend} disabled={resending}>
                    {resending ? 'Resending…' : 'Resend code'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
