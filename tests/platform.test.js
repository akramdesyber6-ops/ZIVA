'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

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
  vm.runInNewContext(script, { window, URL });
  await window.fetch('/api/auth/session', { credentials: 'include' });
  assert.equal(String(requests[0][0]), 'https://api.ziva.example/api/auth/session');
  assert.equal(requests[0][1].credentials, 'include');
  await window.fetch('https://cdn.example.com/library.js');
  assert.equal(requests[1][0], 'https://cdn.example.com/library.js');
  assert.equal(window.zivaApiUrl('/api/library').origin, 'https://api.ziva.example');
});

test('admin page uses absolute dashboard asset paths from both admin route forms', () => {
  const page = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');
  assert.match(page, /href="\/admin\/styles\.css"/);
  assert.match(page, /src="\/admin\/app\.js"/);
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
