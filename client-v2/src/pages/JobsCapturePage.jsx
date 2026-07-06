// fsa-agent/client-v2/src/pages/JobsCapturePage.jsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import './JobsCapturePage.css';

export default function JobsCapturePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('checking'); // 'checking' | 'need-auth' | 'error'
  const [error, setError] = useState('');
  const [job, setJob] = useState(null);

  const token = searchParams.get('token') || '';

  useEffect(() => {
    async function resolveAndSave() {
      if (!token) {
        setStatus('error');
        setError('This save link is missing information. Please go back and try again from the listing.');
        return;
      }

      let stashed;
      try {
        const stashRes = await fetch(`/api/jobs/capture-stash/${encodeURIComponent(token)}`);
        if (!stashRes.ok) {
          throw new Error('This save link has expired. Please go back and try saving the job again.');
        }
        stashed = await stashRes.json();
      } catch (err) {
        setStatus('error');
        setError(err.message || 'Something went wrong. Please try again.');
        return;
      }
      setJob(stashed);

      const storedUser = localStorage.getItem('fsa_user');
      if (!storedUser) {
        setStatus('need-auth');
        return;
      }
      if (!stashed.title || !stashed.url) {
        setStatus('error');
        setError('This job link is missing required information. Please go back and try again from the listing.');
        return;
      }
      try {
        const res = await fetch('/api/jobs/save', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_job_id: stashed.job_id || null,
            title: stashed.title,
            company: stashed.company,
            url: stashed.url,
            posted_at: stashed.posted_at || null,
            description_snapshot: stashed.description || null,
            ai_summary_snapshot: stashed.ai_summary || null,
            location: stashed.location || null,
            job_class_label: stashed.class_level || null,
            employer_logo_url_snapshot: stashed.employer_logo_url || null,
          }),
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
    resolveAndSave();
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
      {job && job.title && <p>{job.title}{job.company ? ` at ${job.company}` : ''}</p>}
      <div className="jc-actions">
        <Link to={`/login?next=${nextParam}`} className="jc-btn-primary">Log In</Link>
        <Link to={`/signup?next=${nextParam}`} className="jc-btn-secondary">Create a Free Account</Link>
      </div>
    </div>
  );
}
