const open = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('queue', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((res) => {
      const tx = db.transaction('kv', 'readonly');
      const q = tx.objectStore('kv').get(key);
      q.onsuccess = () => res(q.result as T | undefined);
      q.onerror = () => res(undefined);
      tx.onerror = () => res(undefined);
    });
  } catch {
    return undefined;
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
      tx.objectStore('kv').put(value, key);
    });
  } catch {}
}

