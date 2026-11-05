'use strict';

(async function initAdmin() {
  const $ = (selector) => document.querySelector(selector);
  const authState = $('#auth-state');
  const roleState = $('#role-state');
  const accessState = $('#access-state');
  const adminContent = $('#admin-content');
  let csrfToken = '';

  if (!authState || !roleState || !accessState || !adminContent) return;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.body ? { 'X-CSRF-Token': csrfToken } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `Admin request failed (${response.status}).`);
    return data;
  }

  function renderUsers(users) {
    $('#user-count').textContent = String(users.length);
    $('#admin-users').innerHTML = users.length ? users.map((user) => {
      const isAdmin = (user.roles || []).includes('admin');
      return `<tr>
        <td><strong>${escapeHtml(user.full_name || 'ZIVA member')}</strong><small>${escapeHtml(user.email)}</small></td>
        <td>${escapeHtml((user.roles || []).join(', ') || 'unassigned')}</td>
        <td>${escapeHtml(user.created_at ? new Date(user.created_at).toLocaleDateString() : '—')}</td>
        <td><button class="admin-inline-button" type="button" data-role-user="${escapeHtml(user.id)}" data-role-action="${isAdmin ? 'remove' : 'assign'}">${isAdmin ? 'Remove admin' : 'Grant admin'}</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="4">No profile records found.</td></tr>';
  }

  function renderCatalog(entries) {
    $('#catalog-count').textContent = String(entries.length);
    $('#admin-catalog').innerHTML = entries.length ? entries.map((entry) => `<tr>
      <td><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.release_year || '')}</small></td>
      <td>${escapeHtml(entry.media_type)}</td><td>${escapeHtml(entry.external_id)}</td>
      <td>${entry.is_published ? 'Published' : 'Draft'}</td>
      <td><button class="admin-inline-button danger" type="button" data-remove-catalog="${escapeHtml(entry.id)}">Remove</button></td>
    </tr>`).join('') : '<tr><td colspan="5">No curated catalogue records yet.</td></tr>';
  }

  function renderProviders(sources) {
    $('#provider-count').textContent = String(sources.length);
    $('#admin-providers').innerHTML = sources.length ? sources.map((source) => `<tr>
      <td>${escapeHtml(source.provider_name)}</td><td>${escapeHtml(source.provider_asset_id)}</td>
      <td>${escapeHtml(source.rights_expires_at ? new Date(source.rights_expires_at).toLocaleDateString() : 'Not specified')}</td>
      <td>${escapeHtml(source.status)}</td>
    </tr>`).join('') : '<tr><td colspan="4">No provider rights records yet.</td></tr>';
  }

  function renderSubscriptions(subscriptions) {
    $('#admin-subscriptions').innerHTML = subscriptions.length ? subscriptions.map((item) => `<tr>
      <td>${escapeHtml(item.user_id)}</td><td>${escapeHtml(item.plan)}</td><td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml(item.current_period_end ? new Date(item.current_period_end).toLocaleDateString() : '—')}</td>
    </tr>`).join('') : '<tr><td colspan="4">No subscription records. Payment processing is disabled.</td></tr>';
  }

  function renderPayments(payments) {
    $('#admin-payments').innerHTML = payments.length ? payments.map((item) => `<tr>
      <td>${escapeHtml(item.user_id)}</td><td>${escapeHtml(item.provider)}</td>
      <td>${escapeHtml((item.amount_minor / 100).toFixed(2))} ${escapeHtml(item.currency)}</td>
      <td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.occurred_at ? new Date(item.occurred_at).toLocaleDateString() : '—')}</td>
    </tr>`).join('') : '<tr><td colspan="5">No payment records. Payment processing is disabled.</td></tr>';
  }

  async function loadUsers() {
    const result = await api('/api/admin/users');
    renderUsers(result.users || []);
  }

  async function loadCatalog() {
    const result = await api('/api/admin/catalog');
    renderCatalog(result.entries || []);
  }

  async function loadProviders() {
    const result = await api('/api/admin/video-sources');
    renderProviders(result.sources || []);
  }

  async function loadSubscriptions() {
    const result = await api('/api/admin/subscriptions');
    renderSubscriptions(result.subscriptions || []);
  }

  async function loadPayments() {
    const result = await api('/api/admin/payments');
    renderPayments(result.payments || []);
  }

  try {
    const sessionResponse = await fetch('/api/auth/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    const session = await sessionResponse.json().catch(() => ({}));
    csrfToken = session.csrfToken || '';
    if (sessionResponse.status === 503) {
      authState.textContent = 'Supabase unavailable';
      roleState.textContent = 'Permission not verified';
      accessState.textContent = 'Unavailable';
      return;
    }
    if (sessionResponse.status === 401 || !sessionResponse.ok || !session.authenticated) {
      authState.textContent = 'Unauthenticated visitor';
      roleState.textContent = 'Sign-in required';
      accessState.textContent = 'Denied';
      return;
    }

    const permissionResponse = await fetch('/api/admin/permissions', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    const permission = await permissionResponse.json().catch(() => ({}));
    if (permissionResponse.ok && permission.isAdmin === true) {
      authState.textContent = 'Authenticated administrator';
      roleState.textContent = 'Administrator';
      accessState.textContent = 'Granted';
      adminContent.hidden = false;
      const results = await Promise.allSettled([loadUsers(), loadCatalog(), loadProviders(), loadSubscriptions(), loadPayments()]);
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length) $('#admin-global-feedback').textContent = failures.map((result) => result.reason.message).join(' ');
    }
    if (permissionResponse.status === 503) {
      authState.textContent = 'Authenticated';
      roleState.textContent = 'Permission check unavailable';
      accessState.textContent = 'Supabase unavailable';
      return;
    }
    if (permissionResponse.status === 401) {
      authState.textContent = 'Unauthenticated visitor';
      roleState.textContent = 'Sign-in required';
      accessState.textContent = 'Denied';
      return;
    }
    const ordinaryUser = permissionResponse.status === 403 && permission.error === 'FORBIDDEN';
    authState.textContent = ordinaryUser ? 'Authenticated ordinary user' : 'Authenticated user';
    roleState.textContent = ordinaryUser ? 'Standard user' : 'Permission unverified';
    accessState.textContent = 'Access denied';
  } catch {
    authState.textContent = 'Supabase unavailable';
    roleState.textContent = 'Permission not verified';
    accessState.textContent = 'Unavailable';
    return;
  }

  $('#admin-users').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-role-user]');
    if (!button) return;
    button.disabled = true;
    try {
      await api('/api/admin/roles', {
        method: 'POST',
        body: JSON.stringify({
          action: button.dataset.roleAction,
          userId: button.dataset.roleUser,
          roleName: 'admin'
        })
      });
      $('#users-feedback').textContent = 'Role assignment updated.';
      await loadUsers();
    } catch (error) {
      $('#users-feedback').textContent = error.message;
      button.disabled = false;
    }
  });

  $('#catalog-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api('/api/admin/catalog', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          releaseYear: values.releaseYear || null,
          genres: values.genres.split(',').map((genre) => genre.trim()).filter(Boolean),
          isPublished: form.elements.isPublished.checked
        })
      });
      form.reset();
      $('#catalog-feedback').textContent = 'Catalogue metadata saved.';
      await loadCatalog();
    } catch (error) {
      $('#catalog-feedback').textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  $('#admin-catalog').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove-catalog]');
    if (!button || !window.confirm('Remove this curated catalogue entry?')) return;
    button.disabled = true;
    try {
      await api('/api/admin/catalog', {
        method: 'POST',
        body: JSON.stringify({ action: 'remove', id: button.dataset.removeCatalog })
      });
      $('#catalog-feedback').textContent = 'Catalogue entry removed.';
      await loadCatalog();
    } catch (error) {
      $('#catalog-feedback').textContent = error.message;
      button.disabled = false;
    }
  });

  $('#provider-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api('/api/admin/video-sources', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          rightsExpiresAt: values.rightsExpiresAt ? new Date(values.rightsExpiresAt).toISOString() : null
        })
      });
      form.reset();
      $('#provider-feedback').textContent = 'Provider rights record saved. It does not create a playable stream.';
      await loadProviders();
    } catch (error) {
      $('#provider-feedback').textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
})();
