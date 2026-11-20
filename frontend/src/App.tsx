import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Bell, CalendarDays, Check, CircleUserRound, CreditCard, Dumbbell, Heart, LogOut, Menu, Pause, Play, Search, ShieldCheck, Star, Trophy, X } from 'lucide-react';
import { api, AppNotification, Booking, Coach, CoachProfile, PlatformStats, Review, Role, SKILL_LEVELS, SkillLevel, SportCategory, TimeSlot, User } from './services/api';
import { EmptyState, ErrorMessage, Loading, Stat } from './components/shared';
import Checkout from './pages/Checkout';
import ReviewForm from './pages/ReviewForm';
import { CoachAvailability, CoachProfileEditor, profileChecklist } from './pages/CoachDashboard';
import AdminPanel from './pages/AdminPanel';
import PaymentMethods from './pages/PaymentMethods';
import PaymentReturn from './pages/PaymentReturn';
import { AccountPage, MessagesPage } from './pages/MemberTools';

type Session = { user: User; token: string };

function useSession() {
  const [session, setSession] = useState<Session | null>(() => {
    const raw = localStorage.getItem('coachconnect_session') || localStorage.getItem('stride_session');
    return raw ? JSON.parse(raw) : null;
  });
  const save = (next: Session | null) => { setSession(next); if (next) { localStorage.setItem('coachconnect_session', JSON.stringify(next)); localStorage.removeItem('stride_session'); } else { localStorage.removeItem('coachconnect_session'); localStorage.removeItem('stride_session'); } };
  return { session, save };
}

function App() {
  const auth = useSession();
  return <Routes>
    <Route element={<Layout session={auth.session} onLogout={() => auth.save(null)} />}>
      <Route path="/" element={<AuthPage mode="login" onAuth={auth.save} />} />
      <Route path="/explore" element={<Home />} />
      <Route path="/coaches" element={<CoachDirectory />} />
      <Route path="/coaches/:id" element={<CoachDetails session={auth.session} />} />
      <Route path="/about" element={<InfoPage title="Train with intention" copy="CoachConnect brings trusted coaches, flexible scheduling, and a little more humanity to every session." />} />
      <Route path="/contact" element={<InfoPage title="Let’s get you moving" copy="Questions about a session, a coach, or your account? Our team is here to help." />} />
      <Route path="/payment-return" element={<PaymentReturn />} />
      <Route path="/login" element={<AuthPage mode="login" onAuth={auth.save} />} />
      <Route path="/register" element={<AuthPage mode="register" onAuth={auth.save} />} />
      <Route path="/dashboard/*" element={auth.session ? <Dashboard session={auth.session} onLogout={() => auth.save(null)} onUserChange={(user) => auth.save({ ...auth.session!, user })} /> : <Navigate to="/login" replace />} />
    </Route>
  </Routes>;
}

function Layout({ session, onLogout }: { session: Session | null; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [location.pathname]);
  const logout = () => { onLogout(); navigate('/'); };
  return <div className="site-shell">
    <header className="topbar"><Link to="/explore" className="brand"><span className="brand-mark"><Dumbbell size={18} /></span> COACHCONNECT</Link>
      <button className="mobile-menu icon-btn" onClick={() => setOpen(!open)} aria-label="Toggle menu">{open ? <X /> : <Menu />}</button>
      <nav className={open ? 'main-nav open' : 'main-nav'}><Link to="/explore">Home</Link><Link to="/coaches">Find a coach</Link><Link to="/about">How it works</Link><Link to="/contact">Contact</Link>
        {session ? <><Link className="nav-dashboard" to="/dashboard">Dashboard <ArrowRight size={15} /></Link><button className="text-btn" onClick={logout}>Log out</button></> : <><Link className="text-btn" to="/login">Log in</Link><Link className="button small" to="/register">Get started <ArrowRight size={15} /></Link></>}
      </nav>
    </header>
    <main><Outlet /></main>
  </div>;
}

