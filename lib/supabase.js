'use strict';

const { createClient } = require('@supabase/supabase-js');

function getSupabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim();
  const anonKey = String(env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  return {
    url,
    anonKey,
    serviceRoleKey,
    isConfigured: Boolean(url && anonKey)
  };
}

function buildSupabaseClientOptions(accessToken = null) {
  const token = typeof accessToken === 'string' ? accessToken.trim() : '';
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  };

  if (token) {
    options.global = {
      headers: {
        Authorization: `Bearer ${token}`
      }
    };
  }

  return options;
}

function createSupabaseServerClient(env = process.env, accessToken = null) {
  const config = getSupabaseConfig(env);
  if (!config.url || !config.anonKey) return null;

  return createClient(config.url, config.anonKey, buildSupabaseClientOptions(accessToken));
}

function createSupabaseAdminClient(env = process.env, accessToken = null) {
  const config = getSupabaseConfig(env);
  if (!config.url || !config.serviceRoleKey) return null;

  return createClient(config.url, config.serviceRoleKey, buildSupabaseClientOptions(accessToken));
}

function parseBearerToken(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function parseCookies(value) {
  if (typeof value !== 'string') return {};
  return value.split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return cookies;
    const name = part.slice(0, separator).trim();
    try {
      cookies[name] = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      cookies[name] = '';
    }
    return cookies;
  }, {});
}

function validateEmail(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function validatePassword(value) {
  return typeof value === 'string' && value.length >= 8;
}

function validateDisplayName(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.length <= 80;
}

function isTransientAuthError(error) {
  if (!error) return false;
  const status = Number(error.status || error.statusCode);
  return status === 429 || status >= 500
    || error.name === 'AuthRetryableFetchError'
    || error.code === 'fetch_failed'
    || (!Number.isFinite(status) && error.name === 'TypeError');
}

async function getAuthenticatedUser(req, env = process.env, overrides = {}) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  const token = cookies.ziva_access || parseBearerToken(req.headers && req.headers.authorization);
  const refreshToken = cookies.ziva_refresh;
  if (!token && !refreshToken) {
    return { ok: false, status: 401, code: 'AUTH_REQUIRED', message: 'Authentication required.' };
  }

  const clientFactory = overrides.clientFactory || createSupabaseServerClient;
  let client = clientFactory(env, token);
  if (!client) {
    return {
      ok: false,
      status: 503,
      code: 'SUPABASE_NOT_CONFIGURED',
      message: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.'
    };
  }

  try {
    let activeToken = token;
    let user = null;
    let error = null;
    let session = null;

    if (activeToken) {
      const result = await client.auth.getUser(activeToken);
      user = result.data && result.data.user;
      error = result.error;
    }

    if (error && isTransientAuthError(error)) {
      return {
        ok: false,
        status: 503,
        code: 'SUPABASE_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.'
      };
    }

    if ((!activeToken || error || !user) && refreshToken && typeof client.auth.refreshSession === 'function') {
      const refreshed = await client.auth.refreshSession({ refresh_token: refreshToken });
      if (refreshed.error) {
        if (isTransientAuthError(refreshed.error)) {
          return {
            ok: false,
            status: 503,
            code: 'SUPABASE_UNAVAILABLE',
            message: 'Authentication is temporarily unavailable.'
          };
        }
        return { ok: false, status: 401, code: 'INVALID_SESSION', message: 'Invalid or expired session.' };
      }
      session = refreshed.data && refreshed.data.session;
      user = refreshed.data && refreshed.data.user;
      if (!session || !session.access_token || !session.refresh_token || !user) {
        return { ok: false, status: 401, code: 'INVALID_SESSION', message: 'Invalid or expired session.' };
      }
      activeToken = session.access_token;
      error = null;
    }

    if (error || !user) {
      return { ok: false, status: 401, code: 'INVALID_SESSION', message: 'Invalid or expired session.' };
    }

    if (activeToken !== token) client = clientFactory(env, activeToken);
    if (!(user.email_confirmed_at || user.confirmed_at)) {
      return {
        ok: false,
        status: 403,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email address before accessing protected features.'
      };
    }

    return {
      ok: true,
      user,
      client,
      token: activeToken,
      refreshToken: (session && session.refresh_token) || refreshToken,
      session
    };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      code: 'SUPABASE_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable.'
    };
  }
}

async function ensureAdmin(req, env = process.env, overrides = {}) {
  const auth = await getAuthenticatedUser(req, env, overrides);
  if (!auth.ok) return auth;

  try {
    const clientFactory = overrides.clientFactory || createSupabaseServerClient;
    const client = clientFactory(env, auth.token);
    const { data, error } = await client.rpc('is_user_admin');
    if (error) {
      return {
        ok: false,
        status: 503,
        code: 'SUPABASE_UNAVAILABLE',
        message: 'Unable to verify admin privileges because Supabase is unavailable.',
        user: auth.user,
        token: auth.token,
        refreshToken: auth.refreshToken,
        session: auth.session
      };
    }

    if (!data) {
      return {
        ok: false,
        status: 403,
        code: 'FORBIDDEN',
        message: 'Admin access required.',
        user: auth.user,
        token: auth.token,
        refreshToken: auth.refreshToken,
        session: auth.session
      };
    }

    return {
      ok: true,
      user: auth.user,
      client,
      isAdmin: true,
      token: auth.token,
      refreshToken: auth.refreshToken,
      session: auth.session
    };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      code: 'SUPABASE_UNAVAILABLE',
      message: 'Unable to verify admin privileges because Supabase is unavailable.',
      user: auth.user,
      token: auth.token,
      refreshToken: auth.refreshToken,
      session: auth.session
    };
  }
}

module.exports = {
  getSupabaseConfig,
  buildSupabaseClientOptions,
  createSupabaseServerClient,
  createSupabaseAdminClient,
  parseBearerToken,
  parseCookies,
  validateEmail,
  validatePassword,
  validateDisplayName,
  isTransientAuthError,
  getAuthenticatedUser,
  ensureAdmin
};
