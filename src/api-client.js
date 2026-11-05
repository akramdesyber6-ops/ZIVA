'use strict';

(function attachZivaApi(global) {
  const originalFetch = global.fetch.bind(global);
  const configuredBase = global.ZIVA_CONFIG && global.ZIVA_CONFIG.apiBaseUrl;
  const baseUrl = configuredBase ? new URL(configuredBase) : null;

  if (baseUrl && baseUrl.protocol !== 'https:' && baseUrl.hostname !== 'localhost' && baseUrl.hostname !== '127.0.0.1') {
    throw new Error('ZIVA_API_BASE_URL must use HTTPS outside local development.');
  }

  global.zivaApiUrl = function zivaApiUrl(path) {
    return new URL(path, baseUrl || global.location.origin);
  };

  if (!baseUrl || baseUrl.origin === global.location.origin) return;

  global.fetch = function zivaFetch(input, init = {}) {
    const url = input instanceof URL ? input : typeof input === 'string' ? new URL(input, global.location.origin) : null;
    if (!url || url.origin !== global.location.origin || !url.pathname.startsWith('/api/')) {
      return originalFetch(input, init);
    }
    return originalFetch(new URL(`${url.pathname}${url.search}`, baseUrl), {
      ...init,
      credentials: 'include'
    });
  };
})(window);
