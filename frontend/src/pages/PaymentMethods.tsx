import { useEffect, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { CreditCard, Plus, Star, Trash2 } from 'lucide-react';
import { stripePromise } from '../services/stripe';
import { api, SavedPaymentMethod } from '../services/api';
import { Loading } from '../components/shared';

function SetupForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError('');
    const { error: confirmError, setupIntent } = await stripe.confirmSetup({ elements, redirect: 'if_required' });
    setBusy(false);
    if (confirmError) { setError(confirmError.message || 'Could not save this card. Please try again.'); return; }
    if (setupIntent?.status === 'succeeded') onDone();
    else setError('Card was not saved. Please try again.');
  };

  return <form onSubmit={submit}>
    <PaymentElement />
    {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
    <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
      <button className="button" type="submit" disabled={busy || !stripe}>{busy ? 'Saving…' : 'Save card'}</button>
      <button className="text-btn" type="button" onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

export default function PaymentMethods() {
  const [methods, setMethods] = useState<SavedPaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [clientSecret, setClientSecret] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');

  const refresh = () => { setLoading(true); api.paymentMethods().then((r) => setMethods(r.data || [])).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(refresh, []);

  const startAdding = async () => {
    setMessage('');
    setAdding(true);
    try {
      const r = await api.createSetupIntent();
      setClientSecret(r.data.clientSecret);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not start saving a card.');
      setAdding(false);
    }
  };

  const finishAdding = () => { setAdding(false); setClientSecret(''); setMessage('Card saved.'); refresh(); };
  const cancelAdding = () => { setAdding(false); setClientSecret(''); };

  const remove = async (id: string) => {
    setBusyId(id);
    setMessage('');
    try { await api.deletePaymentMethod(id); refresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not remove this card.'); }
    finally { setBusyId(''); }
  };

  const makeDefault = async (id: string) => {
    setBusyId(id);
    setMessage('');
    try { await api.setDefaultPaymentMethod(id); refresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not update your default card.'); }
    finally { setBusyId(''); }
  };

  return <div className="content-page">
    <div className="dash-header">
      <div><p className="eyebrow">CARDS ON FILE</p><h1>Payment methods</h1><p className="muted">Save a card once, reuse it for every future booking.</p></div>
      {!adding && <button className="button" onClick={startAdding}><Plus size={16} /> Add a card</button>}
    </div>

    <div className="dash-panel">
      {!stripePromise ? (
        <p className="muted">Payments aren't configured yet — set VITE_STRIPE_PUBLISHABLE_KEY in the frontend .env.</p>
      ) : adding ? (
        !clientSecret ? <p className="muted">Preparing…</p> : (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: { variables: { colorPrimary: '#FF5A36', fontFamily: 'Manrope, sans-serif' } } }}>
            <SetupForm onDone={finishAdding} onCancel={cancelAdding} />
          </Elements>
        )
      ) : loading ? (
        <Loading />
      ) : methods.length === 0 ? (
        <p className="muted">No saved cards yet — add one to speed up checkout.</p>
      ) : (
        <div>
          {methods.map((m) => (
            <div key={m.id} className="list-card">
              <div className="list-card-main">
                <strong style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'capitalize' }}>
                  <CreditCard size={16} /> {m.brand} •••• {m.last4}
                  {m.isDefault && <span className="badge-status confirmed">Default</span>}
                </strong>
                <span>Expires {String(m.expMonth).padStart(2, '0')}/{m.expYear}</span>
              </div>
              <div className="list-card-actions">
                {!m.isDefault && <button className="btn-outline" disabled={busyId === m.id} onClick={() => makeDefault(m.id)}><Star size={14} /> Make default</button>}
                <button className="btn-outline danger" disabled={busyId === m.id} onClick={() => remove(m.id)}><Trash2 size={14} /> Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {message && <p className="form-message">{message}</p>}
    </div>
  </div>;
}
