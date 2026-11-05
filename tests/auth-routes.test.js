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
        if (state.getUserError) return { data: { user: null }, error: state.getUserError };
        const user = state.usersByToken.get(accessToken);
        return user
          ? { data: { user }, error: null }
          : { data: { user: null }, error: { status: 401 } };
      },
      refreshSession: async ({ refresh_token: refreshToken }) => {
        state.refreshCalls += 1;
        if (state.refreshError) return { data: { session: null }, error: state.refreshError };
        const saved = state.sessionsByRefresh.get(refreshToken);
        if (!saved) return { data: { session: null }, error: { status: 401 } };
        const session = makeSession(saved.user);
        state.sessionsByRefresh.delete(refreshToken);
        return { data: { session, user: saved.user }, error: null };
      },
      setSession: async (session) => {
        state.sessionSet = session;
        return { data: { session }, error: null };
      },
      signOut: async (options) => {
        state.signOutScope = options.scope;
        state.signOutCalls.push(options);
        return { error: null };
      }
    },
    from: (table) => {
      const builder = {
        updateValues: null,
        filters: [],
        select: () => builder,
        order: () => builder,
        limit: () => builder,
        eq: (field, value) => {
          builder.filters.push([field, value]);
          return builder;
        },
        upsert: (values, options) => {
          state.databaseWrites.push({ table, values, options });
          return Promise.resolve({ data: values, error: null });
        },
        update: (values) => {
          builder.updateValues = values;
          return builder;
        },
        delete: () => {
          state.databaseDeletes.push({ table });
          return builder;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: builder.updateValues || {}, error: null }),
        then: (resolve, reject) => {
          state.databaseQueries.push({ table, filters: builder.filters.slice() });
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        }
      };
      return builder;
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
    getUserError: null,
    refreshError: null,
    refreshCalls: 0,
    sessionSet: null,
    signOutScope: null,
    signOutCalls: [],
    databaseWrites: [],
    databaseDeletes: [],
    databaseQueries: []
  };
  const env = {
    SUPABASE_URL: 'https://ziva-test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    ZIVA_PROVIDER_ALLOWED_HOSTS: 'media.provider.example,downloads.provider.example',
    NODE_ENV: options.production ? 'production' : 'test'
  };
  if (options.mobileOrigins) env.MOBILE_APP_ORIGINS = options.mobileOrigins;
  if (options.supabaseUnavailable) {
    delete env.SUPABASE_URL;
    delete env.SUPABASE_ANON_KEY;
  }
  const server = createServer({
    env,
    clientFactory: createFakeSupabase(state),
    playbackProvider: options.playbackProvider,
    animeFetch: options.animeFetch
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

test('session restoration refreshes when the access cookie has expired or is missing', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  const verified = await verifySignup(harness, csrf, 'person@example.com');
  const originalCookies = cookieMap(verified);

  const expiredAccess = await fetch(`${harness.origin}/api/auth/session`, {
    headers: { Cookie: cookieHeader({ ...originalCookies, ziva_access: 'expired-access-token' }) }
  });
  assert.equal(expiredAccess.status, 200);
  assert.equal((await expiredAccess.json()).authenticated, true);
  const expiredAccessCookies = cookieMap(expiredAccess);
  assert.ok(expiredAccessCookies.ziva_access);
  assert.ok(expiredAccessCookies.ziva_refresh);
  assert.notEqual(expiredAccessCookies.ziva_refresh, originalCookies.ziva_refresh);

  const missingAccess = await fetch(`${harness.origin}/api/auth/session`, {
    headers: { Cookie: cookieHeader({ ziva_refresh: expiredAccessCookies.ziva_refresh }) }
  });
  assert.equal(missingAccess.status, 200);
  assert.equal((await missingAccess.json()).authenticated, true);
  const missingAccessCookies = cookieMap(missingAccess);
  assert.ok(missingAccessCookies.ziva_access);
  assert.ok(missingAccessCookies.ziva_refresh);
  assert.notEqual(missingAccessCookies.ziva_refresh, expiredAccessCookies.ziva_refresh);
  assert.equal(harness.state.refreshCalls, 2);
});

test('transient Auth failures preserve session cookies and do not masquerade as expiry', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  const verified = await verifySignup(harness, csrf, 'person@example.com');
  const cookies = cookieMap(verified);

  harness.state.getUserError = { status: 503 };
  const unavailable = await fetch(`${harness.origin}/api/auth/session`, {
    headers: { Cookie: cookieHeader(cookies) }
  });
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error, 'SUPABASE_UNAVAILABLE');
  assert.doesNotMatch(unavailable.headers.get('set-cookie') || '', /ziva_access=;.*Max-Age=0/);
  assert.equal(harness.state.refreshCalls, 0);

  harness.state.getUserError = null;
  harness.state.refreshError = { status: 503 };
  const refreshUnavailable = await fetch(`${harness.origin}/api/auth/session`, {
    headers: { Cookie: cookieHeader({ ...cookies, ziva_access: 'expired-access-token' }) }
  });
  assert.equal(refreshUnavailable.status, 503);
  assert.equal((await refreshUnavailable.json()).error, 'SUPABASE_UNAVAILABLE');
  assert.doesNotMatch(refreshUnavailable.headers.get('set-cookie') || '', /ziva_access=;.*Max-Age=0/);
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
  assert.equal(harness.state.signOutCalls.length, 1);
  assert.match(response.headers.get('set-cookie'), /ziva_access=; Path=\/; Max-Age=0/);
  assert.match(response.headers.get('set-cookie'), /ziva_refresh=; Path=\/; Max-Age=0/);
});

