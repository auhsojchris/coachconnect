import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Download, Search } from 'lucide-react';
import { api, CoachPayoutLine, PayoutPeriod, PayoutStatusFilter, PayoutWeek, WeeklyPayouts } from '../services/api';
import { Loading } from '../components/shared';

const peso = (n: number) => `₱${Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
// Week bounds are calendar days (YYYY-MM-DD); format them in UTC so the
// browser's timezone can't shift them a day.
const fmtDay = (ymd: string, opts: Intl.DateTimeFormatOptions) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-PH', { timeZone: 'UTC', ...opts });
const weekLabel = (w: { weekStart: string; weekEnd: string }) => {
  const sameMonth = w.weekStart.slice(0, 7) === w.weekEnd.slice(0, 7);
  const end = sameMonth ? `${Number(w.weekEnd.slice(8))}, ${w.weekEnd.slice(0, 4)}` : fmtDay(w.weekEnd, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmtDay(w.weekStart, { month: 'short', day: 'numeric' })} – ${end}`;
};
const weeksAgo = (ymd: string) => {
  const n = Math.floor((new Date(`${todayPH()}T00:00:00Z`).getTime() - new Date(`${ymd}T00:00:00Z`).getTime()) / (7 * 864e5));
  return n <= 0 ? 'this week' : n === 1 ? 'last week' : `${n} weeks ago`;
};
const paidOn = (iso: string) => new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' });
const sessionOn = (date: string | null, time: string | null) => (date ? `${fmtDay(date, { month: 'short', day: 'numeric' })}${time ? ` · ${time}` : ''}` : '—');
/** Today's date in the Philippines, as YYYY-MM-DD. */
const todayPH = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

const STATUS_LABEL = { owed: 'Owed', settled: 'Settled', partial: 'Part settled' } as const;
const STATUS_CLASS = { owed: 'pending', settled: 'confirmed', partial: 'completed' } as const;

