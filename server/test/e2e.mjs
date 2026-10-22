// End-to-end test: starts the real server against a real MongoDB database and plays the
// customer and owner roles over HTTP and WebSocket. Needs TEST_MONGODB_URI (or MONGODB_URI).
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { MongoClient } from 'mongodb';

process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || process.env.MONGODB_URI || 'mongodb://admin:pass@localhost:27017/queue-test?authSource=admin';
const PORT = 4222;
const URL = `http://localhost:${PORT}`;
let child;
let passed = 0;

function startServer() {
  return new Promise((resolve, reject) => {
    child = spawn('node', ['index.js'], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.on('data', (d) => {
      if (String(d).includes('listening')) resolve();
    });
    child.on('exit', (code) => reject(new Error('server exited early with code ' + code)));
  });
}
function stopServer() {
  return new Promise((resolve) => {
    child.removeAllListeners('exit');
    child.on('exit', resolve);
    child.kill('SIGTERM');
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(25);
  }
  throw new Error('Timed out waiting for: ' + label);
}
const api = async (path, { method = 'GET', body, key, token } = {}) => {
  const r = await fetch(URL + '/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'x-owner-key': key } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
};
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log('PASS', name);
};
function watcher(id) {
  const states = [];
  const socket = io(URL, { transports: ['websocket'] });
  socket.on('state', (s) => states.push(s));
  return new Promise((resolve) =>
    socket.on('connect', async () => {
      socket.emit('watch', id);
      await sleep(300);
      resolve({ socket, states });
    })
  );
}

const rawClient = new MongoClient(process.env.MONGODB_URI);
await rawClient.connect();
const rawDb = rawClient.db();

try {
  await startServer();
  let id, key, customer, ownerSocket;

  await test('owner creates a queue', async () => {
    const r = await api('/queues', { method: 'POST', body: { name: 'Morning OPD' } });
    assert.equal(r.status, 201);
    assert.match(r.body.id, /^[A-Z0-9]{6}$/);
    ({ id, ownerKey: key } = r.body);
    const stored = (await rawDb.collection('queues').findOne({ id })).owner_key_hash;
    assert.notEqual(stored, key, 'owner key must not be stored in plain text');
  });

  await test('input is validated', async () => {
    assert.equal((await api('/queues', { method: 'POST', body: { name: '  ' } })).status, 400);
    assert.equal((await api(`/queues/${id}/join`, { method: 'POST', body: { name: '' } })).status, 400);
    assert.equal((await api('/queues/NOPE12')).status, 404);
    assert.equal((await api('/queues/bad')).status, 404);
  });

  customer = await watcher(id);
  ownerSocket = await watcher(id);

  await test('customers join and everyone watching gets a live update', async () => {
    const a = await api(`/queues/${id}/join`, { method: 'POST', body: { name: 'Asha' } });
    const b = await api(`/queues/${id}/join`, { method: 'POST', body: { name: 'Ravi' } });
    assert.deepEqual([a.status, a.body.number, b.body.number], [201, 1, 2]);
    await waitFor(() => customer.states.at(-1)?.waiting.length === 2, 'customer sees 2 waiting');
    await waitFor(() => ownerSocket.states.at(-1)?.waiting.length === 2, 'owner sees 2 waiting');
  });

  await test('only the owner can see names or run the queue', async () => {
    assert.equal((await api(`/queues/${id}/next`, { method: 'POST', key: 'wrong' })).status, 401);
    assert.equal((await api(`/queues/${id}/next`, { method: 'POST' })).status, 401);
    assert.equal((await api(`/queues/${id}/owner`, { key: 'wrong' })).status, 401);
    assert.equal(
      JSON.stringify((await api(`/queues/${id}`)).body).includes('Asha'),
      false,
      'public state must not contain names'
    );
    assert.deepEqual((await api(`/queues/${id}/owner`, { key })).body.names, { 1: 'Asha', 2: 'Ravi' });
  });

  await test('pausing blocks new tickets, call next, and skip', async () => {
    assert.equal((await api(`/queues/${id}/pause`, { method: 'POST', key })).body.paused, true);
    assert.equal((await api(`/queues/${id}/join`, { method: 'POST', body: { name: 'Late' } })).status, 409);
    assert.equal((await api(`/queues/${id}/next`, { method: 'POST', key })).status, 409, 'next should be blocked when paused');
    assert.equal((await api(`/queues/${id}/skip`, { method: 'POST', key })).status, 409, 'skip should be blocked when paused');
    await waitFor(() => customer.states.at(-1)?.paused === true, 'customer sees paused');
    assert.equal((await api(`/queues/${id}/pause`, { method: 'POST', key })).body.paused, false);
  });

  await test('call next moves the line and notifies customers', async () => {
    const s = (await api(`/queues/${id}/next`, { method: 'POST', key })).body;
    assert.equal(s.nowServing, 1);
    assert.deepEqual(s.waiting, [{ number: 2 }]);
    await waitFor(() => customer.states.at(-1)?.nowServing === 1, 'customer sees number 1 called');
  });

  await test('owner can skip a no-show customer', async () => {
    // Number 1 is currently called. Skip number 1, which should call number 2 and mark 1 as skipped
    const s = (await api(`/queues/${id}/skip`, { method: 'POST', key })).body;
    assert.equal(s.nowServing, 2);
    assert.equal(s.skippedCount, 1);
    assert.equal(s.todaySkipped, 1);
    assert.deepEqual(s.skipped, [1]);
    const row = await rawDb.collection('tickets').findOne({ queue_id: id, number: 1 });
    assert.equal(row.status, 'skipped');
    assert.equal(row.name, '');

    const t1 = await api(`/queues/${id}/tickets/1`);
    assert.equal(t1.status, 200);
    assert.equal(t1.body.status, 'skipped');
  });

  await test('served ticket: status, name erasure, and counts', async () => {
    // Number 2 is currently called. Call next marks 2 as served.
    const s = (await api(`/queues/${id}/next`, { method: 'POST', key })).body;
    assert.equal(s.servedCount, 1);
    assert.equal(s.skippedCount, 1);
    assert.equal(s.todayServed, 1);
    assert.equal(s.todaySkipped, 1);
    assert.ok(!s.waiting.some((w) => w.number === 2), 'served ticket must leave waiting list');
    const row = await rawDb.collection('tickets').findOne({ queue_id: id, number: 2 });
    assert.equal(row.status, 'served');
    assert.equal(row.name, '');

    const t2 = await api(`/queues/${id}/tickets/2`);
    assert.equal(t2.status, 200);
    assert.equal(t2.body.status, 'served');
  });

  await test('finishing the last customer leaves nobody being served', async () => {
    const s = (await api(`/queues/${id}/next`, { method: 'POST', key })).body;
    assert.deepEqual([s.nowServing, s.waiting.length], [0, 0]);
  });

  await test('25 simultaneous joins get unique, gapless numbers', async () => {
    const q = (await api('/queues', { method: 'POST', body: { name: 'Rush' } })).body;
    const rs = await Promise.all(
      Array.from({ length: 25 }, (_, i) => api(`/queues/${q.id}/join`, { method: 'POST', body: { name: 'C' + i } }))
    );
    assert.ok(rs.every((r) => r.status === 201));
    const nums = rs.map((r) => r.body.number).sort((a, b) => a - b);
    assert.deepEqual(nums, Array.from({ length: 25 }, (_, i) => i + 1));
  });

  await test('concurrent owner actions (simultaneous call/skip) are handled safely', async () => {
    const cq = (await api('/queues', { method: 'POST', body: { name: 'Concurrent' } })).body;
    await Promise.all([
      api(`/queues/${cq.id}/join`, { method: 'POST', body: { name: 'User1' } }),
      api(`/queues/${cq.id}/join`, { method: 'POST', body: { name: 'User2' } }),
      api(`/queues/${cq.id}/join`, { method: 'POST', body: { name: 'User3' } }),
    ]);

    const results = await Promise.all([
      api(`/queues/${cq.id}/next`, { method: 'POST', key: cq.ownerKey }),
      api(`/queues/${cq.id}/skip`, { method: 'POST', key: cq.ownerKey }),
    ]);

    // Both should either succeed or return 409 conflict, without unhandled crashes
    assert.ok(results.every((r) => r.status === 200 || r.status === 409));
    const finalState = (await api(`/queues/${cq.id}`)).body;
    assert.ok(finalState.nowServing >= 0);
  });

  let before;
  await test('data survives a server restart', async () => {
    await api(`/queues/${id}/join`, { method: 'POST', body: { name: 'Meena' } });
    before = (await api(`/queues/${id}`)).body;
    customer.socket.close();
    ownerSocket.socket.close();
    await stopServer();
    await startServer();
    assert.deepEqual((await api(`/queues/${id}`)).body, before);
    assert.equal((await api(`/queues/${id}/next`, { method: 'POST', key })).status, 200, 'owner key still works');
    const c = await watcher(id);
    await api(`/queues/${id}/join`, { method: 'POST', body: { name: 'Post-restart' } });
    await waitFor(() => c.states.length > 0, 'live updates work after restart');
    c.socket.close();
  });

  await test('AWS Cognito auth: Admin sign-in, queue list, and privileged access', async () => {
    // 1. Sign in as Admin
    const authRes = await api('/auth/login', {
      method: 'POST',
      body: { email: 'admin@queue.io', password: 'Admin123!' },
    });
    assert.equal(authRes.status, 200);
    assert.ok(authRes.body.idToken);
    assert.equal(authRes.body.user.role, 'Admin');
    const adminToken = authRes.body.idToken;

    // 2. Fetch /api/auth/me
    const meRes = await api('/auth/me', { token: adminToken });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.user.email, 'admin@queue.io');

    // 3. Access admin queues list
    const listRes = await api('/admin/queues', { token: adminToken });
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listRes.body.queues));

    // 4. Admin cannot create or join queues (strict role boundaries)
    const adminCreate = await api('/queues', { method: 'POST', body: { name: 'Admin Queue' }, token: adminToken });
    assert.equal(adminCreate.status, 403, 'Admin must not be allowed to create a queue');

    const qTest = (await api('/queues', { method: 'POST', body: { name: 'Supervised Queue' } })).body;
    const adminJoin = await api(`/queues/${qTest.id}/join`, { method: 'POST', body: { name: 'Admin' }, token: adminToken });
    assert.equal(adminJoin.status, 403, 'Admin must not be allowed to join a queue');

    // 5. Admin can oversee and call next on queues via admin privileges
    await api(`/queues/${qTest.id}/join`, { method: 'POST', body: { name: 'Patient' } });
    const nextRes = await api(`/queues/${qTest.id}/next`, { method: 'POST', token: adminToken });
    assert.equal(nextRes.status, 200);
    assert.equal(nextRes.body.nowServing, 1);

    // 6. Only single admin exists: self-registering as Admin is forbidden
    const regAdmin = await api('/auth/register', {
      method: 'POST',
      body: { email: 'fake_admin@queue.io', password: 'Password123!', name: 'Imposter', role: 'Admin' },
    });
    assert.equal(regAdmin.status, 403, 'Self-registering as Admin must be rejected');

    // 7. Unauthenticated call to /admin/queues is rejected
    const unauth = await api('/admin/queues');
    assert.equal(unauth.status, 401);
  });

  await test('Role boundaries: Owners cannot join queues, Customers cannot create queues', async () => {
    // 1. Register an Owner
    const ownerRes = await api('/auth/register', {
      method: 'POST',
      body: { email: `owner_test_${Date.now()}@queue.io`, password: 'Password123!', name: 'Owner Tim', role: 'Owner' },
    });
    assert.equal(ownerRes.status, 201);
    const ownerToken = ownerRes.body.idToken;

    // 2. Owner CAN create queue
    const qOwn = await api('/queues', { method: 'POST', body: { name: 'Tims Clinic' }, token: ownerToken });
    assert.equal(qOwn.status, 201);

    // 3. Owner CANNOT join a queue
    const ownerJoin = await api(`/queues/${qOwn.body.id}/join`, { method: 'POST', body: { name: 'Owner Self' }, token: ownerToken });
    assert.equal(ownerJoin.status, 403, 'Owner cannot join queue as customer');

    // 4. Register a Customer
    const custRes = await api('/auth/register', {
      method: 'POST',
      body: { email: `cust_test_${Date.now()}@queue.io`, password: 'Password123!', name: 'Customer Bob', role: 'Customer' },
    });
    assert.equal(custRes.status, 201);
    const custToken = custRes.body.idToken;

    // 5. Customer CANNOT create queue
    const custCreate = await api('/queues', { method: 'POST', body: { name: 'Bobs Queue' }, token: custToken });
    assert.equal(custCreate.status, 403, 'Customer cannot create a queue');

    // 6. Customer CAN join queue
    const custJoin = await api(`/queues/${qOwn.body.id}/join`, { method: 'POST', body: { name: 'Bob' }, token: custToken });
    assert.equal(custJoin.status, 201, 'Customer can join queue');
  });

  await test('queues idle for more than 7 days are deleted with their tickets', async () => {
    await rawDb
      .collection('queues')
      .updateOne({ id }, { $set: { last_activity: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) } });
    const { purgeOld, client } = await import('./../db.js');
    assert.ok((await purgeOld()) >= 1);
    await client.close();
    assert.equal((await api(`/queues/${id}`)).status, 404);
    assert.equal(await rawDb.collection('tickets').countDocuments({ queue_id: id }), 0);
  });

  console.log(`\nAll ${passed} tests passed.`);
} catch (e) {
  console.error('\nFAILED after', passed, 'passing tests:\n', e);
  process.exitCode = 1;
} finally {
  await rawClient.close().catch(() => {});
  if (child && child.exitCode === null) child.kill('SIGKILL');
}