test('logout refreshes an expired access cookie before global sign-out and clears both cookies', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  const verification = await verifySignup(harness, csrf, 'person@example.com');
  const originalCookies = cookieMap(verification);

  const response = await postAuth(
    harness,
    '/api/auth/logout',
    {},
    csrf.token,
    { ...csrf.cookies, ...originalCookies, ziva_access: 'expired-access-token' }
  );
  assert.equal(response.status, 200);
  assert.equal(harness.state.refreshCalls, 1);
  assert.ok(harness.state.sessionSet.access_token);
  assert.ok(harness.state.sessionSet.refresh_token);
  assert.notEqual(harness.state.sessionSet.access_token, 'expired-access-token');
  assert.notEqual(harness.state.sessionSet.refresh_token, originalCookies.ziva_refresh);
  assert.equal(harness.state.signOutScope, 'global');
  assert.equal(harness.state.signOutCalls.length, 1);
  assert.match(response.headers.get('set-cookie'), /ziva_access=; Path=\/; Max-Age=0/);
  assert.match(response.headers.get('set-cookie'), /ziva_refresh=; Path=\/; Max-Age=0/);
});

test('logout reports an unavailable Auth service instead of claiming remote revocation', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  const verification = await verifySignup(harness, csrf, 'person@example.com');
  harness.state.getUserError = { status: 503 };

  const response = await postAuth(
    harness,
    '/api/auth/logout',
    {},
    csrf.token,
    { ...csrf.cookies, ...cookieMap(verification) }
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'LOGOUT_UNCONFIRMED');
  assert.match(response.headers.get('set-cookie'), /ziva_refresh=; Path=\/; Max-Age=0/);
  assert.equal(harness.state.signOutScope, null);
});

