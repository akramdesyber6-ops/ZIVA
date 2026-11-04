'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const tmdbHandler = require('./api/tmdb');
const {
  getSupabaseConfig,
  createSupabaseServerClient,
  getAuthenticatedUser,
  ensureAdmin,
  validateEmail,
  validatePassword,
  validateDisplayName,
  parseCookies
} = require('./lib/supabase');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { loadPlaybackProvider, validateProviderResponse } = require('./lib/playback-provider');

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

function cookieAttributes(env, maxAge, httpOnly = true) {
  const attributes = [`Path=/`, `Max-Age=${maxAge}`, 'SameSite=Lax'];
  if (httpOnly) attributes.push('HttpOnly');
  if (env.NODE_ENV === 'production') attributes.push('Secure');
  return attributes.join('; ');
}

function appendCookies(res, cookies) {
  const current = res.getHeader('Set-Cookie');
  const values = current ? (Array.isArray(current) ? current : [current]) : [];
  res.setHeader('Set-Cookie', values.concat(cookies));
}

function clearSessionCookies(res, env) {
  const attributes = cookieAttributes(env, 0);
  appendCookies(res, [
    `ziva_access=; ${attributes}`,
    `ziva_refresh=; ${attributes}`
  ]);
}

function setSessionCookies(res, session, env) {
  if (!session || !session.access_token || !session.refresh_token) return false;
  const accessMaxAge = Math.max(1, Math.min(Number(session.expires_in) || 3600, 86400));
  appendCookies(res, [
    `ziva_access=${encodeURIComponent(session.access_token)}; ${cookieAttributes(env, accessMaxAge)}`,
    `ziva_refresh=${encodeURIComponent(session.refresh_token)}; ${cookieAttributes(env, 30 * 24 * 60 * 60)}`
  ]);
  return true;
}

function ensureCsrfCookie(req, res, env) {
  const existing = parseCookies(req.headers && req.headers.cookie).ziva_csrf;
  const token = /^[A-Za-z0-9_-]{43}$/.test(existing || '')
    ? existing
    : randomBytes(32).toString('base64url');
  appendCookies(res, [`ziva_csrf=${token}; ${cookieAttributes(env, 30 * 24 * 60 * 60, false)}`]);
  return token;
}

function isSameOrigin(req, env) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return false;

  try {
    const requestOrigin = env.APP_ORIGIN
      ? new URL(env.APP_ORIGIN).origin
      : `${(req.headers['x-forwarded-proto'] || (req.socket && req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim()}://${req.headers.host}`;
    return new URL(origin).origin === requestOrigin;
  } catch {
    return false;
  }
}

function requireCsrf(req, res, env) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  const cookieToken = cookies.ziva_csrf || '';
  const headerToken = req.headers && req.headers['x-csrf-token'];
  const fetchSite = req.headers && req.headers['sec-fetch-site'];
  const validTokens = typeof headerToken === 'string'
    && cookieToken.length === headerToken.length
    && timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));

  if (!isSameOrigin(req, env) || (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') || !validTokens) {
    sendJson(res, 403, { error: 'CSRF_VALIDATION_FAILED', message: 'Please reload the page and try again.' });
    return false;
  }
  return true;
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

function requireJsonObject(payload, res) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    sendJson(res, 400, { error: 'INVALID_BODY', message: 'Request body must be a JSON object.' });
    return false;
  }
  return true;
}

