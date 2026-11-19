import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';

// PayMongo redirects the browser here after the client authorizes (or
// cancels) a GCash payment. The redirect itself proves nothing — the
// webhook is the source of truth — so this just polls the booking a few
// times waiting for the webhook to land, rather than trusting the URL.
export default function PaymentReturn() {
  const [params] = useSearchParams();
  const bookingId = params.get('bookingId') || '';
  const [status, setStatus] = useState<'checking' | 'paid' | 'failed' | 'timeout'>('checking');

  useEffect(() => {
    if (!bookingId) { setStatus('timeout'); return; }
    let attempts = 0;
    let cancelled = false;

    const poll = () => {
      api.booking(bookingId).then((r) => {
        if (cancelled) return;
        const paymentStatus = r.data.payment?.status;
        if (paymentStatus === 'paid') { setStatus('paid'); return; }
        if (paymentStatus === 'failed') { setStatus('failed'); return; }
        attempts += 1;
        if (attempts >= 10) { setStatus('timeout'); return; }
        setTimeout(poll, 2000);
      }).catch(() => { if (!cancelled) setStatus('timeout'); });
    };
    poll();

    return () => { cancelled = true; };
  }, [bookingId]);

  return <div className="container" style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
    <div className="dash-panel" style={{ maxWidth: 420, textAlign: 'center' }}>
      {status === 'checking' && <>
        <div className="loading"><span /></div>
        <h2 style={{ marginTop: 14 }}>Confirming your payment…</h2>
        <p className="muted" style={{ fontSize: '.85rem', marginTop: 8 }}>This usually takes a few seconds.</p>
      </>}
      {status === 'paid' && <>
        <h2>Payment confirmed</h2>
        <p className="muted" style={{ fontSize: '.85rem', margin: '8px 0 20px' }}>Your booking is now paid and confirmed.</p>
        <Link className="button" to="/dashboard/bookings">View my bookings</Link>
      </>}
      {status === 'failed' && <>
        <h2>Payment didn't go through</h2>
        <p className="muted" style={{ fontSize: '.85rem', margin: '8px 0 20px' }}>Nothing was charged. You can try again from your bookings.</p>
        <Link className="button" to="/dashboard/bookings">Back to bookings</Link>
      </>}
      {status === 'timeout' && <>
        <h2>Still processing</h2>
        <p className="muted" style={{ fontSize: '.85rem', margin: '8px 0 20px' }}>We haven't heard back yet — check your bookings in a moment; it'll update once confirmed.</p>
        <Link className="button" to="/dashboard/bookings">Go to bookings</Link>
      </>}
    </div>
  </div>;
}
