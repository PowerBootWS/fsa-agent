import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { track } from '../utils/usage';
import './HomePage.css';

const CLASS_LABELS = { second: '2nd Class', third: '3rd Class', fourth_a: '4th Class', fourth_b: '4th Class' };
const ENROLL_URL = 'https://fullsteamahead.ca/enroll';
const JOB_BOARD_URL = 'https://fullsteamahead.ca/jobs';
const AFFILIATE_DASHBOARD_URL = 'https://fullsteamahead.ca/affiliate-dashboard';

const dollars = cents => `$${(cents / 100).toFixed(2)}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function weakestLabel(w) {
  if (!w) return null;
  if (w.title) return w.title;
  if (typeof w.chapter_id === 'string' && w.chapter_id) return `Chapter ${w.chapter_id.split('-').pop()}`;
  return null;
}

function CourseCard({ course, firstName }) {
  if (!course) {
    return <section className="hm-card"><h2 className="hm-card-title">Your course</h2><p className="hm-muted">Couldn't load your course right now.</p></section>;
  }
  if (course.state === 'none') {
    return (
      <section className="hm-card">
        <h2 className="hm-card-title">Your course</h2>
        <p>You're not currently enrolled.</p>
        <a className="hm-btn" href={ENROLL_URL}>Have a look at the courses</a>
      </section>
    );
  }
  if (course.state === 'lapsed') {
    return (
      <section className="hm-card">
        <h2 className="hm-card-title">Your course</h2>
        <p>Welcome back, {firstName}.</p>
        <p>Your course access has ended. Pick up where you left off whenever you're ready.</p>
        <a className="hm-btn" href={ENROLL_URL}>See courses</a>
      </section>
    );
  }
  return (
    <section className="hm-card">
      <h2 className="hm-card-title">Your course</h2>
      {course.subscriptions.map(s => (
        <div className="hm-course-line" key={`${s.class_code}-${s.paper}`}>
          <div className="hm-course-name">
            {CLASS_LABELS[s.class_code] || s.class_code}
            {s.paper ? <> · Paper {s.paper}</> : null}
          </div>
          {!s.paper && <Link className="hm-link" to="/select-paper">Pick your paper</Link>}
          {s.pct_complete !== null && (
            <div className="hm-progress" aria-label={`${s.pct_complete}% complete`}>
              <div className="hm-progress-fill" style={{ width: `${s.pct_complete}%` }} />
              <span className="hm-progress-label">{s.pct_complete}% complete</span>
            </div>
          )}
          {s.paper && (
            <p className="hm-muted">
              {s.last_exam_score !== null
                ? <>Last practice exam {s.last_exam_score}%{weakestLabel(s.weakest_chapter) && <> · weakest: {weakestLabel(s.weakest_chapter)}</>}</>
                : 'No practice exam yet'}
            </p>
          )}
        </div>
      ))}
      <Link className="hm-btn" to="/lobby">Continue</Link>
    </section>
  );
}

function JobsCard({ jobs }) {
  return (
    <section className="hm-card">
      <h2 className="hm-card-title">Jobs</h2>
      {jobs
        ? <p>{plural(jobs.saved_count, 'saved job', 'saved jobs')} · {plural(jobs.custom_resumes_count, 'custom resume', 'custom resumes')} built</p>
        : <p className="hm-muted">Couldn't load your jobs right now.</p>}
      <div className="hm-actions">
        <a className="hm-btn" href={JOB_BOARD_URL}>View the job board</a>
        <Link className="hm-link" to="/jobs">Saved jobs</Link>
      </div>
    </section>
  );
}

function AffiliateCard({ affiliate, onJoin, joining, joinError }) {
  const [copied, setCopied] = useState(false);
  if (affiliate === null) {
    return <section className="hm-card"><h2 className="hm-card-title">Referrals</h2><p className="hm-muted">Couldn't load your referral stats right now.</p></section>;
  }
  if (!affiliate.is_affiliate) {
    return (
      <section className="hm-card hm-card--quiet">
        <h2 className="hm-card-title">Referrals</h2>
        <p>Earn 20% of every referral, every month.</p>
        {affiliate.paused
          ? <p className="hm-muted">Your referral account is paused. Reply to any Full Steam Ahead email and we'll sort it out.</p>
          : <button className="hm-btn hm-btn--ghost" onClick={onJoin} disabled={joining}>{joining ? 'Joining…' : 'Join'}</button>}
        {joinError && <p className="hm-error">{joinError}</p>}
      </section>
    );
  }
  async function copy() {
    try { await navigator.clipboard.writeText(affiliate.referral_url); setCopied(true); } catch { /* ignore */ }
  }
  return (
    <section className="hm-card">
      <h2 className="hm-card-title">Referrals</h2>
      <div className="hm-stats">
        <div><div className="hm-stat-value">{dollars(affiliate.earned_cents)}</div><div className="hm-stat-label">earned to date</div></div>
        <div><div className="hm-stat-value">{affiliate.referred_count}</div><div className="hm-stat-label">people referred</div></div>
        <div><div className="hm-stat-value">{affiliate.paying_referrals_count}</div><div className="hm-stat-label">paying</div></div>
      </div>
      <div className="hm-referral">
        <code className="hm-referral-url">{affiliate.referral_url}</code>
        <button className="hm-btn hm-btn--small" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <a className="hm-link" href={AFFILIATE_DASHBOARD_URL}>Full dashboard</a>
    </section>
  );
}

function CreditsCard({ credits, jobs, firstName }) {
  if (!credits) return null;
  const n = credits.balance;
  if (n > 0 && jobs && jobs.saved_count > 0) {
    return (
      <section className="hm-card hm-card--small">
        <p>Let's go, {firstName}. You've got {plural(n, 'free custom resume', 'free custom resumes')}. Pick one of your saved jobs and we'll build it.</p>
        <Link className="hm-link" to="/jobs">Pick a saved job</Link>
      </section>
    );
  }
  if (n > 0) {
    return (
      <section className="hm-card hm-card--small">
        <p>You've got {plural(n, 'free custom resume', 'free custom resumes')}. Find a job worth going after first.</p>
        <a className="hm-link" href={JOB_BOARD_URL}>Browse the job board</a>
      </section>
    );
  }
  return (
    <section className="hm-card hm-card--small">
      <p>A custom resume is rewritten for one specific posting, so it matches what that employer is asking for.</p>
      <Link className="hm-link" to="/credits">Get more credits</Link>
    </section>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  async function load() {
    setError(false);
    try {
      const res = await fetch('/api/platform/home', { credentials: 'include' });
      if (res.status === 401) {
        localStorage.removeItem('fsa_user');
        navigate('/login', { replace: true });
        return;
      }
      if (!res.ok) throw new Error('home failed');
      setData(await res.json());
    } catch {
      setError(true);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleJoin() {
    setJoining(true);
    setJoinError('');
    try {
      const res = await fetch('/api/platform/affiliate/join', { method: 'POST', credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't join right now, try again in a minute.");
      track('feature_use', { action: 'affiliate_joined' });
      setData(d => ({ ...d, affiliate: body.affiliate }));
    } catch (err) {
      setJoinError(err.message);
    } finally {
      setJoining(false);
    }
  }

  if (error) {
    return (
      <div className="hm-page">
        <p>Couldn't load your home page.</p>
        <button className="hm-btn" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!data) return <div className="hm-page"><p className="hm-muted">Loading…</p></div>;

  return (
    <div className="hm-page">
      <h1 className="hm-greeting">Hi {data.first_name}</h1>
      <div className="hm-grid hm-grid--main">
        <CourseCard course={data.course} firstName={data.first_name} />
        <JobsCard jobs={data.jobs} />
        <AffiliateCard affiliate={data.affiliate} onJoin={handleJoin} joining={joining} joinError={joinError} />
      </div>
      <div className="hm-grid hm-grid--small">
        {data.new_jobs_7d !== null && (
          <section className="hm-card hm-card--small">
            <p>{plural(data.new_jobs_7d, 'new posting', 'new postings')} in the last 7 days.</p>
            <a className="hm-link" href={JOB_BOARD_URL}>Browse the board</a>
          </section>
        )}
        <CreditsCard credits={data.credits} jobs={data.jobs} firstName={data.first_name} />
        {data.resume_on_file === false && (
          <section className="hm-card hm-card--small">
            <p>Upload your resume to unlock one-click custom resumes.</p>
            <Link className="hm-link" to="/profile">Go to your profile</Link>
          </section>
        )}
      </div>
    </div>
  );
}
