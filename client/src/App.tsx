import { FormEvent, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QHistoryItem, QState, req } from './api';
import { CONTACT_EMAIL, PRODUCT_NAME } from './config';
import { idbGet, idbSet } from './idb';
import { ticketStatus } from './status';
import { useQueue } from './useQueue';
import { AuthUser, UserRole, getCurrentUser, initAuth, login, logout, register, subscribeAuth } from './auth';

initAuth();

function useRoute() {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const f = () => setHash(location.hash || '#/');
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return hash.replace(/^#/, '').split('/').filter(Boolean);
}

function AuthModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('Owner');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (tab === 'login') {
        await login(email, password);
      } else {
        await register(email, password, name, role);
      }
      onClose();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function fillDemoAdmin() {
    setEmail('admin@queue.io');
    setPassword('Admin123!');
    setTab('login');
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-tabs">
          <button
            type="button"
            className={`modal-tab ${tab === 'login' ? 'active' : ''}`}
            onClick={() => { setTab('login'); setErr(''); }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`modal-tab ${tab === 'register' ? 'active' : ''}`}
            onClick={() => { setTab('register'); setErr(''); }}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {tab === 'register' && (
            <>
              <label>Select Your Role</label>
              <div className="role-pill-group" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div
                  className={`role-pill ${role === 'Owner' ? 'selected' : ''}`}
                  onClick={() => setRole('Owner')}
                  role="button"
                  tabIndex={0}
                >
                  👑 Queue Owner
                </div>
                <div
                  className={`role-pill ${role === 'Customer' ? 'selected' : ''}`}
                  onClick={() => setRole('Customer')}
                  role="button"
                  tabIndex={0}
                >
                  👤 Customer / Patient
                </div>
              </div>

              <label htmlFor="auth-name">Your Full Name</label>
              <input
                id="auth-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g. Dr. Sarah / Gokul"
              />
            </>
          )}

          <label htmlFor="auth-email">Email Address</label>
          <input
            id="auth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
          />

          <label htmlFor="auth-pass">Password</label>
          <input
            id="auth-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder="Min 6 characters"
          />

          {err && <p className="error" role="alert">{err}</p>}

          <div className="row" style={{ marginTop: '16px', justifyContent: 'space-between' }}>
            <button className="primary" disabled={busy}>
              {busy ? 'Connecting...' : tab === 'login' ? 'Sign In' : 'Create Account'}
            </button>
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>

        <div style={{ marginTop: '20px', paddingTop: '14px', borderTop: '1px solid var(--line)', fontSize: '0.85rem', textAlign: 'center' }}>
          <p className="muted" style={{ margin: '0 0 8px' }}>AWS Cognito Demo Access:</p>
          <button type="button" className="btn-link" onClick={fillDemoAdmin}>
            ⚡ Auto-fill Default Admin (admin@queue.io)
          </button>
        </div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getCurrentUser());
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    return subscribeAuth(setUser);
  }, []);

  return (
    <>
      <header className="bar">
        <div className="bar-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <a href="#/" className="brand">{PRODUCT_NAME}</a>
            {user?.role === 'Admin' && (
              <a href="#/admin" style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--warn)' }}>
                ⚡ Admin Console
              </a>
            )}
          </div>
          <div className="auth-nav">
            {user ? (
              <>
                <span className={`auth-badge badge-${user.role.toLowerCase()}`}>
                  {user.role === 'Owner' && '👑 '}
                  {user.role === 'Customer' && '👤 '}
                  {user.role === 'Admin' && '⚡ '}
                  {user.role}
                </span>
                <span style={{ fontWeight: 600 }}>{user.name}</span>
                <button className="btn-sm secondary" onClick={logout}>Sign out</button>
              </>
            ) : (
              <button className="btn-sm primary" onClick={() => setShowAuth(true)}>
                Sign In / Register
              </button>
            )}
          </div>
        </div>
      </header>
      <main>{children}</main>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      <footer className="foot">
        <a href="/privacy.html">Privacy policy</a>
        <a href="/terms.html">Terms and conditions</a>
        <span>{CONTACT_EMAIL}</span>
      </footer>
    </>
  );
}