async function handleRegister(req, res, env, clientFactory) {
  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
  }

  if (!requireJsonObject(payload, res)) return;

  const email = String(payload.email || '').trim().toLowerCase();
  const fullName = String(payload.full_name || payload.name || '').trim();
  const password = payload.password;

  if (!validateEmail(email)) return sendJson(res, 400, { error: 'INVALID_EMAIL', message: 'A valid email address is required.' });
  if (!validateDisplayName(fullName)) return sendJson(res, 400, { error: 'INVALID_NAME', message: 'Full name must be between 2 and 80 characters.' });
  if (!validatePassword(password)) return sendJson(res, 400, { error: 'WEAK_PASSWORD', message: 'Use a password with at least 8 characters.' });

  const client = clientFactory(env);
  if (!client) return sendJson(res, 503, { error: 'SUPABASE_NOT_CONFIGURED', message: 'Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.' });

  try {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName }
      }
    });

    if (error) {
      const code = String(error.code || '').toLowerCase();
      const message = String(error.message || '').toLowerCase();
      if (error.status === 429) return sendJson(res, 429, { error: 'OTP_RATE_LIMITED', message: 'Too many code requests. Please wait before trying again.' });
      if (/weak_password|password.*(weak|short|characters)/.test(`${code} ${message}`)) {
        return sendJson(res, 400, { error: 'WEAK_PASSWORD', message: 'Use a stronger password with at least 8 characters.' });
      }
      if (/user_already_exists|already registered|already been registered/.test(`${code} ${message}`)) {
        return sendJson(res, 409, { error: 'ACCOUNT_EXISTS', message: 'An account already exists for this email. Sign in or use email-code sign-in.' });
      }
      return sendJson(res, 400, { error: 'REGISTRATION_FAILED', message: 'Unable to create the account. Check the details and try again.' });
    }

    if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return sendJson(res, 409, { error: 'ACCOUNT_EXISTS', message: 'An account already exists for this email. Sign in or use email-code sign-in.' });
    }
    if (!data || !data.user || data.session) {
      return sendJson(res, 503, {
        error: 'EMAIL_CONFIRMATION_REQUIRED',
        message: 'Email verification is not enabled. Enable email confirmation and six-digit OTP codes in Supabase Auth.'
      });
    }

    ensureCsrfCookie(req, res, env);
    return sendJson(res, 202, {
      codeSent: true,
      message: 'If this address can be registered, a one-time verification code has been sent.'
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'AUTH_NETWORK_ERROR',
      message: 'Registration is temporarily unavailable.'
    });
  }
}

async function handleLogin(req, res, env, clientFactory) {
  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
  }

  if (!requireJsonObject(payload, res)) return;

  const email = String(payload.email || '').trim().toLowerCase();
  const password = payload.password;

  if (!validateEmail(email)) return sendJson(res, 400, { error: 'INVALID_EMAIL', message: 'A valid email address is required.' });
  if (!validatePassword(password)) return sendJson(res, 400, { error: 'WEAK_PASSWORD', message: 'Enter your password.' });

  const client = clientFactory(env);
  if (!client) return sendJson(res, 503, { error: 'SUPABASE_NOT_CONFIGURED', message: 'Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.' });

  try {
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password
    });

    if (error && error.status === 429) {
      return sendJson(res, 429, {
        error: 'OTP_RATE_LIMITED',
        message: 'Too many code requests. Please wait before trying again.'
      });
    }

    if (error) {
      const code = String(error.code || '').toLowerCase();
      if (/email_not_confirmed|email.*not.*confirmed/.test(`${code} ${error.message || ''}`.toLowerCase())) {
        return sendJson(res, 403, { error: 'EMAIL_NOT_VERIFIED', message: 'Verify your email first, or request a sign-in code.' });
      }
      return sendJson(res, 401, { error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
    }

    const session = data && data.session;
    if (!session) return sendJson(res, 401, { error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
    const verified = await client.auth.getUser(session.access_token);
    const user = verified.data && verified.data.user;
    if (verified.error || !user || !(user.email_confirmed_at || user.confirmed_at)) {
      return sendJson(res, 403, { error: 'EMAIL_NOT_VERIFIED', message: 'Verify your email before signing in.' });
    }
    if (!setSessionCookies(res, session, env)) {
      return sendJson(res, 502, { error: 'SESSION_SETUP_FAILED', message: 'Unable to establish a secure session. Please try again.' });
    }
    return sendJson(res, 200, {
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: (user.user_metadata && user.user_metadata.full_name) || ''
      }
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'AUTH_NETWORK_ERROR',
      message: 'Sign in is temporarily unavailable.'
    });
  }
}

async function handleLoginCode(req, res, env, clientFactory) {
  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
  }
  if (!requireJsonObject(payload, res)) return;
  const email = String(payload.email || '').trim().toLowerCase();
  if (!validateEmail(email)) return sendJson(res, 400, { error: 'INVALID_EMAIL', message: 'A valid email address is required.' });
  const client = clientFactory(env);
  if (!client) return sendJson(res, 503, { error: 'SUPABASE_NOT_CONFIGURED', message: 'Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.' });
  try {
    const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error && error.status === 429) return sendJson(res, 429, { error: 'OTP_RATE_LIMITED', message: 'Too many code requests. Please wait before trying again.' });
    if (error) return sendJson(res, 503, { error: 'OTP_UNAVAILABLE', message: 'Sign-in codes are temporarily unavailable. Please try again later.' });
    return sendJson(res, 200, { codeSent: true, message: 'If an account exists for this address, a one-time sign-in code has been sent.' });
  } catch {
    return sendJson(res, 500, { error: 'AUTH_NETWORK_ERROR', message: 'Sign-in codes are temporarily unavailable.' });
  }
}