function downloadCsv(week: PayoutWeek) {
  const rows = [['Week', 'Coach', 'Email', 'GCash number', 'GCash name', 'Client', 'Session', 'Paid on', 'Booking amount', 'Commission', 'Net payout', 'Status']];
  for (const c of week.coaches) for (const i of c.items) {
    rows.push([`${week.weekStart} to ${week.weekEnd}`, c.name, c.email || '', c.gcashNumber || '', c.gcashAccountName || '', i.client || '', sessionOn(i.sessionDate, i.startTime), paidOn(i.paidAt), String(i.amount), String(i.commission), String(i.net), i.settled ? 'settled' : 'owed']);
  }
  const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  a.download = `payouts-${week.weekStart}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return <div className="ov-seg" role="group" aria-label={label}>
    {options.map(([v, text]) => <button key={String(v)} className={v === value ? 'active' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>{text}</button>)}
  </div>;
}

function CoachRow({ line, open, onToggle, busy, onSettle }: {
  line: CoachPayoutLine; open: boolean; onToggle: () => void; busy: boolean;
  onSettle: (ids: string[], settled: boolean, what: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const owedIds = line.items.filter((i) => !i.settled).map((i) => i.paymentId);
  const settledIds = line.items.filter((i) => i.settled).map((i) => i.paymentId);
  const copy = async () => {
    if (!line.gcashNumber) return;
    try { await navigator.clipboard.writeText(line.gcashNumber); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return <>
    <tr className={open ? 'po-row open' : 'po-row'}>
      <td className="po-c-expand">
        <button className="po-expand" onClick={onToggle} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} sessions for ${line.name}`}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      </td>
      <td className="po-c-coach"><strong>{line.name}</strong>{line.email && <small className="po-sub">{line.email}</small>}</td>
      <td className="po-c-gcash">
        {line.gcashNumber
          ? <span className="po-gcash"><span className="mono">{line.gcashNumber}</span><button className="po-copy" onClick={copy} title="Copy GCash number">{copied ? 'Copied' : <Copy size={13} />}</button></span>
          : <span className="po-missing">No GCash set</span>}
        {line.gcashAccountName && <small className="po-sub">{line.gcashAccountName}</small>}
      </td>
      <td className="num po-c-meta">{line.sessions}</td>
      <td className="num mono po-c-meta">{peso(line.gross)}</td>
      <td className="num mono po-muted po-c-meta">−{peso(line.commission)}</td>
      <td className="num mono po-c-net"><strong>{peso(line.status === 'settled' ? line.net : line.owed)}</strong>{line.status === 'partial' && <small className="po-sub">of {peso(line.net)}</small>}</td>
      <td className="po-c-status"><span className={`badge-status ${STATUS_CLASS[line.status]}`}>{STATUS_LABEL[line.status]}</span></td>
      <td className="po-actions">
        {owedIds.length > 0
          ? <button className="btn-outline" disabled={busy} onClick={() => onSettle(owedIds, true, `${peso(line.owed)} to ${line.name}${line.gcashNumber ? ` (GCash ${line.gcashNumber})` : ''}`)}>Mark settled</button>
          : <button className="btn-outline" disabled={busy} onClick={() => onSettle(settledIds, false, `${line.name}'s ${peso(line.settled)}`)}>Undo</button>}
      </td>
    </tr>
    {open && <tr className="po-detail"><td /><td colSpan={8}>
      <table className="po-items">
        <thead><tr><th>Session</th><th>Client</th><th>Paid on</th><th className="num">Amount</th><th className="num">Commission</th><th className="num">Net</th><th>Status</th><th /></tr></thead>
        <tbody>{line.items.map((i) => <tr key={i.paymentId}>
          <td>{sessionOn(i.sessionDate, i.startTime)}</td>
          <td>{i.client || '—'}</td>
          <td>{paidOn(i.paidAt)}</td>
          <td className="num mono">{peso(i.amount)}</td>
          <td className="num mono po-muted">−{peso(i.commission)}</td>
          <td className="num mono">{peso(i.net)}</td>
          <td><span className={`badge-status ${i.settled ? 'confirmed' : 'pending'}`}>{i.settled ? 'settled' : 'owed'}</span></td>
          <td className="po-actions"><button className="text-btn" disabled={busy} onClick={() => onSettle([i.paymentId], !i.settled, `${peso(i.net)} for ${i.client || 'this session'}`)}>{i.settled ? 'Undo' : 'Settle'}</button></td>
        </tr>)}</tbody>
      </table>
    </td></tr>}
  </>;
}

function WeekCard({ week, query, busy, onSettle }: { week: PayoutWeek; query: string; busy: boolean; onSettle: (ids: string[], settled: boolean, what: string) => void }) {
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const coaches = week.coaches.filter((c) => !query || `${c.name} ${c.email || ''} ${c.gcashNumber || ''}`.toLowerCase().includes(query));
  if (!coaches.length) return null;
  const today = todayPH();
  const inProgress = week.weekStart <= today && today <= week.weekEnd;
  const owedIds = week.coaches.flatMap((c) => c.items.filter((i) => !i.settled).map((i) => i.paymentId));
  const owedCoaches = week.coaches.filter((c) => c.owed > 0).length;
  return <section className="dash-panel po-week">
    <header className="po-week-head">
      <div>
        <h2>Week of {weekLabel(week)}</h2>
        <p className="po-week-meta">
          {inProgress && <span className="po-tag">In progress</span>}
          {week.coaches.length} coach{week.coaches.length === 1 ? '' : 'es'} · {week.coaches.reduce((s, c) => s + c.sessions, 0)} sessions
        </p>
      </div>
      <dl className="po-week-totals">
        <div><dt>Owed</dt><dd className={week.owed > 0 ? 'owed' : ''}>{peso(week.owed)}</dd></div>
        <div><dt>Settled</dt><dd>{peso(week.settled)}</dd></div>
      </dl>
      <div className="po-week-actions">
        <button className="btn-outline" onClick={() => downloadCsv(week)} title="Download this week as CSV"><Download size={14} /> CSV</button>
        {owedIds.length > 0 && <button className="button small" disabled={busy} onClick={() => onSettle(owedIds, true, `all ${owedCoaches} coach${owedCoaches === 1 ? '' : 'es'} for this week — ${peso(week.owed)} in total`)}>Settle whole week</button>}
      </div>
    </header>
    <div className="po-table-wrap">
      <table className="data-table po-table">
        <thead><tr><th aria-label="Expand" /><th>Coach</th><th>Send to GCash</th><th className="num">Sessions</th><th className="num">Gross</th><th className="num">Commission</th><th className="num">Net payout</th><th>Status</th><th /></tr></thead>
        <tbody>{coaches.map((c) => {
          const key = c.coachId || c.name;
          return <CoachRow key={key} line={c} open={!!openRows[key]} onToggle={() => setOpenRows((o) => ({ ...o, [key]: !o[key] }))} busy={busy} onSettle={onSettle} />;
        })}</tbody>
      </table>
    </div>
  </section>;
}

