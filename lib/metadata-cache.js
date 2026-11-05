'use strict';

class MetadataCache {
  constructor({
    ttlMs = 60_000,
    staleMs = 240_000,
    maxEntries = 500,
    now = Date.now,
    onBackgroundError = () => console.error('Metadata cache refresh failed.')
  } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs < 0
        || !Number.isFinite(staleMs) || staleMs < 0
        || !Number.isInteger(maxEntries) || maxEntries < 1
        || typeof now !== 'function'
        || typeof onBackgroundError !== 'function') {
      throw new TypeError('Invalid metadata cache configuration.');
    }
    this.ttlMs = ttlMs;
    this.staleMs = staleMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.onBackgroundError = onBackgroundError;
    this.entries = new Map();
    this.inFlight = new Map();
  }

  async get(key, loader, { forceRefresh = false } = {}) {
    if (typeof key !== 'string' || !key || typeof loader !== 'function') {
      throw new TypeError('A cache key and loader function are required.');
    }

    const now = this.now();
    const entry = this.entries.get(key);
    if (entry && now < entry.expiresAt && !forceRefresh) {
      this.#touch(key, entry);
      return entry.value;
    }

    if (entry && now < entry.staleUntil && !forceRefresh) {
      this.#touch(key, entry);
      this.#refresh(key, loader).catch((error) => this.onBackgroundError(error, key));
      return entry.value;
    }

    return this.#refresh(key, loader);
  }

  #refresh(key, loader) {
    const current = this.inFlight.get(key);
    if (current) return current;

    const pending = Promise.resolve()
      .then(loader)
      .then((value) => {
        const now = this.now();
        const entry = {
          value,
          expiresAt: now + this.ttlMs,
          staleUntil: now + this.ttlMs + this.staleMs
        };
        this.entries.delete(key);
        this.entries.set(key, entry);
        while (this.entries.size > this.maxEntries) {
          this.entries.delete(this.entries.keys().next().value);
        }
        return value;
      })
      .finally(() => {
        if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
      });

    this.inFlight.set(key, pending);
    return pending;
  }

  #touch(key, entry) {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}

module.exports = { MetadataCache };
