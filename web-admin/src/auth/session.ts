/**
 * Central auth session management.
 * Single source of truth for token persistence and session handling.
 */

const TOKEN_KEY = 'admin_token';

// Get token from localStorage
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

// Store token in localStorage
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

// Clear token from localStorage
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// Check if user is authenticated (validates token and expiration)
export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;

  // Validate JWT format and expiration
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // Check if token is expired (exp is in seconds, Date.now() is in ms)
    return payload.exp * 1000 > Date.now();
  } catch {
    // If JWT parsing fails, token is malformed
    return false;
  }
}

// Handle session expiration (401 or explicit logout)
export function handleSessionExpired(): void {
  clearToken();

  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

export function logout(): void {
  clearToken();
}
