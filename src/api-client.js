'use strict';

(function attachZivaApi(global) {
  const originalFetch = global.fetch.bind(global);
  const configuredBase = global.ZIVA_CONFIG && global.ZIVA_CONFIG.apiBaseUrl;
  let baseUrl = null;
  if (configuredBase !== undefined && configuredBase !== null && configuredBase !== '') {
    try {
      if (typeof configuredBase !== 'string') throw new TypeError('Expected a string.');
      baseUrl = new URL(configuredBase);
    } catch {
      throw new Error('ZIVA_API_BASE_URL must be an absolute HTTPS origin without a path, query or fragment.');
    }
    if (baseUrl.protocol !== 'https:' && !(baseUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname))) {
      throw new Error('ZIVA_API_BASE_URL must use HTTPS outside local development.');
    }
    if (baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash || baseUrl.username || baseUrl.password) {
      throw new Error('ZIVA_API_BASE_URL must be an absolute HTTPS origin without a path, query or fragment.');
    }
  }
  const nativeApi = Boolean(baseUrl && baseUrl.origin !== global.location.origin);
  const API_TIMEOUT_MS = 15000;

  global.zivaApiUrl = function zivaApiUrl(path) {
    return new URL(path, baseUrl || global.location.origin);
  };

  global.fetch = function zivaFetch(input, init = {}) {
    const url = input instanceof URL ? input : typeof input === 'string' ? new URL(input, global.location.origin) : null;
    const isApiPath = url && url.pathname.startsWith('/api/');
    const isAppApiRequest = isApiPath && url.origin === global.location.origin;
    const isConfiguredApiRequest = isApiPath && baseUrl && url.origin === baseUrl.origin;
    if (!isAppApiRequest && !isConfiguredApiRequest) {
      return originalFetch(input, init);
    }

    const controller = new AbortController();
    const requestSignal = init.signal;
    let timedOut = false;
    const abortRequest = () => controller.abort(requestSignal && requestSignal.reason);
    if (requestSignal) {
      if (requestSignal.aborted) abortRequest();
      else requestSignal.addEventListener('abort', abortRequest, { once: true });
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, API_TIMEOUT_MS);
    const target = nativeApi && isAppApiRequest
      ? new URL(`${url.pathname}${url.search}`, baseUrl)
      : input;
    const options = { ...init, signal: controller.signal };
    if (nativeApi) options.credentials = 'include';

    return originalFetch(target, options).catch((error) => {
      if (timedOut) {
        throw new Error('ZIVA could not reach the server in time. Check your connection and try again.');
      }
      if (!requestSignal?.aborted && error && error.name === 'TypeError') {
        throw new Error('ZIVA is temporarily unreachable. Check your internet connection and try again.');
      }
      throw error;
    }).finally(() => {
      clearTimeout(timeout);
      if (requestSignal) requestSignal.removeEventListener('abort', abortRequest);
    });
  };
})(window);
