'use strict';

(function attachZivaLibrary(global) {
  let sessionPromise;

  async function getSession({ refresh = false } = {}) {
    if (refresh) sessionPromise = null;
    if (!sessionPromise) {
      sessionPromise = fetch(global.zivaApiUrl('/api/auth/session'), {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      }).then(async (response) => ({
        response,
        data: await response.json().catch(() => ({}))
      })).catch((error) => {
        sessionPromise = null;
        throw error;
      });
    }
    return sessionPromise;
  }

  async function save(item, action = 'upsert', collection = 'watchlist') {
    let session = await getSession();
    if (!session.response.ok || !session.data.authenticated) session = await getSession({ refresh: true });
    if (!session.response.ok || !session.data.authenticated) return false;
    if (!session.data.csrfToken) throw new Error('Your account request could not be secured. Reload the page and try again.');
    const response = await fetch(global.zivaApiUrl('/api/library'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': session.data.csrfToken
      },
      body: JSON.stringify({
        action,
        mediaType: item.mediaType,
        contentId: item.contentId,
        collection,
        metadata: item.metadata || {}
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Your library could not be synchronized.');
    return true;
  }

  async function getLibrary() {
    const response = await fetch(global.zivaApiUrl('/api/library'), {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Your library could not be loaded.');
    return data;
  }

  async function recordProgress(item) {
    let session = await getSession();
    if (!session.response.ok || !session.data.authenticated) session = await getSession({ refresh: true });
    if (!session.response.ok || !session.data.authenticated) return false;
    if (!session.data.csrfToken) throw new Error('Your playback progress could not be secured.');
    const response = await fetch(global.zivaApiUrl('/api/watch-history'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': session.data.csrfToken
      },
      body: JSON.stringify(item)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Watch history could not be saved.');
    return true;
  }

  global.ZivaLibrary = Object.freeze({ getSession, getLibrary, recordProgress, save });
})(window);
