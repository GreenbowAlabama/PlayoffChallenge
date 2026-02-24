import { apiRequest } from './client';
import type { Pick } from '../types';

export async function getUserPicks(userId: string): Promise<Pick[]> {
  return apiRequest<Pick[]>(`/api/picks/user/${userId}`);
}
