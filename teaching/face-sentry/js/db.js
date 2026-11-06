const NAME = 'FaceSentryDB';
const VERSION = 1;
let dbPromise;

export function openDb() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['persons', 'embeddings', 'events', 'outbox', 'settings']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : name === 'outbox' || name === 'events' ? 'eventId' : 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function all(store) {
  const db = await openDb();
  return requestResult(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await openDb();
  return requestResult(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function remove(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function clear(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveAlert(event) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['events', 'outbox'], 'readwrite');
    tx.objectStore('events').put(event);
    tx.objectStore('outbox').put({ eventId: event.eventId, status: 'PENDING', attempts: 0, nextAttemptAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function touchEvent(eventId, at) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('events', 'readwrite');
    const store = tx.objectStore('events');
    const request = store.get(eventId);
    let found = false;
    request.onsuccess = () => {
      const event = request.result;
      if (!event) return;
      found = true;
      event.lastSeenAt = Math.max(event.lastSeenAt ?? event.alertAt, at);
      store.put(event);
    };
    tx.oncomplete = () => resolve(found);
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateEventStatus(eventId, status) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('events', 'readwrite');
    const store = tx.objectStore('events');
    const request = store.get(eventId);
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, status });
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
