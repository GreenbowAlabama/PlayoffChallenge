import { apiRequest } from './client';
import type { User } from '../types';

export async function getUsers(): Promise<User[]> {
  return apiRequest<User[]>('/api/admin/users');
}

export async function updateUserEligibility(
  userId: string,
  isPaid: boolean
): Promise<User> {
  return apiRequest<User>(`/api/admin/users/${userId}/payment`, {
    method: 'PUT',
    body: JSON.stringify({ has_paid: isPaid }),
  });
}
