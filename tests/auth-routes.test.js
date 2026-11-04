'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../server');

function createFakeSupabase(state) {
  function makeSession(user) {
    const session = {
      access_token: `access-${user.id}-${state.nextToken++}`,
      refresh_token: `refresh-${user.id}-${state.nextToken++}`,
      expires_in: 3600
    };
    state.usersByToken.set(session.access_token, user);
    state.sessionsByRefresh.set(session.refresh_token, { session, user });
    return session;
  }

  function createUser(email, fullName, password) {
    const user = {
      id: `user-${state.nextUser++}`,
      email,
      password,
      user_metadata: { full_name: fullName || '' },
      identities: [{ id: email }],
      email_confirmed_at: null,
      confirmed_at: null
    };
    state.usersByEmail.set(email, user);
    return user;
  }

  function issueCode(email, type) {
    state.pendingCodes.set(email, { code: '123456', type, expiresAt: Date.now() + 60_000 });
  }

  return (env, token) => ({
    auth: {
      signUp: async ({ email, password, options }) => {
        state.signupRequests.push({ email, password, options });
        if (state.rateLimited) return { data: {}, error: { status: 429 } };
        if (state.usersByEmail.has(email)) {
          return { data: { user: { identities: [] }, session: null }, error: null };
        }
        const user = createUser(email, options.data.full_name, password);
        issueCode(email, 'signup');
        return { data: { user, session: null }, error: null };
      },
      signInWithPassword: async ({ email, password }) => {
        state.passwordLogins.push({ email, password });
        const user = state.usersByEmail.get(email);
        if (!user || user.password !== password) {
          return { data: {}, error: { status: 400, code: 'invalid_credentials' } };
        }
        if (!user.email_confirmed_at) {
          return { data: {}, error: { status: 400, code: 'email_not_confirmed', message: 'Email not confirmed' } };
        }
        return { data: { user, session: makeSession(user) }, error: null };
      },
      signInWithOtp: async ({ email, options }) => {
        state.otpRequests.push({ email, options });
        if (state.rateLimited) return { data: {}, error: { status: 429 } };
        if (state.usersByEmail.has(email)) issueCode(email, 'email');
        return { data: {}, error: null };
      },
      resend: async ({ email, type }) => {
        state.resendRequests.push({ email, type });
        if (state.rateLimited) return { data: {}, error: { status: 429 } };
        if (!state.usersByEmail.has(email)) return { data: {}, error: { status: 400 } };
        issueCode(email, type);
        return { data: {}, error: null };
      },
      verifyOtp: async ({ email, token: code, type }) => {
        const pending = state.pendingCodes.get(email);
        if (!pending || pending.type !== type || pending.code !== code || pending.expiresAt < Date.now()) {
          return { data: { user: null, session: null }, error: { status: 400 } };
        }
        const user = state.usersByEmail.get(email);
        state.pendingCodes.delete(email);
        user.email_confirmed_at = new Date().toISOString();
        user.confirmed_at = user.email_confirmed_at;
        const session = makeSession(user);
        return { data: { user, session }, error: null };
      },
      getUser: async (accessToken) => {
        const user = state.usersByToken.get(accessToken);
        return user
          ? { data: { user }, error: null }
          : { data: { user: null }, error: { status: 401 } };
      },
      refreshSession: async ({ refresh_token: refreshToken }) => {
        const saved = state.sessionsByRefresh.get(refreshToken);
        if (!saved) return { data: { session: null }, error: { status: 401 } };
        const session = makeSession(saved.user);
        state.sessionsByRefresh.delete(refreshToken);
        return { data: { session }, error: null };
      },
      setSession: async (session) => {
        state.sessionSet = session;
        return { data: { session }, error: null };
      },
      signOut: async (options) => {
        state.signOutScope = options.scope;
        return { error: null };
      }
    },
    rpc: async (functionName) => {
      assert.equal(functionName, 'is_user_admin');
      const user = state.usersByToken.get(token);
      return { data: Boolean(user && state.adminIds.has(user.id)), error: null };
    }
  });
}

