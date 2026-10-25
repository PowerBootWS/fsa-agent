import { useCallback, useEffect, useState } from 'react';
import { track } from '../utils/usage';
import './HomePage.css';
import './AffiliatePage.css';

const SITE = 'https://fullsteamahead.ca';
const LOAD_ERROR = "Couldn't load your referral dashboard right now.";
const DEEP_LINKS = [
  { label: '2nd Class', path: '/2nd-class-complete' },
  { label: '3rd Class', path: '/3rd-class-complete' },
  { label: '4th Class', path: '/4th-class-complete' },
];
const MEDIA_KIT = [
  { href: 'https://affiliates.fullsteamahead.ca/media/documents/affiliate-guide/AFFILIATE-GUIDE.pdf', title: 'Affiliate Guide', note: 'How it works, what you earn, discount codes (PDF)' },
  { href: 'https://affiliates.fullsteamahead.ca/media/documents/email-templates/fsa-affiliate-emails.pdf', title: 'Email Templates', note: '25 emails for 2nd, 3rd and 4th Class (PDF)' },
  { href: 'https://affiliates.fullsteamahead.ca/media/documents/sms-templates/fsa-affiliate-sms.pdf', title: 'Text Message Templates', note: '25 texts for 2nd, 3rd and 4th Class (PDF)' },
  { href: 'https://affiliates.fullsteamahead.ca/', title: 'Social Media Images', note: 'Facebook, Instagram, LinkedIn and Stories sizes' },
];
const CLASS_LABELS = {
  second: '2nd Class',
  third: '3rd Class',
  fourth_a: '4th Class 4A',
  fourth_b: '4th Class 4B',
};
const CODE_STATUS = {
  active: { label: 'Active', tone: 'good' },
  used: { label: 'Used', tone: 'good' },
  expired: { label: 'Expired', tone: 'muted' },
};

