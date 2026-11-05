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
  'capacitor.config.json',
  'scripts/generate-platform-assets.js',
  'android/app/src/main/AndroidManifest.xml',
  'ios/App/App.xcodeproj/project.pbxproj',
  'ios/App/App/Info.plist',
  'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
  'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png'
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
    const appIcon = fs.readFileSync(path.join(root, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png'));
    const appIconIsPng = appIcon.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    if (!appIconIsPng || appIcon.readUInt32BE(16) !== 1024 || appIcon.readUInt32BE(20) !== 1024) {
      console.error('Static validation failed; iOS app icon must be a 1024x1024 PNG.');
      process.exitCode = 1;
    } else {
      console.log(`Static validation passed (${requiredFiles.length} required files).`);
    }
  }
}
