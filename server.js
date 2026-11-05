'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const tmdbHandler = require('./api/tmdb');
const animeHandler = require('./api/anime');
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
  const attributes = [`Path=/`, `Max-Age=${maxAge}`, `SameSite=${env.MOBILE_APP_ORIGINS ? 'None' : 'Lax'}`];
  if (httpOnly) attributes.push('HttpOnly');
  if (env.NODE_ENV === 'production' || env.MOBILE_APP_ORIGINS) attributes.push('Secure');
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

function normalizeOrigin(value) {
  const url = new URL(value);
  return url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin;
}

function mobileOrigins(env) {
  return String(env.MOBILE_APP_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeOrigin);
}

function isMobileOrigin(req, env) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return false;
  try {
    return mobileOrigins(env).includes(normalizeOrigin(origin));
  } catch {
    return false;
  }
}

function isSameOrigin(req, env) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return false;

  try {
    const requestOrigin = env.APP_ORIGIN
      ? normalizeOrigin(env.APP_ORIGIN)
      : `${(req.headers['x-forwarded-proto'] || (req.socket && req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim()}://${req.headers.host}`;
    const allowedOrigins = [requestOrigin, ...mobileOrigins(env)];
    return allowedOrigins.includes(normalizeOrigin(origin));
  } catch {
    return false;
  }
}

function applyCors(req, res, env) {
  const origin = req.headers && req.headers.origin;
  if (!origin || !isSameOrigin(req, env)) return false;
  res.setHeader('Access-Control-Allow-Origin', normalizeOrigin(origin));
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  return true;
}

function requireCsrf(req, res, env) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  const cookieToken = cookies.ziva_csrf || '';
  const headerToken = req.headers && req.headers['x-csrf-token'];
  const fetchSite = req.headers && req.headers['sec-fetch-site'];
  const validTokens = typeof headerToken === 'string'
    && cookieToken.length === headerToken.length
    && timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));

  const fetchSiteAllowed = !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none'
    || (fetchSite === 'cross-site' && isMobileOrigin(req, env));
  if (!isSameOrigin(req, env) || !fetchSiteAllowed || !validTokens) {
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

function validHttpsUrl(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    return new URL(value).protocol === 'https:' ? value : false;
  } catch {
    return false;
  }
}

async function handleAdminCatalog(req, res, env, clientFactory) {
  const auth = await ensureAdmin(req, env, { clientFactory });
  if (auth.session) setSessionCookies(res, auth.session, env);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });
  if (!auth.client.from) return sendJson(res, 503, { error: 'SUPABASE_UNAVAILABLE', message: 'Catalogue management is temporarily unavailable.' });

  if (req.method === 'GET') {
    let query = auth.client.from('catalog_entries')
      .select('id,media_type,external_id,title,description,release_year,genres,poster_url,backdrop_url,is_published,created_at,updated_at')
      .order('updated_at', { ascending: false })
      .limit(100);
    const mediaType = new URL(req.url, 'http://localhost').searchParams.get('mediaType');
    if (mediaType) {
      if (!['movie', 'tv', 'anime'].includes(mediaType)) return sendJson(res, 400, { error: 'INVALID_MEDIA_TYPE', message: 'Choose movie, tv or anime.' });
      query = query.eq('media_type', mediaType);
    }
    const result = await query;
    if (result.error) return sendJson(res, 503, { error: 'CATALOG_UNAVAILABLE', message: 'Catalogue records could not be loaded. Apply the catalogue migration and try again.' });
    return sendJson(res, 200, { entries: result.data || [] });
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
  }
  if (!requireJsonObject(payload, res)) return;
  if (payload.action === 'remove') {
    if (typeof payload.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.id)) return sendJson(res, 400, { error: 'INVALID_ENTRY_ID', message: 'A valid catalogue entry ID is required.' });
    const result = await auth.client.from('catalog_entries').delete().eq('id', payload.id);
    if (result.error) return sendJson(res, 503, { error: 'CATALOG_WRITE_FAILED', message: 'The catalogue entry could not be removed.' });
    return sendJson(res, 200, { ok: true });
  }

  const mediaType = payload.mediaType;
  const externalId = payload.externalId;
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const releaseYear = payload.releaseYear === '' || payload.releaseYear === null ? null : Number(payload.releaseYear);
  const posterUrl = validHttpsUrl(payload.posterUrl);
  const backdropUrl = validHttpsUrl(payload.backdropUrl);
  const genres = payload.genres;
  if (!['movie', 'tv', 'anime'].includes(mediaType)
      || typeof externalId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(externalId)
      || title.length < 1 || title.length > 240
      || (releaseYear !== null && (!Number.isSafeInteger(releaseYear) || releaseYear < 1800 || releaseYear > 2200))
      || (posterUrl === false) || (backdropUrl === false)
      || !Array.isArray(genres) || genres.length > 20 || genres.some((item) => typeof item !== 'string' || item.length > 60)) {
    return sendJson(res, 400, { error: 'INVALID_CATALOG_ENTRY', message: 'Provide valid type, external ID, title, year, genres and HTTPS images.' });
  }

  const result = await auth.client.from('catalog_entries').upsert({
    media_type: mediaType,
    external_id: externalId,
    title,
    description: typeof payload.description === 'string' ? payload.description.slice(0, 10000) : '',
    release_year: releaseYear,
    genres,
    poster_url: posterUrl,
    backdrop_url: backdropUrl,
    is_published: payload.isPublished === true,
    created_by: auth.user.id,
    updated_at: new Date().toISOString()
  }, { onConflict: 'media_type,external_id' }).select('id,media_type,external_id,title,is_published').single();
  if (result.error) return sendJson(res, 503, { error: 'CATALOG_WRITE_FAILED', message: 'The catalogue entry could not be saved.' });
  return sendJson(res, 200, { entry: result.data });
}