async function handleResendSignupCode(req, res, env, clientFactory) {
  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
  }
  if (!requireJsonObject(payload, res)) return;
  const email = String(payload.email || '').trim().toLowerCase();
  if (!validateEmail(email)) return sendJson(res, 400, { error: 'INVALID_EMAIL', message: 'A valid email address is required.' });
  const client = clientFactory(env);
  if (!client) return sendJson(res, 503, { error: 'SUPABASE_NOT_CONFIGURED', message: 'Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.' });
  try {
    const { error } = await client.auth.resend({ type: 'signup', email });
    if (error && error.status === 429) return sendJson(res, 429, { error: 'OTP_RATE_LIMITED', message: 'Too many code requests. Please wait before trying again.' });
    if (error) return sendJson(res, 400, { error: 'OTP_RESEND_FAILED', message: 'Unable to resend the verification code. Request a new registration or try again later.' });
    return sendJson(res, 200, { codeSent: true, message: 'A new verification code has been sent if the account is awaiting confirmation.' });
  } catch {
    return sendJson(res, 500, { error: 'AUTH_NETWORK_ERROR', message: 'Unable to resend the verification code right now.' });
  }
}

async function handleVerifyOtp(req, res, env, clientFactory) {
  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
  }

  if (!requireJsonObject(payload, res)) return;
  const email = String(payload.email || '').trim().toLowerCase();
  const token = String(payload.code || '').trim();
  const type = payload.type || 'signup';
  if (!validateEmail(email)) return sendJson(res, 400, { error: 'INVALID_EMAIL', message: 'Enter a valid email address.' });
  if (!/^\d{6}$/.test(token)) return sendJson(res, 400, { error: 'INVALID_CODE', message: 'Enter the six-digit code from your email.' });
  if (!['signup', 'email'].includes(type)) return sendJson(res, 400, { error: 'INVALID_CODE_TYPE', message: 'This verification request is invalid.' });

  const client = clientFactory(env);
  if (!client) return sendJson(res, 503, { error: 'SUPABASE_NOT_CONFIGURED', message: 'Supabase is not configured.' });

  try {
    const { data, error } = await client.auth.verifyOtp({
      email,
      token,
      type
    });
    const session = data && data.session;
    if (error || !session) {
      if (error && error.status === 429) {
        return sendJson(res, 429, { error: 'OTP_RATE_LIMITED', message: 'Too many verification attempts. Request a new code and try later.' });
      }
      return sendJson(res, 400, {
        error: 'OTP_INVALID_OR_EXPIRED',
        message: 'That code is invalid or expired. Request a new code and try again.'
      });
    }

    const verified = await client.auth.getUser(session.access_token);
    const user = verified.data && verified.data.user;
    if (verified.error || !user || !(user.email_confirmed_at || user.confirmed_at)) {
      return sendJson(res, 403, {
        error: 'EMAIL_NOT_VERIFIED',
        message: 'Email verification could not be confirmed. Request a new code and try again.'
      });
    }
    if (!setSessionCookies(res, session, env)) {
      return sendJson(res, 502, { error: 'SESSION_SETUP_FAILED', message: 'Unable to establish a secure session. Please try again.' });
    }

    return sendJson(res, 200, {
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: (user.user_metadata && user.user_metadata.full_name) || ''
      },
      message: 'Email verified.'
    });
  } catch (error) {
    return sendJson(res, 500, { error: 'OTP_VERIFICATION_FAILED', message: 'Email verification is temporarily unavailable.' });
  }
}

