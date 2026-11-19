import { useEffect, useState } from 'react';
import { Send, Upload } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api, Booking, Message, User } from '../services/api';
import { EmptyState, ErrorMessage, Loading } from '../components/shared';

export function AccountPage({ user, onUserChange }: { user: User; onUserChange: (user: User) => void }) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone || '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.updateProfile({ name, phone });
      onUserChange(result.data);
      setMessage('Profile updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update profile.');
    } finally { setBusy(false); }
  };

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const result = await api.uploadProfileImage(file);
      onUserChange({ ...user, profileImage: result.data.profileImage });
      setMessage('Profile picture updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not upload profile picture.');
    } finally { setBusy(false); event.target.value = ''; }
  };

  return <div className="content-page">
    <div className="dash-header"><div><p className="eyebrow">YOUR ACCOUNT</p><h1>Profile</h1></div></div>
    <form onSubmit={save} className="dash-panel" style={{ maxWidth: 560 }}>
      <div className="detail-avatar" style={{ marginBottom: 16, overflow: 'hidden' }}>{user.profileImage ? <img src={user.profileImage} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : user.name.slice(0, 1)}</div>
      <label className="btn-outline" style={{ display: 'inline-flex', width: 'auto', cursor: busy ? 'wait' : 'pointer', marginBottom: 22 }}><Upload size={14} /> Choose profile picture<input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} disabled={busy} style={{ display: 'none' }} /></label>
      <div className="mini-form"><label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label></div>
      {message && <p className="form-message">{message}</p>}
      <button className="button" type="submit" disabled={busy}>Save profile</button>
    </form>
  </div>;
}

export function MessagesPage({ role, user }: { role: 'client' | 'coach'; user: User }) {
  const [items, setItems] = useState<Message[]>([]);
  const [searchParams] = useSearchParams();
  const [activeBookingId, setActiveBookingId] = useState(searchParams.get('bookingId') || '');
  const [activeBooking, setActiveBooking] = useState<Booking | null>(null);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const refresh = () => api.messages().then((result) => { const messages = result.data || []; setItems(messages); setActiveBookingId((current) => current || messages[0]?.bookingId || ''); }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load messages.'));

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!activeBookingId) { setActiveBooking(null); return; }
    api.booking(activeBookingId).then((result) => setActiveBooking(result.data)).catch(() => setActiveBooking(null));
  }, [activeBookingId]);
  const send = async (event: React.FormEvent) => { event.preventDefault(); if (!activeBookingId || !content.trim()) { setError('Select a conversation before sending a message.'); return; } try { await api.sendMessage({ bookingId: activeBookingId, content }); setContent(''); refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not send message.'); } };
  const conversations = Array.from(new Map(items.map((item) => [item.bookingId, item])).values());
  const activeMessages = items.filter((item) => item.bookingId === activeBookingId).reverse();
  const activeLatest = conversations.find((item) => item.bookingId === activeBookingId);
  const activePartner = activeLatest
    ? (activeLatest.sender?.id === user?.id ? activeLatest.recipient : activeLatest.sender)
    : role === 'client' ? activeBooking?.coach?.user : activeBooking?.client;

  return <div className="content-page"><div className="dash-header"><div><p className="eyebrow">{role === 'client' ? 'YOUR COACHES' : 'YOUR ATHLETES'}</p><h1>Inbox</h1></div></div>
    <div className="inbox-panel">
      <aside className="inbox-list"><div className="inbox-list-heading"><strong>Conversations</strong><span>{conversations.length}</span></div>{conversations.length ? conversations.map((item) => { const partner = item.sender?.id === user?.id ? item.recipient : item.sender; return <button className={`inbox-conversation ${item.bookingId === activeBookingId ? 'active' : ''}`} type="button" key={item.bookingId} onClick={() => setActiveBookingId(item.bookingId)}><span className="inbox-avatar">{partner?.profileImage ? <img src={partner.profileImage} alt="" /> : partner?.name?.slice(0, 1) || 'M'}</span><span className="inbox-preview"><strong>{partner?.name || 'Member'}</strong><small>{item.content}</small></span></button>; }) : <p className="muted inbox-empty">No conversations yet.</p>}</aside>
      <section className="inbox-thread">{activePartner ? <><header className="inbox-thread-header"><span className="inbox-avatar large">{activePartner.profileImage ? <img src={activePartner.profileImage} alt="" /> : activePartner.name?.slice(0, 1) || 'M'}</span><div><strong>{activePartner.name}</strong><small>Private conversation</small></div></header><div className="inbox-thread-messages">{activeMessages.map((item) => <div className={item.sender?.id === user?.id ? 'thread-message mine' : 'thread-message'} key={item.id}><strong>{item.sender?.id === user?.id ? 'You' : item.sender?.name || 'Member'}</strong><p>{item.content}</p><small>{new Date(item.createdAt).toLocaleString()}</small></div>)}</div><form onSubmit={send} className="inbox-compose"><input value={content} onChange={(event) => setContent(event.target.value)} placeholder="Write a message..." maxLength={2000} /><button className="button" type="submit"><Send size={15} /> Send</button></form></> : <div className="inbox-no-selection"><Send size={25} /><h2>Select a conversation</h2><p>Choose a conversation from your inbox or a booking to start a private message.</p></div>}</section>
      {error && <ErrorMessage text={error} />}
    </div>
  </div>;
}