async function handleAdminUsers(req, res, env, clientFactory) {
  const auth = await ensureAdmin(req, env, { clientFactory });
  if (auth.session) setSessionCookies(res, auth.session, env);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });
  if (!auth.client.from) return sendJson(res, 503, { error: 'SUPABASE_UNAVAILABLE', message: 'User management is temporarily unavailable.' });
  const result = await auth.client.from('profiles')
    .select('id,email,full_name,avatar_url,created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) return sendJson(res, 503, { error: 'USERS_UNAVAILABLE', message: 'User records could not be loaded.' });
  const [assignments, roles] = await Promise.all([
    auth.client.from('user_roles').select('user_id,role_id'),
    auth.client.from('roles').select('id,name')
  ]);
  if (assignments.error || roles.error) return sendJson(res, 503, { error: 'ROLES_UNAVAILABLE', message: 'User roles could not be loaded.' });
  const roleNames = new Map((roles.data || []).map((role) => [role.id, role.name]));
  const users = (result.data || []).map((user) => ({
    ...user,
    roles: (assignments.data || []).filter((assignment) => assignment.user_id === user.id).map((assignment) => roleNames.get(assignment.role_id)).filter(Boolean)
  }));
  return sendJson(res, 200, { users });
}

async function handleAdminRoles(req, res, env, clientFactory) {
  const auth = await ensureAdmin(req, env, { clientFactory });
  if (auth.session) setSessionCookies(res, auth.session, env);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });
  if (!auth.client.from) return sendJson(res, 503, { error: 'SUPABASE_UNAVAILABLE', message: 'Role management is temporarily unavailable.' });
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
  }
  if (!requireJsonObject(payload, res)) return;
  const userId = payload.userId;
  const roleName = payload.roleName;
  if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId) || !['user', 'admin'].includes(roleName)) {
    return sendJson(res, 400, { error: 'INVALID_ROLE_ASSIGNMENT', message: 'Provide a valid user ID and the user or admin role.' });
  }
  const role = await auth.client.from('roles').select('id').eq('name', roleName).single();
  if (role.error || !role.data) return sendJson(res, 503, { error: 'ROLE_UNAVAILABLE', message: 'The requested role could not be loaded.' });
  if (payload.action === 'remove') {
    if (roleName === 'admin') {
      const admins = await auth.client.from('user_roles').select('user_id').eq('role_id', role.data.id);
      if (admins.error) return sendJson(res, 503, { error: 'ROLE_CHECK_FAILED', message: 'Administrator assignments could not be verified.' });
      if (!Array.isArray(admins.data) || admins.data.length <= 1) {
        return sendJson(res, 409, { error: 'LAST_ADMIN_REQUIRED', message: 'Assign another administrator before removing the final administrator role.' });
      }
    }
    const result = await auth.client.from('user_roles').delete().eq('user_id', userId).eq('role_id', role.data.id);
    if (result.error) return sendJson(res, 503, { error: 'ROLE_UPDATE_FAILED', message: 'The role assignment could not be removed.' });
    return sendJson(res, 200, { ok: true });
  }
  if (payload.action !== 'assign') return sendJson(res, 400, { error: 'INVALID_ACTION', message: 'Choose assign or remove.' });
  const result = await auth.client.from('user_roles').upsert({ user_id: userId, role_id: role.data.id }, { onConflict: 'user_id,role_id' });
  if (result.error) return sendJson(res, 503, { error: 'ROLE_UPDATE_FAILED', message: 'The role assignment could not be saved.' });
  return sendJson(res, 200, { ok: true });
}

