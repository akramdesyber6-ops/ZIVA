'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const tmdbHandler = require('./api/tmdb');
const ROOT = __dirname;
function loadEnv() {
  const file = path.join(ROOT, '.env'); if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const value = line.trim(); if (!value || value.startsWith('#')) continue;
    const ix = value.indexOf('='); if (ix < 1) continue;
    const key = value.slice(0, ix).trim(); let val = value.slice(ix + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}
function sendJson(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); }
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon' };
loadEnv();
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  let url; try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { return sendJson(res, 400, { error:'BAD_URL' }); }
  if (url.pathname === '/api/status') return sendJson(res, 200, { mode: process.env.TMDB_API_READ_ACCESS_TOKEN ? 'live' : 'demo', tmdbConfigured: Boolean(process.env.TMDB_API_READ_ACCESS_TOKEN) });
  if (url.pathname === '/api/tmdb') {
    req.query = Object.fromEntries(url.searchParams.entries());
    return tmdbHandler(req, res);
  }
  if (!['GET','HEAD'].includes(req.method)) return sendJson(res, 405, { error:'METHOD_NOT_ALLOWED' });
  let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { return sendJson(res, 400, { error:'BAD_PATH' }); }
  if (pathname === '/') pathname = '/index.html';
  const target = path.resolve(ROOT, `.${pathname}`);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return sendJson(res, 403, { error:'FORBIDDEN' });
  fs.readFile(target, (error, data) => {
    if (error) return sendJson(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'NOT_FOUND' : 'FILE_READ_ERROR' });
    res.writeHead(200, { 'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control': target.endsWith('.html') ? 'no-cache' : 'public, max-age=300' });
    if (req.method === 'HEAD') return res.end();
    res.end(data);
  });
});
const port = Number(process.env.PORT || 5500);
server.listen(port, '127.0.0.1', () => console.log(`ZIVA running at http://127.0.0.1:${port} (${process.env.TMDB_API_READ_ACCESS_TOKEN ? 'TMDB live mode configured' : 'demo mode'})`));
