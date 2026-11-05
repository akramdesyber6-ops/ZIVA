'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function restoreAuthSessionWith(fetchImpl, initialUser) {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const match = source.match(/async function restoreAuthSession\(\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'restoreAuthSession() should exist in app.js');
  const state = { user: initialUser, updates: [], warnings: [] };
  const context = {
    fetch: fetchImpl,
    csrfToken: '',
    updateAuthUi(user) {
      state.user = user;
      state.updates.push(user);
    },
    syncLocalWatchlist: async () => {},
    showToast: (message) => state.warnings.push(message)
  };
  return vm.runInNewContext(`${match[0]}\nrestoreAuthSession();`, context).then(() => state);
}

test('PWA manifest and offline shell contain installable brand identity', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.short_name, 'ZIVA');
  assert.equal(manifest.theme_color, '#FF5F1F');
  assert.ok(fs.existsSync(path.join(root, manifest.icons[0].src.slice(1))));
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /PRIVATE_API/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /offline\.html/);
  for (const page of ['index.html', 'anime.html', 'account.html', 'plans.html']) {
    assert.match(fs.readFileSync(path.join(root, page), 'utf8'), /register-service-worker\.js/);
  }
});

test('PWA service worker explicitly excludes account and playback APIs from caching', () => {
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(worker, /auth\|admin\|library\|watch-history\|playback\|profile\|billing/);
  assert.match(worker, /PUBLIC_METADATA_API/);
});

test('Capacitor packages only an explicit public asset allowlist and requires configured HTTPS API origin', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
  const script = fs.readFileSync(path.join(root, 'scripts', 'prepare-capacitor.js'), 'utf8');
  assert.equal(config.appId, 'com.ziva.platform');
  assert.equal(config.webDir, 'mobile/www');
  assert.match(script, /ZIVA_API_BASE_URL/);
  assert.match(script, /const files = \[/);
  assert.doesNotMatch(script, /'server\.js'|'package-lock\.json'|'\.env'/);
  assert.match(script, /src\/register-service-worker\.js/);
});

test('Android build initializes a missing Capacitor platform before sync and build', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'build-android.js'), 'utf8');
  assert.match(script, /cap', 'add', 'android/);
  assert.match(script, /cap', 'sync', 'android/);
  assert.match(script, /assembleDebug/);
  assert.match(script, /ZIVA_API_BASE_URL/);
});

