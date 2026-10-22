import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_TICKETS = 500;
export const RETENTION_DAYS = 7;

const uri = process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/queue';
export const client = new MongoClient(uri);
export const db = client.db();
export const queues = db.collection('queues');
export const tickets = db.collection('tickets');

export const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
const newId = () => Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');

export async function migrate() {
  await client.connect();
  await tickets.createIndex({ queue_id: 1, number: 1 }, { unique: true });
  await tickets.createIndex({ queue_id: 1, status: 1 });
  await queues.createIndex({ last_activity: 1 });
}

export async function createQueue(name) {
  const ownerKey = crypto.randomBytes(16).toString('hex');
  for (let i = 0; i < 5; i++) {
    const id = newId();
    try {
      await queues.insertOne({
        _id: id,
        id,
        name,
        owner_key_hash: hashKey(ownerKey),
        paused: false,
        now_serving: 0,
        next_number: 1,
        called_at: null,
        last_activity: new Date(),
      });
      return { id, ownerKey };
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
  }
  throw new Error('Could not create a queue id');
}

export async function publicState(id) {
  const q = await queues.findOne({ id });
  if (!q) return null;

  const waiting = await tickets
    .find({ queue_id: id, status: 'waiting' })
    .sort({ number: 1 })
    .project({ number: 1, _id: 0 })
    .toArray();

  const servedCount = await tickets.countDocuments({ queue_id: id, status: 'served' });
  const skippedCount = await tickets.countDocuments({ queue_id: id, status: 'skipped' });

  const recent = await tickets
    .find({ queue_id: id, status: 'served', service_minutes: { $ne: null } })
    .sort({ number: -1 })
    .limit(10)
    .toArray();

  const avgMinutes =
    recent.length === 0
      ? 5
      : Math.max(1, Math.round(recent.reduce((acc, t) => acc + (t.service_minutes || 0), 0) / recent.length));

  const history = await tickets
    .find({ queue_id: id, status: { $in: ['served', 'skipped'] } })
    .sort({ number: -1 })
    .limit(15)
    .project({ number: 1, service_minutes: 1, status: 1, _id: 0 })
    .toArray();

  return {
    id: q.id,
    name: q.name,
    paused: q.paused,
    nowServing: q.now_serving,
    avgMinutes,
    servedCount,
    skippedCount,
    waiting,
    history: history.reverse(),
  };
}

export async function checkOwner(id, key) {
  const q = await queues.findOne({ id });
  if (!q) return 'missing';
  const a = Buffer.from(hashKey(key));
  const b = Buffer.from(q.owner_key_hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'ok' : 'denied';
}

export async function joinQueue(id, name) {
  const q = await queues.findOne({ id });
  if (!q) return { error: 'not_found' };
  if (q.paused) return { error: 'paused' };

  const waitingCount = await tickets.countDocuments({ queue_id: id, status: 'waiting' });
  if (waitingCount >= MAX_TICKETS) return { error: 'full' };

  const updatedQ = await queues.findOneAndUpdate(
    { id, paused: false },
    { $inc: { next_number: 1 }, $set: { last_activity: new Date() } },
    { returnDocument: 'after' }
  );

  if (!updatedQ) return { error: 'paused' };
  const num = updatedQ.next_number - 1;

  await tickets.insertOne({
    queue_id: id,
    number: num,
    name,
    status: 'waiting',
    service_minutes: null,
    created_at: new Date(),
    called_at: null,
    finished_at: null,
  });

  return { number: num, state: await publicState(id) };
}

export async function callNext(id) {
  const q = await queues.findOne({ id });
  if (!q) return { error: 'not_found' };

  if (q.now_serving > 0) {
    const mins = q.called_at
      ? Math.min(60, Math.max(1, Math.round((Date.now() - new Date(q.called_at).getTime()) / 60000)))
      : 1;

    await tickets.updateOne(
      { queue_id: id, number: q.now_serving, status: 'called' },
      { $set: { status: 'served', name: '', service_minutes: mins, finished_at: new Date() } }
    );
  }

  const next = await tickets.findOne({ queue_id: id, status: 'waiting' }, { sort: { number: 1 } });
  if (next) {
    const now = new Date();
    await tickets.updateOne({ queue_id: id, number: next.number }, { $set: { status: 'called', called_at: now } });
    await queues.updateOne({ id }, { $set: { now_serving: next.number, called_at: now, last_activity: now } });
  } else {
    await queues.updateOne({ id }, { $set: { now_serving: 0, called_at: null, last_activity: new Date() } });
  }

  return { state: await publicState(id) };
}

export async function skipCurrent(id) {
  const q = await queues.findOne({ id });
  if (!q) return { error: 'not_found' };

  if (q.now_serving > 0) {
    await tickets.updateOne(
      { queue_id: id, number: q.now_serving, status: 'called' },
      { $set: { status: 'skipped', name: '', finished_at: new Date() } }
    );
  }

  const next = await tickets.findOne({ queue_id: id, status: 'waiting' }, { sort: { number: 1 } });
  if (next) {
    const now = new Date();
    await tickets.updateOne({ queue_id: id, number: next.number }, { $set: { status: 'called', called_at: now } });
    await queues.updateOne({ id }, { $set: { now_serving: next.number, called_at: now, last_activity: now } });
  } else {
    await queues.updateOne({ id }, { $set: { now_serving: 0, called_at: null, last_activity: new Date() } });
  }

  return { state: await publicState(id) };
}

export async function togglePause(id) {
  const q = await queues.findOne({ id });
  if (!q) return { error: 'not_found' };

  await queues.updateOne({ id }, { $set: { paused: !q.paused, last_activity: new Date() } });
  return { state: await publicState(id) };
}

export async function ownerNames(id) {
  const list = await tickets
    .find({ queue_id: id, status: { $in: ['waiting', 'called'] } })
    .project({ number: 1, name: 1, _id: 0 })
    .toArray();
  return Object.fromEntries(list.map((t) => [t.number, t.name]));
}

export async function purgeOld() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const oldQueues = await queues.find({ last_activity: { $lt: cutoff } }).toArray();
  if (oldQueues.length === 0) return 0;

  const ids = oldQueues.map((q) => q.id);
  await tickets.deleteMany({ queue_id: { $in: ids } });
  const r = await queues.deleteMany({ id: { $in: ids } });
  return r.deletedCount;
}
