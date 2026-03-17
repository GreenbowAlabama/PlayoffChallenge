import { apiRequest } from './client';
import { logout, isAuthenticated, setToken } from '../auth/session';
import type { AuthResponse, AppleAuthRequest } from '../types';

export async function loginWithApple(idToken: string): Promise<AuthResponse> {
  const response = await apiRequest<AuthResponse>('/api/admin/auth/apple', {
    method: 'POST',
    body: JSON.stringify({ id_token: idToken } as AppleAuthRequest),
  });

  if (response.token) {
    setToken(response.token);
  }

  return response;
}

export { logout, isAuthenticated, setToken };