async function handleAdminVideoSources(req, res, env, clientFactory) {
  const auth = await ensureAdmin(req, env, { clientFactory });
  if (auth.session) setSessionCookies(res, auth.session, env);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });
  if (!auth.client.from) return sendJson(res, 503, { error: 'SUPABASE_UNAVAILABLE', message: 'Provider records are temporarily unavailable.' });

  if (req.method === 'GET') {
    const result = await auth.client.from('authorized_video_sources')
      .select('id,catalog_entry_id,provider_name,provider_asset_id,rights_reference,rights_expires_at,status,created_at')
      .order('created_at', { ascending: false }).limit(100);
    if (result.error) return sendJson(res, 503, { error: 'PROVIDERS_UNAVAILABLE', message: 'Provider records could not be loaded.' });
    return sendJson(res, 200, { sources: result.data || [] });
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
  }
  if (!requireJsonObject(payload, res)) return;
  const { catalogEntryId, providerName, providerAssetId, rightsReference, rightsExpiresAt, status } = payload;
  if (typeof catalogEntryId !== 'string' || !/^[0-9a-f-]{36}$/i.test(catalogEntryId)
      || typeof providerName !== 'string' || providerName.trim().length < 1 || providerName.length > 120
      || typeof providerAssetId !== 'string' || providerAssetId.trim().length < 1 || providerAssetId.length > 240
      || typeof rightsReference !== 'string' || rightsReference.trim().length < 1 || rightsReference.length > 500
      || !['pending', 'approved', 'expired', 'revoked'].includes(status)
      || (rightsExpiresAt && !Number.isFinite(Date.parse(rightsExpiresAt)))) {
    return sendJson(res, 400, { error: 'INVALID_PROVIDER_RECORD', message: 'Add a valid catalogue ID, provider asset, rights reference and status.' });
  }
  const result = await auth.client.from('authorized_video_sources').upsert({
    catalog_entry_id: catalogEntryId,
    provider_name: providerName.trim(),
    provider_asset_id: providerAssetId.trim(),
    rights_reference: rightsReference.trim(),
    rights_expires_at: rightsExpiresAt || null,
    status,
    created_by: auth.user.id,
    updated_at: new Date().toISOString()
  }, { onConflict: 'provider_name,provider_asset_id' }).select('id,status,provider_name,provider_asset_id').single();
  if (result.error) return sendJson(res, 503, { error: 'PROVIDER_WRITE_FAILED', message: 'The provider rights record could not be saved.' });
  return sendJson(res, 200, { source: result.data });
}

async function handleAdminSubscriptions(req, res, env, clientFactory) {
  const auth = await ensureAdmin(req, env, { clientFactory });
  if (auth.session) setSessionCookies(res, auth.session, env);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });
  if (!auth.client.from) return sendJson(res, 503, { error: 'SUPABASE_UNAVAILABLE', message: 'Subscription records are temporarily unavailable.' });
  const result = await auth.client.from('subscriptions')
    .select('id,user_id,plan,status,provider,current_period_end,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(100);
  if (result.error) return sendJson(res, 503, { error: 'SUBSCRIPTIONS_UNAVAILABLE', message: 'Subscription records could not be loaded.' });
  return sendJson(res, 200, { subscriptions: result.data || [], paymentProcessingEnabled: false });
}

