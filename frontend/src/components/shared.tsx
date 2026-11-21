import { ArrowRight, CalendarDays, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export function Stat({ label, value, icon }: { label: string; value: string; icon: JSX.Element }) {
  return <div className="stat"><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>;
}

export function Loading() {
  return <div className="loading"><span /> Loading...</div>;
}

export function EmptyState({ compact = false, title = 'Nothing here yet', copy = 'Check back once there’s activity to show.' }: { compact?: boolean; title?: string; copy?: string }) {
  const coachesBase = useLocation().pathname.startsWith('/dashboard') ? '/dashboard/coaches' : '/coaches';
  return <div className={compact ? 'empty compact' : 'empty'}><CalendarDays size={28} /><h3>{title}</h3><p>{copy}</p>{!compact && <Link className="button" to={coachesBase}>Explore coaches <ArrowRight size={16} /></Link>}</div>;
}

export function ErrorMessage({ text }: { text: string }) {
  return <div className="empty"><X size={28} /><h3>We hit a snag</h3><p>{text}</p></div>;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge-status ${status}`}>{status}</span>;
}
