/**
 * Central auth session management.
 * Single source of truth for session expiration handling.
 */

export function handleSessionExpired(): void {
  localStorage.removeItem('admin_token');

  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem('admin_token');
}

export function logout(): void {
  localStorage.removeItem('admin_token');
}
