import { useState } from 'react';
import { Star } from 'lucide-react';
import { api } from '../services/api';

export default function ReviewForm({ bookingId, onDone, onCancel }: { bookingId: string; onDone: () => void; onCancel: () => void }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.createReview({ bookingId, rating, comment });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit review.');
    } finally {
      setBusy(false);
    }
  };

  return <form onSubmit={submit} className="checkout-box">
    <label style={{ marginBottom: 6 }}>Rate this session</label>
    <div className="review-stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={26} className={n <= rating ? 'active' : ''} onClick={() => setRating(n)} />
      ))}
    </div>
    <label>Comment (optional)<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="How did the session go?" /></label>
    {error && <p className="error-text">{error}</p>}
    <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
      <button className="button" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit review'}</button>
      <button className="text-btn" type="button" onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}