function Home() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [joinErr, setJoinErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(getCurrentUser());
  const [myQueues, setMyQueues] = useState<{ id: string; name: string; paused: boolean; nowServing: number }[]>([]);

  useEffect(() => {
    return subscribeAuth(setUser);
  }, []);

  useEffect(() => {
    if (user?.role === 'Owner') {
      req<{ queues: typeof myQueues }>('/api/owner/queues')
        .then((r) => setMyQueues(r.queues))
        .catch(() => {});
    } else {
      setMyQueues([]);
    }
  }, [user]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await req<{ id: string; ownerKey: string }>('/api/queues', { method: 'POST', body: JSON.stringify({ name }) });
      await idbSet('owner:' + r.id, r.ownerKey);
      location.hash = '#/owner/' + r.id;
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  }
  function join(e: FormEvent) {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
      setJoinErr('Enter a 6-character queue code');
      return;
    }
    if (!/^[A-Z0-9]{6}$/.test(cleanCode)) {
      setJoinErr('Queue code must be exactly 6 letters/numbers');
      return;
    }
    location.hash = '#/q/' + cleanCode;
  }

  return (
    <>
      <section className="intro">
        <h1>Queue tokens for clinics and small shops</h1>
        <p>
          Customers open a link or scan a QR code on their phone, get a token number, and watch their place in line
          with live wait estimates. The owner runs the line from any browser.
        </p>
      </section>

      {/* Admin Experience: Supervise only, cannot create or join */}
      {user?.role === 'Admin' && (
        <section className="panel" style={{ borderLeft: '4px solid var(--warn)', margin: '24px 0' }}>
          <h2>⚡ System Administrator</h2>
          <p className="muted">
            You are signed in as the system admin. Administrators supervise all queues across the platform via the
            Admin Console and do not create or join individual queues.
          </p>
          <div style={{ marginTop: '16px' }}>
            <a
              href="#/admin"
              className="primary"
              style={{ display: 'inline-block', textDecoration: 'none', padding: '10px 20px', borderRadius: '4px' }}
            >
              Open Admin Console
            </a>
          </div>
        </section>
      )}

      {/* Owner Experience: Can create and manage, cannot join */}
      {user?.role === 'Owner' && (
        <>
          {myQueues.length > 0 && (
            <section className="panel">
              <h2>Your Active Queues</h2>
              <div className="row">
                {myQueues.map((q) => (
                  <a
                    key={q.id}
                    href={`#/owner/${q.id}`}
                    className="btn-sm secondary"
                    style={{ textDecoration: 'none', padding: '10px 14px', border: '1px solid var(--accent)', borderRadius: '6px' }}
                  >
                    <strong>{q.name}</strong> ({q.id}) — Now serving: #{q.nowServing || 'None'}
                  </a>
                ))}
              </div>
            </section>
          )}

          <section className="panel" style={{ maxWidth: '520px', margin: '24px auto' }}>
            <h2>Create a new queue</h2>
            <p className="muted">Set up a virtual queue for your clinic, salon, or office counter.</p>
            <form onSubmit={create}>
              <label htmlFor="qn">Queue name</label>
              <input
                id="qn"
                value={name}
                onChange={(e) => { setName(e.target.value); setErr(''); }}
                maxLength={60}
                placeholder="Example: Morning OPD / Hair Studio"
              />
              {err && <p className="error" role="alert">{err}</p>}
              <button className="primary" style={{ width: '100%' }} disabled={busy}>
                Create queue
              </button>
            </form>
          </section>
        </>
      )}

      {/* Customer Experience: Can only join queues */}
      {user?.role === 'Customer' && (
        <section className="panel" style={{ maxWidth: '480px', margin: '24px auto' }}>
          <h2>Join a queue</h2>
          <p className="muted">
            Signed in as <strong>{user.name}</strong> (Customer). Enter the 6-character queue code from your clinic or shop counter.
          </p>
          <form onSubmit={join}>
            <label htmlFor="qc">Queue code</label>
            <input
              id="qc"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setJoinErr(''); }}
              maxLength={6}
              placeholder="6 characters (e.g. ABC123)"
              autoCapitalize="characters"
            />
            {joinErr && <p className="error" role="alert">{joinErr}</p>}
            <button className="primary" style={{ width: '100%' }}>
              Join queue
            </button>
          </form>
        </section>
      )}

      {/* Guest / Visitor Experience: Join a queue or sign in as Owner to create */}
      {!user && (
        <section className="split">
          <form onSubmit={create} className="panel">
            <h2>Run a queue</h2>
            <p className="muted" style={{ fontSize: '0.85rem' }}>For clinic & shop owners.</p>
            <label htmlFor="qn">Queue name</label>
            <input
              id="qn"
              value={name}
              onChange={(e) => { setName(e.target.value); setErr(''); }}
              maxLength={60}
              placeholder="Example: Morning OPD"
            />
            {err && <p className="error" role="alert">{err}</p>}
            <button className="primary" disabled={busy}>Create queue</button>
          </form>
          <form onSubmit={join} className="panel">
            <h2>Join a queue</h2>
            <p className="muted" style={{ fontSize: '0.85rem' }}>For customers & patients.</p>
            <label htmlFor="qc">Queue code</label>
            <input
              id="qc"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setJoinErr(''); }}
              maxLength={6}
              placeholder="6 characters"
              autoCapitalize="characters"
            />
            {joinErr && <p className="error" role="alert">{joinErr}</p>}
            <button className="secondary">Open queue</button>
          </form>
        </section>
      )}
    </>
  );
}