async function handleSession(req, res, env, clientFactory) {
  const csrfToken = ensureCsrfCookie(req, res, env);
  if (!getSupabaseConfig(env).isConfigured) {
    return sendJson(res, 503, {
      error: 'SUPABASE_NOT_CONFIGURED',
      message: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.',
      csrfToken
    });
  }
  const auth = await getAuthenticatedUser(req, env, { clientFactory });
  if (!auth.ok) {
    if (auth.code === 'INVALID_SESSION' || auth.code === 'AUTH_REQUIRED' || auth.code === 'EMAIL_NOT_VERIFIED') clearSessionCookies(res, env);
    return sendJson(res, auth.status, { error: auth.code, message: auth.message, csrfToken });
  }

  if (auth.session) setSessionCookies(res, auth.session, env);

  let isAdmin = false;
  try {
    const adminCheck = await auth.client.rpc('is_user_admin');
    isAdmin = !adminCheck.error && Boolean(adminCheck.data);
  } catch {
    isAdmin = false;
  }

  return sendJson(res, 200, {
    user: {
      id: auth.user.id,
      email: auth.user.email,
      fullName: (auth.user.user_metadata && auth.user.user_metadata.full_name) || '',
      isAdmin
    },
    authenticated: true,
    csrfToken
  });
}

async function handleLogout(req, res, env, clientFactory) {
  const auth = await getAuthenticatedUser(req, env, { clientFactory });

  try {
    if (auth.ok) {
      if (auth.refreshToken && typeof auth.client.auth.setSession === 'function') {
        const { error } = await auth.client.auth.setSession({
          access_token: auth.token,
          refresh_token: auth.refreshToken
        });
        if (error) throw error;
      }
      const result = await auth.client.auth.signOut({ scope: 'global' });
      if (result && result.error) {
        clearSessionCookies(res, env);
        ensureCsrfCookie(req, res, env);
        return sendJson(res, 502, { error: 'LOGOUT_FAILED', message: 'Your browser session was cleared, but the server could not revoke it. Please try again.' });
      }
    }

    clearSessionCookies(res, env);
    ensureCsrfCookie(req, res, env);
    return sendJson(res, 200, { ok: true, message: 'Logout successful.' });
  } catch (error) {
    clearSessionCookies(res, env);
    ensureCsrfCookie(req, res, env);
    return sendJson(res, 500, {
      error: 'AUTH_ERROR',
      message: 'Your browser session was cleared, but sign-out could not be confirmed.'
    });
  }
}

async function handleAdminPermissions(req, res, env, clientFactory) {
  const auth = await ensureAdmin(req, env, { clientFactory });
  if (auth.session) setSessionCookies(res, auth.session, env);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });

  return sendJson(res, 200, {
    isAdmin: true,
    user: { id: auth.user.id, email: auth.user.email }
  });
}

async function handlePlaybackAuthorize(req, res, env, clientFactory, provider, params) {
  const auth = await getAuthenticatedUser(req, env, { clientFactory });
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });
  if (auth.session) setSessionCookies(res, auth.session, env);

  const tmdbId = Number(params.get('tmdbId'));
  const mediaType = params.get('mediaType');
  if (!Number.isSafeInteger(tmdbId) || tmdbId < 1 || !['movie', 'tv'].includes(mediaType)) {
    return sendJson(res, 400, { error: 'INVALID_TITLE', message: 'A valid movie or series identifier is required.' });
  }

  let adapter;
  try {
    adapter = provider || loadPlaybackProvider(env);
  } catch {
    return sendJson(res, 503, { error: 'PLAYBACK_PROVIDER_MISCONFIGURED', message: 'The authorized playback provider is not configured correctly.' });
  }
  if (!adapter) {
    return sendJson(res, 503, {
      authorized: false,
      error: 'PLAYBACK_PROVIDER_UNAVAILABLE',
      message: 'This title is not currently available for playback.'
    });
  }

  try {
    const result = await adapter.resolveTitle({
      tmdbId,
      mediaType,
      user: { id: auth.user.id, email: auth.user.email }
    });
    if (!result || result.authorized !== true) {
      return sendJson(res, 404, { authorized: false, error: 'TITLE_UNAVAILABLE', message: 'This title is not currently available for playback.' });
    }
    const playback = validateProviderResponse(result, env);
    if (!playback) {
      return sendJson(res, 502, { authorized: false, error: 'INVALID_PROVIDER_RESPONSE', message: 'The provider could not supply a valid authorized stream.' });
    }
    return sendJson(res, 200, playback);
  } catch {
    return sendJson(res, 502, { authorized: false, error: 'PLAYBACK_PROVIDER_ERROR', message: 'The provider could not authorize playback right now.' });
  }
}

