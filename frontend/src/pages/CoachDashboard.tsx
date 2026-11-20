import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Plus, Trash2 } from 'lucide-react';
import { api, Availability, CoachProfile, SKILL_LEVELS, SkillLevel, SportCategory, TimeSlot } from '../services/api';
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

const LEVEL_LABELS: Record<SkillLevel, { label: string; hint: string }> = {
  beginner: { label: 'Beginner', hint: 'Never played / just starting' },
  novice: { label: 'Novice', hint: 'Knows the basics, building habits' },
  intermediate: { label: 'Intermediate', hint: 'Plays regularly, refining technique' },
  advanced: { label: 'Advanced', hint: 'Competitive / tournament level' },
};

type SportRow = { sportCategoryId: string; certification: string; yearsExperience: number };
type AchievementRow = { title: string; year: string; description: string };
type EditorForm = {
  tagline: string; bio: string; experienceYears: number; hourlyRate: number;
  location: string; city: string; country: string;
  gcashNumber: string; gcashAccountName: string;
  skillLevels: SkillLevel[]; sports: SportRow[]; achievements: AchievementRow[];
};

const chipStyle = (on: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'flex-start', gap: 8, width: 'auto', margin: 0, cursor: 'pointer',
  border: `1.5px solid ${on ? 'var(--turf)' : 'var(--line)'}`, borderRadius: 8, padding: '10px 12px',
  background: on ? '#f1f5f3' : 'transparent',
});

function Section({ eyebrow, hint, children }: { eyebrow: string; hint?: string; children: React.ReactNode }) {
  return <div className="dash-panel" style={{ marginBottom: 20 }}>
    <p className="eyebrow" style={{ marginBottom: hint ? 6 : 14 }}>{eyebrow}</p>
    {hint && <p className="muted" style={{ fontSize: '.8rem', marginBottom: 14 }}>{hint}</p>}
    {children}
  </div>;
}