// Large counts read better abbreviated (e.g. 18k); small ones stay exact so
// early-stage real numbers (e.g. 3 coaches) don't look like a rounding error.
function formatMetric(value: number): string {
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`.replace('.0k', 'k');
  return String(value);
}

function Home() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  useEffect(() => { api.stats().then((res) => setStats(res.data)).catch(() => setStats(null)); }, []);

  return <>
  <section className="hero"><div className="hero-copy"><p className="eyebrow">COACHING, ON YOUR TERMS</p><h1>Your next<br /><em>stronger</em> self<br />starts here.</h1><p className="hero-lede">Book one-on-one coaching with people who know how to make progress feel personal.</p><Link className="button" to="/coaches">Explore coaches <ArrowRight size={17} /></Link><div className="trust-row"><span><ShieldCheck size={17} /> Verified coaches</span><span><Star size={17} fill="currentColor" /> {stats?.averageRating ? `${stats.averageRating} average rating` : 'New on CoachConnect'}</span></div></div><div className="hero-art"><div className="art-circle"><div className="runner">TRAIN<br /><strong>PLAY<br />HARD</strong></div></div><div className="art-note">01 <span>MOVE WITH PURPOSE</span></div></div></section>
  <section className="metrics"><Link to="/coaches" aria-label="View coaches"><strong>{stats ? formatMetric(stats.coachCount) : '—'}</strong><span>coaches ready</span></Link><div><strong>{stats ? formatMetric(stats.sportCount) : '—'}</strong><span>sports & disciplines</span></div><div><strong>{stats ? formatMetric(stats.completedSessions) : '—'}</strong><span>sessions completed</span></div><div><strong>{stats?.averageRating ? `${stats.averageRating}/5` : 'New'}</strong><span>athlete rating</span></div></section>
  <HomeSportsShowcase />
  <section className="home-section"><div className="section-heading"><div><p className="eyebrow">THE COACHCONNECT METHOD</p><h2>Training that meets<br /><span>you where you are.</span></h2></div><Link to="/about" className="underlink">See how it works <ArrowRight size={16} /></Link></div><div className="feature-grid"><Feature number="01" title="Find your fit" copy="Browse verified experts by sport, style, location, and rate." icon={<Search />} /><Feature number="02" title="Book with ease" copy="See real availability and reserve a time that works for your life." icon={<CalendarDays />} /><Feature number="03" title="Keep growing" copy="Build momentum with a coach who is invested in your progress." icon={<Heart />} /></div></section>
  <section className="dark-band"><div><p className="eyebrow light">YOUR GAME PLAN</p><h2>Small steps.<br /><em>Big energy.</em></h2></div><Link className="button light-button" to="/coaches">Start your search <ArrowRight size={17} /></Link></section>
</>; }

const homeSlides = [
  { label: 'SHOW UP', title: 'Your strongest days start with one step.', image: 'https://images.unsplash.com/photo-1538805060514-97d9cc17730c?auto=format&fit=crop&w=1200&q=85' },
  { label: 'KEEP GOING', title: 'Progress is built one brave effort at a time.', image: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1200&q=85' },
  { label: 'GO FURTHER', title: 'Train for the moment you will never forget.', image: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1200&q=85' },
];

function HomeSportsShowcase() {
  const [slide, setSlide] = useState(0);
  const activeSlide = homeSlides[slide];
  useEffect(() => { const timer = window.setInterval(() => setSlide((current) => (current + 1) % homeSlides.length), 4500); return () => window.clearInterval(timer); }, []);
  return <section className="home-showcase"><div className="home-showcase-image-wrap"><img className="home-showcase-image" src={activeSlide.image} alt={activeSlide.label.toLowerCase()} /></div><div className="home-showcase-copy"><p className="eyebrow">{activeSlide.label}</p><h2>{activeSlide.title}</h2><p>Train with a coach who understands the details behind your best performance.</p><Link className="underlink" to="/coaches">Meet your coach <ArrowRight size={16} /></Link><div className="home-showcase-dots">{homeSlides.map((item, index) => <button key={item.label} className={index === slide ? 'active' : ''} onClick={() => setSlide(index)} aria-label={`Show ${item.label.toLowerCase()} slide`} />)}</div></div></section>;
}

function Feature({ number, title, copy, icon }: { number: string; title: string; copy: string; icon: JSX.Element }) { return <article className="feature"><span className="feature-number">{number}</span><div className="feature-icon">{icon}</div><h3>{title}</h3><p>{copy}</p><ArrowRight className="feature-arrow" size={18} /></article>; }

const trainingSlides = [
  { sport: 'PICKLEBALL', title: 'Play with purpose', copy: 'Sharpen your touch, movement, and court awareness one rally at a time.', image: 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?auto=format&fit=crop&w=1400&q=85' },
  { sport: 'TENNIS', title: 'Own the court', copy: 'Build a stronger serve, cleaner footwork, and confidence under pressure.', image: 'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=1400&q=85' },
  { sport: 'RUNNING', title: 'Find your pace', copy: 'Build endurance with a plan that moves at your speed.', image: 'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=1400&q=85' },
  { sport: 'BADMINTON', title: 'Move faster', copy: 'Improve reaction time, agility, and control through every exchange.', image: 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?auto=format&fit=crop&w=1400&q=85' },
];

function InfoPage({ title, copy }: { title: string; copy: string }) {
  const [slide, setSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const activeSlide = trainingSlides[slide];

  useEffect(() => {
    if (isPaused) return undefined;
    const timer = window.setInterval(() => setSlide((current) => (current + 1) % trainingSlides.length), 5000);
    return () => window.clearInterval(timer);
  }, [isPaused]);

  const moveSlide = (direction: number) => setSlide((current) => (current + direction + trainingSlides.length) % trainingSlides.length);

  return <section className="simple-page"><p className="eyebrow">ABOUT COACHCONNECT</p><h1>{title}</h1><p>{copy}</p><Link className="button" to="/coaches">Find your coach <ArrowRight size={17} /></Link>
    <div className="training-showcase" aria-label="Sports and training highlights">
      <img className="training-showcase-image" src={activeSlide.image} alt={`${activeSlide.sport.toLowerCase()} training`} />
      <div className="training-showcase-overlay" />
      <div className="training-showcase-content"><span className="eyebrow light">{activeSlide.sport} / 0{slide + 1}</span><h2>{activeSlide.title}</h2><p>{activeSlide.copy}</p></div>
      <div className="training-showcase-controls"><button className="icon-btn" onClick={() => moveSlide(-1)} aria-label="Previous slide"><ArrowLeft size={18} /></button><button className="icon-btn" onClick={() => setIsPaused((paused) => !paused)} aria-label={isPaused ? 'Play slideshow' : 'Pause slideshow'}>{isPaused ? <Play size={17} /> : <Pause size={17} />}</button><button className="icon-btn" onClick={() => moveSlide(1)} aria-label="Next slide"><ArrowRight size={18} /></button></div>
      <div className="training-showcase-dots">{trainingSlides.map((item, index) => <button key={item.sport} className={index === slide ? 'active' : ''} onClick={() => setSlide(index)} aria-label={`Show ${item.sport.toLowerCase()} slide`} />)}</div>
    </div>
  </section>;
}

function CoachDirectory() {
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [categories, setCategories] = useState<SportCategory[]>([]);
  const [query, setQuery] = useState('');
  const [sport, setSport] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [level, setLevel] = useState<SkillLevel | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { api.sportCategories().then((r) => setCategories(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    setLoading(true);
    setError('');
    api.coaches({ city: query || undefined, sport: sport || undefined, minRating: minRating || undefined, level: level || undefined })
      .then((r) => setCoaches(r.data || []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load coaches.'))
      .finally(() => setLoading(false));
  }, [query, sport, minRating, level]);

  return <section className="directory">
    <div className="page-intro"><div><p className="eyebrow">THE COACH ROSTER</p><h1>Find your<br /><em>right fit.</em></h1></div><p>Expert guidance for wherever you are in your game. Search by city, sport, rating, or your level.</p></div>
    <div className="searchbar"><Search size={19} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by city..." /><span>⌘ K</span></div>
    <div className="filter-bar">
      <select value={sport} onChange={(e) => setSport(e.target.value)}>
        <option value="">All sports</option>
        {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
      </select>
      <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
        <option value={0}>Any rating</option>
        <option value={4}>4.0+ stars</option>
        <option value={4.5}>4.5+ stars</option>
      </select>
      <select value={level} onChange={(e) => setLevel(e.target.value as SkillLevel | '')} aria-label="Your level">
        <option value="">Any level</option>
        {SKILL_LEVELS.map((l) => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>)}
      </select>
    </div>
    {loading ? <Loading /> : error ? <ErrorMessage text={error} /> : coaches.length ? <div className="coach-grid">{coaches.map((coach) => <CoachCard key={coach.id} coach={coach} />)}</div> : <EmptyState />}
  </section>;
}

function CoachCard({ coach }: { coach: Coach }) { const tags = coach.specializations?.map((s) => s.sportCategory?.name).filter(Boolean) as string[] || []; return <Link className="coach-card" to={`/coaches/${coach.id}`}><div className="coach-photo">{coach.user?.profileImage ? <img className="coach-photo-image" src={coach.user.profileImage} alt={`${coach.user.name || 'Coach'} profile`} /> : <div className="avatar-large">{coach.user?.name?.slice(0, 1) || 'C'}</div>}{coach.isVerified && <span className="verified"><Check size={13} /> Verified</span>}<button className="heart-btn" onClick={(e) => e.preventDefault()} aria-label="Save coach"><Heart size={18} /></button></div><div className="coach-body"><div className="coach-name"><div><h3>{coach.user?.name || 'Coach'}</h3><p>{coach.city || coach.location || 'Online coaching'}</p></div><span className="rating"><Star size={14} fill="currentColor" /> {Number(coach.averageRating || 0).toFixed(1)}</span></div><div className="tag-row">{(tags.length ? tags : ['Performance']).slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</div><div className="card-footer"><strong>₱{Number(coach.hourlyRate || 0)} <small>/ session</small></strong><span>View profile <ArrowRight size={15} /></span></div></div></Link>; }

// Matches MAX_SLOTS_PER_CHECKOUT in the backend booking validator.
const MAX_SLOTS_PER_CHECKOUT = 10;

/** Same formula as the backend's calculateSessionPrice: rate × hours. */
function sessionPrice(hourlyRate: number, slot: TimeSlot) {
  const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  return Math.round(Number(hourlyRate) * ((minutes(slot.endTime) - minutes(slot.startTime)) / 60) * 100) / 100;
}

function CoachDetails({ session }: { session: Session | null }) {
  const { id = '' } = useParams();
  const [coach, setCoach] = useState<Coach | null>(null);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [tab, setTab] = useState<'about' | 'reviews'>('about');
  const [selected, setSelected] = useState<string[]>([]);
  const [booking, setBooking] = useState(false);
  const [selectedSportCategoryId, setSelectedSportCategoryId] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([api.coach(id), api.availability(id), api.coachReviews(id)])
      .then(([c, a, r]) => {
        setCoach(c.data);
        setSlots(a.data?.timeSlots || []);
        setReviews(r.data || []);
        setSelectedSportCategoryId(c.data.specializations?.[0]?.sportCategoryId || '');
      })
      .catch((e) => setMessage(e instanceof Error ? e.message : 'Could not load this coach.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Loading />;
  if (!coach) return <ErrorMessage text={message || 'Coach not found'} />;

  const book = async () => {
    if (!session) { navigate('/login'); return; }
    if (!selected.length) { setMessage('Choose at least one available time first.'); return; }
    if (!selectedSportCategoryId) { setMessage('Choose a sport for this session.'); return; }
    setBooking(true);
    setMessage('');
    try {
      await api.createBookings({ coachId: coach.id, timeSlotIds: selected, sportCategoryId: selectedSportCategoryId });
      navigate('/dashboard/bookings');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not create booking.');
      // Slots may have been taken in the meantime — refresh what's open.
      api.availability(coach.id).then((a) => { const open = a.data?.timeSlots || []; setSlots(open); setSelected((sel) => sel.filter((id) => open.some((s) => s.id === id))); }).catch(() => {});
    } finally { setBooking(false); }
  };

  const toggleSlot = (id: string) => {
    if (selected.includes(id)) { setSelected(selected.filter((s) => s !== id)); return; }
    if (selected.length >= MAX_SLOTS_PER_CHECKOUT) { setMessage(`You can book up to ${MAX_SLOTS_PER_CHECKOUT} sessions at a time.`); return; }
    setMessage('');
    setSelected([...selected, id]);
  };
  const slotsByDate = slots.reduce<Record<string, TimeSlot[]>>((acc, s) => { (acc[s.date] ||= []).push(s); return acc; }, {});
  const selectedSlots = slots.filter((s) => selected.includes(s.id));
  const total = selectedSlots.reduce((sum, s) => sum + sessionPrice(coach.hourlyRate, s), 0);

  const tags = coach.specializations?.map((s) => s.sportCategory?.name).filter(Boolean) as string[] || [];
  const levels = SKILL_LEVELS.filter((l) => coach.skillLevels?.includes(l));
  const certified = (coach.specializations || []).filter((s) => s.certification || s.yearsExperience);
  const achievements = [...(coach.achievements || [])].sort((a, b) => (b.year || 0) - (a.year || 0));

  return <section className="coach-detail">
    <Link to="/coaches" className="backlink">← Back to coaches</Link>
    <div className="detail-layout">
      <div className="detail-profile">
        <div className="detail-avatar">{coach.user?.profileImage ? <img className="detail-avatar-image" src={coach.user.profileImage} alt={`${coach.user.name || 'Coach'} profile`} /> : coach.user?.name?.slice(0, 1) || 'C'}</div>
        <div className="detail-title">
          <span className="eyebrow">{coach.isVerified ? 'VERIFIED COACH' : 'COACH'}</span>
          <h1>{coach.user?.name || 'Coach'}</h1>
          {coach.tagline && <p style={{ fontWeight: 600, marginBottom: 4 }}>{coach.tagline}</p>}
          <p>{coach.city || coach.location || 'Online coaching'} · {coach.experienceYears || 0}+ years experience</p>
          <div className="detail-rating"><Star size={18} fill="currentColor" /> {Number(coach.averageRating || 0).toFixed(1)} <span>{coach.totalReviews || 0} reviews</span></div>
          {tags.length > 0 && <div className="tag-row" style={{ margin: '14px 0 0' }}>{tags.map((t) => <span key={t}>{t}</span>)}</div>}
          {levels.length > 0 && <p className="muted" style={{ fontSize: '.8rem', marginTop: 10 }}><strong>Coaches:</strong> {levels.map((l) => l[0].toUpperCase() + l.slice(1)).join(' · ')}</p>}
        </div>
        <div className="tab-strip" style={{ gridColumn: '1 / -1', marginTop: 26 }}>
          <button className={`tab-btn ${tab === 'about' ? 'active' : ''}`} onClick={() => setTab('about')}>About</button>
          <button className={`tab-btn ${tab === 'reviews' ? 'active' : ''}`} onClick={() => setTab('reviews')}>Reviews ({reviews.length})</button>
        </div>
        {tab === 'about' && <div style={{ gridColumn: '1 / -1', marginTop: 20 }}>
          <p className="bio">{coach.bio || 'Focused, practical coaching designed around your goals, your body, and the life you actually live.'}</p>
          {certified.length > 0 && <>
            <p className="eyebrow" style={{ margin: '26px 0 10px' }}>CERTIFICATIONS</p>
            {certified.map((s) => <div key={s.sportCategoryId} style={{ borderBottom: '1px solid var(--line)', padding: '10px 0', fontSize: '.88rem' }}>
              <strong>{s.sportCategory?.name || 'Coaching'}</strong>
              <span className="muted"> · {[s.certification, s.yearsExperience ? `${s.yearsExperience} yrs` : ''].filter(Boolean).join(' · ')}</span>
            </div>)}
          </>}
          {achievements.length > 0 && <>
            <p className="eyebrow" style={{ margin: '26px 0 10px' }}>ACHIEVEMENTS</p>
            {achievements.map((a, i) => <div key={i} style={{ display: 'flex', gap: 12, borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
              <Trophy size={18} style={{ color: '#c28a35', flexShrink: 0, marginTop: 2 }} />
              <div><strong style={{ fontSize: '.9rem' }}>{a.title}</strong>{a.year && <span className="muted mono" style={{ fontSize: '.75rem' }}> · {a.year}</span>}
                {a.description && <p className="muted" style={{ fontSize: '.82rem', marginTop: 2 }}>{a.description}</p>}</div>
            </div>)}
          </>}
        </div>}
        {tab === 'reviews' && (
          <div style={{ gridColumn: '1 / -1', marginTop: 6 }}>
            {reviews.length === 0 ? <p className="muted">No reviews yet — be the first to train and rate this coach.</p> : reviews.map((r) => (
              <div key={r.id} style={{ borderBottom: '1px solid var(--line)', padding: '16px 0' }}>
                <strong>{r.client?.name || 'Athlete'}</strong> <span className="muted" style={{ fontSize: '.75rem' }}>· {new Date(r.createdAt).toLocaleDateString()}</span>
                <div style={{ color: '#c28a35', margin: '4px 0' }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</div>
                {r.comment && <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>{r.comment}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
      <aside className="booking-panel">
        <p className="eyebrow">BOOK A SESSION</p>
        <div className="price"><strong>₱{Number(coach.hourlyRate || 0)}</strong><span>/ session</span></div>
        {(coach.specializations?.length || 0) > 0 && <label>Sport for this session<select value={selectedSportCategoryId} onChange={(e) => setSelectedSportCategoryId(e.target.value)}><option value="">Choose a sport</option>{coach.specializations?.map((specialization) => <option key={specialization.sportCategoryId} value={specialization.sportCategoryId}>{specialization.sportCategory?.name || 'Coaching'}</option>)}</select></label>}
        <p style={{ fontSize: '.78rem', fontWeight: 700, margin: '14px 0 8px' }}>Pick one or more times</p>
        {slots.length === 0 ? <p className="muted" style={{ fontSize: '.8rem' }}>No open times right now — check back soon.</p> : (
          <div style={{ maxHeight: 280, overflowY: 'auto', marginBottom: 12, paddingRight: 4 }}>
            {Object.entries(slotsByDate).map(([date, daySlots]) => (
              <div key={date} style={{ marginBottom: 10 }}>
                <p className="muted" style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: '.04em', marginBottom: 6 }}>{new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {daySlots.map((slot) => {
                    const on = selected.includes(slot.id);
                    return <button key={slot.id} type="button" aria-pressed={on} onClick={() => toggleSlot(slot.id)} className="mono"
                      style={{ fontSize: '.75rem', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', border: `1.5px solid ${on ? 'var(--turf)' : 'var(--line)'}`, background: on ? 'var(--turf)' : 'transparent', color: on ? '#fff' : 'inherit' }}>
                      {on && <Check size={11} style={{ marginRight: 3, verticalAlign: -1 }} />}{slot.startTime.slice(0, 5)}
                    </button>;
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        {selectedSlots.length > 0 && <div style={{ borderTop: '1px solid var(--line)', padding: '10px 0', marginBottom: 6, fontSize: '.82rem' }}>
          {selectedSlots.map((s) => <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span>{new Date(`${s.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}</span>
            <span className="mono">₱{sessionPrice(coach.hourlyRate, s).toLocaleString()}</span>
          </div>)}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 6 }}>
            <span>Total · {selectedSlots.length} session{selectedSlots.length > 1 ? 's' : ''}</span><span className="mono">₱{total.toLocaleString()}</span>
          </div>
        </div>}
        <button className="button full" onClick={book} disabled={booking}>{booking ? 'Booking…' : selectedSlots.length > 1 ? `Request ${selectedSlots.length} sessions` : 'Request session'} <ArrowRight size={16} /></button>
        {selectedSlots.length > 1 && <small style={{ display: 'block', marginTop: 6 }}>You’ll pay for all {selectedSlots.length} sessions together in one checkout.</small>}
        {message && <p className="form-message">{message}</p>}
        <small>Free cancellation up to 24 hours before your session.</small>
      </aside>
    </div>
  </section>;
}

