import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import * as db from './db.js';

if (!process.env.MONGODB_URI && !process.env.DATABASE_URL) {
  console.error('MONGODB_URI is not set. Example: mongodb://localhost:27017/queue');
  process.exit(1);
}

const PORT = process.env.PORT || 4000;
const ORIGIN = process.env.CLIENT_ORIGIN || true;
const ID_RE = /^[A-Z0-9]{6}$/;

const app = express();
app.use(cors({ origin: ORIGIN }));
app.use(express.json({ limit: '2kb' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ORIGIN } });

const route = (fn) => (req, res, next) => fn(req, res).catch(next);
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const idOf = (req) => String(req.params.id).toUpperCase();
const notFound = (res) => res.status(404).json({ error: 'Queue not found' });
const broadcast = (id, state) => io.to(id).emit('state', state);

// Resolves the queue id and checks the owner key. Returns the id, or null after replying.
async function owner(req, res) {
  const id = idOf(req);
  const result = ID_RE.test(id) ? await db.checkOwner(id, req.get('x-owner-key') || '') : 'missing';
  if (result === 'missing') { notFound(res); return null; }
  if (result === 'denied') { res.status(401).json({ error: 'Owner key is missing or wrong' }); return null; }
  return id;
}

app.get('/', (_req, res) => {
  res.json({
    status: 'online',
    service: 'Queue API Server',
    health: '/health',
    frontend: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  });
});

app.get('/health', route(async (_req, res) => {
  await db.db.command({ ping: 1 });
  res.json({ ok: true, database: 'mongodb' });
}));

app.post('/api/queues', route(async (req, res) => {
  const name = clean(req.body?.name, 60);
  if (!name) return res.status(400).json({ error: 'Enter a name for the queue' });
  res.status(201).json(await db.createQueue(name));
}));

app.get('/api/queues/:id', route(async (req, res) => {
  const id = idOf(req);
  const state = ID_RE.test(id) ? await db.publicState(id) : null;
  if (!state) return notFound(res);
  res.json(state);
}));

app.post('/api/queues/:id/join', route(async (req, res) => {
  const id = idOf(req);
  if (!ID_RE.test(id)) return notFound(res);
  const name = clean(req.body?.name, 40);
  if (!name) return res.status(400).json({ error: 'Enter your name' });
  const r = await db.joinQueue(id, name);
  if (r.error === 'not_found') return notFound(res);
  if (r.error === 'paused') return res.status(409).json({ error: 'This queue is paused' });
  if (r.error === 'full') return res.status(409).json({ error: 'This queue is full' });
  broadcast(id, r.state);
  res.status(201).json({ number: r.number, state: r.state });
}));

app.get('/api/queues/:id/owner', route(async (req, res) => {
  const id = await owner(req, res);
  if (id) res.json({ names: await db.ownerNames(id) });
}));

app.post('/api/queues/:id/next', route(async (req, res) => {
  const id = await owner(req, res);
  if (!id) return;
  const r = await db.callNext(id);
  if (r.error === 'not_found') return notFound(res);
  broadcast(id, r.state);
  res.json(r.state);
}));

app.post('/api/queues/:id/skip', route(async (req, res) => {
  const id = await owner(req, res);
  if (!id) return;
  const r = await db.skipCurrent(id);
  if (r.error === 'not_found') return notFound(res);
  broadcast(id, r.state);
  res.json(r.state);
}));

app.post('/api/queues/:id/pause', route(async (req, res) => {
  const id = await owner(req, res);
  if (!id) return;
  const r = await db.togglePause(id);
  if (r.error === 'not_found') return notFound(res);
  broadcast(id, r.state);
  res.json(r.state);
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Try again.' });
});

io.on('connection', (socket) => {
  socket.on('watch', async (id) => {
    const upper = typeof id === 'string' ? id.toUpperCase() : '';
    if (ID_RE.test(upper) && (await db.publicState(upper).catch(() => null))) socket.join(upper);
  });
});

await db.migrate();
setInterval(() => db.purgeOld().catch((e) => console.error('purge failed', e)), 60 * 60 * 1000).unref();
server.listen(PORT, () => console.log(`Queue server listening on port ${PORT}`));

const stop = () => { server.close(); db.client.close().finally(() => process.exit(0)); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