test('generated Android project uses ZIVA launcher and branded splash resources', () => {
  const manifest = fs.readFileSync(path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  const theme = fs.readFileSync(path.join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'styles.xml'), 'utf8');
  assert.match(manifest, /android:icon="@drawable\/ic_ziva_launcher"/);
  assert.match(theme, /@drawable\/ziva_splash/);
  assert.match(fs.readFileSync(path.join(root, 'android', 'app', 'src', 'main', 'res', 'drawable', 'ic_ziva_launcher.xml'), 'utf8'), /#FF5F1F/);
});

test('Capacitor iOS project includes ZIVA identity, iPhone and iPad orientation support, and branded assets', () => {
  const project = path.join(root, 'ios', 'App');
  const plist = fs.readFileSync(path.join(project, 'App', 'Info.plist'), 'utf8');
  const projectFile = fs.readFileSync(path.join(project, 'App.xcodeproj', 'project.pbxproj'), 'utf8');
  const appIcon = fs.readFileSync(path.join(project, 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png'));
  const splashDirectory = path.join(project, 'App', 'Assets.xcassets', 'Splash.imageset');
  const splashContents = JSON.parse(fs.readFileSync(path.join(splashDirectory, 'Contents.json'), 'utf8'));
  const generator = fs.readFileSync(path.join(root, 'scripts', 'generate-platform-assets.js'), 'utf8');
  assert.ok(fs.existsSync(path.join(project, 'App.xcodeproj', 'project.pbxproj')));
  assert.match(plist, /<string>ZIVA<\/string>/);
  assert.match(plist, /UISupportedInterfaceOrientations~ipad/);
  assert.match(projectFile, /PRODUCT_BUNDLE_IDENTIFIER = com\.ziva\.platform/);
  assert.equal(appIcon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(appIcon.readUInt32BE(16), 1024);
  assert.equal(appIcon.readUInt32BE(20), 1024);
  for (const [image, expectedSize] of splashContents.images.map((item, index) => [item, [2732, 1366, 910][index]])) {
    const splash = fs.readFileSync(path.join(splashDirectory, image.filename));
    assert.equal(splash.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(splash.readUInt32BE(16), expectedSize);
    assert.equal(splash.readUInt32BE(20), expectedSize);
  }
  assert.match(generator, /255, 95, 31/);
});

test('native API client rewrites only same-origin API requests to the configured HTTPS server', async () => {
  const script = fs.readFileSync(path.join(root, 'src', 'api-client.js'), 'utf8');
  const requests = [];
  const window = {
    location: { origin: 'https://localhost' },
    ZIVA_CONFIG: { apiBaseUrl: 'https://api.ziva.example' },
    fetch: async (...args) => {
      requests.push(args);
      return { ok: true };
    }
  };
  vm.runInNewContext(script, { window, URL, AbortController, setTimeout, clearTimeout });
  await window.fetch('/api/auth/session', { credentials: 'include' });
  assert.equal(String(requests[0][0]), 'https://api.ziva.example/api/auth/session');
  assert.equal(requests[0][1].credentials, 'include');
  assert.ok(requests[0][1].signal instanceof AbortSignal);
  const libraryUrl = window.zivaApiUrl('/api/library');
  await window.fetch(libraryUrl);
  assert.equal(String(requests[1][0]), 'https://api.ziva.example/api/library');
  assert.equal(requests[1][1].credentials, 'include');
  assert.ok(requests[1][1].signal instanceof AbortSignal);
  await window.fetch('https://cdn.example.com/library.js');
  assert.equal(requests[2][0], 'https://cdn.example.com/library.js');
  assert.equal(requests[2][1].signal, undefined);
  assert.equal(requests[2][1].credentials, undefined);
  assert.equal(window.zivaApiUrl('/api/library').origin, 'https://api.ziva.example');
});

test('same-origin API requests have a timeout and report network failures clearly', async () => {
  const script = fs.readFileSync(path.join(root, 'src', 'api-client.js'), 'utf8');
  let timeoutCallback;
  const window = {
    location: { origin: 'https://ziva.example' },
    fetch: async (_input, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new TypeError('aborted')));
    })
  };
  vm.runInNewContext(script, {
    window,
    URL,
    AbortController,
    setTimeout: (callback) => {
      timeoutCallback = callback;
      return 1;
    },
    clearTimeout: () => {}
  });
  const timedOutRequest = window.fetch('/api/library');
  timeoutCallback();
  await assert.rejects(timedOutRequest, /could not reach the server in time/);

  const networkWindow = {
    location: { origin: 'https://ziva.example' },
    fetch: async () => { throw new TypeError('network failure'); }
  };
  vm.runInNewContext(script, { window: networkWindow, URL, AbortController, setTimeout, clearTimeout });

  await assert.rejects(
    networkWindow.fetch('/api/library'),
    /ZIVA is temporarily unreachable/
  );
});

test('absolute configured API requests time out and preserve caller cancellation', async () => {
  const script = fs.readFileSync(path.join(root, 'src', 'api-client.js'), 'utf8');
  let timeoutCallback;
  const window = {
    location: { origin: 'https://localhost' },
    ZIVA_CONFIG: { apiBaseUrl: 'https://api.ziva.example' },
    fetch: async (_input, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason));
    })
  };
  vm.runInNewContext(script, {
    window,
    URL,
    AbortController,
    setTimeout: (callback) => {
      timeoutCallback = callback;
      return 1;
    },
    clearTimeout: () => {}
  });

  const timedOutRequest = window.fetch(window.zivaApiUrl('/api/library'));
  timeoutCallback();
  await assert.rejects(timedOutRequest, /could not reach the server in time/);

  const cancellation = new AbortController();
  const cancellationError = new Error('caller cancelled');
  const cancelledRequest = window.fetch(window.zivaApiUrl('/api/library'), { signal: cancellation.signal });
  cancellation.abort(cancellationError);
  await assert.rejects(cancelledRequest, (error) => {
    assert.equal(error, cancellationError);
    assert.doesNotMatch(error.message, /temporarily unreachable|could not reach the server in time/);
    return true;
  });
});

test('invalid API origins are rejected safely', () => {
  const script = fs.readFileSync(path.join(root, 'src', 'api-client.js'), 'utf8');
  const window = {
    location: { origin: 'https://localhost' },
    ZIVA_CONFIG: { apiBaseUrl: 'https://api.ziva.example/private' },
    fetch: async () => ({ ok: true })
  };
  assert.throws(() => vm.runInNewContext(script, { window, URL, AbortController, setTimeout, clearTimeout }), /absolute HTTPS origin/);
});

