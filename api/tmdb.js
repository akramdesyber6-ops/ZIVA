'use strict';
const { requestTmdb, buildUrl, TmdbError } = require('../lib/tmdb');
const { MetadataCache } = require('../lib/metadata-cache');
const metadataCache = new MetadataCache({ ttlMs: 60_000, staleMs: 240_000, maxEntries: 500 });

module.exports = async function tmdbHandler(req, res, env = process.env, cache = metadataCache) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET'); res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported.' }));
  }
  try {
    const query = req.query || {};
    const route = typeof query.path === 'string' ? query.path : '';
    const params = { ...query }; delete params.path;
    const cacheKey = `tmdb:${buildUrl(route, params).href}`;
    const forceRefresh = req.headers && req.headers['cache-control'] === 'no-cache';
    const data = await cache.get(
      cacheKey,
      () => requestTmdb(route, params, env.TMDB_API_READ_ACCESS_TOKEN),
      { forceRefresh }
    );
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.statusCode = 200;
    return res.end(JSON.stringify(data));
  } catch (error) {
    const known = error instanceof TmdbError;
    const status = known ? error.status : error.name === 'TimeoutError' ? 504 : 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.statusCode = status;
    return res.end(JSON.stringify({ error: known ? error.code : 'TMDB_PROXY_ERROR', message: known ? error.message : 'The movie data service is temporarily unavailable.' }));
  }
};
