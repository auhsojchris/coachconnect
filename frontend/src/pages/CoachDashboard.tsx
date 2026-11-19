import { Fragment, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, Availability, CoachProfile, SportCategory, TimeSlot } from '../services/api';
import { Loading, ErrorMessage } from '../components/shared';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function useOwnCoach() {
  const [coach, setCoach] = useState<CoachProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    api.profile()
      .then((r) => { if (!r.data.coachProfile) throw new Error('No coach profile found on this account.'); setCoach(r.data.coachProfile); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load your coach profile.'))
      .finally(() => setLoading(false));
  }, []);
  return { coach, loading, error };
}

export function CoachAvailability() {
  const { coach, loading, error } = useOwnCoach();
  const [rules, setRules] = useState<Availability[]>([]);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [isRecurring, setIsRecurring] = useState(true);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [specificDate, setSpecificDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [genFor, setGenFor] = useState<string | null>(null);
  const [genFrom, setGenFrom] = useState('');
  const [genTo, setGenTo] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = (coachId: string) => api.availability(coachId).then((r) => { setRules(r.data.recurringRules); setSlots(r.data.timeSlots); });

  useEffect(() => { if (coach) refresh(coach.id); }, [coach]);

  if (loading) return <Loading />;
  if (error || !coach) return <ErrorMessage text={error || 'No coach profile found.'} />;

  const addRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api.createAvailability({ coachId: coach.id, isRecurring, dayOfWeek: isRecurring ? dayOfWeek : undefined, specificDate: isRecurring ? undefined : specificDate, startTime, endTime });
      await refresh(coach.id);
      setMessage('Availability window added.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not add that window.');
    } finally { setBusy(false); }
  };

  const removeRule = async (id: string) => { await api.deleteAvailability(id); await refresh(coach.id); };

  const generate = async (ruleId: string) => {
    if (!genFrom || !genTo) { setMessage('Pick a from/to date range first.'); return; }
    setBusy(true);
    try {
      const r = await api.generateSlots(ruleId, { from: genFrom, to: genTo, slotDurationMinutes: 60 });
      setMessage(`Generated ${r.data.count} bookable time slot(s).`);
      setGenFor(null);
      await refresh(coach.id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not generate slots.');
    } finally { setBusy(false); }
  };

  return <div className="content-page">
    <div className="dash-header"><div><p className="eyebrow">YOUR CALENDAR</p><h1>Availability</h1><p className="muted">Define recurring or one-off windows, then generate bookable slots from them.</p></div></div>

    <div className="dash-panel" style={{ marginBottom: 20 }}>
      <p className="eyebrow" style={{ marginBottom: 14 }}>ADD A WINDOW</p>
      <form onSubmit={addRule} className="mini-form">
        <label>Type
          <select value={isRecurring ? 'recurring' : 'one-off'} onChange={(e) => setIsRecurring(e.target.value === 'recurring')}>
            <option value="recurring">Recurring weekly</option>
            <option value="one-off">One-off date</option>
          </select>
        </label>
        {isRecurring ? (
          <label>Day of week
            <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>
        ) : (
          <label>Date<input type="date" value={specificDate} onChange={(e) => setSpecificDate(e.target.value)} required /></label>
        )}
        <label>Start time<input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required /></label>
        <label>End time<input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required /></label>
        <button className="button full" type="submit" disabled={busy} style={{ gridColumn: '1 / -1' }}><Plus size={16} /> Add window</button>
      </form>
      {message && <p className="form-message">{message}</p>}
    </div>

    <div className="dash-panel" style={{ marginBottom: 20 }}>
      <p className="eyebrow" style={{ marginBottom: 14 }}>YOUR WINDOWS</p>
      {rules.length === 0 ? <p className="muted">No availability windows yet — add one above.</p> : (
        <table className="data-table">
          <thead><tr><th>When</th><th>Time</th><th></th></tr></thead>
          <tbody>
            {rules.map((rule) => (
              <Fragment key={rule.id}>
                <tr>
                  <td>{rule.isRecurring ? WEEKDAYS[rule.dayOfWeek ?? 0] : rule.specificDate}</td>
                  <td className="mono">{rule.startTime}–{rule.endTime}</td>
                  <td style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn-outline" type="button" onClick={() => setGenFor(genFor === rule.id ? null : rule.id)}>Generate slots</button>
                    <button className="btn-outline danger" type="button" onClick={() => removeRule(rule.id)}><Trash2 size={14} /></button>
                  </td>
                </tr>
                {genFor === rule.id && (
                  <tr key={`${rule.id}-gen`}><td colSpan={3}>
                    <div className="mini-form" style={{ padding: '10px 0' }}>
                      <label>From<input type="date" value={genFrom} onChange={(e) => setGenFrom(e.target.value)} /></label>
                      <label>To<input type="date" value={genTo} onChange={(e) => setGenTo(e.target.value)} /></label>
                      <button className="button" type="button" disabled={busy} onClick={() => generate(rule.id)} style={{ gridColumn: '1 / -1' }}>Generate 60-min slots</button>
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>

    <div className="dash-panel">
      <p className="eyebrow" style={{ marginBottom: 14 }}>UPCOMING SLOTS</p>
      {slots.length === 0 ? <p className="muted">No open or booked slots yet — generate some above.</p> : (
        <table className="data-table">
          <thead><tr><th>Date</th><th>Time</th><th>Status</th></tr></thead>
          <tbody>{slots.slice(0, 30).map((s) => <tr key={s.id}><td>{s.date}</td><td className="mono">{s.startTime}–{s.endTime}</td><td><span className={`badge-status ${s.status}`}>{s.status}</span></td></tr>)}</tbody>
        </table>
      )}
    </div>
  </div>;
}

export function CoachProfileEditor() {
  const { coach, loading, error } = useOwnCoach();
  const [categories, setCategories] = useState<SportCategory[]>([]);
  const [form, setForm] = useState<{ bio: string; experienceYears: number; hourlyRate: number; location: string; city: string; country: string; gcashNumber: string; gcashAccountName: string; sportIds: string[] }>({ bio: '', experienceYears: 0, hourlyRate: 0, location: '', city: '', country: '', gcashNumber: '', gcashAccountName: '', sportIds: [] });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { api.sportCategories().then((r) => setCategories(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    if (!coach) return;
    setForm({
      bio: coach.bio || '', experienceYears: coach.experienceYears || 0, hourlyRate: coach.hourlyRate || 0,
      location: coach.location || '', city: coach.city || '', country: coach.country || '',
      gcashNumber: coach.gcashNumber || '', gcashAccountName: coach.gcashAccountName || '',
      sportIds: (coach.specializations || []).map((s) => s.sportCategoryId),
    });
  }, [coach]);

  if (loading) return <Loading />;
  if (error || !coach) return <ErrorMessage text={error || 'No coach profile found.'} />;

  const toggleSport = (id: string) => setForm((f) => ({ ...f, sportIds: f.sportIds.includes(id) ? f.sportIds.filter((s) => s !== id) : [...f.sportIds, id] }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api.updateCoach(coach.id, {
        bio: form.bio, experienceYears: form.experienceYears, hourlyRate: form.hourlyRate,
        location: form.location, city: form.city, country: form.country,
        gcashNumber: form.gcashNumber, gcashAccountName: form.gcashAccountName,
        specializations: form.sportIds.map((sportCategoryId) => ({ sportCategoryId })),
      });
      setMessage('Profile updated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save changes.');
    } finally { setBusy(false); }
  };

  return <div className="content-page">
    <div className="dash-header"><div><p className="eyebrow">HOW ATHLETES FIND YOU</p><h1>Profile & rates</h1></div></div>
    <form onSubmit={save} className="dash-panel">
      <div className="mini-form">
        <label className="full">Bio<textarea rows={4} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="Tell athletes about your coaching style..." /></label>
        <label>Hourly rate (PHP)<input type="number" min={0} step={1} value={form.hourlyRate} onChange={(e) => setForm({ ...form, hourlyRate: Number(e.target.value) })} /></label>
        <label>Years of experience<input type="number" min={0} value={form.experienceYears} onChange={(e) => setForm({ ...form, experienceYears: Number(e.target.value) })} /></label>
        <label>City<input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
        <label>Location / venue<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Riverside Courts" /></label>
        <label>Country<input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></label>
      </div>
      <p className="eyebrow" style={{ margin: '22px 0 10px' }}>GCASH PAYOUTS</p>
      <p className="muted" style={{ fontSize: '.8rem', marginBottom: 14 }}>Clients who pay via GCash send money straight to this number — set it up so you can get paid.</p>
      <div className="mini-form">
        <label>GCash number<input value={form.gcashNumber} onChange={(e) => setForm({ ...form, gcashNumber: e.target.value })} placeholder="e.g. 0917 000 0000" /></label>
        <label>GCash account name<input value={form.gcashAccountName} onChange={(e) => setForm({ ...form, gcashAccountName: e.target.value })} placeholder="Name on the GCash account" /></label>
      </div>
      <p className="eyebrow" style={{ margin: '22px 0 10px' }}>SPORTS YOU COACH</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {categories.map((c) => (
          <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, width: 'auto', border: '1px solid var(--line)', padding: '8px 12px', margin: 0, cursor: 'pointer', background: form.sportIds.includes(c.id) ? '#f1f5f3' : 'transparent' }}>
            <input type="checkbox" style={{ width: 'auto', margin: 0, padding: 0 }} checked={form.sportIds.includes(c.id)} onChange={() => toggleSport(c.id)} /> {c.name}
          </label>
        ))}
      </div>
      {message && <p className="form-message">{message}</p>}
      <button className="button" type="submit" disabled={busy} style={{ marginTop: 20 }}>{busy ? 'Saving…' : 'Save changes'}</button>
    </form>
  </div>;
}