async function createHarness(options = {}) {
  const state = {
    usersByEmail: new Map(),
    usersByToken: new Map(),
    sessionsByRefresh: new Map(),
    pendingCodes: new Map(),
    signupRequests: [],
    passwordLogins: [],
    otpRequests: [],
    resendRequests: [],
    adminIds: new Set(),
    nextUser: 1,
    nextToken: 1,
    rateLimited: Boolean(options.rateLimited),
    sessionSet: null,
    signOutScope: null
  };
  const env = {
    SUPABASE_URL: 'https://ziva-test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    ZIVA_PROVIDER_ALLOWED_HOSTS: 'media.provider.example,downloads.provider.example',
    NODE_ENV: options.production ? 'production' : 'test'
  };
  if (options.supabaseUnavailable) {
    delete env.SUPABASE_URL;
    delete env.SUPABASE_ANON_KEY;
  }
  const server = createServer({
    env,
    clientFactory: createFakeSupabase(state),
    playbackProvider: options.playbackProvider
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    state,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

function cookieMap(response) {
  const value = response.headers.get('set-cookie') || '';
  const cookies = {};
  for (const match of value.matchAll(/(ziva_[a-z]+)=([^;,]*)/g)) cookies[match[1]] = match[2];
  return cookies;
}

function cookieHeader(cookies) {
  return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
}

async function csrfFor(harness) {
  const response = await fetch(`${harness.origin}/api/auth/session`);
  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.ok(payload.csrfToken);
  return { token: payload.csrfToken, cookies: cookieMap(response) };
}

async function postAuth(harness, route, body, csrf, cookies = {}) {
  return fetch(`${harness.origin}${route}`, {
    method: 'POST',
    headers: {
      Origin: harness.origin,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
      Cookie: cookieHeader(cookies)
    },
    body: JSON.stringify(body)
  });
}

async function register(harness, csrf, email = 'person@example.com', overrides = {}) {
  return postAuth(harness, '/api/auth/register', {
    email,
    full_name: 'Ziva User',
    password: 'secure-password-123',
    ...overrides
  }, csrf.token, csrf.cookies);
}

async function verifySignup(harness, csrf, email, cookies = csrf.cookies) {
  return postAuth(harness, '/api/auth/verify', {
    email,
    code: '123456',
    type: 'signup'
  }, csrf.token, cookies);
}

test('registration creates a password account and waits for six-digit email verification', async (t) => {
  const harness = await createHarness({ production: true });
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);

  const invalid = await register(harness, csrf, 'not-an-email');
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'INVALID_EMAIL');
  const weak = await register(harness, csrf, 'weak@example.com', { password: 'tiny' });
  assert.equal(weak.status, 400);
  assert.equal((await weak.json()).error, 'WEAK_PASSWORD');

  const response = await register(harness, csrf);
  const payload = await response.json();
  assert.equal(response.status, 202);
  assert.equal(payload.codeSent, true);
  assert.equal(harness.state.signupRequests[0].password, 'secure-password-123');
  assert.equal(harness.state.signupRequests[0].options.data.full_name, 'Ziva User');
  assert.equal(JSON.stringify(payload).includes('access-'), false);
  assert.equal(cookieMap(response).ziva_access, undefined);
  assert.equal(cookieMap(response).ziva_refresh, undefined);
  assert.match(response.headers.get('set-cookie'), /Secure/);
});

test('registration reports duplicate accounts and resend uses Supabase signup OTP', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  assert.equal((await register(harness, csrf, 'existing@example.com')).status, 202);
  const duplicate = await register(harness, csrf, 'existing@example.com');
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error, 'ACCOUNT_EXISTS');

  const resent = await postAuth(harness, '/api/auth/resend', { email: 'existing@example.com' }, csrf.token, csrf.cookies);
  assert.equal(resent.status, 200);
  assert.deepEqual(harness.state.resendRequests.at(-1), { email: 'existing@example.com', type: 'signup' });
});

test('valid signup OTP verifies the email and issues only HttpOnly session cookies', async (t) => {
  const harness = await createHarness({ production: true });
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  const response = await verifySignup(harness, csrf, 'person@example.com');
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.authenticated, true);
  assert.equal(payload.user.fullName, 'Ziva User');
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.ok(cookieMap(response).ziva_access);
  assert.ok(cookieMap(response).ziva_refresh);
  assert.equal(JSON.stringify(payload).includes('access-'), false);
});

test('wrong, malformed, expired and reused OTPs are rejected', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);

  const malformed = await postAuth(harness, '/api/auth/verify', { email: 'person@example.com', code: '1234' }, csrf.token, csrf.cookies);
  assert.equal(malformed.status, 400);
  const wrong = await postAuth(harness, '/api/auth/verify', { email: 'person@example.com', code: '000000', type: 'signup' }, csrf.token, csrf.cookies);
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json()).error, 'OTP_INVALID_OR_EXPIRED');
  harness.state.pendingCodes.get('person@example.com').expiresAt = Date.now() - 1;
  const expired = await verifySignup(harness, csrf, 'person@example.com');
  assert.equal(expired.status, 400);

  await register(harness, csrf, 'reuse@example.com');
  const valid = await verifySignup(harness, csrf, 'reuse@example.com');
  assert.equal(valid.status, 200);
  const reused = await verifySignup(harness, csrf, 'reuse@example.com');
  assert.equal(reused.status, 400);
});

