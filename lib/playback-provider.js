'use strict';

const path = require('node:path');

const PROVIDER_DIRECTORY = path.resolve(__dirname, 'providers');

function getAllowedHosts(env = process.env) {
  return new Set(String(env.ZIVA_PROVIDER_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean));
}

function validateProviderUrl(value, env = process.env) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
  if (!getAllowedHosts(env).has(url.hostname.toLowerCase())) return null;
  return url.href;
}

function loadPlaybackProvider(env = process.env) {
  const moduleName = String(env.ZIVA_PLAYBACK_PROVIDER_MODULE || '').trim();
  if (!moduleName) return null;
  const providerPath = path.resolve(PROVIDER_DIRECTORY, moduleName);
  if (!providerPath.startsWith(`${PROVIDER_DIRECTORY}${path.sep}`) || path.extname(providerPath) !== '.js') {
    throw new Error('Configured playback provider must be a JavaScript module under lib/providers.');
  }
  const provider = require(providerPath);
  if (!provider || typeof provider.resolveTitle !== 'function') {
    throw new Error('Configured playback provider must export resolveTitle().');
  }
  return provider;
}

function validateProviderResponse(result, env = process.env) {
  if (!result || typeof result !== 'object' || result.authorized !== true) return null;
  const streamUrl = validateProviderUrl(result.streamUrl, env);
  const streamType = String(result.streamType || '').toLowerCase();
  if (!streamUrl || !['video/mp4', 'application/vnd.apple.mpegurl', 'application/x-mpegurl'].includes(streamType)) {
    return null;
  }
  const downloadUrl = result.downloadAllowed === true
    ? validateProviderUrl(result.downloadUrl, env)
    : null;
  return {
    authorized: true,
    stream: { url: streamUrl, type: streamType },
    download: downloadUrl ? { allowed: true, url: downloadUrl } : null
  };
}

module.exports = { getAllowedHosts, validateProviderUrl, loadPlaybackProvider, validateProviderResponse };
