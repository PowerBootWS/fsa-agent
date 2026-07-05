// fsa-agent/client-v2/src/pages/JobsPage.jsx
import { useEffect, useState } from 'react';
import './JobsPage.css';

const STATUS_LABELS = { saved: 'Saved', applied: 'Applied', interviewing: 'Interviewing', archived: 'Archived' };
const STATUS_ORDER = ['saved', 'applied', 'interviewing', 'archived'];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState({ title: '', company: '', url: '' });
  const [manualError, setManualError] = useState('');

  useEffect(() => {
    loadJobs();
  }, []);

  async function loadJobs() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/jobs', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load your saved jobs.');
      const data = await res.json();
      setJobs(data.jobs);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id, status) {
    setJobs(js => js.map(j => (j.id === id ? { ...j, status } : j)));
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
    } catch {
      loadJobs();
    }
  }

  async function handleManualAdd(e) {
    e.preventDefault();
    setManualError('');
    if (!manualForm.title.trim() || !manualForm.url.trim()) {
      setManualError('Title and URL are required.');
      return;
    }
    try {
      const res = await fetch('/api/jobs/save', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: manualForm.title.trim(),
          company: manualForm.company.trim(),
          url: manualForm.url.trim(),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not save this job.');
      }
      setManualForm({ title: '', company: '', url: '' });
      setShowManualForm(false);
      loadJobs();
    } catch (err) {
      setManualError(err.message);
    }
  }

  if (loading) return <div className="jb-loading">Loading your saved jobs…</div>;

  return (
    <div className="jb-page">
      <h1 className="jb-title">Your Saved Jobs</h1>
      {error && <div className="jb-error">{error}</div>}

      <button className="jb-btn-secondary" onClick={() => setShowManualForm(s => !s)}>
        {showManualForm ? 'Cancel' : '+ Add a Job Manually'}
      </button>

      {showManualForm && (
        <form className="jb-manual-form" onSubmit={handleManualAdd}>
          <input className="jb-input" placeholder="Job title" value={manualForm.title}
            onChange={e => setManualForm(f => ({ ...f, title: e.target.value }))} />
          <input className="jb-input" placeholder="Company (optional)" value={manualForm.company}
            onChange={e => setManualForm(f => ({ ...f, company: e.target.value }))} />
          <input className="jb-input" placeholder="Posting URL" value={manualForm.url}
            onChange={e => setManualForm(f => ({ ...f, url: e.target.value }))} />
          {manualError && <div className="jb-error">{manualError}</div>}
          <button type="submit" className="jb-btn-primary">Save Job</button>
        </form>
      )}

      {jobs.length === 0 ? (
        <p className="jb-empty">No saved jobs yet. Save one from the jobs board, or add one manually above.</p>
      ) : (
        <div className="jb-list">
          {jobs.map(job => (
            <div key={job.id} className="jb-card">
              <div className="jb-card-top">
                <h3 className="jb-card-title">{job.title}</h3>
                <span className={`jb-badge jb-badge--${job.status}`}>{STATUS_LABELS[job.status]}</span>
              </div>
              <div className="jb-card-company">{job.company}{job.location ? ` · ${job.location}` : ''}</div>
              <div className="jb-card-dates">
                {formatDate(job.posted_at) && <span>Posted {formatDate(job.posted_at)} · </span>}
                <span>Saved {formatDate(job.saved_at)}</span>
              </div>
              <div className="jb-card-actions">
                {STATUS_ORDER.filter(s => s !== job.status).map(s => (
                  <button key={s} className="jb-status-btn" onClick={() => updateStatus(job.id, s)}>
                    Mark {STATUS_LABELS[s]}
                  </button>
                ))}
                <a href={job.url} target="_blank" rel="noopener noreferrer" className="jb-link">View posting →</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
