'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePath, buildUrl, requestTmdb, TmdbError } = require('../lib/tmdb');
const tmdbHandler = require('../api/tmdb');
const { MetadataCache } = require('../lib/metadata-cache');

test('accepts supported trending and search paths', () => {
  assert.equal(validatePath('trending/all/week'), 'trending/all/week');
  assert.equal(validatePath('search/multi'), 'search/multi');
});
test('rejects paths outside the allowlist', () => {
  assert.throws(() => validatePath('../../etc/passwd'), TmdbError);
  assert.throws(() => validatePath('account/123'), TmdbError);
});
test('builds TMDB URL with safe parameters and default language', () => {
  const url = buildUrl('search/multi', { query:'Dune', page:'2', api_key:'should-be-ignored' });
  assert.equal(url.origin, 'https://api.themoviedb.org');
  assert.equal(url.pathname, '/3/search/multi');
  assert.equal(url.searchParams.get('query'), 'Dune');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('language'), 'en-US');
  assert.equal(url.searchParams.has('api_key'), false);
});
test('rejects invalid page values', () => {
  assert.throws(() => buildUrl('movie/popular', { page:'999' }), TmdbError);
});
test('returns an explicit configuration error without a token', async () => {
  await assert.rejects(() => requestTmdb('movie/popular', {}, ''), (error) => error.code === 'TMDB_NOT_CONFIGURED' && error.status === 503);
});
test('sends bearer token and returns successful JSON', async () => {
  let captured;
  const fakeFetch = async (url, options) => {
    captured = { url: String(url), authorization: options.headers.Authorization };
    return { ok:true, status:200, json:async () => ({ results:[] }) };
  };
  const result = await requestTmdb('movie/popular', {}, 'test-token', fakeFetch);
  assert.deepEqual(result, { results:[] });
  assert.equal(captured.authorization, 'Bearer test-token');
  assert.match(captured.url, /movie\/popular/);
});

test('TMDB API metadata responses are cached and can be revalidated', async () => {
  const originalFetch = global.fetch;
  const cache = new MetadataCache({ ttlMs: 60_000, staleMs: 60_000 });
  let upstreamCalls = 0;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ request: ++upstreamCalls })
  });
  const request = (headers = {}) => ({
    method: 'GET',
    query: { path: 'movie/popular', page: '1' },
    headers
  });
  function response() {
    return {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(value) { this.body = value; }
    };
  }

  try {
    const first = response();
    await tmdbHandler(request(), first, { TMDB_API_READ_ACCESS_TOKEN: 'configured-in-test' }, cache);
    const cached = response();
    await tmdbHandler(request(), cached, { TMDB_API_READ_ACCESS_TOKEN: 'configured-in-test' }, cache);
    assert.equal(JSON.parse(first.body).request, 1);
    assert.equal(JSON.parse(cached.body).request, 1);
    assert.equal(upstreamCalls, 1);

    const refreshed = response();
    await tmdbHandler(request({ 'cache-control': 'no-cache' }), refreshed, {
      TMDB_API_READ_ACCESS_TOKEN: 'configured-in-test'
    }, cache);
    assert.equal(JSON.parse(refreshed.body).request, 2);
    assert.equal(upstreamCalls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});
