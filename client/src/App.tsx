import { FormEvent, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QHistoryItem, QState, req } from './api';
import { CONTACT_EMAIL, PRODUCT_NAME } from './config';
import { idbGet, idbSet } from './idb';
import { ticketStatus } from './status';
import { useQueue } from './useQueue';

function useRoute() {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const f = () => setHash(location.hash || '#/');
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return hash.replace(/^#/, '').split('/').filter(Boolean);
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="bar">
        <a href="#/" className="brand">{PRODUCT_NAME}</a>
      </header>
      <main>{children}</main>
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
      <section className="split">
        <form onSubmit={create} className="panel">
          <h2>Run a queue</h2>
          <label htmlFor="qn">Queue name</label>
          <input id="qn" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} maxLength={60} placeholder="Example: Morning OPD" />
          {err && <p className="error" role="alert">{err}</p>}
          <button className="primary" disabled={busy}>Create queue</button>
        </form>
        <form onSubmit={join} className="panel">
          <h2>Join a queue</h2>
          <label htmlFor="qc">Queue code</label>
          <input
            id="qc"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setJoinErr('');
            }}
            maxLength={6}
            placeholder="6 characters"
            autoCapitalize="characters"
          />
          {joinErr && <p className="error" role="alert">{joinErr}</p>}
          <button className="secondary">Open queue</button>
        </form>
      </section>
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
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [notifGranted, setNotifGranted] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  );

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
      {!ticket ? (
        <form onSubmit={join}>
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

  useEffect(() => { idbGet<string>('owner:' + id).then((k) => setKey(k ?? null)); }, [id]);
  useEffect(() => {
    if (!key) return;
    req<{ names: Record<number, string> }>(`/api/queues/${id}/owner`, { headers: { 'x-owner-key': key } })
      .then((r) => setNames(r.names)).catch(() => {});
  }, [state, key, id]);

  async function act(path: 'next' | 'skip' | 'pause') {
    setErr('');
    setBusy(true);
    try {
      const updated = await req<QState>(`/api/queues/${id}/${path}`, { method: 'POST', headers: { 'x-owner-key': key || '' } });
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

  if (key === undefined) return <p>Loading</p>;
  if (key === null) return <section className="panel"><h1>Owner access needed</h1><p>This browser does not have the owner key for this queue. Open the queue from the browser where you created it.</p><a href="#/">Back to start</a></section>;
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
          <button className="primary" onClick={() => act('next')} disabled={busy}>Call next</button>
          <button className="secondary" onClick={() => act('skip')} disabled={busy || state.nowServing === 0}>Skip number</button>
          <button className="secondary" onClick={() => act('pause')} disabled={busy}>{state.paused ? 'Resume queue' : 'Pause queue'}</button>
        </div>
        {err && <p className="error" role="alert">{err}</p>}
      </div>

      <div className="panel">
        <h2>Today's Stats</h2>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Served</div>
            <div className="stat-val">{state.servedCount}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Skipped</div>
            <div className="stat-val">{state.skippedCount ?? 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg Wait</div>
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

export default function App() {
  const r = useRoute();
  return (
    <Shell>
      {r[0] === 'q' && r[1] ? <Customer id={r[1].toUpperCase()} /> : r[0] === 'owner' && r[1] ? <Owner id={r[1].toUpperCase()} /> : <Home />}
    </Shell>
  );
}