async function handleAdminPayments(req, res, env, clientFactory) {
  const auth = await ensureAdmin(req, env, { clientFactory });
  if (auth.session) setSessionCookies(res, auth.session, env);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });
  if (!auth.client.from) return sendJson(res, 503, { error: 'SUPABASE_UNAVAILABLE', message: 'Payment records are temporarily unavailable.' });
  const result = await auth.client.from('payment_records')
    .select('id,user_id,subscription_id,provider,amount_minor,currency,status,occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(100);
  if (result.error) return sendJson(res, 503, { error: 'PAYMENTS_UNAVAILABLE', message: 'Payment records could not be loaded.' });
  return sendJson(res, 200, { payments: result.data || [], paymentProcessingEnabled: false });
}

function validLibraryRecord(payload) {
  const mediaType = payload.mediaType;
  const collection = payload.collection;
  const contentId = payload.contentId;
  return ['movie', 'tv', 'anime'].includes(mediaType)
    && ['watchlist', 'favorite'].includes(collection)
    && typeof contentId === 'string'
    && contentId.length >= 1
    && contentId.length <= 160
    && /^[A-Za-z0-9_-]+$/.test(contentId);
}

function cleanLibraryMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, 240) : '';
  const year = Number.isSafeInteger(value.year) && value.year >= 1800 && value.year <= 2200 ? value.year : null;
  const image = typeof value.image === 'string' && value.image.length <= 1000
    && /^https:\/\/(image\.tmdb\.org|[a-z0-9-]+\.anilist\.co)\//i.test(value.image)
    ? value.image
    : '';
  return { title, year, image };
}