export default function PayoutsPanel() {
  const [status, setStatus] = useState<PayoutStatusFilter>('owed');
  const [period, setPeriod] = useState<PayoutPeriod>('all');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<WeeklyPayouts | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    return api.adminWeeklyPayouts(status, period)
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load payouts.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [status, period]); // eslint-disable-line react-hooks/exhaustive-deps

  const settle = async (ids: string[], settled: boolean, what: string) => {
    const ok = window.confirm(settled
      ? `Mark ${what} as settled?\n\nOnly do this after you've sent the money.`
      : `Move ${what} back to owed?`);
    if (!ok) return;
    setBusy(true);
    setNotice('');
    try {
      const r = await api.adminSettlePayouts(ids, settled);
      setNotice(settled ? `Marked ${peso(r.data.amount)} as settled.` : `Moved ${peso(r.data.amount)} back to owed.`);
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the payout.');
    } finally { setBusy(false); }
  };

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => (data?.statements || []).filter((w) => !q || w.coaches.some((c) => `${c.name} ${c.email || ''} ${c.gcashNumber || ''}`.toLowerCase().includes(q))), [data, q]);
  const summary = data?.summary;

  return <div className="po">
    <p className="muted po-intro">Coaches' net share of payments the platform collected (QR and PayMongo), grouped by the week the client paid (Monday–Sunday, Philippine time). Send each coach one GCash transfer for the week, then mark it settled.</p>

    {summary && <div className="ov-kpis po-kpis">
      <div className="ov-kpi"><small>Owed to coaches</small><strong>{peso(summary.owed)}</strong><span className="ov-kpi-sub">{summary.coachesOwed} coach{summary.coachesOwed === 1 ? '' : 'es'} waiting</span></div>
      <div className="ov-kpi"><small>Oldest unsettled week</small><strong className="po-kpi-text">{summary.oldestOwedWeek ? weeksAgo(summary.oldestOwedWeek) : 'None'}</strong><span className="ov-kpi-sub">{summary.oldestOwedWeek ? `week of ${fmtDay(summary.oldestOwedWeek, { month: 'short', day: 'numeric' })}` : 'everyone is paid up'}</span></div>
      <div className="ov-kpi"><small>Settled</small><strong>{peso(summary.settled)}</strong><span className="ov-kpi-sub">{period === 'all' ? 'all time' : `last ${period} weeks`}</span></div>
    </div>}

    <div className="po-toolbar">
      <Seg label="Payout status" value={status} onChange={setStatus} options={[['owed', 'Owed'], ['settled', 'Settled'], ['all', 'All']]} />
      <Seg label="Period" value={period} onChange={setPeriod} options={[[4, '4 weeks'], [12, '12 weeks'], ['all', 'All time']]} />
      <label className="po-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a coach…" aria-label="Find a coach" /></label>
    </div>

    {notice && <p className="po-notice" role="status">{notice}</p>}
    {error && <p className="error-text">{error}</p>}

    {loading ? <Loading /> : visible.length === 0
      ? <div className="dash-panel po-empty">{q ? `No coach matching “${query}”.` : status === 'owed' ? 'All clear — no coach payouts are owed.' : 'No payouts in this period.'}</div>
      : visible.map((w) => <WeekCard key={w.weekStart} week={w} query={q} busy={busy} onSettle={settle} />)}
  </div>;
}
