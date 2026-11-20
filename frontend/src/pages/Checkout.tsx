import { useEffect, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { stripePromise } from '../services/stripe';
import { api, PayTarget, payTargetKey } from '../services/api';

function PayForm({ onDone }: { onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError('');
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    setBusy(false);
    if (confirmError) { setError(confirmError.message || 'Payment failed. Please try again.'); return; }
    if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') onDone();
    else setError('Payment did not complete. Please try again.');
  };

  return <form onSubmit={submit}>
    <PaymentElement />
    {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
    <button className="button full" type="submit" disabled={busy || !stripe} style={{ marginTop: 16 }}>{busy ? 'Processing…' : 'Pay now'}</button>
  </form>;
}

function CardCheckout({ bookingId, onDone }: { bookingId: PayTarget; onDone: () => void }) {
  const [clientSecret, setClientSecret] = useState('');
  const [summary, setSummary] = useState<{ total: number; count: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.createPayment(bookingId)
      .then((r) => { setClientSecret(r.data.clientSecret); setSummary({ total: r.data.total, count: r.data.payments?.length || 1 }); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not start checkout.'));
  }, [payTargetKey(bookingId)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!stripePromise) return <p className="form-message">Payments aren’t configured yet — set VITE_STRIPE_PUBLISHABLE_KEY in the frontend .env.</p>;
  if (error) return <p className="error-text">{error}</p>;
  if (!clientSecret) return <p className="form-message">Preparing checkout…</p>;

  return <Elements stripe={stripePromise} options={{ clientSecret, appearance: { variables: { colorPrimary: '#FF5A36', fontFamily: 'Manrope, sans-serif' } } }}>
    {summary && <p style={{ fontWeight: 700, marginBottom: 12 }}>Total: ₱{summary.total.toLocaleString()}{summary.count > 1 ? ` for ${summary.count} sessions` : ''}</p>}
    <PayForm onDone={onDone} />
  </Elements>;
}

function FeeBreakdown({ price, feeRate, feeLabel, footnote }: { price: number; feeRate: number; feeLabel: string; footnote: string }) {
  const fee = Math.round(price * feeRate * 100) / 100;
  return <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 14, marginBottom: 10, fontSize: '.85rem' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span className="muted">Price</span><span className="mono">₱{price.toLocaleString()}</span></div>
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span className="muted">Platform fee ({(feeRate * 100).toFixed(0)}%, {feeLabel})</span>
      <span className="mono muted">− ₱{fee.toLocaleString()}</span>
    </div>
    <div className="hr" style={{ margin: '6px 0' }} />
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontWeight: 700 }}><span>Amount you pay</span><span className="mono">₱{price.toLocaleString()}</span></div>
    <p className="muted" style={{ fontSize: '.72rem', marginTop: 6 }}>{footnote}</p>
  </div>;
}

function AutomaticGcashCheckout({ bookingId, price, feeRate }: { bookingId: PayTarget; price: number; feeRate: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pay = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.startGcashCheckout(bookingId);
      window.location.href = r.data.redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start GCash checkout.');
      setBusy(false);
    }
  };

  const net = price - Math.round(price * feeRate * 100) / 100;

  return <div>
    <p className="eyebrow" style={{ marginBottom: 10 }}>PAYMENT DETAILS</p>
    <FeeBreakdown price={price} feeRate={feeRate} feeLabel="platform's cut"
      footnote={`You'll be redirected to GCash to confirm this payment. It goes to the platform automatically — your coach receives their ₱${net.toLocaleString()} net share from the platform afterward.`} />
    {error && <p className="error-text">{error}</p>}
    <button className="button full" type="button" disabled={busy} onClick={pay} style={{ marginTop: 6 }}>{busy ? 'Redirecting…' : `Pay ₱${price.toLocaleString()} via GCash`}</button>
  </div>;
}

function ManualGcashCheckout({ bookingId, price, feeRate, number, accountName, onDone }: { bookingId: PayTarget; price: number; feeRate: number; number: string; accountName: string; onDone: () => void }) {
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.submitGcashPayment(bookingId, reference);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your payment.');
    } finally {
      setBusy(false);
    }
  };

  const net = price - Math.round(price * feeRate * 100) / 100;

  return <form onSubmit={submit}>
    <p className="eyebrow" style={{ marginBottom: 10 }}>PAYMENT DETAILS</p>
    <FeeBreakdown price={price} feeRate={feeRate} feeLabel="coach's responsibility"
      footnote={`Send the full session price — the platform fee isn't added on top. Your coach nets ₱${net.toLocaleString()} after their commission is settled with the platform.`} />
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
      <div style={{ fontSize: '1.2rem', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{number}</div>
      <div className="muted" style={{ fontSize: '.8rem', marginTop: 2 }}>{accountName}</div>
    </div>
    <label>GCash reference number
      <input required value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 1234567890123" />
    </label>
    {error && <p className="error-text">{error}</p>}
    <button className="button full" type="submit" disabled={busy} style={{ marginTop: 6 }}>{busy ? 'Submitting…' : 'I’ve sent the payment'}</button>
    <p className="muted" style={{ fontSize: '.72rem', marginTop: 10 }}>Your coach will confirm receipt and the booking will be marked paid shortly after.</p>
  </form>;
}

function SessionCountNote({ count }: { count: number }) {
  return <p className="form-message" style={{ marginBottom: 10 }}>This payment covers all {count} sessions in your checkout.</p>;
}

function GcashCheckout({ bookingId, amount, onDone }: { bookingId: PayTarget; amount?: number; onDone: () => void }) {
  const [info, setInfo] = useState<{ number: string; accountName: string; platformFeeRate: number; paymongoConfigured: boolean; amount: number; sessionCount: number } | null>(null);
  const [infoError, setInfoError] = useState('');

  useEffect(() => {
    api.gcashInfo(bookingId)
      .then((r) => setInfo(r.data))
      .catch((e) => setInfoError(e instanceof Error ? e.message : 'Could not load GCash checkout details.'));
  }, [payTargetKey(bookingId)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (infoError) return <p className="error-text">{infoError}</p>;
  if (!info) return <p className="form-message">Loading GCash details…</p>;

  // The server resolves the whole multi-session checkout, so its total wins.
  const price = Number(info.amount ?? amount ?? 0);
  return info.paymongoConfigured
    ? <>{info.sessionCount > 1 && <SessionCountNote count={info.sessionCount} />}<AutomaticGcashCheckout bookingId={bookingId} price={price} feeRate={info.platformFeeRate} /></>
    : <>{info.sessionCount > 1 && <SessionCountNote count={info.sessionCount} />}<ManualGcashCheckout bookingId={bookingId} price={price} feeRate={info.platformFeeRate} number={info.number} accountName={info.accountName} onDone={onDone} /></>;
}

export default function Checkout({ bookingId, amount, onDone, onCancel }: { bookingId: PayTarget; amount?: number; onDone: () => void; onCancel: () => void }) {
  const [method, setMethod] = useState<'card' | 'gcash'>('card');

  return <div className="checkout-box">
    <div className="tab-strip" style={{ marginBottom: 16 }}>
      <button type="button" className={`tab-btn ${method === 'card' ? 'active' : ''}`} onClick={() => setMethod('card')}>Card</button>
      <button type="button" className={`tab-btn ${method === 'gcash' ? 'active' : ''}`} onClick={() => setMethod('gcash')}>GCash</button>
    </div>
    {method === 'card' ? <CardCheckout bookingId={bookingId} onDone={onDone} /> : <GcashCheckout bookingId={bookingId} amount={amount} onDone={onDone} />}
    <button className="text-btn" onClick={onCancel} style={{ marginTop: 10, padding: 0 }}>Cancel</button>
  </div>;
}