test('password login works after verification and rejects incorrect credentials', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  await verifySignup(harness, csrf, 'person@example.com');

  const bad = await postAuth(harness, '/api/auth/login', { email: 'person@example.com', password: 'wrong-password' }, csrf.token, csrf.cookies);
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).error, 'INVALID_CREDENTIALS');

  const response = await postAuth(harness, '/api/auth/login', { email: 'person@example.com', password: 'secure-password-123' }, csrf.token, csrf.cookies);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).authenticated, true);
  assert.ok(cookieMap(response).ziva_access);
});

test('email-code sign-in remains available without permitting account creation', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  const unknown = await postAuth(harness, '/api/auth/login-code', { email: 'unknown@example.com' }, csrf.token, csrf.cookies);
  assert.equal(unknown.status, 200);
  assert.equal(harness.state.usersByEmail.has('unknown@example.com'), false);
  assert.equal(harness.state.otpRequests[0].options.shouldCreateUser, false);

  await register(harness, csrf);
  await verifySignup(harness, csrf, 'person@example.com');
  await postAuth(harness, '/api/auth/login-code', { email: 'person@example.com' }, csrf.token, csrf.cookies);
  const verification = await postAuth(harness, '/api/auth/verify', {
    email: 'person@example.com', code: '123456', type: 'email'
  }, csrf.token, csrf.cookies);
  assert.equal(verification.status, 200);
});

test('registration and login respect Supabase OTP rate limits', async (t) => {
  const harness = await createHarness({ rateLimited: true });
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  const response = await register(harness, csrf);
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, 'OTP_RATE_LIMITED');
});

test('session restoration refreshes valid sessions and clears invalid cookies', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  const verified = await verifySignup(harness, csrf, 'person@example.com');
  const cookies = cookieMap(verified);

  const restored = await fetch(`${harness.origin}/api/auth/session`, { headers: { Cookie: cookieHeader(cookies) } });
  const payload = await restored.json();
  assert.equal(restored.status, 200);
  assert.equal(payload.authenticated, true);
  assert.equal(payload.user.email, 'person@example.com');

  const refreshed = await fetch(`${harness.origin}/api/auth/session`, {
    headers: { Cookie: cookieHeader({ ...cookies, ziva_access: 'expired-access-token' }) }
  });
  assert.equal(refreshed.status, 200);
  assert.ok(cookieMap(refreshed).ziva_access);

  const invalid = await fetch(`${harness.origin}/api/auth/session`, {
    headers: { Cookie: cookieHeader({ ziva_access: 'bad', ziva_refresh: 'bad' }) }
  });
  assert.equal(invalid.status, 401);
  assert.match(invalid.headers.get('set-cookie'), /ziva_access=; Path=\/; Max-Age=0/);
});

test('session endpoint reports missing Supabase configuration distinctly from an unauthenticated visitor', async (t) => {
  const harness = await createHarness({ supabaseUnavailable: true });
  t.after(() => harness.close());
  const response = await fetch(`${harness.origin}/api/auth/session`);
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.error, 'SUPABASE_NOT_CONFIGURED');
  assert.ok(payload.csrfToken);
});

test('logout revokes the Supabase session and clears cookies', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  const verification = await verifySignup(harness, csrf, 'person@example.com');
  const cookies = { ...csrf.cookies, ...cookieMap(verification) };
  const response = await postAuth(harness, '/api/auth/logout', {}, csrf.token, cookies);
  assert.equal(response.status, 200);
  assert.equal(harness.state.signOutScope, 'global');
  assert.match(response.headers.get('set-cookie'), /ziva_refresh=; Path=\/; Max-Age=0/);
});

test('CSRF validation protects registration and sign-in actions', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  const invalid = await fetch(`${harness.origin}/api/auth/register`, {
    method: 'POST',
    headers: { Origin: harness.origin, 'Content-Type': 'application/json', Cookie: cookieHeader(csrf.cookies) },
    body: JSON.stringify({ email: 'person@example.com', full_name: 'Person', password: 'secure-password' })
  });
  assert.equal(invalid.status, 403);
});

