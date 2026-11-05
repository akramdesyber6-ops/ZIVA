'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'catalogue.js'), 'utf8');

function createCatalogue(fetchImpl) {
  const window = { location: { origin: 'https://ziva.example' } };
  vm.runInNewContext(source, { window, fetch: fetchImpl, URL });
  return window.ZivaCatalogue;
}

test('catalogue client coalesces requests, caches metadata, and supports forced revalidation', async () => {
  let requests = 0;
  const catalogue = createCatalogue(async () => ({
    ok: true,
    json: async () => ({ request: ++requests })
  }));
  const [first, second] = await Promise.all([
    catalogue.get('movie/popular', { page: 1 }),
    catalogue.get('movie/popular', { page: 1 })
  ]);
  assert.equal(first.request, 1);
  assert.equal(second.request, 1);
  assert.equal(requests, 1);
  assert.equal((await catalogue.get('movie/popular', { page: 1 })).request, 1);
  assert.equal((await catalogue.get('movie/popular', { page: 1 }, { forceRefresh: true })).request, 2);
  assert.equal(requests, 2);
});

test('catalogue search passes cancellation signals to fetch', async () => {
  let requestOptions;
  const catalogue = createCatalogue(async (_url, options) => {
    requestOptions = options;
    return { ok: true, json: async () => ({ results: [], page: 1, total_pages: 1 }) };
  });
  const controller = new AbortController();
  await catalogue.search('example', 1, 'tv', { signal: controller.signal });
  assert.equal(requestOptions.signal, controller.signal);
});

test('catalogue normalization rejects missing titles and leaves unavailable ratings blank', () => {
  const catalogue = createCatalogue(async () => { throw new Error('unexpected request'); });
  assert.equal(catalogue.normalize({ id: 1 }, 'movie'), null);
  const movie = catalogue.normalize({ id: 2, title: 'Verified title', vote_average: 0 }, 'movie');
  assert.equal(movie.title, 'Verified title');
  assert.equal(movie.rating, '');
});
