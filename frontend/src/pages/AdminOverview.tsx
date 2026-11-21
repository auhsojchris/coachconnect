import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight, CalendarCheck, CheckCircle2, Star } from 'lucide-react';
import { api, AdminOverview, DashboardStats } from '../services/api';
import { Loading, StatusBadge } from '../components/shared';

export type OverviewTarget = 'payments' | 'users' | 'reviews' | 'commissions' | 'payouts';

const RANGES = [7, 30, 90] as const;
const peso = (n: number) => `₱${Math.round(n).toLocaleString()}`;
const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** "▲ 12% vs previous 30 days", or "New" / "No change" when a percentage would mislead. */
function Delta({ current, previous, range }: { current: number; previous: number; range: number }) {
  const label = `vs previous ${range} days`;
  if (!previous && !current) return <span className="ov-delta">No activity yet</span>;
  if (!previous) return <span className="ov-delta up"><ArrowUpRight size={13} /> Up from 0 {label}</span>;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return <span className="ov-delta">No change {label}</span>;
  const up = pct > 0;
  return <span className={`ov-delta ${up ? 'up' : 'down'}`}>{up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} {Math.abs(pct)}% {label}</span>;
}

function Kpi({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta: JSX.Element }) {
  return <div className="ov-kpi">
    <small>{label}</small>
    <strong>{value}</strong>
    {sub && <span className="ov-kpi-sub">{sub}</span>}
    {delta}
  </div>;
}