export function CoachProfileEditor() {
  const { coach, loading, error } = useOwnCoach();
  const [categories, setCategories] = useState<SportCategory[]>([]);
  const [form, setForm] = useState<EditorForm>({
    tagline: '', bio: '', experienceYears: 0, hourlyRate: 0, location: '', city: '', country: '',
    gcashNumber: '', gcashAccountName: '', skillLevels: [], sports: [], achievements: [],
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { api.sportCategories().then((r) => setCategories(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    if (!coach) return;
    setForm({
      tagline: coach.tagline || '', bio: coach.bio || '',
      experienceYears: coach.experienceYears || 0, hourlyRate: Number(coach.hourlyRate) || 0,
      location: coach.location || '', city: coach.city || '', country: coach.country || '',
      gcashNumber: coach.gcashNumber || '', gcashAccountName: coach.gcashAccountName || '',
      skillLevels: coach.skillLevels || [],
      sports: (coach.specializations || []).map((s) => ({ sportCategoryId: s.sportCategoryId, certification: s.certification || '', yearsExperience: s.yearsExperience || 0 })),
      achievements: (coach.achievements || []).map((a) => ({ title: a.title, year: a.year ? String(a.year) : '', description: a.description || '' })),
    });
  }, [coach]);

  if (loading) return <Loading />;
  if (error || !coach) return <ErrorMessage text={error || 'No coach profile found.'} />;

  const set = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const toggleLevel = (level: SkillLevel) => set('skillLevels', form.skillLevels.includes(level) ? form.skillLevels.filter((l) => l !== level) : [...form.skillLevels, level]);

  const toggleSport = (id: string) => set('sports', form.sports.some((s) => s.sportCategoryId === id)
    ? form.sports.filter((s) => s.sportCategoryId !== id)
    : [...form.sports, { sportCategoryId: id, certification: '', yearsExperience: 0 }]);
  const updateSport = (id: string, patch: Partial<SportRow>) => set('sports', form.sports.map((s) => (s.sportCategoryId === id ? { ...s, ...patch } : s)));

  const addAchievement = () => set('achievements', [...form.achievements, { title: '', year: '', description: '' }]);
  const updateAchievement = (i: number, patch: Partial<AchievementRow>) => set('achievements', form.achievements.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const removeAchievement = (i: number) => set('achievements', form.achievements.filter((_, idx) => idx !== i));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api.updateCoach(coach.id, {
        tagline: form.tagline, bio: form.bio, experienceYears: form.experienceYears, hourlyRate: form.hourlyRate,
        location: form.location, city: form.city, country: form.country,
        gcashNumber: form.gcashNumber, gcashAccountName: form.gcashAccountName,
        skillLevels: form.skillLevels,
        specializations: form.sports.map((s) => ({ sportCategoryId: s.sportCategoryId, certification: s.certification.trim() || undefined, yearsExperience: s.yearsExperience })),
        // Drop rows the coach added but left blank instead of failing validation.
        achievements: form.achievements.filter((a) => a.title.trim()).map((a) => ({ title: a.title.trim(), year: a.year ? Number(a.year) : null, description: a.description.trim() || null })),
      });
      setMessage('Profile updated — athletes will see these changes on your public page.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save changes.');
    } finally { setBusy(false); }
  };

  return <div className="content-page">
    <div className="dash-header">
      <div><p className="eyebrow">HOW ATHLETES FIND YOU</p><h1>Coach profile</h1><p className="muted">Everything here appears on your public coach page.</p></div>
      <Link className="btn-outline" to={`/coaches/${coach.id}`}><Eye size={15} /> View public page</Link>
    </div>
    <form onSubmit={save}>
      <Section eyebrow="BASICS">
        <div className="mini-form">
          <label className="full">Tagline<input maxLength={120} value={form.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="e.g. Former varsity setter helping beginners love volleyball" /></label>
          <label className="full">Bio<textarea rows={4} value={form.bio} onChange={(e) => set('bio', e.target.value)} placeholder="Tell athletes about your coaching style..." /></label>
          <label>Years of coaching experience<input type="number" min={0} max={60} value={form.experienceYears} onChange={(e) => set('experienceYears', Number(e.target.value))} /></label>
          <label>City<input value={form.city} onChange={(e) => set('city', e.target.value)} /></label>
          <label>Location / venue<input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Riverside Courts" /></label>
          <label>Country<input value={form.country} onChange={(e) => set('country', e.target.value)} /></label>
        </div>
      </Section>

      <Section eyebrow="RATES">
        <div className="mini-form">
          <label>Rate per session (PHP)<input type="number" min={0} step={1} value={form.hourlyRate} onChange={(e) => set('hourlyRate', Number(e.target.value))} /></label>
        </div>
      </Section>

      <Section eyebrow="LEVELS YOU COACH" hint="Pick every level you’re comfortable taking on. Athletes see this before booking.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          {SKILL_LEVELS.map((level) => (
            <label key={level} style={chipStyle(form.skillLevels.includes(level))}>
              <input type="checkbox" style={{ width: 'auto', margin: '3px 0 0', padding: 0 }} checked={form.skillLevels.includes(level)} onChange={() => toggleLevel(level)} />
              <span><strong>{LEVEL_LABELS[level].label}</strong><br /><small className="muted">{LEVEL_LABELS[level].hint}</small></span>
            </label>
          ))}
        </div>
      </Section>

      <Section eyebrow="SPORTS & CERTIFICATIONS" hint="Select the sports you coach, then add any certification and years of experience for each.">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: form.sports.length ? 16 : 0 }}>
          {categories.map((c) => {
            const on = form.sports.some((s) => s.sportCategoryId === c.id);
            return <label key={c.id} style={{ ...chipStyle(on), alignItems: 'center' }}>
              <input type="checkbox" style={{ width: 'auto', margin: 0, padding: 0 }} checked={on} onChange={() => toggleSport(c.id)} /> {c.name}
            </label>;
          })}
        </div>
        {form.sports.map((s) => (
          <div key={s.sportCategoryId} className="mini-form" style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 12 }}>
            <p style={{ gridColumn: '1 / -1', fontWeight: 700 }}>{categories.find((c) => c.id === s.sportCategoryId)?.name || 'Sport'}</p>
            <label>Certification<input maxLength={150} value={s.certification} onChange={(e) => updateSport(s.sportCategoryId, { certification: e.target.value })} placeholder="e.g. PSC Level 2 Coach" /></label>
            <label>Years coaching this sport<input type="number" min={0} max={60} value={s.yearsExperience} onChange={(e) => updateSport(s.sportCategoryId, { yearsExperience: Number(e.target.value) })} /></label>
          </div>
        ))}
      </Section>

      <Section eyebrow="ACHIEVEMENTS" hint="Titles, medals, notable athletes you’ve coached — anything that builds trust.">
        {form.achievements.length === 0 && <p className="muted" style={{ marginBottom: 12 }}>No achievements yet.</p>}
        {form.achievements.map((a, i) => (
          <div key={i} className="mini-form" style={{ borderTop: i ? '1px solid var(--line)' : 0, paddingTop: i ? 12 : 0, marginBottom: 12, gridTemplateColumns: '1fr 120px auto', alignItems: 'end' }}>
            <label>Title<input maxLength={120} value={a.title} onChange={(e) => updateAchievement(i, { title: e.target.value })} placeholder="e.g. UAAP Season 85 Champion" /></label>
            <label>Year<input type="number" min={1950} max={2100} value={a.year} onChange={(e) => updateAchievement(i, { year: e.target.value })} placeholder="2023" /></label>
            <button type="button" className="btn-outline danger" onClick={() => removeAchievement(i)} aria-label="Remove achievement"><Trash2 size={14} /></button>
            <label style={{ gridColumn: '1 / -1' }}>Details (optional)<input maxLength={300} value={a.description} onChange={(e) => updateAchievement(i, { description: e.target.value })} /></label>
          </div>
        ))}
        {form.achievements.length < 20 && <button type="button" className="btn-outline" onClick={addAchievement}><Plus size={14} /> Add achievement</button>}
      </Section>

      <Section eyebrow="GCASH PAYOUTS" hint="Private — never shown on your public page. Used to pay out your earnings.">
        <div className="mini-form">
          <label>GCash number<input value={form.gcashNumber} onChange={(e) => set('gcashNumber', e.target.value)} placeholder="e.g. 0917 000 0000" /></label>
          <label>GCash account name<input value={form.gcashAccountName} onChange={(e) => set('gcashAccountName', e.target.value)} placeholder="Name on the GCash account" /></label>
        </div>
      </Section>

      {message && <p className="form-message">{message}</p>}
      <button className="button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
    </form>
  </div>;
}

/** Share of the public-profile fields a coach has filled in, for the overview nudge. */
export function profileChecklist(coach: CoachProfile | null | undefined) {
  const items = [
    { label: 'Write a tagline', done: !!coach?.tagline },
    { label: 'Add a bio', done: !!coach?.bio },
    { label: 'Set your session rate', done: Number(coach?.hourlyRate) > 0 },
    { label: 'Choose the levels you coach', done: (coach?.skillLevels?.length || 0) > 0 },
    { label: 'Pick your sports', done: (coach?.specializations?.length || 0) > 0 },
    { label: 'Add an achievement', done: (coach?.achievements?.length || 0) > 0 },
  ];
  return { items, percent: Math.round((items.filter((i) => i.done).length / items.length) * 100) };
}
