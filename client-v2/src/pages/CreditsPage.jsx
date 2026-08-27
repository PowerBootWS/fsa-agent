// fsa-agent/client-v2/src/pages/CreditsPage.jsx
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getJson } from '../utils/api';
import './CreditsPage.css';

export default function CreditsPage() {
  const [searchParams] = useSearchParams();
  const purchaseStatus = searchParams.get('purchase'); // 'success' | 'cancelled' | null

  const [balance, setBalance] = useState(null);
  const [packs, setPacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [buyingPackId, setBuyingPackId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [balanceData, packsData] = await Promise.all([
          getJson('/api/platform/credits'),
          getJson('/api/platform/credits/packs'),
        ]);
        if (cancelled) return;
        setBalance(balanceData.balance);
        setPacks(packsData.packs);
      } catch {
        if (!cancelled) setError('Could not load credits — please refresh.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (purchaseStatus !== 'success') return;
    const timer = setTimeout(async () => {
      try {
        const data = await getJson('/api/platform/credits');
        setBalance(data.balance);
      } catch {
        // Balance will still be correct on next normal page load; nothing to show the user here.
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [purchaseStatus]);

  async function handleBuy(packId) {
    setBuyingPackId(packId);
    setError('');
    try {
      const res = await fetch('/api/platform/credits/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't start checkout.");
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
      setBuyingPackId(null);
    }
  }

  return (
    <div className="cr-page">
      <h1 className="cr-title">Buy Credits</h1>
      <p className="cr-balance">
        {loading ? 'Loading…' : `Current balance: ${balance} credit${balance === 1 ? '' : 's'}`}
      </p>

      {purchaseStatus === 'success' && (
        <p className="cr-banner cr-banner-success">
          Payment received — your credits will appear in a moment.
        </p>
      )}
      {purchaseStatus === 'cancelled' && (
        <p className="cr-banner cr-banner-cancelled">Checkout cancelled — no charge was made.</p>
      )}
      {error && <p className="cr-error">{error}</p>}

      <div className="cr-packs">
        {packs.map((pack) => (
          <div key={pack.id} className="cr-pack-card">
            <h2 className="cr-pack-name">{pack.displayName}</h2>
            <p className="cr-pack-price">{pack.priceLabel}</p>
            <p className="cr-pack-credits">{pack.credits} credit{pack.credits === 1 ? '' : 's'}</p>
            <button
              className="cr-buy-button"
              disabled={buyingPackId !== null}
              onClick={() => handleBuy(pack.id)}
            >
              {buyingPackId === pack.id ? 'Redirecting…' : 'Buy'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
