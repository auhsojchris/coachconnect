import { useEffect, useState } from 'react';
import { Flag, ShieldCheck } from 'lucide-react';
import { api, Payment, Review, Role, SportCategory, User } from '../services/api';
import { Loading } from '../components/shared';
import Overview from './AdminOverview';
import PayoutsPanel from './AdminPayouts';

type Tab = 'overview' | 'payments' | 'users' | 'categories' | 'reviews' | 'commissions' | 'payouts' | 'settings';

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>('overview');
  return <div className="content-page">
    <div className="dash-header"><div><p className="eyebrow">ADMIN COMMAND CENTER</p><h1>System overview</h1><p className="muted">A clear view of what is moving through CoachConnect.</p></div></div>
    <div className="tab-strip">
      {(['overview', 'payments', 'users', 'categories', 'reviews', 'commissions', 'payouts', 'settings'] as Tab[]).map((t) => (
        <button key={t} className={`tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
      ))}
    </div>
    {tab === 'overview' && <Overview onNavigate={setTab} />}
    {tab === 'payments' && <QrPaymentsPanel />}
    {tab === 'users' && <UsersPanel />}
    {tab === 'categories' && <CategoriesPanel />}
    {tab === 'reviews' && <ReviewsPanel />}
    {tab === 'commissions' && <CommissionsPanel />}
    {tab === 'payouts' && <PayoutsPanel />}
    {tab === 'settings' && <SettingsPanel />}
  </div>;
}

/** One client checkout paid with one QR transfer: all its sessions resolve together. */
type QrGroup = { key: string; payments: Payment[]; total: number };

function QrPaymentsPanel() {
  const [status, setStatus] = useState<'submitted' | 'paid' | 'failed' | 'all'>('submitted');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [message, setMessage] = useState('');

  const refresh = () => {
    setLoading(true);
    api.adminQrPayments(status).then((r) => setPayments(r.data || [])).catch((e) => setMessage(e instanceof Error ? e.message : 'Could not load payments.')).finally(() => setLoading(false));
  };
  useEffect(refresh, [status]);

  const groups = Object.values(payments.reduce<Record<string, QrGroup>>((acc, p) => {
    const key = `${p.booking?.checkoutId || p.id}:${p.gcashReference}:${p.status}`;
    acc[key] ||= { key, payments: [], total: 0 };
    acc[key].payments.push(p);
    acc[key].total = Math.round((acc[key].total + Number(p.amount)) * 100) / 100;
    return acc;
  }, {}));

  const resolve = async (group: QrGroup, action: 'confirm' | 'reject') => {
    const verb = action === 'confirm' ? 'Confirm' : 'Reject';
    if (!confirm(`${verb} ₱${group.total.toLocaleString()} (ref ${group.payments[0].gcashReference}) for ${group.payments.length} session(s)?${action === 'confirm' ? ' Only do this once you see the money in the account.' : ''}`)) return;
    setBusyKey(group.key);
    setMessage('');
    try {
      const id = group.payments[0].id;
      await (action === 'confirm' ? api.confirmGcashPayment(id) : api.rejectGcashPayment(id));
      setMessage(action === 'confirm' ? 'Payment confirmed — the sessions are booked and the coach payout is queued.' : 'Payment rejected — the client has been notified.');
      refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'That didn’t go through.');
    } finally { setBusyKey(''); }
  };

  return <div className="dash-panel">
    <p className="muted" style={{ fontSize: '.8rem', marginBottom: 14 }}>Payments clients sent to the platform QR. Check each reference number in your GCash/bank history, then confirm it — that books every session in the checkout and queues the coach’s payout.</p>
    <div className="filter-bar">
      <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
        <option value="submitted">To verify</option>
        <option value="paid">Confirmed</option>
        <option value="failed">Rejected</option>
        <option value="all">All</option>
      </select>
    </div>
    {message && <p className="form-message">{message}</p>}
    {loading ? <Loading /> : groups.length === 0 ? <p className="muted">{status === 'submitted' ? 'Nothing waiting for verification.' : 'No payments to show.'}</p> : (
      <table className="data-table">
        <thead><tr><th>Submitted</th><th>Client</th><th>Coach</th><th>Sessions</th><th>Reference</th><th>Amount</th><th></th></tr></thead>
        <tbody>
          {groups.map((g) => {
            const first = g.payments[0];
            return <tr key={g.key}>
              <td className="muted" style={{ whiteSpace: 'nowrap' }}>{first.updatedAt ? new Date(first.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
              <td><strong>{first.booking?.client?.name || '—'}</strong><br /><span className="muted">{first.booking?.client?.email}</span></td>
              <td>{first.booking?.coach?.user?.name || '—'}</td>
              <td style={{ fontSize: '.8rem' }}>{g.payments.map((p) => <div key={p.id}>{p.booking?.timeSlot ? `${p.booking.timeSlot.date} ${p.booking.timeSlot.startTime.slice(0, 5)}` : '—'}</div>)}</td>
              <td className="mono">{first.gcashReference}</td>
              <td className="mono"><strong>₱{g.total.toLocaleString()}</strong></td>
              <td style={{ textAlign: 'right' }}>
                {first.status === 'submitted' ? <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn-outline" disabled={busyKey === g.key} onClick={() => resolve(g, 'confirm')}>Confirm</button>
                  <button className="btn-outline danger" disabled={busyKey === g.key} onClick={() => resolve(g, 'reject')}>Reject</button>
                </div> : <span className={`badge-status ${first.status === 'paid' ? 'confirmed' : 'cancelled'}`}>{first.status === 'paid' ? 'confirmed' : 'rejected'}</span>}
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    )}
  </div>;
}

function UsersPanel() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'client' as Role });
  const [createMessage, setCreateMessage] = useState('');

  const refresh = () => { setLoading(true); api.adminUsers({ search: search || undefined, role: (role || undefined) as Role | undefined }).then((r) => setUsers(r.data)).finally(() => setLoading(false)); };
  useEffect(refresh, []);

  const toggleActive = async (u: User) => { await api.adminUpdateUser(u.id, { isActive: !u.isActive }); refresh(); };
  const remove = async (u: User) => { if (!confirm(`Delete ${u.name}? This cannot be undone.`)) return; try { await api.adminDeleteUser(u.id); refresh(); } catch (e) { alert(e instanceof Error ? e.message : 'Could not delete user.'); } };
  const verify = async (u: User) => { if (!u.coachProfile) return; await api.adminVerifyCoach(u.coachProfile.id, !u.coachProfile.isVerified); refresh(); };
  const addUser = async (event: React.FormEvent) => {
    event.preventDefault();
    try { await api.adminCreateUser(newUser); setNewUser({ name: '', email: '', password: '', role: 'client' }); setCreateMessage('User created.'); refresh(); }
    catch (error) { setCreateMessage(error instanceof Error ? error.message : 'Could not create user.'); }
  };

  return <div className="dash-panel">
    <form onSubmit={addUser} className="mini-form" style={{ marginBottom: 24 }}>
      <label>Name<input required value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} /></label>
      <label>Email<input required type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} /></label>
      <label>Temporary password<input required minLength={8} value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} /></label>
      <label>Role<select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value as Role })}><option value="client">Athlete</option><option value="coach">Coach</option><option value="admin">Admin</option></select></label>
      <button className="button" type="submit">Add user</button>
      {createMessage && <p className="form-message" style={{ gridColumn: '1 / -1' }}>{createMessage}</p>}
    </form>
    <div className="filter-bar">
      <input placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && refresh()} />
      <select value={role} onChange={(e) => { setRole(e.target.value); }}>
        <option value="">All roles</option>
        <option value="client">Athletes</option>
        <option value="coach">Coaches</option>
        <option value="admin">Admins</option>
      </select>
      <button className="btn-outline" onClick={refresh}>Filter</button>
    </div>
    {loading ? <Loading /> : (
      <table className="data-table">
        <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Coach</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td><strong>{u.name}</strong><br /><span className="muted">{u.email}</span></td>
              <td style={{ textTransform: 'capitalize' }}>{u.role?.name}</td>
              <td><span className={`badge-status ${u.isActive ? 'confirmed' : 'cancelled'}`}>{u.isActive ? 'active' : 'suspended'}</span></td>
              <td>{u.coachProfile ? <span className={`badge-status ${u.coachProfile.isVerified ? 'confirmed' : 'pending'}`}>{u.coachProfile.isVerified ? 'verified' : 'unverified'}</span> : '—'}</td>
              <td style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                {u.coachProfile && <button className="btn-outline" onClick={() => verify(u)}><ShieldCheck size={14} /> {u.coachProfile.isVerified ? 'Unverify' : 'Verify'}</button>}
                <button className="btn-outline" disabled={u.role?.name === 'admin'} title={u.role?.name === 'admin' ? 'Admins cannot be suspended' : undefined} onClick={() => toggleActive(u)}>{u.isActive ? 'Suspend' : 'Reactivate'}</button>
                <button className="btn-outline danger" disabled={u.role?.name === 'admin'} title={u.role?.name === 'admin' ? 'Admins cannot be deleted' : undefined} onClick={() => remove(u)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>;
}

function CategoriesPanel() {
  const [categories, setCategories] = useState<SportCategory[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = () => { setLoading(true); api.sportCategories().then((r) => setCategories(r.data)).finally(() => setLoading(false)); };
  useEffect(refresh, []);

  const add = async (e: React.FormEvent) => { e.preventDefault(); if (!name.trim()) return; await api.createSportCategory({ name }); setName(''); refresh(); };
  const toggleActive = async (c: SportCategory) => { await api.updateSportCategory(c.id, { isActive: !c.isActive }); refresh(); };
  const remove = async (c: SportCategory) => { if (!confirm(`Delete ${c.name}?`)) return; try { await api.deleteSportCategory(c.id); refresh(); } catch (e) { alert(e instanceof Error ? e.message : 'Could not delete category.'); } };

  return <div className="dash-panel">
    <form onSubmit={add} className="filter-bar">
      <input placeholder="New sport category name…" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="button" type="submit">Add category</button>
    </form>
    {loading ? <Loading /> : (
      <table className="data-table">
        <thead><tr><th>Name</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td><span className={`badge-status ${c.isActive ? 'confirmed' : 'cancelled'}`}>{c.isActive ? 'active' : 'inactive'}</span></td>
              <td style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn-outline" onClick={() => toggleActive(c)}>{c.isActive ? 'Deactivate' : 'Activate'}</button>
                <button className="btn-outline danger" onClick={() => remove(c)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>;
}

function CommissionsPanel() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [totalOwed, setTotalOwed] = useState(0);
  const [onlyUnsettled, setOnlyUnsettled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const refresh = () => {
    setLoading(true);
    api.adminGcashCommissions(onlyUnsettled ? { settled: false } : {})
      .then((r) => { setPayments(r.data); setTotalOwed(r.meta?.totalOwed || 0); })
      .finally(() => setLoading(false));
  };
  useEffect(refresh, [onlyUnsettled]);

  const toggleSettled = async (p: Payment) => {
    setBusyId(p.id);
    try { await api.adminSettleGcashCommission(p.id, !p.platformFeeSettled); refresh(); }
    finally { setBusyId(''); }
  };

  return <div className="dash-panel">
    <div className="filter-bar" style={{ justifyContent: 'space-between' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, width: 'auto', margin: 0 }}>
        <input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={onlyUnsettled} onChange={(e) => setOnlyUnsettled(e.target.checked)} /> Unsettled only
      </label>
      {!onlyUnsettled && <strong className="mono">₱{totalOwed.toLocaleString()} still owed</strong>}
    </div>
    {loading ? <Loading /> : payments.length === 0 ? <p className="muted">No GCash commissions to show.</p> : (
      <table className="data-table">
        <thead><tr><th>Coach</th><th>Client</th><th>Booking amount</th><th>Commission</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td>{p.booking?.coach?.user?.name || '—'}</td>
              <td>{p.booking?.client?.name || '—'}</td>
              <td className="mono">₱{Number(p.amount).toLocaleString()}</td>
              <td className="mono">₱{Number(p.platformFeeAmount || 0).toLocaleString()}</td>
              <td><span className={`badge-status ${p.platformFeeSettled ? 'confirmed' : 'pending'}`}>{p.platformFeeSettled ? 'settled' : 'owed'}</span></td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn-outline" disabled={busyId === p.id} onClick={() => toggleSettled(p)}>{p.platformFeeSettled ? 'Mark unsettled' : 'Mark settled'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>;
}

function SettingsPanel() {
  const [form, setForm] = useState({ gcashNumber: '', gcashAccountName: '' });
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrMessage, setQrMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.profile()
      .then((r) => { setForm({ gcashNumber: r.data.gcashNumber || '', gcashAccountName: r.data.gcashAccountName || '' }); setQrUrl(r.data.gcashQrUrl || null); })
      .finally(() => setLoading(false));
  }, []);

  const uploadQr = async (file: File | undefined) => {
    if (!file) return;
    setQrBusy(true);
    setQrMessage('');
    try {
      const r = await api.uploadGcashQr(file);
      setQrUrl(r.data.gcashQrUrl);
      setQrMessage('QR uploaded — clients now pay by scanning it at checkout.');
    } catch (err) {
      setQrMessage(err instanceof Error ? err.message : 'Could not upload the QR.');
    } finally { setQrBusy(false); }
  };

  const removeQr = async () => {
    if (!confirm('Remove the payment QR? Checkout will fall back to the card/GCash options.')) return;
    setQrBusy(true);
    try { await api.removeGcashQr(); setQrUrl(null); setQrMessage('QR removed.'); }
    catch (err) { setQrMessage(err instanceof Error ? err.message : 'Could not remove the QR.'); }
    finally { setQrBusy(false); }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api.updateProfile(form);
      setMessage('Settings saved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save changes.');
    } finally { setBusy(false); }
  };

  if (loading) return <Loading />;

  return <div className="dash-panel" style={{ maxWidth: 520 }}>
    <p className="eyebrow" style={{ marginBottom: 6 }}>CHECKOUT PAYMENT QR</p>
    <p className="muted" style={{ fontSize: '.8rem', marginBottom: 14 }}>Upload your GCash/InstaPay QR (GCash → Profile → My QR → Download). Clients scan it to pay at checkout, then you verify their reference number in the Payments tab.</p>
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 24 }}>
      {qrUrl
        ? <img src={qrUrl} alt="Current payment QR" style={{ width: 160, borderRadius: 8, border: '1px solid var(--line)', background: '#fff' }} />
        : <div className="muted" style={{ width: 160, height: 160, border: '1.5px dashed var(--line)', borderRadius: 8, display: 'grid', placeItems: 'center', fontSize: '.75rem', textAlign: 'center', padding: 10 }}>No QR yet — checkout uses card/GCash tabs</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label className="btn-outline" style={{ cursor: qrBusy ? 'wait' : 'pointer', width: 'auto', margin: 0 }}>
          {qrBusy ? 'Uploading…' : qrUrl ? 'Replace QR image' : 'Upload QR image'}
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={qrBusy} style={{ display: 'none' }} onChange={(e) => { uploadQr(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {qrUrl && <button type="button" className="btn-outline danger" disabled={qrBusy} onClick={removeQr}>Remove QR</button>}
      </div>
    </div>
    {qrMessage && <p className="form-message" style={{ marginTop: -12, marginBottom: 20 }}>{qrMessage}</p>}

    <p className="eyebrow" style={{ marginBottom: 6 }}>PLATFORM GCASH ACCOUNT</p>
    <p className="muted" style={{ fontSize: '.8rem', marginBottom: 16 }}>Shown under the QR at checkout, and to coaches settling owed commission.</p>
    <form onSubmit={save}>
      <div className="mini-form">
        <label>GCash number<input value={form.gcashNumber} onChange={(e) => setForm({ ...form, gcashNumber: e.target.value })} placeholder="e.g. 0917 000 0000" /></label>
        <label>GCash account name<input value={form.gcashAccountName} onChange={(e) => setForm({ ...form, gcashAccountName: e.target.value })} placeholder="Name on the GCash account" /></label>
      </div>
      {message && <p className="form-message">{message}</p>}
      <button className="button" type="submit" disabled={busy} style={{ marginTop: 16 }}>{busy ? 'Saving…' : 'Save changes'}</button>
    </form>
  </div>;
}

function ReviewsPanel() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [loading, setLoading] = useState(true);
  const refresh = () => { setLoading(true); api.adminReviews(onlyFlagged ? { flagged: true } : {}).then((r) => setReviews(r.data)).finally(() => setLoading(false)); };
  useEffect(refresh, [onlyFlagged]);

  const setApproved = async (r: Review, isApproved: boolean) => { await api.moderateReview(r.id, { isApproved, isFlagged: false }); refresh(); };
  const remove = async (r: Review) => { if (!confirm('Delete this review?')) return; await api.deleteReview(r.id); refresh(); };

  return <div className="dash-panel">
    <div className="filter-bar">
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, width: 'auto', margin: 0 }}>
        <input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> Flagged only
      </label>
    </div>
    {loading ? <Loading /> : reviews.length === 0 ? <p className="muted">Nothing to moderate right now.</p> : (
      <div>
        {reviews.map((r) => (
          <div key={r.id} className="list-card">
            <div className="list-card-main">
              <strong>{r.client?.name} → {r.coach?.user?.name}</strong>
              <span>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)} · {new Date(r.createdAt).toLocaleDateString()}</span>
              {r.comment && <span>{r.comment}</span>}
              {r.isFlagged && <span style={{ color: '#c94c41', display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}><Flag size={13} /> Flagged{r.flagReason ? `: ${r.flagReason}` : ''}</span>}
            </div>
            <div className="list-card-actions">
              <span className={`badge-status ${r.isApproved ? 'confirmed' : 'pending'}`}>{r.isApproved ? 'approved' : 'unapproved'}</span>
              {!r.isApproved && <button className="btn-outline" onClick={() => setApproved(r, true)}>Approve</button>}
              {r.isApproved && <button className="btn-outline" onClick={() => setApproved(r, false)}>Unapprove</button>}
              <button className="btn-outline danger" onClick={() => remove(r)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>;
}