/** Rounds a max up to a tidy axis top with 3-4 gridlines. */
function niceScale(max: number) {
  if (max <= 0) return { top: 1000, step: 250 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  return { top: Math.ceil(max / step) * step, step };
}

const compactPeso = (n: number) => (n >= 1000 ? `₱${(n / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k` : `₱${n}`);

/** Single-series revenue bars: thin, baseline-anchored, hover tooltip, table fallback. */
function RevenueChart({ overview }: { overview: AdminOverview }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(260, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [asTable]);

  const data = overview.trend;
  const weekly = data[0]?.days > 1;
  const bucketLabel = (i: number) => {
    const d = data[i];
    if (!weekly || d.days === 1) return shortDate(d.date);
    const end = new Date(new Date(`${d.date}T00:00:00`).getTime() + (d.days - 1) * 86400000);
    return `${shortDate(d.date)} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  };

  const height = 210;
  const pad = { top: 12, right: 8, bottom: 26, left: 46 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const { top, step } = niceScale(Math.max(...data.map((d) => d.revenue)));
  const slot = plotW / data.length;
  const barW = Math.max(2, Math.min(24, slot - 2)); // 2px gap between bars, 24px cap
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.ceil(data.length / 6);
  const hasRevenue = data.some((d) => d.revenue > 0);

  /** Bar with 4px rounded top, square at the baseline. */
  const barPath = (x: number, v: number) => {
    const h = Math.max(0, (v / top) * plotH);
    if (h <= 0) return '';
    const r = Math.min(4, h, barW / 2);
    const yTop = pad.top + plotH - h;
    const yBase = pad.top + plotH;
    return `M${x},${yBase} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yBase} Z`;
  };

  return <section className="dash-panel ov-chart-panel">
    <div className="panel-heading ov-panel-heading">
      <div><p className="eyebrow">REVENUE</p><h2>{peso(overview.current.revenue)}</h2><p className="muted ov-h2-sub">Paid in the last {overview.range} days, by {weekly ? 'week' : 'day'}</p></div>
      <button type="button" className="text-btn" onClick={() => setAsTable((t) => !t)}>{asTable ? 'View as chart' : 'View as table'}</button>
    </div>
    {asTable ? <div className="ov-table-wrap"><table className="ov-table">
      <thead><tr><th>{weekly ? 'Week' : 'Day'}</th><th className="num">Revenue</th><th className="num">New bookings</th></tr></thead>
      <tbody>{data.map((d, i) => <tr key={d.date}><td>{bucketLabel(i)}</td><td className="num mono">{peso(d.revenue)}</td><td className="num mono">{d.bookings}</td></tr>)}</tbody>
    </table></div> : <div ref={wrapRef} className="ov-chart" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label={`Revenue per ${weekly ? 'week' : 'day'} for the last ${overview.range} days, ${peso(overview.current.revenue)} in total`}>
        {ticks.map((t) => <g key={t}>
          <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'ov-axis' : 'ov-grid'} />
          <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="ov-tick">{compactPeso(t)}</text>
        </g>)}
        {data.map((d, i) => {
          const x = pad.left + i * slot + (slot - barW) / 2;
          return <g key={d.date}>
            <path d={barPath(x, d.revenue)} className={`ov-bar ${hover !== null && hover !== i ? 'dim' : ''}`} />
            {/* Hit target: the whole column, much bigger than the bar. */}
            <rect x={pad.left + i * slot} y={pad.top} width={slot} height={plotH} fill="transparent"
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}
              aria-label={`${bucketLabel(i)}: ${peso(d.revenue)}, ${d.bookings} new bookings`} />
            {(i % labelEvery === 0 || i === data.length - 1) && (i === data.length - 1 || data.length - 1 - i >= labelEvery / 2) &&
              <text x={pad.left + i * slot + slot / 2} y={height - 8} textAnchor="middle" className="ov-tick">{shortDate(d.date)}</text>}
          </g>;
        })}
      </svg>
      {!hasRevenue && <p className="ov-chart-empty muted">No paid sessions in this period yet.</p>}
      {hover !== null && <div className="ov-tooltip" style={{ left: Math.min(width - 150, Math.max(0, pad.left + hover * slot + slot / 2 - 75)), top: Math.max(0, Math.min(y(data[hover].revenue), pad.top + plotH - 40) - 70) }}>
        <strong>{bucketLabel(hover)}</strong>
        <span><span className="ov-swatch" /> Revenue <b className="mono">{peso(data[hover].revenue)}</b></span>
        <span className="muted">{data[hover].bookings} new booking{data[hover].bookings === 1 ? '' : 's'}</span>
      </div>}
    </div>}
  </section>;
}

function NeedsAttention({ stats, onNavigate }: { stats: DashboardStats; onNavigate: (t: OverviewTarget) => void }) {
  const a = stats.overview.attention;
  const items = [
    a.qrPaymentsToVerify > 0 && { key: 'qr', to: 'payments' as const, title: `${a.qrPaymentsToVerify} QR payment${a.qrPaymentsToVerify > 1 ? 's' : ''} to verify`, detail: `${peso(a.qrAmountToVerify)} waiting. Clients' sessions stay pending until you confirm.` },
    a.unverifiedCoaches > 0 && { key: 'coaches', to: 'users' as const, title: `${a.unverifiedCoaches} coach${a.unverifiedCoaches > 1 ? 'es' : ''} awaiting verification`, detail: 'Review their profiles and verify them in Users.' },
    stats.reviewsPendingModeration > 0 && { key: 'reviews', to: 'reviews' as const, title: `${stats.reviewsPendingModeration} flagged review${stats.reviewsPendingModeration > 1 ? 's' : ''}`, detail: 'Approve or remove them in Reviews.' },
    stats.gcashPayoutOwed > 0 && { key: 'payouts', to: 'payouts' as const, title: `${peso(stats.gcashPayoutOwed)} owed to coaches`, detail: 'Their share of payments the platform collected.' },
    stats.gcashCommissionOwed > 0 && { key: 'commissions', to: 'commissions' as const, title: `${peso(stats.gcashCommissionOwed)} commission owed by coaches`, detail: 'From GCash payments sent directly to coaches.' },
  ].filter(Boolean) as { key: string; to: OverviewTarget; title: string; detail: string }[];

  return <section className="dash-panel">
    <div className="panel-heading"><div><p className="eyebrow">NEEDS ATTENTION</p><h2>{items.length ? `${items.length} thing${items.length > 1 ? 's' : ''} to do` : 'All clear'}</h2></div></div>
    {items.length === 0
      ? <p className="ov-clear"><CheckCircle2 size={18} /> Nothing is waiting on you right now.</p>
      : <div className="ov-todo">{items.map((item) => <button type="button" key={item.key} className="ov-todo-row" onClick={() => onNavigate(item.to)}>
        <AlertCircle size={17} className="ov-todo-icon" />
        <span><strong>{item.title}</strong><small>{item.detail}</small></span>
        <ArrowRight size={16} />
      </button>)}</div>}
  </section>;
}

function BookingStatus({ stats }: { stats: DashboardStats }) {
  const order = ['pending', 'confirmed', 'completed', 'cancelled'];
  const entries = order.map((k) => [k, stats.bookingsByStatus[k] || 0] as const);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return <section className="dash-panel">
    <div className="panel-heading"><div><p className="eyebrow">ALL BOOKINGS</p><h2>{total.toLocaleString()} total</h2></div></div>
    {entries.map(([key, value]) => {
      const share = total ? value / total : 0;
      return <div className="ov-status-row" key={key}>
        <span>{key}</span>
        <div className="ov-status-track"><i style={{ width: `${share * 100}%` }} /></div>
        <strong className="mono">{value}</strong>
        <small className="muted mono">{Math.round(share * 100)}%</small>
      </div>;
    })}
    <p className="ov-upcoming"><CalendarCheck size={16} /> <strong>{stats.overview.upcomingSessions}</strong> confirmed session{stats.overview.upcomingSessions === 1 ? '' : 's'} in the next 7 days</p>
  </section>;
}

