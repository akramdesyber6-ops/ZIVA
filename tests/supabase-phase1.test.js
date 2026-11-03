'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSupabaseConfig,
  parseBearerToken,
  validateEmail,
  validatePassword,
  validateDisplayName,
  getAuthenticatedUser
} = require('../lib/supabase');

test('reads Supabase config safely from the environment', () => {
  const config = getSupabaseConfig({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key'
  });

  assert.equal(config.url, 'https://example.supabase.co');
  assert.equal(config.anonKey, 'anon-key');
  assert.equal(config.serviceRoleKey, 'service-role-key');
  assert.equal(config.isConfigured, true);
});

test('parses bearer tokens from an Authorization header', () => {
  assert.equal(parseBearerToken('Bearer test-token'), 'test-token');
  assert.equal(parseBearerToken('bearer test-token'), 'test-token');
  assert.equal(parseBearerToken('test-token'), null);
  assert.equal(parseBearerToken(''), null);
});

test('validates registration and profile inputs', () => {
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