function Banner({ live, updatedAt }: { live: boolean; updatedAt: number | null }) {
  if (live || !updatedAt) return null;
  const t = new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return <p className="banner" role="status">No connection. Showing the last update from {t}.</p>;
}

function QRCodeDisplay({ url, code }: { url: string; code: string }) {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    QRCode.toDataURL(url, {
      width: 200,
      margin: 1,
      color: { dark: '#0f5c4a', light: '#ffffff' },
    })
      .then(setDataUrl)
      .catch(() => {});
  }, [url]);

  return (
    <div className="qr-container">
      {dataUrl ? <img src={dataUrl} alt={`Scan to join queue ${code}`} /> : <p className="muted">Generating QR code...</p>}
      <p className="muted" style={{ margin: '8px 0 0', fontSize: '0.9rem' }}>Scan with any phone camera to join</p>
    </div>
  );
}

function StatsChart({ history }: { history?: QHistoryItem[] }) {
  if (!history || history.length === 0) {
    return <p className="muted">No service data yet. The chart will update as customers are called and served.</p>;
  }

  const maxMin = Math.max(...history.map((h) => h.service_minutes || 1), 10);
  const chartHeight = 90;
  const barWidth = 24;
  const gap = 12;
  const totalWidth = history.length * (barWidth + gap);

  return (
    <div className="chart-box">
      <p style={{ fontWeight: 700, margin: '0 0 8px 0', fontSize: '0.95rem' }}>Service times (minutes per ticket)</p>
      <div style={{ overflowX: 'auto', paddingBottom: '4px' }}>
        <svg viewBox={`0 0 ${Math.max(totalWidth, 260)} 120`} className="chart-svg" style={{ minWidth: `${Math.max(totalWidth, 260)}px` }}>
          {history.map((h, i) => {
            const mins = h.service_minutes || 1;
            const hRatio = Math.min(1, mins / maxMin);
            const bHeight = Math.max(8, hRatio * chartHeight);
            const x = i * (barWidth + gap) + 10;
            const y = chartHeight - bHeight + 10;
            const isSkipped = h.status === 'skipped';
            const color = isSkipped ? 'var(--warn)' : 'var(--accent)';

            return (
              <g key={i}>
                <rect x={x} y={y} width={barWidth} height={bHeight} rx={3} fill={color} />
                <text x={x + barWidth / 2} y={y - 3} textAnchor="middle" fontSize={11} fill="var(--ink)" fontWeight={700}>
                  {isSkipped ? 'Skip' : `${mins}m`}
                </text>
                <text x={x + barWidth / 2} y={chartHeight + 22} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  #{h.number}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="chart-legend">
        <span><span className="legend-dot" style={{ background: 'var(--accent)' }}></span> Served</span>
        <span><span className="legend-dot" style={{ background: 'var(--warn)' }}></span> Skipped</span>
      </div>
    </div>
  );
}

function Customer({ id }: { id: string }) {
  const { state, live, updatedAt, notFound, loadError, applyState } = useQueue(id);
  const [ticket, setTicket] = useState<{ number: number } | null | undefined>(undefined);
  const user = getCurrentUser();
  const [name, setName] = useState(user?.name || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [notifGranted, setNotifGranted] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  );

  useEffect(() => {
    if (user?.name && !name) setName(user.name);
  }, [user]);

  useEffect(() => { idbGet<{ number: number }>('ticket:' + id).then((t) => setTicket(t ?? null)); }, [id]);

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await req<{ number: number; state?: QState }>(`/api/queues/${id}/join`, { method: 'POST', body: JSON.stringify({ name }) });
      await idbSet('ticket:' + id, { number: res.number });
      if (res.state) applyState(res.state);
      setTicket({ number: res.number });
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  }

  async function clearTicket() {
    await idbSet('ticket:' + id, null);
    setTicket(null);
  }

  async function requestNotification() {
    if ('Notification' in window) {
      const p = await Notification.requestPermission();
      setNotifGranted(p === 'granted');
    }
  }

  const status = ticket && state ? ticketStatus(state, ticket.number) : null;
  const peopleAhead = status?.kind === 'waiting' ? status.position - 1 : 0;
  const isNear = status?.kind === 'waiting' && status.position <= 2;
  const waitMinutes = status?.kind === 'waiting'
    ? (state && state.nowServing > 0 ? status.position : peopleAhead) * (state?.avgMinutes ?? 5)
    : 0;

  // Browser Notification trigger
  useEffect(() => {
    if (!ticket || !state || !notifGranted || typeof Notification === 'undefined') return;

    if (status?.kind === 'called') {
      new Notification('It is your turn!', {
        body: `Ticket #${ticket.number} is being called at the counter!`,
        icon: '/favicon.svg',
      });
    } else if (isNear) {
      new Notification('Your turn is near!', {
        body: `You are #${ticket.number}. Only ${peopleAhead} ahead of you at ${state.name}.`,
        icon: '/favicon.svg',
      });
    }
  }, [isNear, status?.kind]);

  if (notFound) return <section className="panel"><h1>Queue not found</h1><p>Check the code and try again.</p><a href="#/">Back to start</a></section>;
  if (!state && loadError) return <section className="panel"><h1>Connection problem</h1><p>{loadError}</p><a href="#/">Back to start</a></section>;
  if (!state || ticket === undefined) return <p>Loading</p>;

  return (
    <section className="panel">
      <Banner live={live} updatedAt={updatedAt} />
      <h1>{state.name}</h1>
      <p className="muted">Now serving: {state.nowServing ? `number ${state.nowServing}` : 'nobody yet'}</p>
      {state.paused && <p className="error" role="status">This queue is paused. New numbers are paused and calls are on hold.</p>}
      {user?.role === 'Owner' ? (
        <div className="panel" style={{ borderLeft: '4px solid var(--warn)', margin: '16px 0' }}>
          <p><strong>Queue Owners cannot join queues as customers.</strong></p>
          <p className="muted">You are signed in as a Queue Owner. Owners create and manage queues.</p>
          <a
            href={`#/owner/${id}`}
            className="primary"
            style={{ display: 'inline-block', textDecoration: 'none', padding: '10px 18px', borderRadius: '4px', marginTop: '8px' }}
          >
            Open Owner Dashboard
          </a>
        </div>
      ) : user?.role === 'Admin' ? (
        <div className="panel" style={{ borderLeft: '4px solid var(--warn)', margin: '16px 0' }}>
          <p><strong>Administrators cannot join queues.</strong></p>
          <p className="muted">Administrators supervise all queues from the Admin Console.</p>
          <div className="row" style={{ marginTop: '8px' }}>
            <a
              href="#/admin"
              className="primary"
              style={{ display: 'inline-block', textDecoration: 'none', padding: '10px 18px', borderRadius: '4px' }}
            >
              Open Admin Console
            </a>
            <a
              href={`#/owner/${id}`}
              className="secondary"
              style={{ display: 'inline-block', textDecoration: 'none', padding: '10px 18px', borderRadius: '4px' }}
            >
              Inspect Queue
            </a>
          </div>
        </div>
      ) : !ticket ? (
        <form onSubmit={join}>
          {user && (
            <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '10px' }}>
              Cognito Account: <strong>{user.name}</strong> ({user.role})
            </p>
          )}
          <label htmlFor="cn">Your name</label>
          <input id="cn" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} maxLength={40} />
          {err && <p className="error" role="alert">{err}</p>}
          <button className="primary" disabled={busy || state.paused}>Get a number</button>
        </form>
      ) : (
        <div aria-live="polite">
          <p className="muted">Your number</p>
          <p className="big">{ticket.number}</p>

          {isNear && (
            <div className="alert-near" role="alert">
              <span className="bell">🔔</span>
              <div>
                <strong>Your turn is near!</strong>
                <p>Only {peopleAhead === 0 ? 'the current person' : '1 person'} ahead of you. Please head towards the counter.</p>
              </div>
            </div>
          )}

          {status?.kind === 'called' && <p className="turn">It is your turn. Go to the counter.</p>}
          {status?.kind === 'waiting' && (
            <p>
              {peopleAhead} {peopleAhead === 1 ? 'person' : 'people'} ahead of you.
              {state.nowServing === 0 && peopleAhead === 0
                ? ' You are next in line. Counter is ready.'
                : ` Estimated wait: about ${waitMinutes} minutes.`}
            </p>
          )}
          {status?.kind === 'skipped' && (
            <div className="alert-skipped" role="alert" style={{ margin: '16px 0', padding: '14px', background: 'var(--card)', border: '1px solid var(--warn)', borderRadius: '8px' }}>
              <p style={{ fontWeight: 700, color: 'var(--warn)', margin: '0 0 8px 0' }}>Your number was skipped</p>
              <p style={{ margin: '0 0 12px 0' }}>Your ticket was called at the counter, but you were marked as skipped. Please speak with staff or request a new ticket.</p>
              <button className="secondary" onClick={clearTicket}>Get a new number</button>
            </div>
          )}
          {status?.kind === 'served' && (
            <>
              <p>You have been served. Thank you.</p>
              <button className="secondary" onClick={clearTicket}>Get a new number</button>
            </>
          )}

          {typeof Notification !== 'undefined' && Notification.permission === 'default' && (
            <div style={{ marginTop: '16px' }}>
              <button className="secondary" type="button" onClick={requestNotification} style={{ fontSize: '0.9rem', padding: '6px 12px' }}>
                Enable phone notifications for your turn
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Owner({ id }: { id: string }) {
  const { state, live, updatedAt, notFound, loadError, applyState } = useQueue(id);
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [names, setNames] = useState<Record<number, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const user = getCurrentUser();

  const isAuthorized = Boolean(key || user?.role === 'Admin' || user?.role === 'Owner');

  useEffect(() => { idbGet<string>('owner:' + id).then((k) => setKey(k ?? null)); }, [id]);
  useEffect(() => {
    if (!isAuthorized) return;
    req<{ names: Record<number, string> }>(`/api/queues/${id}/owner`, {
      headers: key ? { 'x-owner-key': key } : {},
    })
      .then((r) => setNames(r.names))
      .catch(() => {});
  }, [state, key, id, isAuthorized]);

  async function act(path: 'next' | 'skip' | 'pause') {
    setErr('');
    setBusy(true);
    try {
      const updated = await req<QState>(`/api/queues/${id}/${path}`, {
        method: 'POST',
        headers: key ? { 'x-owner-key': key } : {},
      });
      applyState(updated);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const link = `${location.origin}/#/q/${id}`;

  async function copy() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(link);
      } else {
        const ta = document.createElement('textarea');
        ta.value = link;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  if (user?.role === 'Customer') {
    return (
      <section className="panel">
        <h1>Owner access denied</h1>
        <p>Customers and patients cannot manage or run queues. You are signed in as a Customer.</p>
        <a href={`#/q/${id}`}>Return to Customer Queue View</a>
      </section>
    );
  }
  if (key === undefined && !user) return <p>Loading</p>;
  if (key === null && (!user || (user.role !== 'Admin' && user.role !== 'Owner'))) {
    return (
      <section className="panel">
        <h1>Owner access needed</h1>
        <p>This browser does not have the owner key for this queue. Please sign in with your Cognito Owner account or open from the browser where you created it.</p>
        <a href="#/">Back to start</a>
      </section>
    );
  }
  if (notFound) return <section className="panel"><h1>Queue not found</h1><a href="#/">Back to start</a></section>;
  if (!state && loadError) return <section className="panel"><h1>Connection problem</h1><p>{loadError}</p><a href="#/">Back to start</a></section>;
  if (!state) return <p>Loading</p>;

  return (
    <section>
      <Banner live={live} updatedAt={updatedAt} />
      <h1>{state.name}</h1>

      <div className="panel">
        <p className="muted">Customer link, code {state.id}</p>
        <p className="link">{link}</p>
        <div className="row" style={{ marginTop: '8px' }}>
          <button className="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
        </div>
        <QRCodeDisplay url={link} code={state.id} />
      </div>

      <div className="panel">
        <p className="muted">Now serving</p>
        <p className="big">{state.nowServing ? state.nowServing : 'None'}</p>
        {state.nowServing > 0 && names[state.nowServing] && <p><strong>{names[state.nowServing]}</strong></p>}
        <div className="row">
          <button className="primary" onClick={() => act('next')} disabled={busy || state.paused}>Call next</button>
          <button className="secondary" onClick={() => act('skip')} disabled={busy || state.nowServing === 0 || state.paused}>Skip number</button>
          <button className="secondary" onClick={() => act('pause')} disabled={busy}>{state.paused ? 'Resume queue' : 'Pause queue'}</button>
        </div>
        {state.paused && <p className="muted" style={{ marginTop: '8px', color: 'var(--warn)' }}>Queue is currently paused. Resume to call or skip tickets.</p>}
        {err && <p className="error" role="alert">{err}</p>}
      </div>

      <div className="panel">
        <h2>Today's Stats</h2>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Served Today</div>
            <div className="stat-val">{state.todayServed ?? state.servedCount}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Skipped Today</div>
            <div className="stat-val">{state.todaySkipped ?? state.skippedCount ?? 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg Service Time</div>
            <div className="stat-val">{state.avgMinutes}<span style={{ fontSize: '1rem' }}>m</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Waiting</div>
            <div className="stat-val">{state.waiting.length}</div>
          </div>
        </div>
        <StatsChart history={state.history} />
      </div>

      <div className="panel">
        <h2>Waiting in line ({state.waiting.length})</h2>
        {state.waiting.length === 0 ? <p>No one is waiting. Customers can scan the QR code to join.</p> : (
          <ol className="list">
            {state.waiting.map((w) => <li key={w.number}><strong>#{w.number}</strong> {names[w.number] ? `— ${names[w.number]}` : ''}</li>)}
          </ol>
        )}
      </div>
    </section>
  );
}

type AdminQueueItem = {
  id: string;
  name: string;
  ownerEmail: string;
  ownerId?: string | null;
  paused: boolean;
  nowServing: number;
  waiting: number;
  served: number;
  skipped: number;
  lastActivity: string;
};

function AdminConsole() {
  const user = getCurrentUser();
  const [queues, setQueues] = useState<AdminQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  if (user?.role !== 'Admin') {
    return (
      <section className="panel">
        <h1>Admin access required</h1>
        <p>This console is strictly reserved for the designated system administrator. Please sign in as Admin.</p>
        <a href="#/">Back to home</a>
      </section>
    );
  }

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const data = await req<{ queues: AdminQueueItem[] }>('/api/admin/queues');
      setQueues(data.queues);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    if (!confirm(`Delete queue ${id} and all its tickets?`)) return;
    try {
      await req(`/api/admin/queues/${id}`, { method: 'DELETE' });
      setQueues((prev) => prev.filter((q) => q.id !== id));
    } catch (x) {
      alert((x as Error).message);
    }
  }

  return (
    <section>
      <h1>⚡ Admin Console</h1>
      <p className="muted">Manage all virtual queues across the system with AWS Cognito administrator privileges.</p>
      {err && <p className="error" role="alert">{err}</p>}
      {loading ? <p>Loading queues...</p> : (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h2>System Queues ({queues.length})</h2>
            <button className="btn-sm secondary" onClick={load}>Refresh</button>
          </div>
          {queues.length === 0 ? <p className="muted">No active queues in the system.</p> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Owner</th>
                    <th>Status</th>
                    <th>Serving</th>
                    <th>Waiting</th>
                    <th>Served</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {queues.map((q) => (
                    <tr key={q.id}>
                      <td><strong>{q.id}</strong></td>
                      <td>{q.name}</td>
                      <td><span style={{ fontSize: '0.8rem' }}>{q.ownerEmail}</span></td>
                      <td>{q.paused ? <span style={{ color: 'var(--warn)' }}>Paused</span> : <span style={{ color: 'var(--accent)' }}>Active</span>}</td>
                      <td>#{q.nowServing || 'None'}</td>
                      <td>{q.waiting}</td>
                      <td>{q.served}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <a href={`#/owner/${q.id}`} className="btn-sm secondary" style={{ textDecoration: 'none' }}>Manage</a>
                          <button className="btn-sm" style={{ borderColor: 'var(--warn)', color: 'var(--warn)', background: 'transparent' }} onClick={() => remove(q.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function App() {
  const r = useRoute();
  return (
    <Shell>
      {r[0] === 'q' && r[1] ? <Customer id={r[1].toUpperCase()} /> :
       r[0] === 'owner' && r[1] ? <Owner id={r[1].toUpperCase()} /> :
       r[0] === 'admin' ? <AdminConsole /> :
       <Home />}
    </Shell>
  );
}
