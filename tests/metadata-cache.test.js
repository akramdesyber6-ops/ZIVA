'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MetadataCache } = require('../lib/metadata-cache');

test('metadata cache deduplicates concurrent requests and caches successful results', async () => {
  let now = 100;
  let calls = 0;
  const cache = new MetadataCache({ ttlMs: 50, staleMs: 100, now: () => now });
  let release;
  const loader = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };

  const first = cache.get('tmdb:movie/popular', loader);
  const second = cache.get('tmdb:movie/popular', loader);
  await Promise.resolve();
  release({ results: [] });
  assert.deepEqual(await first, { results: [] });
  assert.deepEqual(await second, { results: [] });
  assert.equal(calls, 1);
  assert.deepEqual(await cache.get('tmdb:movie/popular', loader), { results: [] });
  assert.equal(calls, 1);
});

test('stale entries are served during background refresh and expire after the stale window', async () => {
  let now = 0;
  let calls = 0;
  const cache = new MetadataCache({ ttlMs: 10, staleMs: 20, now: () => now });
  const loader = async () => ({ value: ++calls });

  assert.deepEqual(await cache.get('key', loader), { value: 1 });
  now = 11;
  assert.deepEqual(await cache.get('key', loader), { value: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await cache.get('key', loader), { value: 2 });
  now = 42;
  assert.deepEqual(await cache.get('key', loader), { value: 3 });
});

test('background refresh failures preserve stale metadata and report the failure', async () => {
  let now = 0;
  const failures = [];
  const cache = new MetadataCache({
    ttlMs: 10,
    staleMs: 20,
    now: () => now,
    onBackgroundError: (error, key) => failures.push({ error, key })
  });
  assert.deepEqual(await cache.get('key', async () => ({ value: 'cached' })), { value: 'cached' });
  now = 11;
  assert.deepEqual(await cache.get('key', async () => { throw new Error('refresh failed'); }), { value: 'cached' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].key, 'key');
  assert.match(failures[0].error.message, /refresh failed/);
});

test('forced refresh bypasses fresh cache entries and the cache remains bounded', async () => {
  let now = 0;
  let calls = 0;
  const cache = new MetadataCache({ ttlMs: 100, staleMs: 100, maxEntries: 2, now: () => now });
  const loader = async () => ++calls;

  assert.equal(await cache.get('one', loader), 1);
  assert.equal(await cache.get('one', loader, { forceRefresh: true }), 2);
  await cache.get('two', loader);
  await cache.get('three', loader);
  assert.equal(cache.entries.size, 2);
  assert.equal(cache.entries.has('one'), false);
});
