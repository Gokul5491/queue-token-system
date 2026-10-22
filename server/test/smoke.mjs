// Runs the customer-to-owner workflow against a deployed backend.
// Usage: node test/smoke.mjs https://api.yourdomain.com
// It creates one test queue named "Smoke test", which the server deletes after 7 days of inactivity.
import { io } from 'socket.io-client';

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) {
  console.error('Usage: node test/smoke.mjs <backend-url>');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (path, { method = 'GET', body, key } = {}) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-owner-key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const check = (cond, label) => {
  if (!cond) throw new Error('FAILED: ' + label);
  console.log('ok  ', label);
};
async function waitFor(fn, label) {
  for (let i = 0; i < 120; i++) {
    if (fn()) return;
    await sleep(25);
  }
  throw new Error('FAILED (timed out): ' + label);
}

const health = await call('/health');
check(health.status === 200, 'health check reaches the database');

const q = await call('/api/queues', { method: 'POST', body: { name: 'Smoke test' } });
check(q.status === 201, 'owner creates a queue');
const { id, ownerKey } = q.body;

const states = [];
const socket = io(base, { transports: ['websocket'] });
await new Promise((res, rej) => {
  socket.on('connect', res);
  socket.on('connect_error', rej);
  setTimeout(() => rej(new Error('FAILED: WebSocket did not connect (check HTTPS and CLIENT_ORIGIN)')), 8000);
});
socket.on('state', (s) => states.push(s));
socket.emit('watch', id);
await sleep(500);

const j1 = await call(`/api/queues/${id}/join`, { method: 'POST', body: { name: 'Customer one' } });
const j2 = await call(`/api/queues/${id}/join`, { method: 'POST', body: { name: 'Customer two' } });
const j3 = await call(`/api/queues/${id}/join`, { method: 'POST', body: { name: 'Customer three' } });
check(j1.body.number === 1 && j2.body.number === 2 && j3.body.number === 3, 'three customers get numbers 1, 2, and 3');
await waitFor(() => states.at(-1)?.waiting.length === 3, 'customer screen receives a live update');

check((await call(`/api/queues/${id}/next`, { method: 'POST', key: 'wrong' })).status === 401, 'wrong owner key is refused');
check(
  (await call(`/api/queues/${id}`)).body.waiting.length === 3 &&
    !JSON.stringify((await call(`/api/queues/${id}`)).body).includes('Customer'),
  'public view shows numbers, not names'
);

await call(`/api/queues/${id}/next`, { method: 'POST', key: ownerKey });
await waitFor(() => states.at(-1)?.nowServing === 1, 'owner calls number 1 and customers see it');

// Skip customer 1
const skipped = (await call(`/api/queues/${id}/skip`, { method: 'POST', key: ownerKey })).body;
check(skipped.nowServing === 2 && skipped.skippedCount === 1, 'number 1 is marked skipped and number 2 is called');

// Next for customer 2
const s = (await call(`/api/queues/${id}/next`, { method: 'POST', key: ownerKey })).body;
check(s.nowServing === 3 && s.servedCount === 1, 'number 2 is marked served and number 3 is called');

const last = (await call(`/api/queues/${id}/next`, { method: 'POST', key: ownerKey })).body;
check(last.nowServing === 0 && last.servedCount === 2 && last.skippedCount === 1, 'queue finishes cleanly');

socket.close();
console.log('\nSmoke test passed.');
