'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'mobile', 'www');
const apiBaseUrl = String(process.env.ZIVA_API_BASE_URL || '').trim();

if (!apiBaseUrl) {
  throw new Error('Set ZIVA_API_BASE_URL to the deployed HTTPS ZIVA origin before preparing the native app.');
}

let apiOrigin;
try {
  apiOrigin = new URL(apiBaseUrl);
} catch {
  throw new Error('ZIVA_API_BASE_URL must be an absolute HTTPS URL.');
}
if (apiOrigin.protocol !== 'https:' || apiOrigin.pathname !== '/' || apiOrigin.search || apiOrigin.hash) {
  throw new Error('ZIVA_API_BASE_URL must be an HTTPS origin without a path, query or fragment.');
}

const files = [
  'index.html',
  'anime.html',
  'account.html',
  'plans.html',
  'offline.html',
  'styles.css',
  'app.js',
  'anime.js',
  'account.js',
  'plans.js',
  'manifest.json',
  'sw.js',
  'mobile-config.js',
  'src/api-client.js',
  'src/register-service-worker.js',
  'src/library-client.js',
  'src/catalogue.js',
  'src/catalogue-sections.js',
  'assets/icons/ziva.svg'
];

for (const file of files) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) {
    if (['account.html', 'account.js', 'plans.html', 'plans.js', 'src/library-client.js'].includes(file)) continue;
    throw new Error(`Required mobile web asset is missing: ${file}`);
  }
  const target = path.join(destination, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

fs.writeFileSync(
  path.join(destination, 'mobile-config.js'),
  `'use strict';\nwindow.ZIVA_CONFIG = Object.freeze({ apiBaseUrl: ${JSON.stringify(apiOrigin.origin)} });\n`
);
console.log(`Prepared Capacitor web assets in ${path.relative(root, destination)} for ${apiOrigin.origin}`);