test('logout does not claim remote sign-out when refreshing the session fails', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  const verification = await verifySignup(harness, csrf, 'person@example.com');
  const cookies = cookieMap(verification);
  harness.state.refreshError = { status: 503 };

  const response = await postAuth(
    harness,
    '/api/auth/logout',
    {},
    csrf.token,
    { ...csrf.cookies, ...cookies, ziva_access: 'expired-access-token' }
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'LOGOUT_UNCONFIRMED');
  assert.equal(harness.state.refreshCalls, 1);
  assert.equal(harness.state.signOutCalls.length, 0);
  assert.match(response.headers.get('set-cookie'), /ziva_access=; Path=\/; Max-Age=0/);
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

test('configured Capacitor origins receive credentialed CORS and CSRF validation', async (t) => {
  const harness = await createHarness({ mobileOrigins: 'capacitor://localhost,https://localhost' });
  t.after(() => harness.close());
  const preflight = await fetch(`${harness.origin}/api/auth/logout`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'capacitor://localhost',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-csrf-token'
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'capacitor://localhost');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');

  const sessionResponse = await fetch(`${harness.origin}/api/auth/session`, { headers: { Origin: 'capacitor://localhost' } });
  const session = await sessionResponse.json();
  const cookies = cookieMap(sessionResponse);
  const auth = await fetch(`${harness.origin}/api/auth/register`, {
    method: 'POST',
    headers: {
      Origin: 'capacitor://localhost',
      'Sec-Fetch-Site': 'cross-site',
      'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrfToken,
      Cookie: cookieHeader(cookies)
    },
    body: JSON.stringify({ email: 'mobile@example.com', full_name: 'Mobile User', password: 'secure-password-123' })
  });
  assert.equal(auth.status, 202);
  assert.match(sessionResponse.headers.get('set-cookie'), /SameSite=None; Secure/i);
});

test('anonymous and normal users cannot access protected admin or playback features', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  for (const route of [
    '/api/admin/permissions',
    '/api/admin/catalog',
    '/api/admin/users',
    '/api/admin/subscriptions',
    '/api/admin/payments',
    '/api/billing',
    '/api/admin/video-sources',
    '/api/playback/authorize?tmdbId=12&mediaType=movie'
  ]) {
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

test('user library, watch progress and profile writes are tied to the authenticated user', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  const verified = await verifySignup(harness, csrf, 'person@example.com');
  const user = harness.state.usersByEmail.get('person@example.com');
  const cookies = { ...csrf.cookies, ...cookieMap(verified) };
  const post = (route, payload) => fetch(`${harness.origin}${route}`, {
    method: 'POST',
    headers: {
      Origin: harness.origin,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf.token,
      Cookie: cookieHeader(cookies)
    },
    body: JSON.stringify(payload)
  });

  const libraryResponse = await post('/api/library', {
    action: 'upsert', mediaType: 'anime', contentId: '42', collection: 'watchlist',
    user_id: 'attacker-chosen-id', metadata: { title: 'Sample Anime' }
  });
  assert.equal(libraryResponse.status, 200);
  assert.equal(harness.state.databaseWrites[0].table, 'user_library');
  assert.equal(harness.state.databaseWrites[0].values.user_id, user.id);
  assert.equal(harness.state.databaseWrites[0].values.media_type, 'anime');

  const historyResponse = await post('/api/watch-history', {
    mediaType: 'movie', contentId: '19', title: 'Sample Movie',
    positionSeconds: 30, durationSeconds: 120
  });
  assert.equal(historyResponse.status, 200);
  assert.equal(harness.state.databaseWrites[1].table, 'watch_history');
  assert.equal(harness.state.databaseWrites[1].values.user_id, user.id);

  const invalidProgress = await post('/api/watch-history', {
    mediaType: 'movie', contentId: '19', title: 'Sample Movie',
    positionSeconds: 121, durationSeconds: 120
  });
  assert.equal(invalidProgress.status, 400);
  assert.equal(harness.state.databaseWrites.length, 2);

  const profileResponse = await post('/api/profile', { fullName: 'New Display Name', avatarUrl: null });
  assert.equal(profileResponse.status, 200);
  assert.equal((await profileResponse.json()).profile.full_name, 'New Display Name');

  const ownLibrary = await fetch(`${harness.origin}/api/library`, { headers: { Cookie: cookieHeader(cookies) } });
  assert.equal(ownLibrary.status, 200);
  const billingResponse = await fetch(`${harness.origin}/api/billing`, { headers: { Cookie: cookieHeader(cookies) } });
  assert.equal(billingResponse.status, 200);
  assert.equal((await billingResponse.json()).paymentProcessingEnabled, false);
  for (const table of ['subscriptions', 'payment_records']) {
    const query = harness.state.databaseQueries.find((item) => item.table === table);
    assert.ok(query);
    assert.deepEqual(query.filters, [['user_id', user.id]]);
  }
});

test('admin payment history is denied to ordinary accounts and read-only for authorized admins', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  const verified = await verifySignup(harness, csrf, 'person@example.com');
  const cookies = cookieMap(verified);
  const denied = await fetch(`${harness.origin}/api/admin/payments`, { headers: { Cookie: cookieHeader(cookies) } });
  assert.equal(denied.status, 403);

  const user = harness.state.usersByEmail.get('person@example.com');
  harness.state.adminIds.add(user.id);
  const allowed = await fetch(`${harness.origin}/api/admin/payments`, { headers: { Cookie: cookieHeader(cookies) } });
  assert.equal(allowed.status, 200);
  assert.deepEqual((await allowed.json()).payments, []);
  const forbiddenWrite = await fetch(`${harness.origin}/api/admin/payments`, { method: 'POST', headers: { Cookie: cookieHeader(cookies) } });
  assert.equal(forbiddenWrite.status, 405);
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

test('series playback requires a selected episode and passes it to the authorized provider', async (t) => {
  let resolved;
  const harness = await createHarness({
    playbackProvider: {
      resolveTitle: async (request) => {
        resolved = request;
        return {
          authorized: true,
          streamUrl: 'https://media.provider.example/series/42/season/2/episode/4.m3u8',
          streamType: 'application/vnd.apple.mpegurl'
        };
      }
    }
  });
  t.after(() => harness.close());
  const csrf = await csrfFor(harness);
  await register(harness, csrf);
  const verified = await verifySignup(harness, csrf, 'person@example.com');
  const headers = { Cookie: cookieHeader(cookieMap(verified)) };
  const missingEpisode = await fetch(
    `${harness.origin}/api/playback/authorize?tmdbId=42&mediaType=tv`,
    { headers }
  );
  assert.equal(missingEpisode.status, 400);
  assert.equal(resolved, undefined);

  const response = await fetch(
    `${harness.origin}/api/playback/authorize?tmdbId=42&mediaType=tv&seasonNumber=2&episodeNumber=4`,
    { headers }
  );
  assert.equal(response.status, 200);
  assert.equal(resolved.tmdbId, 42);
  assert.equal(resolved.mediaType, 'tv');
  assert.equal(resolved.seasonNumber, 2);
  assert.equal(resolved.episodeNumber, 4);

  const invalidEpisode = await fetch(
    `${harness.origin}/api/playback/authorize?tmdbId=42&mediaType=tv&seasonNumber=2.5&episodeNumber=4`,
    { headers }
  );
  assert.equal(invalidEpisode.status, 400);
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

test('separate catalogue and account paths serve their dedicated responsive pages', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  for (const route of ['/', '/movies', '/series', '/anime', '/account', '/plans', '/genres/action', '/watchlist']) {
    const response = await fetch(`${harness.origin}${route}`);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), /text\/html/);
  }
  const app = await (await fetch(`${harness.origin}/app.js`)).text();
  assert.match(app, /search\(query, page, currentMediaType, \{ signal: controller\.signal \}\)/);
  assert.match(app, /tmdb-\(movie\|tv\)/);
  const page = await (await fetch(`${harness.origin}/index.html`)).text();
  assert.match(page, /\/genres\/action/);
  assert.match(page, /data-media-type="tv"/);
  const anime = await (await fetch(`${harness.origin}/anime`)).text();
  assert.match(anime, /Anilist catalogue|AniList catalogue/i);
  assert.match(anime, /\/src\/library-client\.js/);
  const account = await (await fetch(`${harness.origin}/account`)).text();
  assert.match(account, /Continue watching/);
});

test('static assets remain available while server-side files and secrets stay private', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());
  for (const asset of ['/', '/app.js', '/anime.js', '/sw.js', '/manifest.json', '/mobile-config.js', '/src/api-client.js', '/src/register-service-worker.js', '/src/library-client.js', '/src/catalogue.js', '/src/catalogue-sections.js', '/assets/icons/ziva.svg']) {
    assert.equal((await fetch(`${harness.origin}${asset}`)).status, 200, asset);
  }
  for (const privatePath of ['/.env', '/.env.local', '/lib/supabase.js', '/server.js', '/supabase/migrations/001_initial_auth_schema.sql', '/capacitor.config.json', '/scripts/prepare-capacitor.js', '/mobile/www/index.html']) {
    assert.equal((await fetch(`${harness.origin}${privatePath}`)).status, 404, privatePath);
  }
  const app = await (await fetch(`${harness.origin}/app.js`)).text();
  assert.doesNotMatch(app, /SUPABASE_SERVICE_ROLE_KEY|access_token|refresh_token/);
});