async function handleLibrary(req, res, env, clientFactory) {
  const auth = await getAuthenticatedUser(req, env, { clientFactory });
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });
  if (auth.session) setSessionCookies(res, auth.session, env);
  if (!auth.client.from) return sendJson(res, 503, { error: 'SUPABASE_UNAVAILABLE', message: 'Your library is temporarily unavailable.' });

  if (req.method === 'GET') {
    const [library, history] = await Promise.all([
      auth.client.from('user_library').select('media_type,content_id,collection,metadata,created_at,updated_at').order('updated_at', { ascending: false }),
      auth.client.from('watch_history').select('media_type,content_id,title,position_seconds,duration_seconds,completed_at,updated_at').order('updated_at', { ascending: false }).limit(50)
    ]);
    if (library.error || history.error) {
      return sendJson(res, 503, { error: 'LIBRARY_UNAVAILABLE', message: 'Your library could not be loaded. Apply the user library migration and try again.' });
    }
    return sendJson(res, 200, { items: library.data || [], history: history.data || [] });
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
  }
  if (!requireJsonObject(payload, res)) return;
  if (!validLibraryRecord(payload)) return sendJson(res, 400, { error: 'INVALID_LIBRARY_ITEM', message: 'A supported media type, collection and content ID are required.' });

  let result;
  const query = auth.client.from('user_library');
  const match = (builder) => builder
    .eq('user_id', auth.user.id)
    .eq('media_type', payload.mediaType)
    .eq('content_id', payload.contentId)
    .eq('collection', payload.collection);
  if (payload.action === 'remove') {
    result = await match(query.delete());
  } else if (payload.action === 'upsert') {
    result = await query.upsert({
      user_id: auth.user.id,
      media_type: payload.mediaType,
      content_id: payload.contentId,
      collection: payload.collection,
      metadata: cleanLibraryMetadata(payload.metadata),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,media_type,content_id,collection' });
  } else {
    return sendJson(res, 400, { error: 'INVALID_ACTION', message: 'Choose upsert or remove.' });
  }
  if (result.error) return sendJson(res, 503, { error: 'LIBRARY_UNAVAILABLE', message: 'Your library could not be saved. Apply the user library migration and try again.' });
  return sendJson(res, 200, { ok: true });
}

async function handleWatchHistory(req, res, env, clientFactory) {
  const auth = await getAuthenticatedUser(req, env, { clientFactory });
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });
  if (auth.session) setSessionCookies(res, auth.session, env);
  if (!auth.client.from) return sendJson(res, 503, { error: 'SUPABASE_UNAVAILABLE', message: 'Watch history is temporarily unavailable.' });
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
  }
  if (!requireJsonObject(payload, res)) return;
  const { mediaType, contentId, title, positionSeconds, durationSeconds } = payload;
  if (!['movie', 'tv', 'anime'].includes(mediaType)
      || typeof contentId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(contentId)
      || typeof title !== 'string' || !title.trim() || title.length > 240
      || !Number.isSafeInteger(positionSeconds) || positionSeconds < 0
      || (durationSeconds !== null && durationSeconds !== undefined && (!Number.isSafeInteger(durationSeconds) || durationSeconds < positionSeconds))) {
    return sendJson(res, 400, { error: 'INVALID_WATCH_HISTORY', message: 'Provide valid title, media ID and playback progress.' });
  }
  const result = await auth.client.from('watch_history').upsert({
    user_id: auth.user.id,
    media_type: mediaType,
    content_id: contentId,
    title: title.trim(),
    position_seconds: positionSeconds,
    duration_seconds: durationSeconds ?? null,
    completed_at: durationSeconds && positionSeconds >= durationSeconds * 0.9 ? new Date().toISOString() : null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,media_type,content_id' });
  if (result.error) return sendJson(res, 503, { error: 'HISTORY_UNAVAILABLE', message: 'Watch history could not be saved. Apply the user library migration and try again.' });
  return sendJson(res, 200, { ok: true });
}

async function handleProfile(req, res, env, clientFactory) {
  const auth = await getAuthenticatedUser(req, env, { clientFactory });
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });
  if (auth.session) setSessionCookies(res, auth.session, env);
  if (!auth.client.from) return sendJson(res, 503, { error: 'SUPABASE_UNAVAILABLE', message: 'Your profile is temporarily unavailable.' });
  if (req.method === 'GET') {
    const result = await auth.client.from('profiles').select('id,email,full_name,avatar_url,created_at').eq('id', auth.user.id).maybeSingle();
    if (result.error) return sendJson(res, 503, { error: 'PROFILE_UNAVAILABLE', message: 'Your profile could not be loaded.' });
    return sendJson(res, 200, { profile: result.data || { id: auth.user.id, email: auth.user.email, full_name: '' } });
  }
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
  }
  if (!requireJsonObject(payload, res)) return;
  const fullName = typeof payload.fullName === 'string' ? payload.fullName.trim() : '';
  const avatarUrl = payload.avatarUrl === '' ? null : payload.avatarUrl;
  if (fullName.length < 2 || fullName.length > 80) return sendJson(res, 400, { error: 'INVALID_NAME', message: 'Display name must be between 2 and 80 characters.' });
  if (avatarUrl !== null && (typeof avatarUrl !== 'string' || avatarUrl.length > 1000 || !/^https:\/\//i.test(avatarUrl))) {
    return sendJson(res, 400, { error: 'INVALID_AVATAR', message: 'Profile images must use a valid HTTPS URL.' });
  }
  const result = await auth.client.from('profiles').update({
    full_name: fullName,
    avatar_url: avatarUrl,
    updated_at: new Date().toISOString()
  }).eq('id', auth.user.id).select('id,email,full_name,avatar_url,created_at').single();
  if (result.error) return sendJson(res, 503, { error: 'PROFILE_UNAVAILABLE', message: 'Your profile could not be saved.' });
  return sendJson(res, 200, { profile: result.data });
}