test('session restoration preserves authenticated UI on HTTP 503 and 429', async () => {
  const existingUser = { email: 'person@example.com' };
  for (const status of [503, 429]) {
    const state = await restoreAuthSessionWith(async () => ({
      ok: false,
      status,
      json: async () => ({ error: status === 503 ? 'SUPABASE_UNAVAILABLE' : 'RATE_LIMITED' })
    }), existingUser);
    assert.equal(state.user, existingUser);
    assert.deepEqual(state.updates, []);
    assert.equal(state.warnings.length, 1);
    assert.match(state.warnings[0], /temporarily unavailable/);
    assert.match(state.warnings[0], /sign-in status has not been changed/);
  }
});

test('session restoration preserves authenticated UI on network failures', async () => {
  const existingUser = { email: 'person@example.com' };
  const state = await restoreAuthSessionWith(async () => {
    throw new TypeError('network failure');
  }, existingUser);
  assert.equal(state.user, existingUser);
  assert.deepEqual(state.updates, []);
  assert.equal(state.warnings.length, 1);
  assert.match(state.warnings[0], /connection/);
  assert.match(state.warnings[0], /sign-in status has not been changed/);
});

test('session restoration updates the UI only for confirmed authenticated or guest responses', async () => {
  const authenticatedUser = { email: 'person@example.com' };
  const authenticated = await restoreAuthSessionWith(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ authenticated: true, user: authenticatedUser })
  }), null);
  assert.equal(authenticated.user, authenticatedUser);
  assert.deepEqual(authenticated.updates, [authenticatedUser]);
  assert.deepEqual(authenticated.warnings, []);

  for (const response of [
    { ok: true, status: 200, json: async () => ({ authenticated: false }) },
    { ok: false, status: 401, json: async () => ({ authenticated: false }) },
    { ok: false, status: 403, json: async () => ({ authenticated: false }) }
  ]) {
    const state = await restoreAuthSessionWith(async () => response, authenticatedUser);
    assert.equal(state.user, null);
    assert.deepEqual(state.updates, [null]);
    assert.deepEqual(state.warnings, []);
  }
});

test('unexpected session responses preserve authenticated UI state', async () => {
  const existingUser = { email: 'person@example.com' };
  const state = await restoreAuthSessionWith(async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: 'BAD_REQUEST' })
  }), existingUser);
  assert.equal(state.user, existingUser);
  assert.deepEqual(state.updates, []);
  assert.equal(state.warnings.length, 1);
  assert.match(state.warnings[0], /could not confirm your session/);
});

test('responsive web layout defines mobile breakpoints and visible keyboard focus', () => {
  const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const pages = ['index.html', 'anime.html', 'account.html', 'plans.html', 'admin/index.html'];
  for (const page of pages) {
    assert.match(fs.readFileSync(path.join(root, page), 'utf8'), /name="viewport"/);
  }
  assert.match(styles, /@media\s*\(max-width:\s*820px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*600px\)/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion/);
});

test('Android release signing reads only a gitignored local properties file', () => {
  const gradle = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(gradle, /keystore\.properties/);
  assert.match(gradle, /storePassword/);
  assert.match(gradle, /keyPassword/);
  assert.match(ignore, /android\/keystore\.properties/);
  assert.match(ignore, /android\/\*\.jks/);
});

test('admin page uses absolute dashboard asset paths from both admin route forms', () => {
  const page = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');
  assert.match(page, /href="\/admin\/styles\.css"/);
  assert.match(page, /src="\/admin\/app\.js"/);
  assert.match(page, /src="\/src\/api-client\.js"/);
});

test('library migration adds user-scoped RLS without redefining initial auth objects', () => {
  const initial = fs.readFileSync(path.join(root, 'supabase', 'migrations', '001_initial_auth_schema.sql'), 'utf8');
  const library = fs.readFileSync(path.join(root, 'supabase', 'migrations', '002_user_library.sql'), 'utf8');
  assert.match(initial, /create table if not exists public\.profiles/i);
  assert.match(library, /create table if not exists public\.user_library/i);
  assert.match(library, /create table if not exists public\.watch_history/i);
  assert.match(library, /auth\.uid\(\)\s*=\s*user_id/ig);
  assert.doesNotMatch(library, /create table if not exists public\.profiles/i);
});

test('catalogue and entitlement migration separates source IDs from playback URLs', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '003_catalogue_and_entitlements.sql'), 'utf8');
  assert.match(sql, /create table if not exists public\.catalog_entries/i);
  assert.match(sql, /create table if not exists public\.authorized_video_sources/i);
  assert.match(sql, /rights_reference text not null/i);
  assert.match(sql, /create table if not exists public\.subscriptions/i);
  assert.match(sql, /create table if not exists public\.payment_records/i);
  assert.match(sql, /public\.is_user_admin\(\)/i);
  assert.doesNotMatch(sql, /stream_url|playback_url/i);
});
