'use strict';
const { requestTmdb, TmdbError } = require('../lib/tmdb');
module.exports = async function tmdbHandler(req, res, env = process.env) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET'); res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported.' }));
  }
  try {
    const query = req.query || {};
    const route = typeof query.path === 'string' ? query.path : '';
    const params = { ...query }; delete params.path;
    const data = await requestTmdb(route, params, env.TMDB_API_READ_ACCESS_TOKEN);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.statusCode = 200;
    return res.end(JSON.stringify(data));
  } catch (error) {
    const known = error instanceof TmdbError;
    const status = known ? error.status : error.name === 'TimeoutError' ? 504 : 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.statusCode = status;
    return res.end(JSON.stringify({ error: known ? error.code : 'TMDB_PROXY_ERROR', message: known ? error.message : 'The movie data service is temporarily unavailable.' }));
  }
};