async function handleBilling(req, res, env, clientFactory) {
  const auth = await getAuthenticatedUser(req, env, { clientFactory });
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.code, message: auth.message });
  if (auth.session) setSessionCookies(res, auth.session, env);
  if (!auth.client.from) return sendJson(res, 503, { error: 'SUPABASE_UNAVAILABLE', message: 'Billing information is temporarily unavailable.' });
  const [subscriptions, payments] = await Promise.all([
    auth.client.from('subscriptions')
      .select('plan,status,current_period_end,created_at,updated_at')
      .eq('user_id', auth.user.id)
      .order('updated_at', { ascending: false })
      .limit(10),
    auth.client.from('payment_records')
      .select('provider,amount_minor,currency,status,occurred_at')
      .eq('user_id', auth.user.id)
      .order('occurred_at', { ascending: false })
      .limit(20)
  ]);
  if (subscriptions.error || payments.error) {
    return sendJson(res, 503, { error: 'BILLING_UNAVAILABLE', message: 'Billing records could not be loaded. Apply the catalogue and entitlement migration and try again.' });
  }
  return sendJson(res, 200, {
    subscriptions: subscriptions.data || [],
    payments: payments.data || [],
    paymentProcessingEnabled: false
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
    const corsAllowed = applyCors(req, res, env);
    if (req.method === 'OPTIONS') {
      if (!corsAllowed) return sendJson(res, 403, { error: 'CORS_ORIGIN_DENIED', message: 'This origin is not allowed.' });
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type, X-CSRF-Token');
      res.setHeader('Access-Control-Max-Age', '600');
      res.statusCode = 204;
      return res.end();
    }

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

    if (url.pathname === '/api/admin/catalog') {
      if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only GET and POST requests are supported.' });
      if (req.method === 'POST' && !requireCsrf(req, res, env)) return;
      return handleAdminCatalog(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/admin/users') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported.' });
      return handleAdminUsers(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/admin/roles') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are supported.' });
      if (!requireCsrf(req, res, env)) return;
      return handleAdminRoles(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/admin/video-sources') {
      if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only GET and POST requests are supported.' });
      if (req.method === 'POST' && !requireCsrf(req, res, env)) return;
      return handleAdminVideoSources(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/admin/subscriptions') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported.' });
      return handleAdminSubscriptions(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/admin/payments') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported.' });
      return handleAdminPayments(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/library') {
      if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only GET and POST requests are supported.' });
      if (req.method === 'POST' && !requireCsrf(req, res, env)) return;
      return handleLibrary(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/watch-history') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are supported.' });
      if (!requireCsrf(req, res, env)) return;
      return handleWatchHistory(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/profile') {
      if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only GET and POST requests are supported.' });
      if (req.method === 'POST' && !requireCsrf(req, res, env)) return;
      return handleProfile(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/billing') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported.' });
      return handleBilling(req, res, env, clientFactory);
    }

    if (url.pathname === '/api/playback/authorize') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported.' });
      return handlePlaybackAuthorize(req, res, env, clientFactory, playbackProvider, url.searchParams);
    }

    if (url.pathname === '/api/tmdb') {
      req.query = Object.fromEntries(url.searchParams.entries());
      return tmdbHandler(req, res, env);
    }

    if (url.pathname === '/api/anime') {
      return animeHandler(req, res, options.animeFetch || fetch);
    }

    if (!['GET','HEAD'].includes(req.method)) return sendJson(res, 405, { error:'METHOD_NOT_ALLOWED' });

    let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { return sendJson(res, 400, { error:'BAD_PATH' }); }
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/anime' || pathname === '/anime/') pathname = '/anime.html';
    if (pathname === '/account' || pathname === '/account/') pathname = '/account.html';
    if (pathname === '/plans' || pathname === '/plans/') pathname = '/plans.html';
    if (/^\/(?:movies|series|watchlist|genres\/[a-z0-9-]+)\/?$/i.test(pathname)) pathname = '/index.html';
    if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin/index.html';
    const pathSegments = pathname.split('/');
    const privatePath = pathSegments.some((segment) => segment.startsWith('.'))
      || /^\/(?:lib|supabase|tests|node_modules|android|mobile|scripts|\.vscode)(?:\/|$)/i.test(pathname)
      || /^\/(?:server\.js|package(?:-lock)?\.json|capacitor\.config\.json|README[^/]*|setup-stage2\.js)$/i.test(pathname);
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
