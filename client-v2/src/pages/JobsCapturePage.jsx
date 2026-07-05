// fsa-agent/client-v2/src/pages/JobsCapturePage.jsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import './JobsCapturePage.css';

export default function JobsCapturePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('checking'); // 'checking' | 'need-auth' | 'error'
  const [error, setError] = useState('');

  const jobId = searchParams.get('job_id') || '';
  const title = searchParams.get('title') || '';
  const company = searchParams.get('company') || '';
  const url = searchParams.get('url') || '';
  const postedAt = searchParams.get('posted_at') || '';

  useEffect(() => {
    async function attemptSave() {
      const storedUser = localStorage.getItem('fsa_user');
      if (!storedUser) {
        setStatus('need-auth');
        return;
      }
      if (!title || !url) {
        setStatus('error');
        setError('This job link is missing required information. Please go back and try again from the listing.');
        return;
      }
      try {
        const res = await fetch('/api/jobs/save', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_job_id: jobId || null, title, company, url, posted_at: postedAt || null }),
        });
        if (res.status === 401) {
          localStorage.removeItem('fsa_user');
          setStatus('need-auth');
          return;
        }
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || 'Could not save this job.');
        }
        navigate('/jobs?saved=1', { replace: true });
      } catch (err) {
        setStatus('error');
        setError(err.message || 'Something went wrong. Please try again.');
      }
    }
    attemptSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextParam = encodeURIComponent(`/jobs/capture?${searchParams.toString()}`);

  if (status === 'checking') {
    return <div className="jc-wrap"><p>Saving this job to your account…</p></div>;
  }

  if (status === 'error') {
    return <div className="jc-wrap"><p>{error}</p></div>;
  }

  return (
    <div className="jc-wrap">
      <h2>Save this job to your FSA account</h2>
      {title && <p>{title}{company ? ` at ${company}` : ''}</p>}
      <div className="jc-actions">
        <Link to={`/login?next=${nextParam}`} className="jc-btn-primary">Log In</Link>
        <Link to={`/signup?next=${nextParam}`} className="jc-btn-secondary">Create a Free Account</Link>
      </div>
    </div>
  );
}