const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon' };
loadEnv();
function createServer(options = {}) {
  const env = options.env || process.env;
  const clientFactory = options.clientFactory || createSupabaseServerClient;
  const playbackProvider = options.playbackProvider || null;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');

    let url; try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { return sendJson(res, 400, { error:'BAD_URL' }); }

    if (url.pathname === '/api/status') return sendJson(res, 200, { mode: env.TMDB_API_READ_ACCESS_TOKEN ? 'live' : 'demo', tmdbConfigured: Boolean(env.TMDB_API_READ_ACCESS_TOKEN) });

    if (url.pathname === '/api/auth/register') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are supported.' });
      if (!requireCsrf(req, res, env)) return;
      return handleRegister(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/auth/login') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are supported.' });
      if (!requireCsrf(req, res, env)) return;
      return handleLogin(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/auth/login-code') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are supported.' });
      if (!requireCsrf(req, res, env)) return;
      return handleLoginCode(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/auth/resend') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are supported.' });
      if (!requireCsrf(req, res, env)) return;
      return handleResendSignupCode(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/auth/verify') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are supported.' });
      if (!requireCsrf(req, res, env)) return;
      return handleVerifyOtp(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/auth/logout') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are supported.' });
      if (!requireCsrf(req, res, env)) return;
      return handleLogout(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/auth/session') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported.' });
      return handleSession(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/admin/permissions') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported.' });
      return handleAdminPermissions(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/playback/authorize') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported.' });
      return handlePlaybackAuthorize(req, res, env, clientFactory, playbackProvider, url.searchParams);
    }

    if (url.pathname === '/api/tmdb') {
      req.query = Object.fromEntries(url.searchParams.entries());
      return tmdbHandler(req, res, env);
    }

    if (!['GET','HEAD'].includes(req.method)) return sendJson(res, 405, { error:'METHOD_NOT_ALLOWED' });

    let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { return sendJson(res, 400, { error:'BAD_PATH' }); }
    if (pathname === '/') pathname = '/index.html';
    if (/^\/(?:movies|series|watchlist|genres\/[a-z0-9-]+)\/?$/i.test(pathname)) pathname = '/index.html';
    if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin/index.html';
    const pathSegments = pathname.split('/');
    const privatePath = pathSegments.some((segment) => segment.startsWith('.'))
      || /^\/(?:lib|supabase|tests|node_modules)(?:\/|$)/i.test(pathname)
      || /^\/(?:server\.js|package(?:-lock)?\.json|README[^/]*|setup-stage2\.js)$/i.test(pathname);
    if (privatePath) return sendJson(res, 404, { error:'NOT_FOUND' });

    const target = path.resolve(ROOT, `.${pathname}`);
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return sendJson(res, 403, { error:'FORBIDDEN' });

    fs.readFile(target, (error, data) => {
      if (error) return sendJson(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'NOT_FOUND' : 'FILE_READ_ERROR' });
      res.writeHead(200, { 'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control': target.endsWith('.html') ? 'no-cache' : 'public, max-age=300' });
      if (req.method === 'HEAD') return res.end();
      res.end(data);
    });
  });
  return server;
}

if (require.main === module) {
  const server = createServer();
  const port = Number(process.env.PORT || 5500);
  server.listen(port, '127.0.0.1', () => console.log(`ZIVA running at http://127.0.0.1:${port} (${process.env.TMDB_API_READ_ACCESS_TOKEN ? 'TMDB live mode configured' : 'demo mode'})`));
}

module.exports = { createServer };
