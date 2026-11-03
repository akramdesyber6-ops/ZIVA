'use strict';

const { createClient } = require('@supabase/supabase-js');

function getSupabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim();
  const anonKey = String(env.SUPABASE_ANON_KEY || '').trim();
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  return {
    url,
    anonKey,
    serviceRoleKey,
    isConfigured: Boolean(url && anonKey)
  };
}

function createSupabaseServerClient(env = process.env) {
  const config = getSupabaseConfig(env);
  if (!config.url || !config.anonKey) return null;

  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function createSupabaseAdminClient(env = process.env) {
  const config = getSupabaseConfig(env);
  if (!config.url || !config.serviceRoleKey) return null;

  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function parseBearerToken(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
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

async function getAuthenticatedUser(req, env = process.env) {
  const token = parseBearerToken(req.headers && req.headers.authorization);
  if (!token) {
    return { ok: false, status: 401, code: 'AUTH_REQUIRED', message: 'Authentication required.' };
  }

  const client = createSupabaseServerClient(env);
  if (!client) {
    return {
      ok: false,
      status: 503,
      code: 'SUPABASE_NOT_CONFIGURED',
      message: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.'
    };
  }

  try {
    const { data: { user }, error } = await client.auth.getUser(token);
    if (error || !user) {
      return { ok: false, status: 401, code: 'INVALID_SESSION', message: 'Invalid or expired session.' };
    }

    return { ok: true, user, client };
  } catch (error) {
    return {
      ok: false,
      status: 401,
      code: 'AUTH_ERROR',
      message: error && error.message ? error.message : 'Authentication failed.'
    };
  }
}

async function ensureAdmin(req, env = process.env) {
  const auth = await getAuthenticatedUser(req, env);
  if (!auth.ok) return auth;

  try {
    const { data, error } = await auth.client.rpc('is_user_admin');
    if (error) {
      return {
        ok: false,
        status: 403,
        code: 'ADMIN_CHECK_FAILED',
        message: 'Unable to verify admin privileges.'
      };
    }

    if (!data) {
      return {
        ok: false,
        status: 403,
        code: 'FORBIDDEN',
        message: 'Admin access required.'
      };
    }

    return { ok: true, user: auth.user, client: auth.client, isAdmin: true };
  } catch (error) {
    return {
      ok: false,
      status: 403,
      code: 'ADMIN_CHECK_FAILED',
      message: error && error.message ? error.message : 'Admin access required.'
    };
  }
}

module.exports = {
  getSupabaseConfig,
  createSupabaseServerClient,
  createSupabaseAdminClient,
  parseBearerToken,
  validateEmail,
  validatePassword,
  validateDisplayName,
  getAuthenticatedUser,
  ensureAdmin
};
