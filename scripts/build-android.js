'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const platformPath = path.join(root, 'android');
const windows = process.platform === 'win32';
const npmExec = windows ? 'npx.cmd' : 'npx';

const java = spawnSync('java', ['-version'], { stdio: 'ignore', shell: windows });
if (java.error || java.status !== 0) {
  throw new Error('Java is required for Android builds. Install a supported JDK and add java to PATH.');
}

const sdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  windows ? path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk') : path.join(os.homedir(), 'Android', 'Sdk')
].filter(Boolean);
const androidSdk = sdkCandidates.find((candidate) => fs.existsSync(candidate));
if (!androidSdk) throw new Error('Android SDK was not found. Set ANDROID_HOME or ANDROID_SDK_ROOT to its directory.');
if (!process.env.ANDROID_HOME) process.env.ANDROID_HOME = androidSdk;
if (!process.env.ANDROID_SDK_ROOT) process.env.ANDROID_SDK_ROOT = androidSdk;

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: windows
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    return false;
  }
  return true;
}

if (!process.env.ZIVA_API_BASE_URL) {
  throw new Error('Set ZIVA_API_BASE_URL to the deployed HTTPS ZIVA origin before building Android.');
}

if (!run(process.execPath, [path.join(root, 'scripts', 'prepare-capacitor.js')])) process.exit();
if (!fs.existsSync(platformPath) && !run(npmExec, ['cap', 'add', 'android'])) process.exit();
if (!run(npmExec, ['cap', 'sync', 'android'])) process.exit();

const gradle = windows ? 'gradlew.bat' : './gradlew';
if (run(gradle, ['assembleDebug'], platformPath)) {
  console.log(`Android debug APK: ${path.join(platformPath, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')}`);
}
