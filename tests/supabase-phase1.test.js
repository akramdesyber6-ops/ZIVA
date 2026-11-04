'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSupabaseConfig,
  buildSupabaseClientOptions,
  parseBearerToken,
  validateEmail,
  validatePassword,
  validateDisplayName,
  getAuthenticatedUser,
  ensureAdmin
} = require('../lib/supabase');

test('reads Supabase config safely from the environment and supports the publishable-key alias', () => {
  const config = getSupabaseConfig({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key'
  });

  assert.equal(config.url, 'https://example.supabase.co');
  assert.equal(config.anonKey, 'publishable-key');
  assert.equal(config.serviceRoleKey, 'service-role-key');
  assert.equal(config.isConfigured, true);
});

test('builds a client configuration that carries the user access token as a bearer header', () => {
  const options = buildSupabaseClientOptions('verified-token');
  assert.equal(options.global.headers.Authorization, 'Bearer verified-token');
  assert.equal(options.auth.persistSession, false);
});

test('parses bearer tokens from an Authorization header', () => {
  assert.equal(parseBearerToken('Bearer test-token'), 'test-token');
  assert.equal(parseBearerToken('bearer test-token'), 'test-token');
  assert.equal(parseBearerToken('test-token'), null);
  assert.equal(parseBearerToken(''), null);
});

test('validates registration inputs and profile naming before Supabase signup is attempted', () => {
  assert.equal(validateEmail('user@example.com'), true);
  assert.equal(validateEmail('invalid-email'), false);
  assert.equal(validatePassword('secret123'), true);
  assert.equal(validatePassword('short'), false);
  assert.equal(validateDisplayName('Ziva User'), true);
  assert.equal(validateDisplayName('A'), false);
});

test('returns a configuration error before any network call is attempted', async () => {
  const result = await getAuthenticatedUser(
    { headers: { authorization: 'Bearer test-token' } },
    {}
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.code, 'SUPABASE_NOT_CONFIGURED');
});

test('rejects a normal user from admin authorization even when a valid bearer token is present', async () => {
  const fakeClient = {
    auth: {
      getUser: async (token) => ({
        data: { user: { id: 'user-123', email: 'user@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' } },
        error: null
      })
    },
    rpc: async () => ({ data: false, error: null })
  };

  const result = await ensureAdmin(
    { headers: { authorization: 'Bearer valid-user-token' } },
    { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' },
    { clientFactory: () => fakeClient }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, 'FORBIDDEN');
});

test('allows an authenticated admin request when the user context evaluates to admin', async () => {
  const fakeClient = {
    auth: {
      getUser: async (token) => ({
        data: { user: { id: 'admin-123', email: 'admin@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' } },
        error: null
      })
    },
    rpc: async () => ({ data: true, error: null })
  };

  const result = await ensureAdmin(
    { headers: { authorization: 'Bearer valid-admin-token' } },
    { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' },
    { clientFactory: (env, token) => {
      assert.equal(token, 'valid-admin-token');
      return fakeClient;
    } }
  );

  assert.equal(result.ok, true);
  assert.equal(result.isAdmin, true);
  assert.equal(result.user.email, 'admin@example.com');
});

test('assigns the default user role in the SQL migration and blocks direct self-role changes through RLS', () => {
  const SQL_PATH = path.join(__dirname, '..', 'supabase', 'migrations', '001_initial_auth_schema.sql');
  const migration = fs.readFileSync(SQL_PATH, 'utf8');

  assert.match(migration, /select\s+r\.id\s+into\s+v_role_id\s+from\s+public\.roles\s+r\s+where\s+r\.name\s*=\s*'user'/i);
  assert.match(migration, /insert\s+into\s+public\.user_roles\s*\(\s*user_id\s*,\s*role_id\s*\)\s*values\s*\(\s*new\.id\s*,\s*v_role_id\s*\)\s*on\s+conflict\s*\(\s*user_id\s*,\s*role_id\s*\)\s+do\s+nothing/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.user_roles\s*\(\s*user_id\s*,\s*role_id\s*\)\s*values\s*\(\s*new\.id\s*,\s*'admin'/i);
  assert.match(migration, /create policy ".*Admins can manage role assignments"/i);
  assert.match(migration, /with check \(public\.is_user_admin\(\)\)/i);
});