test('anonymous and normal users cannot access protected admin or playback features', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  for (const route of ['/api/admin/permissions', '/api/playback/authorize?tmdbId=12&mediaType=movie']) {
    const response = await fetch(`${harness.origin}${route}`);
    assert.equal(response.status, 401);
  }

  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  const verified = await verifySignup(harness, csrf, 'person@example.com');
  const cookies = { ...cookieMap(verified), ziva_access: 'expired-access-token' };
  const forbidden = await fetch(`${harness.origin}/api/admin/permissions`, { headers: { Cookie: cookieHeader(cookies) } });
  assert.equal(forbidden.status, 403);
  const refreshedCookies = { ...cookies, ...cookieMap(forbidden) };
  assert.ok(cookieMap(forbidden).ziva_access);
  const unavailable = await fetch(`${harness.origin}/api/playback/authorize?tmdbId=12&mediaType=movie`, { headers: { Cookie: cookieHeader(refreshedCookies) } });
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).authorized, false);
});

test('admin permissions endpoint grants access only after a server-side administrator check', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  const verified = await verifySignup(harness, csrf, 'person@example.com');
  const user = harness.state.usersByEmail.get('person@example.com');
  harness.state.adminIds.add(user.id);

  const response = await fetch(`${harness.origin}/api/admin/permissions`, {
    headers: { Cookie: cookieHeader(cookieMap(verified)) }
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.isAdmin, true);
  assert.equal(payload.user.id, user.id);
});

test('playback adapter returns only approved HTTPS streams and explicitly permitted downloads', async (t) => {
  const playbackProvider = {
    resolveTitle: async ({ tmdbId, mediaType, user }) => {
      assert.equal(tmdbId, 42);
      assert.equal(mediaType, 'movie');
      assert.ok(user.id);
      return {
        authorized: true,
        streamUrl: 'https://media.provider.example/title/42/master.m3u8',
        streamType: 'application/vnd.apple.mpegurl',
        downloadAllowed: true,
        downloadUrl: 'https://downloads.provider.example/title/42'
      };
    }
  };
  const harness = await createHarness({ playbackProvider });
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  const verified = await verifySignup(harness, csrf, 'person@example.com');
  const response = await fetch(`${harness.origin}/api/playback/authorize?tmdbId=42&mediaType=movie`, { headers: { Cookie: cookieHeader(cookieMap(verified)) } });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.stream.type, 'application/vnd.apple.mpegurl');
  assert.equal(payload.download.allowed, true);
  assert.doesNotMatch(JSON.stringify(payload), /service.role|secret|token/i);
});

test('playback fails closed for unauthorized titles and rejects unapproved provider URLs', async (t) => {
  const harness = await createHarness({
    playbackProvider: {
      resolveTitle: async () => ({
        authorized: true,
        streamUrl: 'https://unapproved.example/film.mp4',
        streamType: 'video/mp4',
        downloadAllowed: true,
        downloadUrl: 'http://downloads.provider.example/file.mp4'
      })
    }
  });
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  const verified = await verifySignup(harness, csrf, 'person@example.com');
  const response = await fetch(`${harness.origin}/api/playback/authorize?tmdbId=42&mediaType=movie`, { headers: { Cookie: cookieHeader(cookieMap(verified)) } });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).authorized, false);
});

test('separate catalogue paths serve the app and preserve media-specific client routes', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  for (const route of ['/', '/movies', '/series', '/genres/action', '/watchlist']) {
    const response = await fetch(`${harness.origin}${route}`);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), /text\/html/);
  }
  const app = await (await fetch(`${harness.origin}/app.js`)).text();
  assert.match(app, /search\(query, page, currentMediaType\)/);
  assert.match(app, /tmdb-\(movie\|tv\)/);
  const page = await (await fetch(`${harness.origin}/index.html`)).text();
  assert.match(page, /\/genres\/action/);
  assert.match(page, /data-media-type="tv"/);
});

test('static assets remain available while server-side files and secrets stay private', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  for (const asset of ['/', '/app.js', '/src/catalogue.js', '/src/catalogue-sections.js']) {
    assert.equal((await fetch(`${harness.origin}${asset}`)).status, 200, asset);
  }
  for (const privatePath of ['/.env', '/.env.local', '/lib/supabase.js', '/server.js', '/supabase/migrations/001_initial_auth_schema.sql']) {
    assert.equal((await fetch(`${harness.origin}${privatePath}`)).status, 404, privatePath);
  }
  const app = await (await fetch(`${harness.origin}/app.js`)).text();
  assert.doesNotMatch(app, /SUPABASE_SERVICE_ROLE_KEY|access_token|refresh_token/);
});
