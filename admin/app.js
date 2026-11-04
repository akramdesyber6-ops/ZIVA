'use strict';

(async function initAdmin() {
  const authState = document.getElementById('auth-state');
  const roleState = document.getElementById('role-state');
  const accessState = document.getElementById('access-state');

  if (!authState || !roleState || !accessState) return;

  try {
    const sessionResponse = await fetch('/api/auth/session', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const session = await sessionResponse.json().catch(() => ({}));

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
      headers: { Accept: 'application/json' }
    });
    const permission = await permissionResponse.json().catch(() => ({}));

    if (permissionResponse.ok && permission.isAdmin === true) {
      authState.textContent = 'Authenticated administrator';
      roleState.textContent = 'Administrator';
      accessState.textContent = 'Granted';
      return;
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
  }
})();
