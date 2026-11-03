'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const tmdbHandler = require('./api/tmdb');
const {
  createSupabaseServerClient,
  getAuthenticatedUser,
  ensureAdmin,
  validateEmail,
  validatePassword,
  validateDisplayName
} = require('./lib/supabase');

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

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('REQUEST_BODY_TOO_LARGE'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function handleRegister(req, res) {
  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  const fullName = String(payload.full_name || payload.name || '').trim();

  if (!validateEmail(email)) return sendJson(res, 400, { error: 'INVALID_EMAIL', message: 'A valid email address is required.' });
  if (!validatePassword(password)) return sendJson(res, 400, { error: 'INVALID_PASSWORD', message: 'Password must be at least 8 characters long.' });
  if (!validateDisplayName(fullName)) return sendJson(res, 400, { error: 'INVALID_NAME', message: 'Full name must be between 2 and 80 characters.' });

  const client = createSupabaseServerClient(process.env);
  if (!client) return sendJson(res, 503, { error: 'SUPABASE_NOT_CONFIGURED', message: 'Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.' });

  try {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } }
    });

    if (error) {
      return sendJson(res, error.status || 400, {
        error: error.code || 'SIGNUP_FAILED',
        message: error.message || 'Registration failed.'
      });
    }

    return sendJson(res, 201, {
      user: data && data.user ? { id: data.user.id, email: data.user.email } : null,
      session: data && data.session ? { access_token: Boolean(data.session.access_token) } : null,
      message: 'Registration successful.'
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'AUTH_ERROR',
      message: error && error.message ? error.message : 'Registration failed.'
    });
  }
}

async function handleLogin(req, res) {
  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');

  if (!validateEmail(email)) return sendJson(res, 400, { error: 'INVALID_EMAIL', message: 'A valid email address is required.' });
  if (!validatePassword(password)) return sendJson(res, 400, { error: 'INVALID_PASSWORD', message: 'Password must be at least 8 characters long.' });

  const client = createSupabaseServerClient(process.env);
  if (!client) return sendJson(res, 503, { error: 'SUPABASE_NOT_CONFIGURED', message: 'Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.' });

  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      return sendJson(res, error.status || 401, {
        error: error.code || 'LOGIN_FAILED',
        message: error.message || 'Unable to sign in.'
      });
    }

    return sendJson(res, 200, {
      user: data && data.user ? { id: data.user.id, email: data.user.email } : null,
      session: data && data.session ? { access_token: Boolean(data.session.access_token) } : null,
      message: 'Login successful.'
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'AUTH_ERROR',
      message: error && error.message ? error.message : 'Login failed.'
    });
  }
}

async function handleSession(req, res) {
  const auth = await getAuthenticatedUser(req, process.env);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });

  let isAdmin = false;
  try {
    const adminCheck = await auth.client.rpc('is_user_admin');
    isAdmin = Boolean(adminCheck.data);
  } catch {
    isAdmin = false;
  }

  return sendJson(res, 200, {
    user: {
      id: auth.user.id,
      email: auth.user.email,
      isAdmin
    },
    authenticated: true
  });
}

async function handleLogout(req, res) {
  const auth = await getAuthenticatedUser(req, process.env);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });

  try {
    const { error } = await auth.client.auth.signOut();
    if (error) {
      return sendJson(res, error.status || 400, {
        error: error.code || 'LOGOUT_FAILED',
        message: error.message || 'Logout failed.'
      });
    }

    return sendJson(res, 200, { ok: true, message: 'Logout successful.' });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'AUTH_ERROR',
      message: error && error.message ? error.message : 'Logout failed.'
    });
  }
}

async function handleAdminPermissions(req, res) {
  const auth = await ensureAdmin(req, process.env);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });

  return sendJson(res, 200, {
    isAdmin: true,
    user: { id: auth.user.id, email: auth.user.email }
  });
}

async function handlePlaybackAuthorize(req, res) {
  const auth = await getAuthenticatedUser(req, process.env);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });

  return sendJson(res, 200, {
    authorized: true,
    requiresAuth: true,
    user: { id: auth.user.id, email: auth.user.email }
  });
}

const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon' };
loadEnv();
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');

  let url; try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { return sendJson(res, 400, { error:'BAD_URL' }); }

  if (url.pathname === '/api/status') return sendJson(res, 200, { mode: process.env.TMDB_API_READ_ACCESS_TOKEN ? 'live' : 'demo', tmdbConfigured: Boolean(process.env.TMDB_API_READ_ACCESS_TOKEN) });

  if (url.pathname === '/api/auth/register') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are supported.' });
    return handleRegister(req, res);
  }

  if (url.pathname === '/api/auth/login') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are supported.' });
    return handleLogin(req, res);
  }

  if (url.pathname === '/api/auth/logout') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are supported.' });
    return handleLogout(req, res);
  }

  if (url.pathname === '/api/auth/session') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported.' });
    return handleSession(req, res);
  }

  if (url.pathname === '/api/admin/permissions') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported.' });
    return handleAdminPermissions(req, res);
  }

  if (url.pathname === '/api/playback/authorize') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported.' });
    return handlePlaybackAuthorize(req, res);
  }

  if (url.pathname === '/api/tmdb') {
    req.query = Object.fromEntries(url.searchParams.entries());
    return tmdbHandler(req, res);
  }

  if (!['GET','HEAD'].includes(req.method)) return sendJson(res, 405, { error:'METHOD_NOT_ALLOWED' });

  let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { return sendJson(res, 400, { error:'BAD_PATH' }); }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin/index.html';

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
