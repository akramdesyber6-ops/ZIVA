'use strict';

module.exports = function statusHandler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 200;
  return res.end(JSON.stringify({
    mode: process.env.TMDB_API_READ_ACCESS_TOKEN ? 'live' : 'demo',
    tmdbConfigured: Boolean(process.env.TMDB_API_READ_ACCESS_TOKEN)
  }));
};
