'use strict';

(async function initAdmin() {
  const authState = document.getElementById('auth-state');
  const roleState = document.getElementById('role-state');

  if (!authState || !roleState) return;

  try {
    const response = await fetch('/api/auth/session', {
      headers: {
        Accept: 'application/json'
      }
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      authState.textContent = 'Not authenticated';
      roleState.textContent = 'Requires login';
      return;
    }

    authState.textContent = 'Authenticated';
    roleState.textContent = payload.user && payload.user.isAdmin ? 'Admin' : 'User';
  } catch (error) {
    authState.textContent = 'Session unavailable';
    roleState.textContent = 'Check server config';
  }
})();
