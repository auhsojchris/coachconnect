import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Search } from 'lucide-react';
import { api, CoachCommissions, CommissionsByCoach, FinanceDays, PaidPayments, PaidTransaction } from '../services/api';
import { Loading } from '../components/shared';
import { peso, Seg } from './AdminPayouts';

const METHOD_LABEL: Record<string, string> = { platform_qr: 'Platform QR', gcash: 'GCash (direct)', paymongo: 'PayMongo', stripe: 'Card' };
const methodLabel = (m: string) => METHOD_LABEL[m] || m;
const PERIODS: [FinanceDays, string][] = [[7, '7 days'], [30, '30 days'], [90, '90 days'], ['all', 'All time']];
const periodText = (d: FinanceDays) => (d === 'all' ? 'all time' : `last ${d} days`);
const when = (iso: string) => new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
const session = (date: string | null, time: string | null) => (date ? `${new Date(`${date}T00:00:00Z`).toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric' })}${time ? ` · ${time}` : ''}` : '—');

/** Debounce a text box so typing doesn't fire a request per keystroke. */
function useDebounced(value: string, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function saveCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------- Payments

export function PaymentsHistory() {
  const [days, setDays] = useState<FinanceDays>(30);
  const [method, setMethod] = useState('');
  const [query, setQuery] = useState('');
  const search = useDebounced(query.trim());
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaidPayments | null>(null);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setPage(1); }, [days, method, search]);
  useEffect(() => {
    setLoading(true);
    setError('');
    api.adminPaidPayments({ days, method, search, page, limit: 20 })
      .then((r) => { setData(r.data); setMeta({ total: r.meta.total, totalPages: r.meta.totalPages }); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load payments.'))
      .finally(() => setLoading(false));
  }, [days, method, search, page]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: PaidTransaction[] = [];
      for (let p = 1; ; p += 1) {
        const r = await api.adminPaidPayments({ days, method, search, page: p, limit: 100 });
        all.push(...r.data.transactions);
        if (p >= r.meta.totalPages) break;
      }
      saveCsv(`payments-${days === 'all' ? 'all-time' : `${days}d`}.csv`, [
        ['Paid on', 'Client', 'Client email', 'Coach', 'Method', 'Reference', 'Sessions', 'Session times', 'Amount', 'Commission'],
        ...all.map((t) => [when(t.paidAt), t.client?.name || '', t.client?.email || '', t.coach?.name || '', methodLabel(t.method), t.reference || '', t.sessions.length, t.sessions.map((s) => session(s.date, s.startTime)).join('; '), t.amount, t.commission]),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export.');
    } finally { setExporting(false); }
  };

  const s = data?.summary;
  return <section className="po fi-section">
    <header className="fi-head">
      <h2>Successful payments</h2>
      <p className="muted">Every payment a client completed, by any method. Sessions bought together in one checkout show as one payment.</p>
    </header>

    {s && <div className="ov-kpis po-kpis">
      <div className="ov-kpi"><small>Payments received</small><strong>{s.transactions.toLocaleString()}</strong><span className="ov-kpi-sub">{s.sessions} session{s.sessions === 1 ? '' : 's'} · {periodText(days)}</span></div>
      <div className="ov-kpi"><small>Total collected</small><strong>{peso(s.amount)}</strong><span className="ov-kpi-sub">{s.byMethod.length ? s.byMethod.map((m) => `${methodLabel(m.method)} ${peso(m.amount)}`).join(' · ') : 'no payments yet'}</span></div>
      <div className="ov-kpi"><small>Platform commission</small><strong>{peso(s.commission)}</strong><span className="ov-kpi-sub">{s.amount ? `${Math.round((s.commission / s.amount) * 1000) / 10}% of collected` : '—'}</span></div>
    </div>}

    <div className="po-toolbar">
      <Seg label="Period" value={days} onChange={setDays} options={PERIODS} />
      <select className="fi-select" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Payment method">
        <option value="">All methods</option>
        {(s?.byMethod || []).map((m) => <option key={m.method} value={m.method}>{methodLabel(m.method)}</option>)}
      </select>
      <label className="po-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Client, coach or reference…" aria-label="Search payments" /></label>
      <button className="btn-outline" onClick={exportCsv} disabled={exporting || !meta.total}><Download size={14} /> {exporting ? 'Exporting…' : 'CSV'}</button>
    </div>

    {error && <p className="error-text">{error}</p>}
    {loading && !data ? <Loading /> : !data?.transactions.length
      ? <div className="dash-panel po-empty">{search || method ? 'No payments match these filters.' : `No successful payments in the ${periodText(days)}.`}</div>
      : <div className={`dash-panel fi-panel${loading ? ' fi-loading' : ''}`}>
        <div className="po-table-wrap">
          <table className="data-table fi-table">
            <thead><tr><th>Paid on</th><th>Client</th><th>Coach</th><th>Sessions</th><th>Method</th><th>Reference</th><th className="num">Amount</th><th className="num">Commission</th></tr></thead>
            <tbody>{data.transactions.map((t) => <tr key={t.id}>
              <td className="fi-nowrap fi-c-when">{when(t.paidAt)}</td>
              <td className="fi-c-client"><strong>{t.client?.name || '—'}</strong>{t.client?.email && <small className="po-sub">{t.client.email}</small>}</td>
              <td className="fi-c-coach">{t.coach?.name || '—'}</td>
              <td className="fi-c-sessions">{t.sessions.length > 1 ? <strong>{t.sessions.length} sessions</strong> : null}{t.sessions.map((x) => <small key={x.paymentId} className="po-sub fi-nowrap">{session(x.date, x.startTime)}</small>)}</td>
              <td className="fi-c-method"><span className={`fi-method ${t.method}`}>{methodLabel(t.method)}</span></td>
              <td className="mono fi-ref fi-c-ref">{t.receiptUrl ? <a href={t.receiptUrl} target="_blank" rel="noreferrer">{t.reference || 'Receipt'}</a> : t.reference || '—'}</td>
              <td className="num mono fi-c-amount"><strong>{peso(t.amount)}</strong></td>
              <td className="num mono po-muted fi-c-comm">{peso(t.commission)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <footer className="fi-pager">
          <span className="muted">{(page - 1) * 20 + 1}–{Math.min(page * 20, meta.total)} of {meta.total}</span>
          <div>
            <button className="btn-outline" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="btn-outline" disabled={page >= meta.totalPages || loading} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </footer>
      </div>}
  </section>;
}

// ------------------------------------------------------------- Commissions

function CoachCommissionRow({ c, open, onToggle, busy, onCollect }: {
  c: CoachCommissions; open: boolean; onToggle: () => void; busy: boolean;
  onCollect: (ids: string[], settled: boolean, what: string) => void;
}) {
  const owedIds = c.records.filter((r) => !r.collected).map((r) => r.paymentId);
  return <>
    <tr className={open ? 'po-row open' : 'po-row'}>
      <td className="po-c-expand"><button className="po-expand" onClick={onToggle} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} records for ${c.name}`}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></td>
      <td className="po-c-coach"><strong>{c.name}</strong>{c.email && <small className="po-sub">{c.email}</small>}</td>
      <td className="po-c-gcash"><span className="fi-mobile-only po-sub">{c.sessions} sessions · {peso(c.gross)} gross</span><span className="fi-desktop-only">{c.lastPaidAt ? day(c.lastPaidAt) : '—'}</span></td>
      <td className="num po-c-meta">{c.sessions}</td>
      <td className="num mono po-c-meta">{peso(c.gross)}</td>
      <td className="num mono po-c-net"><strong>{peso(c.commission)}</strong></td>
      <td className="num mono po-c-meta">{peso(c.collected)}</td>
      <td className="po-c-status num">{c.owed > 0 ? <span className="fi-owed mono">{peso(c.owed)} owed</span> : <span className="badge-status confirmed">Collected</span>}</td>
      <td className="po-actions">
        {owedIds.length > 0 && <button className="btn-outline" disabled={busy} onClick={() => onCollect(owedIds, true, `${peso(c.owed)} commission from ${c.name}`)}>Mark collected</button>}
      </td>
    </tr>
    {open && <tr className="po-detail"><td /><td colSpan={8}>
      <table className="po-items">
        <thead><tr><th>Paid on</th><th>Session</th><th>Client</th><th>Method</th><th className="num">Amount</th><th className="num">Rate</th><th className="num">Commission</th><th>Status</th><th /></tr></thead>
        <tbody>{c.records.map((r) => <tr key={r.paymentId}>
          <td>{day(r.paidAt)}</td>
          <td>{session(r.sessionDate, r.startTime)}</td>
          <td>{r.client || '—'}</td>
          <td>{methodLabel(r.method)}</td>
          <td className="num mono">{peso(r.amount)}</td>
          <td className="num mono po-muted">{r.rate !== null ? `${Math.round(r.rate * 1000) / 10}%` : '—'}</td>
          <td className="num mono">{peso(r.commission)}</td>
          <td>{r.heldByPlatform
            ? <span className="badge-status confirmed" title="The platform collected this payment and kept its commission">Kept</span>
            : <span className={`badge-status ${r.collected ? 'confirmed' : 'pending'}`}>{r.collected ? 'Collected' : 'Owed'}</span>}</td>
          <td className="po-actions">{!r.heldByPlatform && <button className="text-btn" disabled={busy} onClick={() => onCollect([r.paymentId], !r.collected, `${peso(r.commission)} from ${c.name}`)}>{r.collected ? 'Undo' : 'Collect'}</button>}</td>
        </tr>)}</tbody>
      </table>
    </td></tr>}
  </>;
}

export function CommissionsByCoachPanel() {
  const [days, setDays] = useState<FinanceDays>('all');
  const [status, setStatus] = useState<'all' | 'owed'>('all');
  const [query, setQuery] = useState('');
  const search = useDebounced(query.trim());
  const [data, setData] = useState<CommissionsByCoach | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => api.adminCommissions({ days, status, search })
    .then((r) => setData(r.data))
    .catch((e) => setError(e instanceof Error ? e.message : 'Could not load commissions.'))
    .finally(() => setLoading(false));
  useEffect(() => { setLoading(true); setError(''); load(); }, [days, status, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const collect = async (ids: string[], settled: boolean, what: string) => {
    if (!window.confirm(settled ? `Mark ${what} as collected?\n\nOnly do this once the coach has paid it.` : `Move ${what} back to owed?`)) return;
    setBusy(true);
    setNotice('');
    try {
      const r = await api.adminSettleCommissions(ids, settled);
      setNotice(settled ? `Marked ${peso(r.data.amount)} as collected.` : `Moved ${peso(r.data.amount)} back to owed.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the commission.');
    } finally { setBusy(false); }
  };

  const exportCsv = () => {
    if (!data) return;
    saveCsv(`commissions-${days === 'all' ? 'all-time' : `${days}d`}.csv`, [
      ['Coach', 'Coach email', 'Paid on', 'Session', 'Client', 'Method', 'Amount', 'Rate', 'Commission', 'Status'],
      ...data.coaches.flatMap((c) => c.records.map((r) => [c.name, c.email || '', day(r.paidAt), session(r.sessionDate, r.startTime), r.client || '', methodLabel(r.method), r.amount, r.rate !== null ? `${Math.round(r.rate * 1000) / 10}%` : '', r.commission, r.heldByPlatform ? 'kept by platform' : r.collected ? 'collected' : 'owed'])),
    ]);
  };

  const s = data?.summary;
  return <div className="po">
    <p className="muted po-intro">The platform's commission on every successful payment, per coach. On payments the platform collected (QR, PayMongo) the commission was kept automatically. On direct GCash payments the coach owes it until you mark it collected.</p>

    {s && <div className="ov-kpis po-kpis">
      <div className="ov-kpi"><small>Commission earned</small><strong>{peso(s.commission)}</strong><span className="ov-kpi-sub">on {peso(s.gross)} of payments · {periodText(days)}</span></div>
      <div className="ov-kpi"><small>Collected</small><strong>{peso(s.collected)}</strong><span className="ov-kpi-sub">kept automatically or paid by coaches</span></div>
      <div className="ov-kpi"><small>Owed by coaches</small><strong>{peso(s.owed)}</strong><span className="ov-kpi-sub">{s.coachesOwing ? `${s.coachesOwing} coach${s.coachesOwing === 1 ? '' : 'es'} to collect from` : 'nothing to collect'}</span></div>
    </div>}

    <div className="po-toolbar">
      <Seg label="Status" value={status} onChange={setStatus} options={[['all', 'All records'], ['owed', 'Owed']]} />
      <Seg label="Period" value={days} onChange={setDays} options={PERIODS} />
      <label className="po-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a coach…" aria-label="Find a coach" /></label>
      <button className="btn-outline" onClick={exportCsv} disabled={!data?.coaches.length}><Download size={14} /> CSV</button>
    </div>

    {notice && <p className="po-notice" role="status">{notice}</p>}
    {error && <p className="error-text">{error}</p>}

    {loading && !data ? <Loading /> : !data?.coaches.length
      ? <div className="dash-panel po-empty">{search ? `No coach matching “${query}”.` : status === 'owed' ? 'All clear — no coach owes commission.' : `No commission in the ${periodText(days)}.`}</div>
      : <section className={`dash-panel po-week${loading ? ' fi-loading' : ''}`}>
        <div className="po-table-wrap">
          <table className="data-table po-table">
            <thead><tr><th aria-label="Expand" /><th>Coach</th><th>Last payment</th><th className="num">Sessions</th><th className="num">Gross</th><th className="num">Commission</th><th className="num">Collected</th><th className="num">Owed</th><th /></tr></thead>
            <tbody>{data.coaches.map((c) => {
              const key = c.coachId || c.name;
              return <CoachCommissionRow key={key} c={c} open={!!open[key]} onToggle={() => setOpen((o) => ({ ...o, [key]: !o[key] }))} busy={busy} onCollect={collect} />;
            })}</tbody>
          </table>
        </div>
      </section>}
  </div>;
}