test('AniList API route validates requests and returns normalized metadata', async (t) => {
  let upstream;
  const harness = await createHarness({
    animeFetch: async (url, options) => {
      upstream = { url, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({ data: { Page: {
          pageInfo: { currentPage: 1, hasNextPage: false },
          media: [{ id: 8, title: { english: 'ZIVA Anime' }, averageScore: 90, episodes: 12, genres: ['Drama'] }]
        } } })
      };
    }
  });
  t.after(() => harness.close());
  const response = await fetch(`${harness.origin}/api/anime?mode=search&query=space`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.items[0].title, 'ZIVA Anime');
  assert.equal(upstream.body.variables.search, 'space');
  assert.equal(upstream.url, 'https://graphql.anilist.co');

  const invalid = await fetch(`${harness.origin}/api/anime?mode=delete`);
  assert.equal(invalid.status, 404);
  const method = await fetch(`${harness.origin}/api/anime`, { method: 'POST' });
  assert.equal(method.status, 405);
});

test('AniList failure surfaces a service error without manufacturing playback availability', async (t) => {
  const harness = await createHarness({
    animeFetch: async () => ({ ok: false, status: 503, json: async () => ({}) })
  });
  t.after(() => harness.close());
  const response = await fetch(`${harness.origin}/api/anime?mode=popular`);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, 'ANILIST_UPSTREAM_ERROR');
  assert.match(body.message, /anime data service/);
});
