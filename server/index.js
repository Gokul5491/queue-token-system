import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import { rateLimit } from 'express-rate-limit';
import * as db from './db.js';
import { verifyToken, requireRole, registerUser, loginUser, USER_POOL_ID, CLIENT_ID, REGION } from './auth.js';

if (!process.env.MONGODB_URI && !process.env.DATABASE_URL) {
  console.error('MONGODB_URI is not set. Example: mongodb://localhost:27017/queue');
  process.exit(1);
}

// In production, require an explicit frontend origin to protect CORS
if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_ORIGIN) {
  console.error('FATAL: CLIENT_ORIGIN must be set in production mode to prevent unauthorized cross-origin requests.');
  process.exit(1);
}

const PORT = process.env.PORT || 4000;
const ORIGIN = process.env.CLIENT_ORIGIN || (process.env.NODE_ENV === 'production' ? false : true);
const ID_RE = /^[A-Z0-9]{6}$/;

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: ORIGIN }));
app.use(express.json({ limit: '2kb' }));
app.use(verifyToken);

// Rate limiters to prevent spam and abuse
const createQueueLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many queues created. Please try again later.' },
});

const joinQueueLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100, // accommodates batch rush in tests while preventing runaway bot flooding
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many join attempts. Please slow down.' },
});

const ownerLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Please try again later.' },
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ORIGIN } });

const route = (fn) => (req, res, next) => fn(req, res).catch(next);
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const idOf = (req) => String(req.params.id).toUpperCase();
const notFound = (res) => res.status(404).json({ error: 'Queue not found' });
const broadcast = (id, state) => io.to(id).emit('state', state);

// Resolves the queue id and verifies owner access via Cognito token or owner key
async function owner(req, res) {
  const id = idOf(req);
  if (!ID_RE.test(id)) { notFound(res); return null; }
  const result = await db.checkOwner(id, req.get('x-owner-key') || '', req.user);
  if (result === 'missing') { notFound(res); return null; }
  if (result === 'denied') {
    res.status(401).json({ error: 'Owner access required. Please sign in as queue owner or provide owner key.' });
    return null;
  }
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
  res.json({ ok: true, database: 'mongodb', cognito: { pool: USER_POOL_ID, region: REGION } });
}));

// Cognito Auth Endpoints
app.get('/api/auth/config', (_req, res) => {
  res.json({ userPoolId: USER_POOL_ID, clientId: CLIENT_ID, region: REGION });
});

app.post('/api/auth/register', authLimiter, route(async (req, res) => {
  const { email, password, name, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const requestedRole = clean(role, 20);
  if (requestedRole === 'Admin') {
    return res.status(403).json({ error: 'Admin accounts cannot be self-registered. There is a single designated platform admin.' });
  }
  const result = await registerUser({
    email: String(email).trim().toLowerCase(),
    password: String(password),
    name: clean(name, 50),
    role: requestedRole === 'Owner' ? 'Owner' : 'Customer',
  });
  res.status(201).json(result);
}));

app.post('/api/auth/login', authLimiter, route(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  try {
    const result = await loginUser({
      email: String(email).trim().toLowerCase(),
      password: String(password),
    });
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message || 'Invalid email or password' });
  }
}));

app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.user });
});

app.post('/api/queues', createQueueLimiter, route(async (req, res) => {
  const name = clean(req.body?.name, 60);
  if (!name) return res.status(400).json({ error: 'Enter a name for the queue' });
  if (req.user) {
    if (req.user.role === 'Admin') {
      return res.status(403).json({ error: 'Admins cannot create queues. Queue creation is reserved for Owners.' });
    }
    if (req.user.role === 'Customer') {
      return res.status(403).json({ error: 'Customers and patients cannot create queues. Please sign in as a Queue Owner.' });
    }
  }
  const ownerId = req.user?.id || null;
  const ownerEmail = req.user?.email || null;
  res.status(201).json(await db.createQueue(name, ownerId, ownerEmail));
}));

app.get('/api/queues/:id', route(async (req, res) => {
  const id = idOf(req);
  const state = ID_RE.test(id) ? await db.publicState(id) : null;
  if (!state) return notFound(res);
  res.json(state);
}));

app.get('/api/queues/:id/tickets/:number', route(async (req, res) => {
  const id = idOf(req);
  const num = parseInt(req.params.number, 10);
  if (!ID_RE.test(id) || isNaN(num)) return notFound(res);
  const t = await db.ticketState(id, num);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  res.json(t);
}));

app.post('/api/queues/:id/join', joinQueueLimiter, route(async (req, res) => {
  const id = idOf(req);
  if (!ID_RE.test(id)) return notFound(res);
  if (req.user) {
    if (req.user.role === 'Admin') {
      return res.status(403).json({ error: 'Admins cannot join queues. Admins oversee queues via the Admin Console.' });
    }
    if (req.user.role === 'Owner') {
      return res.status(403).json({ error: 'Queue Owners cannot join queues as customers. Only Customers and patients can join.' });
    }
  }
  const name = clean(req.body?.name, 40) || req.user?.name || '';
  if (!name) return res.status(400).json({ error: 'Enter your name' });
  const customerId = req.user?.id || null;
  const customerEmail = req.user?.email || null;
  const r = await db.joinQueue(id, name, customerId, customerEmail);
  if (r.error === 'not_found') return notFound(res);
  if (r.error === 'paused') return res.status(409).json({ error: 'This queue is paused' });
  if (r.error === 'full') return res.status(409).json({ error: 'This queue is full' });
  broadcast(id, r.state);
  res.status(201).json({ number: r.number, state: r.state });
}));

app.get('/api/owner/queues', route(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  res.json({ queues: await db.listOwnerQueues(req.user.id) });
}));

app.get('/api/admin/queues', requireRole('Admin'), route(async (_req, res) => {
  res.json({ queues: await db.listAllQueues() });
}));

app.delete('/api/admin/queues/:id', requireRole('Admin'), route(async (req, res) => {
  const id = idOf(req);
  if (!ID_RE.test(id)) return notFound(res);
  const deleted = await db.deleteQueue(id);
  if (!deleted) return notFound(res);
  res.json({ success: true, deleted: id });
}));

app.get('/api/queues/:id/owner', ownerLimiter, route(async (req, res) => {
  const id = await owner(req, res);
  if (id) res.json({ names: await db.ownerNames(id) });
}));

app.post('/api/queues/:id/next', ownerLimiter, route(async (req, res) => {
  const id = await owner(req, res);
  if (!id) return;
  const r = await db.callNext(id);
  if (r.error === 'not_found') return notFound(res);
  if (r.error === 'paused') return res.status(409).json({ error: 'This queue is paused' });
  if (r.error === 'conflict') return res.status(409).json({ error: 'Another action is in progress. Please retry.' });
  broadcast(id, r.state);
  res.json(r.state);
}));

app.post('/api/queues/:id/skip', ownerLimiter, route(async (req, res) => {
  const id = await owner(req, res);
  if (!id) return;
  const r = await db.skipCurrent(id);
  if (r.error === 'not_found') return notFound(res);
  if (r.error === 'paused') return res.status(409).json({ error: 'This queue is paused' });
  if (r.error === 'conflict') return res.status(409).json({ error: 'Another action is in progress. Please retry.' });
  broadcast(id, r.state);
  res.json(r.state);
}));

app.post('/api/queues/:id/pause', ownerLimiter, route(async (req, res) => {
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
