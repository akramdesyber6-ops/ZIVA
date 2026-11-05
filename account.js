'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  let csrfToken = '';
  let sessionUser = null;

  async function api(path, options = {}) {
    const response = await fetch(window.zivaApiUrl(path), {
      credentials: 'include',
      cache: 'no-store',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `Request failed (${response.status}).`);
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  function renderItems(container, items, render) {
    if (!items.length) {
      container.innerHTML = '<p class="empty-state">Nothing to show yet.</p>';
      return;
    }
    container.innerHTML = items.map(render).join('');
  }

  function renderLibrary(item) {
    const metadata = item.metadata || {};
    const title = metadata.title || item.content_id;
    const image = typeof metadata.image === 'string' && metadata.image.startsWith('https://')
      ? `<img src="${escapeHtml(metadata.image)}" alt="" loading="lazy">`
      : '<span class="account-art-placeholder">Z</span>';
    return `<article class="account-title">${image}<div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(item.media_type.toUpperCase())} · ${escapeHtml(item.collection)}</p></div></article>`;
  }

  function renderHistory(item) {
    const percent = item.duration_seconds ? Math.min(100, Math.floor(item.position_seconds / item.duration_seconds * 100)) : 0;
    return `<article class="history-item"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.media_type.toUpperCase())} · ${item.completed_at ? 'Completed' : `${percent}% watched`}</p></div><progress max="100" value="${percent}" aria-label="${percent}% watched"></progress></article>`;
  }

  function renderPayment(payment) {
    return `<article class="history-item"><div><h3>${escapeHtml(payment.status)}</h3><p>${escapeHtml(payment.provider)} · ${escapeHtml(payment.occurred_at ? new Date(payment.occurred_at).toLocaleDateString() : '')}</p></div><strong>${escapeHtml((payment.amount_minor / 100).toFixed(2))} ${escapeHtml(payment.currency)}</strong></article>`;
  }

  async function loadAccount() {
    try {
      const sessionResponse = await fetch(window.zivaApiUrl('/api/auth/session'), { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
      const session = await sessionResponse.json().catch(() => ({}));
      csrfToken = session.csrfToken || '';
      if (!sessionResponse.ok || !session.authenticated) {
        $('#account-status').textContent = sessionResponse.status === 503 ? 'Account service unavailable' : 'Sign in required';
        $('#account-message').textContent = session.message || 'Sign in to access your private profile and synced library.';
        $('#account-login').hidden = false;
        if (sessionResponse.status === 503) $('#account-login').hidden = true;
        return;
      }
      sessionUser = session.user;
      $('#account-sign-out').hidden = false;
      $('#account-status').textContent = `Welcome${session.user.fullName ? `, ${session.user.fullName}` : ''}`;
      $('#account-message').textContent = session.user.email || '';
      $('#profile').hidden = false;
      $('#library').hidden = false;
      $('#history').hidden = false;
      const [profile, library, billing] = await Promise.all([api('/api/profile'), api('/api/library'), api('/api/billing')]);
      $('#profile-name').value = profile.profile.full_name || sessionUser.fullName || '';
      $('#profile-email').value = profile.profile.email || sessionUser.email || '';
      $('#profile-avatar').value = profile.profile.avatar_url || '';
      const items = library.items || [];
      renderItems($('#account-library'), items, renderLibrary);
      const history = library.history || [];
      renderItems($('#continue-watching'), history.filter((item) => !item.completed_at && item.position_seconds > 0), renderHistory);
      renderItems($('#watch-history'), history, renderHistory);
      $('#billing').hidden = false;
      const subscription = (billing.subscriptions || [])[0];
      $('#billing-plan').textContent = subscription ? `${subscription.plan === 'premium' ? 'Premium' : 'Free'} plan` : 'Free plan';
      $('#billing-status').textContent = subscription
        ? `${subscription.status}${subscription.current_period_end ? ` · renews or ends ${new Date(subscription.current_period_end).toLocaleDateString()}` : ''}. Payment processing is not configured.`
        : 'No paid plan is active. Payment processing is not configured.';
      renderItems($('#payment-history'), billing.payments || [], renderPayment);
    } catch (error) {
      $('#account-status').textContent = 'Account unavailable';
      $('#account-message').textContent = error.message || 'Your account could not be loaded.';
    }
  }

  $('#profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const response = await api('/api/profile', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ fullName: $('#profile-name').value, avatarUrl: $('#profile-avatar').value.trim() })
      });
      $('#profile-name').value = response.profile.full_name;
      $('#account-message').textContent = 'Profile saved.';
    } catch (error) {
      $('#account-message').textContent = error.message || 'Profile could not be saved.';
    } finally {
      submit.disabled = false;
    }
  });

  $('#account-sign-out').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
        body: '{}'
      });
      location.reload();
    } catch (error) {
      $('#account-message').textContent = error.message || 'Sign out could not be completed.';
      button.disabled = false;
    }
  });

  loadAccount();
})();
