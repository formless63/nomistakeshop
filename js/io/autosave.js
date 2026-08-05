// js/io/autosave.js — IndexedDB-backed autosave of the serialized project.
// db 'nomistakeshop', objectStore 'kv' (out-of-line keys: put(value, key)).
// Everything is feature-detected; without IndexedDB all exports are no-ops.

import { state } from '../core/state.js';
import { io } from './io.js';

const DB_NAME = 'nomistakeshop';
const STORE = 'kv';
const KEY = 'autosave';
const INTERVAL_MS = 30000;

const hasIDB = typeof indexedDB !== 'undefined';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Runs op(store) inside a transaction on 'kv', resolving when it completes.
async function withStore(mode, op) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// Serialize + store right now. Best-effort: quota/serialize failures are
// swallowed (console.warn only) so autosave can never break editing.
function saveNow() {
  if (!state.doc) return;
  try {
    const data = io.serializeProject();
    if (!data) return;
    // Structured clone handles the plain object (dataURLs included).
    withStore('readwrite', (store) => store.put(data, KEY)).catch((err) => {
      console.warn('autosave: write failed', err);
    });
  } catch (err) {
    console.warn('autosave: serialize failed', err);
  }
}

export function scheduleAutosave() {
  if (!hasIDB) return;
  setInterval(saveNow, INTERVAL_MS);
  // Synchronous best-effort on tab close — the put is async but usually flushes.
  window.addEventListener('beforeunload', saveNow);
}

export function loadAutosave() {
  if (!hasIDB) return Promise.resolve(null);
  return withStore('readonly', (store) => store.get(KEY))
    .then((data) => (data == null ? null : data)) // missing key reads as undefined
    .catch((err) => {
      console.warn('autosave: read failed', err);
      return null;
    });
}

export function clearAutosave() {
  if (!hasIDB) return Promise.resolve();
  return withStore('readwrite', (store) => store.delete(KEY)).catch((err) => {
    console.warn('autosave: clear failed', err);
  });
}
