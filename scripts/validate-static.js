'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'index.html',
  'anime.html',
  'account.html',
  'plans.html',
  'manifest.json',
  'sw.js',
  'offline.html',
  'src/api-client.js',
  'src/library-client.js',
  'assets/icons/ziva.svg',
  'capacitor.config.json'
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`Static validation failed; missing: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const capacitor = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
  if (!manifest.name.startsWith('ZIVA') || capacitor.appId !== 'com.ziva.platform' || capacitor.webDir !== 'mobile/www') {
    console.error('Static validation failed; application identity or platform configuration is invalid.');
    process.exitCode = 1;
  } else {
    console.log(`Static validation passed (${requiredFiles.length} required files).`);
  }
}
