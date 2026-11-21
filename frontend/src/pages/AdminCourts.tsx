import { useEffect, useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { api, Court } from '../services/api';
import { Loading } from '../components/shared';

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function CourtRow({ court, busy, onSave, onToggle, onDelete }: {
  court: Court; busy: boolean;
  onSave: (c: Court, name: string, address: string) => Promise<boolean>;
  onToggle: (c: Court) => void;
  onDelete: (c: Court) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(court.name);
  const [address, setAddress] = useState(court.address || '');
  const startEdit = () => { setName(court.name); setAddress(court.address || ''); setEditing(true); };
  const save = async () => { if (await onSave(court, name, address)) setEditing(false); };
  const used = court.bookingCount || 0;

  if (editing) {
    return <tr>
      <td><input value={name} onChange={(e) => setName(e.target.value)} aria-label="Court name" maxLength={120} autoFocus onKeyDown={(e) => e.key === 'Enter' && save()} /></td>
      <td><input value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Address" maxLength={255} placeholder="Address (optional)" onKeyDown={(e) => e.key === 'Enter' && save()} /></td>
      <td className="mono">{used}</td>
      <td><span className={`badge-status ${court.isActive ? 'confirmed' : 'cancelled'}`}>{court.isActive ? 'active' : 'inactive'}</span></td>
      <td><div className="ct-actions">
        <button className="btn-outline" disabled={busy || !name.trim()} onClick={save}>Save</button>
        <button className="text-btn" style={{ color: 'var(--slate)' }} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
      </div></td>
    </tr>;
  }

  return <tr className={court.isActive ? '' : 'ct-inactive'}>
    <td><strong>{court.name}</strong></td>
    <td className="muted">{court.address || '—'}</td>
    <td className="mono">{used}</td>
    <td className="ct-keep"><span className={`badge-status ${court.isActive ? 'confirmed' : 'cancelled'}`}>{court.isActive ? 'active' : 'inactive'}</span></td>
    <td className="ct-keep"><div className="ct-actions">
      <button className="btn-outline" disabled={busy} onClick={startEdit}>Edit</button>
      <button className="btn-outline" disabled={busy} onClick={() => onToggle(court)}>{court.isActive ? 'Deactivate' : 'Activate'}</button>
      <button className="btn-outline danger" disabled={busy || used > 0} onClick={() => onDelete(court)}
        title={used > 0 ? `Used by ${used} booking${used === 1 ? '' : 's'} — deactivate it instead` : 'Delete this court'}>Delete</button>
    </div></td>
  </tr>;
}

export default function CourtsPanel() {
  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = () => api.adminCourts()
    .then((r) => setCourts(r.data))
    .catch((e) => setError(errorText(e, 'Could not load courts.')))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try { await fn(); await load(); setNotice(success); return true; }
    catch (e) { setError(errorText(e, 'That didn’t go through.')); return false; }
    finally { setBusy(false); }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (await run(() => api.createCourt({ name: name.trim(), address: address.trim() || undefined }), `Added ${name.trim()}.`)) { setName(''); setAddress(''); }
  };
  const save = (c: Court, newName: string, newAddress: string) =>
    run(() => api.updateCourt(c.id, { name: newName.trim(), address: newAddress.trim() }), `Saved ${newName.trim()}.`);
  const toggle = (c: Court) => {
    if (c.isActive && activeCount === 1 && !window.confirm(`${c.name} is the only active court. Deactivating it means clients can book without choosing a court. Continue?`)) return;
    run(() => api.updateCourt(c.id, { isActive: !c.isActive }), c.isActive ? `${c.name} is hidden from clients.` : `${c.name} is available to clients again.`);
  };
  const remove = (c: Court) => {
    if (!window.confirm(`Delete ${c.name}? This cannot be undone.`)) return;
    run(() => api.deleteCourt(c.id), `Deleted ${c.name}.`);
  };

  const activeCount = courts.filter((c) => c.isActive).length;

  return <div className="dash-panel">
    <p className="muted" style={{ fontSize: '.8rem', marginBottom: 14 }}>
      <MapPin size={13} style={{ verticalAlign: '-2px' }} /> Courts clients can choose from when booking a coach.{' '}
      {activeCount > 0
        ? <>Clients must pick one of the <strong>{activeCount} active court{activeCount === 1 ? '' : 's'}</strong> for every booking.</>
        : <>With no active courts, clients book without choosing one.</>}
      {' '}A court that has bookings can't be deleted. Deactivate it to hide it from clients and keep it on past bookings.
    </p>

    <form className="ct-form" onSubmit={add}>
      <label>Court name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rizal Memorial Court 2" maxLength={120} required /></label>
      <label>Address <span className="muted" style={{ fontWeight: 400 }}>(optional)</span><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city" maxLength={255} /></label>
      <button className="button small" disabled={busy || !name.trim()}><Plus size={15} /> Add court</button>
    </form>

    {notice && <p className="po-notice" role="status" style={{ marginBottom: 12 }}>{notice}</p>}
    {error && <p className="error-text">{error}</p>}

    {loading ? <Loading /> : courts.length === 0
      ? <p className="muted">No courts yet. Add the first one above.</p>
      : <table className="data-table ct-table">
        <thead><tr><th>Name</th><th>Address</th><th>Bookings</th><th>Status</th><th /></tr></thead>
        <tbody>{courts.map((c) => <CourtRow key={c.id} court={c} busy={busy} onSave={save} onToggle={toggle} onDelete={remove} />)}</tbody>
      </table>}
  </div>;
}
