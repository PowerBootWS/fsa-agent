// fsa-agent/client-v2/src/pages/JobDetailModal.jsx
import { useEffect, useState } from 'react';
import './JobDetailModal.css';

export default function JobDetailModal({ jobId, onClose }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadDetail() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { credentials: 'include' });
        if (!res.ok) throw new Error("Failed to load this job's details.");
        const data = await res.json();
        if (!cancelled) setJob(data.job);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadDetail();
    return () => { cancelled = true; };
  }, [jobId]);

  const isClosed = job && job.source_status && job.source_status !== 'active';

  return (
    <div className="jd-overlay" onClick={onClose}>
      <div className="jd-modal" onClick={(e) => e.stopPropagation()}>
        <button className="jd-close" onClick={onClose} aria-label="Close">×</button>

        {loading && <p className="jd-loading">Loading…</p>}
        {error && <p className="jd-error">{error}</p>}

        {job && (
          <>
            <div className="jd-header">
              {job.employer_logo_url_snapshot && (
                <img className="jd-logo" src={job.employer_logo_url_snapshot} alt="" />
              )}
              <div>
                <h2 className="jd-title">{job.title}</h2>
                <div className="jd-company">{job.company}{job.location ? ` · ${job.location}` : ''}</div>
                {job.job_class_label && <span className="jd-badge">{job.job_class_label}</span>}
              </div>
            </div>

            {job.ai_summary_snapshot && (
              <div className="jd-summary-panel">
                <div className="jd-summary-label">AI Summary</div>
                <p>{job.ai_summary_snapshot}</p>
              </div>
            )}

            {job.description_snapshot && (
              <div className="jd-section">
                <h3>Description</h3>
                <p className="jd-description">{job.description_snapshot}</p>
              </div>
            )}

            <div className="jd-footer">
              {isClosed ? (
                <p className="jd-closed-note">This opportunity is no longer accepting applications.</p>
              ) : (
                <a href={job.url} target="_blank" rel="noopener noreferrer" className="jd-apply-link">Apply →</a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