function formatCents(cents) {
  return `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
}
function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}
function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

function enrolledLabel(status) {
  const code = status.replace('enrolled:', '');
  return `Enrolled – ${CLASS_LABELS[code] || code}`;
}

function Badge({ tone, children }) {
  return <span className={`af-badge af-badge--${tone}`}>{children}</span>;
}

function CopyButton({ text, label, className = 'hm-btn hm-btn--small' }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  }
  return <button type="button" className={className} onClick={copy}>{copied ? 'Copied!' : label}</button>;
}

function DataTable({ head, empty, rows }) {
  if (!rows.length) return <p className="hm-muted">{empty}</p>;
  return (
    <div className="af-table-wrap">
      <table className="af-table">
        <thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

function DiscountCodes({ link, history, onGenerated }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/platform/affiliate/discount-codes', { method: 'POST', credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
      const expiry = formatDateTime(body.expiresAt);
      setResult({
        code: body.code,
        expiry,
        message: `Here's 20% off your first month of Full Steam Ahead (2nd or 3rd Class Complete). Enter code ${body.code} in the "Add promotion code" box at checkout. It only works once and expires ${expiry}. Sign up here: ${link}`,
      });
      track('feature_use', { action: 'affiliate_code_generated' });
      onGenerated();
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hm-card">
      <h2 className="hm-card-title">Discount Codes</h2>
      <p>For a lead who's close to signing up. Generate a code right before you send it.</p>
      <ul className="af-list">
        <li>20% off their first month of 2nd Class or 3rd Class Complete</li>
        <li>One use, and it expires 48 hours after you generate it</li>
        <li>You don't earn commission on that first month. Every payment after that pays your normal 20%</li>
        <li>If they use your code, the sale is credited to you, whichever link they clicked last</li>
      </ul>
      <div>
        <button type="button" className="hm-btn" onClick={generate} disabled={busy}>
          {busy ? 'Generating…' : 'Generate a Code'}
        </button>
      </div>
      {error && <p className="hm-error">{error}</p>}
      {result && (
        <div className="af-result">
          <div className="af-label">Your Code</div>
          <div className="af-code">{result.code}</div>
          <div className="hm-muted">Expires {result.expiry}</div>
          <textarea className="af-message" aria-label="Message to send" readOnly value={result.message} />
          <div className="af-actions">
            <CopyButton text={result.code} label="Copy Code" />
            <CopyButton text={result.message} label="Copy Message" />
          </div>
        </div>
      )}
      {history.length > 0 && (
        <div>
          <div className="af-label">Recent Codes</div>
          <div className="af-table-wrap">
            <table className="af-table">
              <tbody>
                {history.map(c => {
                  const st = CODE_STATUS[c.status] || { label: c.status, tone: 'muted' };
                  return (
                    <tr key={c.code}>
                      <td>{c.code}</td>
                      <td>{c.status === 'active' ? `Expires ${formatDateTime(c.expiresAt)}` : `Made ${formatDate(c.createdAt)}`}</td>
                      <td><Badge tone={st.tone}>{st.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function Dashboard({ data, onGenerated }) {
  const { summary, leads = [], customers = [], commissions = [], discountCodes = [] } = data;
  const code = summary.code;
  const link = code ? `${SITE}/?am_id=${code}` : '';

  return (
    <>
      <section className="hm-card">
        <h2 className="hm-card-title">Your Referral Link</h2>
        <div className="hm-referral">
          <code className="hm-referral-url">{link || '–'}</code>
          <CopyButton text={link} label="Copy Link" />
        </div>
        {code && (
          <ul className="af-deeplinks">
            {DEEP_LINKS.map(d => {
              const url = `${SITE}${d.path}?am_id=${code}`;
              return (
                <li key={d.path}>
                  <span className="af-label">{d.label}</span>
                  <div className="hm-referral">
                    <code className="hm-referral-url">{url}</code>
                    <CopyButton text={url} label="Copy" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="af-stats">
        <div className="hm-card"><div className="hm-stat-value">{summary.totalClicks}</div><div className="hm-stat-label">Clicks</div></div>
        <div className="hm-card"><div className="hm-stat-value">{summary.totalLeads}</div><div className="hm-stat-label">Leads</div></div>
        <div className="hm-card"><div className="hm-stat-value">{formatCents(summary.totalEarnedCents)}</div><div className="hm-stat-label">Total Earned</div></div>
        <div className="hm-card"><div className="hm-stat-value">{formatCents(summary.outstandingCents)}</div><div className="hm-stat-label">Unpaid Balance</div></div>
      </div>

      <DiscountCodes link={link} history={discountCodes} onGenerated={onGenerated} />

      <section className="hm-card">
        <h2 className="hm-card-title">Media Kit</h2>
        <p>Everything you need to share FSA. Put your referral link in wherever a template says [LINK] or [YOUR AFFILIATE LINK].</p>
        <div className="af-media">
          {MEDIA_KIT.map(m => (
            <a key={m.title} className="af-media-item" href={m.href} target="_blank" rel="noopener noreferrer">
              <strong>{m.title}</strong><span>{m.note}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="hm-card">
        <h2 className="hm-card-title">Leads</h2>
        <DataTable
          head={['Name', 'Email', 'Referred', 'Status']}
          empty="No leads attributed yet."
          rows={leads.map(l => {
            const enrolled = l.enrollmentStatus !== 'not_enrolled';
            return (
              <tr key={l.email}>
                <td>{l.firstName || '–'}</td>
                <td>{l.email}</td>
                <td>{formatDate(l.attributedAt)}</td>
                <td><Badge tone={enrolled ? 'good' : 'muted'}>{enrolled ? enrolledLabel(l.enrollmentStatus) : 'Not Enrolled'}</Badge></td>
              </tr>
            );
          })}
        />
      </section>

      <section className="hm-card">
        <h2 className="hm-card-title">Customers</h2>
        <p className="hm-muted">People who bought through your link or code.</p>
        <DataTable
          head={['Name', 'Program', 'Since', 'Status', "You've Earned"]}
          empty="No customers yet. When someone you refer buys, they'll show here."
          rows={customers.map((c, i) => (
            <tr key={`${c.email}-${i}`}>
              <td>{c.firstName || c.email}</td>
              <td>{c.program || '–'}</td>
              <td>{formatDate(c.since)}</td>
              <td>
                {c.status === 'active'
                  ? <Badge tone="good">{c.endsAt ? `Active until ${formatDate(c.endsAt)}` : 'Active'}</Badge>
                  : <Badge tone="muted">Ended</Badge>}
              </td>
              <td className="af-num">{formatCents(c.earnedCents)}</td>
            </tr>
          ))}
        />
      </section>

      <section className="hm-card">
        <h2 className="hm-card-title">Commissions</h2>
        <p className="hm-muted">Every payment you've earned on. Paid out by e-Transfer.</p>
        <DataTable
          head={['Date', 'Customer', 'Payment', 'Your Commission', 'Status']}
          empty="No commissions yet."
          rows={commissions.map((r, i) => {
            let who = r.firstName || r.email;
            if (r.type === 'refund') who += ' (refund)';
            if (r.type === 'discount') who += ' (discount code, first month)';
            return (
              <tr key={i}>
                <td>{formatDate(r.date)}</td>
                <td>{who}</td>
                <td className="af-num">{formatCents(r.paymentCents)}</td>
                <td className="af-num">{formatCents(r.commissionCents)}</td>
                <td>
                  {r.commissionCents === 0
                    ? <Badge tone="muted">No commission</Badge>
                    : r.paidAt ? <Badge tone="good">Paid {formatDate(r.paidAt)}</Badge> : <Badge tone="muted">Unpaid</Badge>}
                </td>
              </tr>
            );
          })}
        />
      </section>
    </>
  );
}

export default function AffiliatePage() {
  // data: undefined = loading, null = load failed, object = payload
  const [data, setData] = useState(undefined);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/platform/affiliate', { credentials: 'include' });
      if (!res.ok) throw new Error('load');
      setData(await res.json());
    } catch {
      // Only the first load shows the error; a refresh keeps what is on screen.
      setData(prev => (prev === undefined ? null : prev));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleJoin() {
    setJoining(true);
    setJoinError('');
    try {
      const res = await fetch('/api/platform/affiliate/join', { method: 'POST', credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't join right now, try again in a minute.");
      track('feature_use', { action: 'affiliate_joined' });
      await load();
    } catch (err) {
      setJoinError(err.message);
    } finally {
      setJoining(false);
    }
  }

  let body;
  if (data === undefined) {
    body = <p className="hm-muted">Loading…</p>;
  } else if (data === null) {
    body = <section className="hm-card"><p>{LOAD_ERROR}</p></section>;
  } else if (!data.is_affiliate) {
    body = (
      <section className="hm-card">
        <h2 className="hm-card-title">Become an Affiliate</h2>
        <p>Earn 20% of every payment from the people you refer. No approval wait. Join and your referral link is ready right away.</p>
        <div><button type="button" className="hm-btn" onClick={handleJoin} disabled={joining}>{joining ? 'Joining…' : 'Join'}</button></div>
        {joinError && <p className="hm-error">{joinError}</p>}
      </section>
    );
  } else if (data.status !== 'active') {
    body = (
      <section className="hm-card">
        <p>Your referral account is paused. Email support@fullsteamahead.ca if you think that's a mistake.</p>
      </section>
    );
  } else {
    body = <Dashboard data={data} onGenerated={load} />;
  }

  return (
    <div className="hm-page af-page">
      <h1 className="hm-greeting">Referrals</h1>
      <div className="af-stack">{body}</div>
    </div>
  );
}