function TopCoaches({ overview }: { overview: AdminOverview }) {
  return <section className="dash-panel">
    <div className="panel-heading"><div><p className="eyebrow">TOP COACHES</p><h2>By revenue, last {overview.range} days</h2></div></div>
    {overview.topCoaches.length === 0 ? <p className="muted">No paid sessions in this period yet.</p> : <ol className="ov-rank">
      {overview.topCoaches.map((c, i) => <li key={c.coachId}>
        <span className="ov-rank-n mono">{i + 1}</span>
        <span className="ov-rank-name"><strong>{c.name}</strong><small className="muted">{c.sessions} paid session{c.sessions === 1 ? '' : 's'}{c.averageRating > 0 && <> · <Star size={11} fill="currentColor" style={{ verticalAlign: -1 }} /> {c.averageRating.toFixed(1)}</>}</small></span>
        <strong className="mono">{peso(c.revenue)}</strong>
      </li>)}
    </ol>}
  </section>;
}

function RecentBookings({ stats }: { stats: DashboardStats }) {
  return <section className="dash-panel">
    <div className="panel-heading"><div><p className="eyebrow">RECENT ACTIVITY</p><h2>Latest bookings</h2></div></div>
    {stats.recentBookings.length === 0 ? <p className="muted">No bookings yet.</p> : <div className="ov-table-wrap"><table className="ov-table">
      <thead><tr><th>Client</th><th>Coach</th><th>Session</th><th className="num">Price</th><th>Status</th></tr></thead>
      <tbody>{stats.recentBookings.map((b) => <tr key={b.id}>
        <td>{b.client?.name || '—'}</td>
        <td>{b.coach?.user?.name || '—'}</td>
        <td className="mono">{b.timeSlot ? `${shortDate(b.timeSlot.date)} · ${b.timeSlot.startTime.slice(0, 5)}` : '—'}</td>
        <td className="num mono">{peso(Number(b.price))}</td>
        <td><StatusBadge status={b.status} /></td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

export default function Overview({ onNavigate }: { onNavigate: (t: OverviewTarget) => void }) {
  const [range, setRange] = useState<number>(30);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    api.adminStats(range)
      .then((r) => setStats(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the overview.'))
      .finally(() => setLoading(false));
  }, [range]);

  if (!stats) return error ? <p className="error-text">{error}</p> : <Loading />;
  const { overview } = stats;
  const { current, previous } = overview;

  return <div className={`ov ${loading ? 'ov-loading' : ''}`}>
    <div className="ov-toolbar">
      <div className="ov-seg" role="group" aria-label="Time range">
        {RANGES.map((r) => <button key={r} type="button" className={range === r ? 'active' : ''} aria-pressed={range === r} onClick={() => setRange(r)}>{r} days</button>)}
      </div>
      <small className="muted">Since {shortDate(overview.since)} · Philippine time</small>
    </div>
    {error && <p className="error-text">{error}</p>}

    <div className="ov-kpis">
      <Kpi label="Revenue" value={peso(current.revenue)} delta={<Delta current={current.revenue} previous={previous.revenue} range={range} />} />
      <Kpi label="Platform commission" value={peso(current.commission)} delta={<Delta current={current.commission} previous={previous.commission} range={range} />} />
      <Kpi label="New bookings" value={current.bookings.toLocaleString()} sub={`${current.completedSessions} completed`} delta={<Delta current={current.bookings} previous={previous.bookings} range={range} />} />
      <Kpi label="New sign-ups" value={(current.newClients + current.newCoaches).toLocaleString()} sub={`${current.newClients} athlete${current.newClients === 1 ? '' : 's'} · ${current.newCoaches} coach${current.newCoaches === 1 ? '' : 'es'}`} delta={<Delta current={current.newClients + current.newCoaches} previous={previous.newClients + previous.newCoaches} range={range} />} />
    </div>

    <div className="ov-grid-main">
      <RevenueChart overview={overview} />
      <NeedsAttention stats={stats} onNavigate={onNavigate} />
    </div>

    <div className="ov-grid-3">
      <BookingStatus stats={stats} />
      <TopCoaches overview={overview} />
      <section className="dash-panel ov-totals">
        <div className="panel-heading"><div><p className="eyebrow">ALL TIME</p><h2>Platform totals</h2></div></div>
        <dl>
          <div><dt>Revenue</dt><dd className="mono">{peso(stats.totalRevenue)}</dd></div>
          <div><dt>Commission earned</dt><dd className="mono">{peso(stats.totalCommissionEarned)}</dd></div>
          <div><dt>Athletes</dt><dd className="mono">{stats.totalClients.toLocaleString()}</dd></div>
          <div><dt>Coaches</dt><dd className="mono">{stats.totalCoaches.toLocaleString()} <small className="muted">({stats.verifiedCoaches} verified)</small></dd></div>
        </dl>
      </section>
    </div>

    <RecentBookings stats={stats} />
  </div>;
}
