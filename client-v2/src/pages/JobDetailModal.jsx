// fsa-agent/client-v2/src/pages/JobDetailModal.jsx
import { useEffect, useRef, useState } from 'react';
import './JobDetailModal.css';

export default function JobDetailModal({ jobId, onClose, focusTailoring = false }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [balance, setBalance] = useState(null);
  const [hasResume, setHasResume] = useState(null);
  const [selectedTypes, setSelectedTypes] = useState({ resume: true, cover_letter: false });
  const [generating, setGenerating] = useState(false);
  const [tailorError, setTailorError] = useState('');
  const [tailorResult, setTailorResult] = useState(null);
  const [history, setHistory] = useState([]);
  const tailoringRef = useRef(null);

  function scrollToTailoring() {
    tailoringRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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

  useEffect(() => {
    let cancelled = false;
    async function loadTailoringContext() {
      try {
        const [creditsRes, docsRes, historyRes] = await Promise.all([
          fetch('/api/platform/credits', { credentials: 'include' }),
          fetch('/api/platform/documents', { credentials: 'include' }),
          fetch(`/api/platform/jobs/${jobId}/generated-documents`, { credentials: 'include' }),
        ]);
        const creditsData = await creditsRes.json();
        const docsData = await docsRes.json();
        const historyData = await historyRes.json();
        if (cancelled) return;
        setBalance(creditsData.balance);
        setHasResume(docsData.documents.some((d) => d.doc_type === 'resume'));
        setHistory(historyData.documents || []);
      } catch {
        if (!cancelled) setBalance(null);
      }
    }
    loadTailoringContext();
    return () => { cancelled = true; };
  }, [jobId]);

  useEffect(() => {
    if (focusTailoring && job) {
      scrollToTailoring();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTailoring, job]);

  const selectedCount = Object.values(selectedTypes).filter(Boolean).length;

  async function handleGenerate() {
    const docTypes = Object.entries(selectedTypes).filter(([, v]) => v).map(([k]) => k);
    setGenerating(true);
    setTailorError('');
    setTailorResult(null);
    try {
      const res = await fetch(`/api/platform/jobs/${jobId}/tailor`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docTypes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong generating your documents.');
      setTailorResult(data);
      setBalance(data.balanceRemaining);
      setHistory((prev) => [
        ...data.documents.map((d) => ({
          id: d.id,
          docType: d.docType,
          changesSummary: data.changesSummary,
          placeholderCount: data.placeholderCount,
          generatedAt: new Date().toISOString(),
          downloadUrls: d.downloadUrls,
        })),
        ...prev,
      ]);
    } catch (err) {
      setTailorError(err.message);
    } finally {
      setGenerating(false);
    }
  }

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

            <button className="jd-tailor-cta-top" onClick={scrollToTailoring}>
              Customize Your Resume and Cover Letter for This Job
            </button>

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

            <div className="jd-section jd-tailoring" ref={tailoringRef}>
              <h3>Customize Your Resume and Cover Letter for This Job</h3>
              {balance === null ? (
                <p className="jd-loading">Loading…</p>
              ) : !hasResume ? (
                <p className="jd-tailoring-gate">
                  Upload a resume on your <a href="/profile">Profile</a> page before generating tailored documents.
                </p>
              ) : balance === 0 ? (
                <p className="jd-tailoring-gate">
                  You're out of credits — <a href="/credits">buy more here</a>.
                </p>
              ) : (
                <>
                  <p className="jd-credit-balance">Credits available: {balance}</p>
                  <label className="jd-tailor-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedTypes.resume}
                      onChange={(e) => setSelectedTypes((s) => ({ ...s, resume: e.target.checked }))}
                    /> Resume
                  </label>
                  <label className="jd-tailor-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedTypes.cover_letter}
                      onChange={(e) => setSelectedTypes((s) => ({ ...s, cover_letter: e.target.checked }))}
                    /> Cover Letter
                  </label>
                  <button
                    className="jd-tailor-generate"
                    disabled={selectedCount === 0 || selectedCount > balance || generating}
                    onClick={handleGenerate}
                  >
                    {generating
                      ? 'Tailoring your documents… this can take up to a minute.'
                      : `Generate (${selectedCount} credit${selectedCount === 1 ? '' : 's'})`}
                  </button>
                  {tailorError && <p className="jd-error">{tailorError}</p>}
                  {tailorResult && (
                    <div className="jd-tailor-result">
                      <p>{tailorResult.changesSummary}</p>
                      <p>{tailorResult.placeholderCount} placeholder{tailorResult.placeholderCount === 1 ? '' : 's'} to fill in before sending.</p>
                      {tailorResult.flaggedGaps?.map((gap, i) => (
                        <p key={i} className="jd-flagged-gap">⚠ {gap}</p>
                      ))}
                    </div>
                  )}
                </>
              )}
              {history.length > 0 && (
                <div className="jd-tailor-history">
                  <h4>Previously generated</h4>
                  {history.map((doc) => (
                    <div key={doc.id} className="jd-tailor-history-item">
                      <span>{doc.docType === 'resume' ? 'Resume' : 'Cover Letter'} — {new Date(doc.generatedAt).toLocaleDateString()}</span>
                      <a href={doc.downloadUrls.docx}>DOCX</a>
                      <a href={doc.downloadUrls.pdf}>PDF</a>
                    </div>
                  ))}
                </div>
              )}
            </div>

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