function AuthPage({ mode, onAuth }: { mode: 'login' | 'register'; onAuth: (s: Session) => void }) { const isLogin = mode === 'login'; const [form, setForm] = useState({ name: '', email: '', password: '', role: 'client' as Role }); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const navigate = useNavigate(); const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { const result = isLogin ? await api.login({ email: form.email, password: form.password }) : await api.register(form); onAuth(result.data); navigate('/dashboard'); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to continue.'); } finally { setBusy(false); } };
  return <section className="auth-page"><div className="auth-aside"><Link to="/explore" className="brand light-brand"><span className="brand-mark"><Dumbbell size={18} /></span> COACHCONNECT</Link><div><p className="eyebrow light">{isLogin ? 'WELCOME BACK' : 'YOUR NEXT CHAPTER'}</p><h1>{isLogin ? 'Good to see you.' : 'Make your move.'}</h1><p>{isLogin ? 'Your training plan is waiting.' : 'Find a coach who helps you go further.'}</p></div></div><div className="auth-form"><p className="eyebrow">{isLogin ? 'SIGN IN' : 'CREATE ACCOUNT'}</p><h2>{isLogin ? 'Welcome back' : 'Join CoachConnect'}</h2><form onSubmit={submit}>{!isLogin && <label>Your name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Alex Morgan" /></label>}<label>Email address<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" /></label><label>Password<input required minLength={8} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="8+ characters" /></label>{!isLogin && <label> I’m joining as<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}><option value="client">An athlete</option><option value="coach">A coach</option></select></label>}{error && <p className="error-text">{error}</p>}<button className="button full" disabled={busy}>{busy ? 'One moment...' : isLogin ? 'Log in' : 'Create account'} <ArrowRight size={16} /></button></form><p className="auth-switch">{isLogin ? 'New to CoachConnect?' : 'Already have an account?'} <Link to={isLogin ? '/register' : '/login'}>{isLogin ? 'Create an account' : 'Log in'}</Link></p></div></section>; }

function Dashboard({ session, onLogout, onUserChange }: { session: Session; onLogout: () => void; onUserChange: (user: User) => void }) {
  const role = (session.user.role?.name || 'client') as Role;
  const [mobile, setMobile] = useState(false);
  const location = useLocation();
  const [unreadMessages, setUnreadMessages] = useState(0);
  useEffect(() => {
    if (role === 'admin') return undefined;
    const refreshUnread = () => api.unreadMessageCount().then((result) => setUnreadMessages(result.data.count)).catch(() => {});
    refreshUnread();
    const timer = window.setInterval(refreshUnread, 15000);
    return () => window.clearInterval(timer);
  }, [role, location.pathname]);
  useEffect(() => setMobile(false), [location.pathname]);
  const isActive = (path: string) => location.pathname === path;
  return <section className="dashboard">
    {mobile && <div className="sidebar-backdrop" onClick={() => setMobile(false)} />}
    <aside className={mobile ? 'sidebar mobile-open' : 'sidebar'}>
      <div className="sidebar-top"><Link to="/explore" className="brand"><span className="brand-mark"><Dumbbell size={18} /></span> COACHCONNECT</Link><button className="icon-btn" onClick={() => setMobile(false)}><X /></button></div>
      <p className="side-label">WORKSPACE</p>
      <Link className={`side-link ${isActive('/dashboard') ? 'active' : ''}`} to="/dashboard"><CalendarDays size={17} /> Overview</Link>
      {role === 'client' && <Link className="side-link" to="/coaches"><Search size={17} /> Find a coach</Link>}
      <Link className={`side-link ${isActive('/dashboard/bookings') ? 'active' : ''}`} to="/dashboard/bookings"><Check size={17} /> Bookings</Link>
      {role !== 'admin' && <Link className={`side-link ${isActive('/dashboard/messages') ? 'active' : ''}`} to="/dashboard/messages"><Bell size={17} /> Messages{unreadMessages > 0 && <span className="message-badge">{unreadMessages > 99 ? '99+' : unreadMessages}</span>}</Link>}
      <Link className={`side-link ${isActive('/dashboard/profile') ? 'active' : ''}`} to="/dashboard/profile"><CircleUserRound size={17} /> My profile</Link>
      {role === 'client' && <Link className={`side-link ${isActive('/dashboard/payment-methods') ? 'active' : ''}`} to="/dashboard/payment-methods"><CreditCard size={17} /> Payment methods</Link>}
      <Link className={`side-link ${isActive('/dashboard/notifications') ? 'active' : ''}`} to="/dashboard/notifications"><Bell size={17} /> Notifications</Link>
      {role === 'coach' && <>
        <p className="side-label">COACHING</p>
        <Link className={`side-link ${isActive('/dashboard/coach/profile') ? 'active' : ''}`} to="/dashboard/coach/profile"><Trophy size={17} /> Coach profile</Link>
        <Link className={`side-link ${isActive('/dashboard/coach/availability') ? 'active' : ''}`} to="/dashboard/coach/availability"><CalendarDays size={17} /> Availability</Link>
      </>}
      {role === 'admin' && <><p className="side-label">ADMIN</p><Link className={`side-link ${isActive('/dashboard/admin') ? 'active' : ''}`} to="/dashboard/admin"><ShieldCheck size={17} /> Command center</Link></>}
      <div className="side-bottom"><div className="mini-avatar">{session.user.name.slice(0, 1)}</div><div><strong>{session.user.name}</strong><small>{role}</small></div><button className="icon-btn" onClick={onLogout} title="Log out"><LogOut size={16} /></button></div>
    </aside>
    <div className="dashboard-main">
      <div className="dash-mobile-top"><button className="icon-btn" onClick={() => setMobile(true)}><Menu /></button><span>Overview</span><Bell size={18} /></div>
      <Routes>
        <Route index element={<Overview session={session} />} />
        <Route path="bookings" element={<Bookings viewerRole={role} />} />
        <Route path="profile" element={<AccountPage user={session.user} onUserChange={onUserChange} />} />
        <Route path="messages" element={role !== 'admin' ? <MessagesPage role={role as 'client' | 'coach'} user={session.user} /> : <Navigate to="/dashboard" />} />
        <Route path="payment-methods" element={role === 'client' ? <PaymentMethods /> : <Navigate to="/dashboard" />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="coach/availability" element={role === 'coach' ? <CoachAvailability /> : <Navigate to="/dashboard" />} />
        <Route path="coach/profile" element={role === 'coach' ? <CoachProfileEditor /> : <Navigate to="/dashboard" />} />
        <Route path="admin" element={role === 'admin' ? <AdminPanel /> : <Navigate to="/dashboard" />} />
      </Routes>
    </div>
  </section>;
}

function CoachProfileStrength({ coach }: { coach: CoachProfile | null }) {
  const { items, percent } = profileChecklist(coach);
  const todo = items.filter((i) => !i.done);
  return <section className="dash-panel accent-panel">
    <p className="eyebrow">PROFILE STRENGTH</p>
    <h2>{percent}% complete</h2>
    <div style={{ height: 6, borderRadius: 6, background: 'rgba(255,255,255,.25)', margin: '0 0 16px' }}>
      <div style={{ width: `${percent}%`, height: '100%', borderRadius: 6, background: 'var(--gold)' }} />
    </div>
    {todo.length === 0
      ? <p>Your profile is complete — athletes can see your levels, sports and achievements.</p>
      : <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', fontSize: '.88rem', lineHeight: 1.9 }}>{todo.map((i) => <li key={i.label}>○ {i.label}</li>)}</ul>}
    <Link className="underlink" to="/dashboard/coach/profile">{todo.length ? 'Finish your profile' : 'Edit your profile'} <ArrowRight size={16} /></Link>
  </section>;
}

function Overview({ session }: { session: Session }) {
  const role = (session.user.role?.name || 'client') as Role;
  const [upcoming, setUpcoming] = useState<Booking[]>([]);
  const [completed, setCompleted] = useState<Booking[]>([]);
  const [coachProfile, setCoachProfile] = useState<CoachProfile | null>(null);
  const rating = coachProfile?.averageRating ?? null;
  const [platformGcash, setPlatformGcash] = useState<{ number: string; accountName: string } | null>(null);

  useEffect(() => {
    api.bookings({ timeframe: 'upcoming' }).then((r) => setUpcoming(r.data || [])).catch(() => {});
    api.bookings({ status: 'completed' }).then((r) => setCompleted(r.data || [])).catch(() => {});
    if (role === 'coach') {
      api.profile().then((r) => setCoachProfile(r.data.coachProfile ?? null)).catch(() => {});
      api.platformGcashAccount().then((r) => setPlatformGcash(r.data)).catch(() => {});
    }
  }, [role]);

  const totalMoney = completed.reduce((sum, b) => sum + (b.payment?.status === 'paid' ? Number(b.price) : 0), 0);
  // Platform commission is never the coach's money, on either GCash path —
  // deducted automatically from what's shown here as "earned" either way.
  const totalCommission = completed.reduce((sum, b) => sum + (b.payment?.status === 'paid' && b.payment.platformFeeAmount ? Number(b.payment.platformFeeAmount) : 0), 0);
  const netEarned = totalMoney - totalCommission;
  // Manual GCash: money already sits with the coach, and this is what they
  // still owe the platform for its cut.
  const unsettledCommission = completed.reduce((sum, b) => sum + (b.payment?.status === 'paid' && b.payment.provider === 'gcash' && !b.payment.platformFeeSettled ? Number(b.payment.platformFeeAmount || 0) : 0), 0);
  // Automatic (PayMongo) GCash: the platform holds the money, and this is
  // the coach's net share still waiting to be paid out to them.
  const pendingPayout = completed.reduce((sum, b) => sum + (b.payment?.status === 'paid' && b.payment.provider === 'paymongo' && !b.payment.payoutSettled ? Number(b.payment.payoutAmount || 0) : 0), 0);
  const next = upcoming[0];
  const memberSince = session.user.createdAt ? new Date(session.user.createdAt).getFullYear() : null;

  return <>
    <div className="dash-header">
      <div><p className="eyebrow">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</p><h1>Good morning, {session.user.name.split(' ')[0]}.</h1><p className="muted">Keep the momentum going.</p></div>
      {role === 'client' && <Link className="button" to="/coaches">Book a session <ArrowRight size={16} /></Link>}
      {role === 'coach' && <Link className="button" to="/dashboard/coach/profile">Edit coach profile <ArrowRight size={16} /></Link>}
    </div>
    <div className="stat-grid">
      <Stat label="Upcoming sessions" value={String(upcoming.length).padStart(2, '0')} icon={<CalendarDays />} />
      <Stat label="Sessions completed" value={String(completed.length).padStart(2, '0')} icon={<Check />} />
      <Stat label={role === 'coach' ? 'Net earned (completed)' : 'Invested (completed)'} value={`₱${(role === 'coach' ? netEarned : totalMoney).toLocaleString()}`} icon={<Dumbbell />} />
      {role === 'coach'
        ? <Stat label="Your rating" value={rating != null ? Number(rating).toFixed(1) : '—'} icon={<Star />} />
        : <Stat label="Member since" value={memberSince ? String(memberSince) : '—'} icon={<Star />} />}
    </div>
    {role === 'coach' && totalCommission > 0 && (
      <div className="muted" style={{ marginTop: -14, marginBottom: 24, fontSize: '.8rem' }}>
        <p>₱{totalCommission.toLocaleString()} in platform commission was automatically deducted from your earnings above.</p>
        {unsettledCommission > 0 && (
          <p style={{ marginTop: 4 }}>
            <strong style={{ color: 'var(--orange)' }}>₱{unsettledCommission.toLocaleString()} of that</strong> was on GCash payments sent straight to you — you still owe it to the platform
            {platformGcash?.number && <>, send it to <strong>{platformGcash.number}</strong> ({platformGcash.accountName})</>}.
          </p>
        )}
        {pendingPayout > 0 && (
          <p style={{ marginTop: 4 }}>
            <strong style={{ color: 'var(--turf-dark)' }}>₱{pendingPayout.toLocaleString()}</strong> is your net share from automatic GCash payments the platform collected — waiting for the platform to pay it out to you.
          </p>
        )}
      </div>
    )}
    <div className="dash-columns">
      <section className="dash-panel">
        <div className="panel-heading"><div><p className="eyebrow">NEXT UP</p><h2>Your upcoming session</h2></div><Link to="/dashboard/bookings">See all <ArrowRight size={15} /></Link></div>
        {next ? <BookingRow booking={next} viewerRole={role} onChanged={() => window.location.reload()} /> : <EmptyState compact />}
      </section>
      {role === 'coach' ? <CoachProfileStrength coach={coachProfile} /> : (
        <section className="dash-panel accent-panel">
          <p className="eyebrow">A LITTLE NUDGE</p><h2>Consistency beats intensity.</h2><p>One focused session today can change the shape of your whole week.</p>
          <Link className="underlink" to="/coaches">Find your next session <ArrowRight size={16} /></Link>
        </section>
      )}
    </div>
  </>;
}

function Bookings({ viewerRole }: { viewerRole: Role }) {
  const [items, setItems] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = () => { setLoading(true); api.bookings().then((r) => setItems(r.data || [])).finally(() => setLoading(false)); };
  useEffect(refresh, []);

  // Multi-session checkouts still waiting for payment: paid once, together.
  const unpaidCheckouts = viewerRole === 'client' ? Object.values(items.reduce<Record<string, Booking[]>>((acc, b) => {
    if (b.checkoutId && needsClientPayment(b)) (acc[b.checkoutId] ||= []).push(b);
    return acc;
  }, {})).filter((group) => group.length > 1) : [];
  const groupedIds = new Set(unpaidCheckouts.flat().map((b) => b.id));

  return <div className="content-page">
    <div className="dash-header"><div><p className="eyebrow">{viewerRole === 'coach' ? 'MANAGE YOUR SESSIONS' : 'YOUR TRAINING LOG'}</p><h1>Bookings</h1></div>{viewerRole === 'client' && <Link className="button" to="/coaches">New booking <ArrowRight size={16} /></Link>}</div>
    {!loading && unpaidCheckouts.map((group) => <CheckoutGroup key={group[0].checkoutId!} bookings={group} onChanged={refresh} />)}
    <div className="dash-panel">{loading ? <Loading /> : items.length ? items.map((item) => <BookingRow key={item.id} booking={item} viewerRole={viewerRole} onChanged={refresh} payViaGroup={groupedIds.has(item.id)} />) : <EmptyState compact />}</div>
  </div>;
}

function needsClientPayment(booking: Booking) {
  const awaitingGcash = booking.payment?.provider === 'gcash' && booking.payment?.status === 'submitted';
  return booking.status === 'pending' && booking.payment?.status !== 'paid' && !awaitingGcash;
}

function CheckoutGroup({ bookings, onChanged }: { bookings: Booking[]; onChanged: () => void }) {
  const [paying, setPaying] = useState(false);
  const sorted = [...bookings].sort((a, b) => `${a.timeSlot?.date} ${a.timeSlot?.startTime}`.localeCompare(`${b.timeSlot?.date} ${b.timeSlot?.startTime}`));
  const total = Math.round(sorted.reduce((sum, b) => sum + Number(b.price), 0) * 100) / 100;
  const coachName = sorted[0].coach?.user?.name || 'your coach';

  return <div className="dash-panel" style={{ marginBottom: 20, borderColor: 'var(--orange)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <p className="eyebrow" style={{ marginBottom: 6 }}>AWAITING PAYMENT</p>
        <h2 style={{ fontSize: '1.15rem' }}>{sorted.length} sessions with {coachName}</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', fontSize: '.82rem' }}>
          {sorted.map((b) => <li key={b.id} className="muted" style={{ padding: '2px 0' }}>
            {b.timeSlot?.date ? new Date(`${b.timeSlot.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'TBD'} · {b.timeSlot?.startTime?.slice(0, 5)} · <span className="mono">₱{Number(b.price).toLocaleString()}</span>
          </li>)}
        </ul>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700 }}>₱{total.toLocaleString()}</div>
        <button className="button" style={{ marginTop: 8 }} onClick={() => setPaying((p) => !p)}>{paying ? 'Hide payment' : `Pay for ${sorted.length} sessions`}</button>
      </div>
    </div>
    {paying && <div style={{ marginTop: 16 }}><Checkout bookingId={sorted[0].id} amount={total} onDone={() => { setPaying(false); onChanged(); }} onCancel={() => setPaying(false)} /></div>}
  </div>;
}

function BookingRow({ booking, viewerRole, onChanged, payViaGroup = false }: { booking: Booking; viewerRole: Role; onChanged: () => void; payViaGroup?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [msg, setMsg] = useState('');

  const otherPartyName = viewerRole === 'coach' ? (booking.client?.name || 'Athlete') : (booking.coach?.user?.name || 'Coaching session');

  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setMsg(''); try { await fn(); onChanged(); } catch (e) { setMsg(e instanceof Error ? e.message : 'That didn’t go through.'); setBusy(false); } };

  const awaitingGcash = booking.payment?.provider === 'gcash' && booking.payment?.status === 'submitted';
  const needsPayment = viewerRole === 'client' && !payViaGroup && needsClientPayment(booking);
  const canReview = viewerRole === 'client' && booking.status === 'completed';
  const canResolveGcash = viewerRole === 'coach' && awaitingGcash;

  return <div>
    <div className="booking-row">
      <div className="booking-date"><strong>{booking.timeSlot?.date ? new Date(`${booking.timeSlot.date}T00:00:00`).toLocaleDateString('en-US', { day: '2-digit' }) : '--'}</strong><span>{booking.timeSlot?.date ? new Date(`${booking.timeSlot.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short' }) : 'TBD'}</span></div>
      <div className="booking-info">
        <strong>{otherPartyName}</strong>
        <span>{booking.sportCategory?.name || 'Training'} · {booking.timeSlot?.startTime || 'Time pending'}</span>
        {awaitingGcash && <span style={{ color: 'var(--orange)' }}>GCash ref {booking.payment?.gcashReference} · awaiting confirmation{booking.checkoutId ? ' · covers every session paid with this reference' : ''}</span>}
        {payViaGroup && <span style={{ color: 'var(--orange)' }}>Part of a multi-session checkout — pay above</span>}
      </div>
      <span className={`status ${booking.status}`}>{booking.status}</span>
      <div style={{ display: 'flex', gap: 10 }}>
        {viewerRole === 'coach' && booking.status === 'pending' && <>
          <button className="cancel-link" disabled={busy} onClick={() => act(() => api.updateBookingStatus(booking.id, 'confirmed'))}>Accept</button>
          <button className="cancel-link" disabled={busy} onClick={() => act(() => api.cancelBooking(booking.id))}>Decline</button>
        </>}
        {viewerRole === 'coach' && booking.status === 'confirmed' && <>
          <button className="cancel-link" disabled={busy} onClick={() => act(() => api.updateBookingStatus(booking.id, 'completed'))}>Mark complete</button>
          <button className="cancel-link" disabled={busy} onClick={() => act(() => api.cancelBooking(booking.id))}>Cancel</button>
        </>}
        {canResolveGcash && <>
          <button className="cancel-link" disabled={busy} onClick={() => act(() => api.confirmGcashPayment(booking.payment!.id))}>Confirm GCash payment</button>
          <button className="cancel-link" disabled={busy} onClick={() => act(() => api.rejectGcashPayment(booking.payment!.id))}>Reject</button>
        </>}
        {viewerRole === 'client' && (booking.status === 'pending' || booking.status === 'confirmed') && <button className="cancel-link" disabled={busy} onClick={() => act(() => api.cancelBooking(booking.id))}>Cancel</button>}
        <Link className="cancel-link" to={`/dashboard/messages?bookingId=${booking.id}`}>Message</Link>
        {needsPayment && <button className="cancel-link" onClick={() => setPaying((p) => !p)}>{paying ? 'Hide payment' : 'Pay now'}</button>}
        {canReview && <button className="cancel-link" onClick={() => setReviewing((r) => !r)}>{reviewing ? 'Hide' : 'Leave a review'}</button>}
      </div>
    </div>
    {msg && <p className="form-message" style={{ padding: '0 0 12px' }}>{msg}</p>}
    {paying && <Checkout bookingId={booking.id} amount={booking.price} onDone={() => { setPaying(false); onChanged(); }} onCancel={() => setPaying(false)} />}
    {reviewing && <ReviewForm bookingId={booking.id} onDone={() => { setReviewing(false); onChanged(); }} onCancel={() => setReviewing(false)} />}
  </div>;
}

function Notifications() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const refresh = () => { api.notifications().then((r) => setItems(r.data || [])).catch(() => {}); };
  useEffect(refresh, []);
  const markRead = (id: string) => { api.markNotificationRead(id).then(refresh); };
  return <div className="content-page">
    <div className="dash-header"><div><p className="eyebrow">STAY IN THE LOOP</p><h1>Notifications</h1></div></div>
    <div className="dash-panel notification-list">
      {items.length ? items.map((item) => (
        <div className={item.isRead ? 'notification read' : 'notification'} key={item.id} onClick={() => !item.isRead && markRead(item.id)} style={{ cursor: item.isRead ? 'default' : 'pointer' }}>
          <span><Bell size={17} /></span><div><strong>{item.title}</strong><p>{item.message}</p></div><small>{new Date(item.createdAt).toLocaleDateString()}</small>
        </div>
      )) : <EmptyState compact />}
    </div>
  </div>;
}

export default App;
