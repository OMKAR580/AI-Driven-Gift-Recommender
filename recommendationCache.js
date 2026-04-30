/**
 * In-memory TTL cache (Map-based) for Phase C recommendation + model layers.
 */

function now() {
  return Date.now();
}

export function createTtlCache({ name = 'cache', defaultTtlMs = 20 * 60 * 1000, onLog } = {}) {
  const store = new Map();

  const log = typeof onLog === 'function' ? onLog : () => {};

  function prune() {
    const t = now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= t) {
        store.delete(key);
      }
    }
  }

  function get(key) {
    prune();
    const entry = store.get(key);
    if (!entry) {
      log(`${name} miss`, keyPreview(key));
      return null;
    }
    if (entry.expiresAt <= now()) {
      store.delete(key);
      log(`${name} expired`, keyPreview(key));
      return null;
    }
    log(`${name} hit`, keyPreview(key));
    return entry.value;
  }

  function set(key, value, ttlMs = defaultTtlMs) {
    prune();
    store.set(key, { value, expiresAt: now() + Math.max(1000, ttlMs) });
    log(`${name} set`, keyPreview(key), `ttlMs=${ttlMs}`);
  }

  function del(key) {
    store.delete(key);
  }

  return { get, set, delete: del, _size: () => store.size };
}

function keyPreview(key) {
  const s = String(key);
  return s.length > 96 ? `${s.slice(0, 96)}…` : s;
}
