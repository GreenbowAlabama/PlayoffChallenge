import { apiRequest } from './client';
import type { AuthResponse, AppleAuthRequest } from '../types';

export async function loginWithApple(idToken: string): Promise<AuthResponse> {
  const response = await apiRequest<AuthResponse>('/api/admin/auth/apple', {
    method: 'POST',
    body: JSON.stringify({ id_token: idToken } as AppleAuthRequest),
  });

  if (response.token) {
    localStorage.setItem('admin_token', response.token);
  }

  return response;
}

export function logout(): void {
  localStorage.removeItem('admin_token');
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem('admin_token');
}
