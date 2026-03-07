import { apiRequest } from './client';
import type { User, UserDetail } from '../types';

export async function getUsers(): Promise<User[]> {
  return apiRequest<User[]>('/api/admin/users');
}

export async function getUserDetail(userId: string): Promise<UserDetail> {
  return apiRequest<UserDetail>(`/api/admin/users/${userId}`);
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

export async function updateUserNotes(
  userId: string,
  adminNotes: string
): Promise<{ adminNotes: string | null }> {
  return apiRequest<{ adminNotes: string | null }>(`/api/admin/users/${userId}/notes`, {
    method: 'PATCH',
    body: JSON.stringify({ adminNotes }),
  });
}

export interface WalletTransaction {
  id: string;
  entry_type: string;
  direction: 'CREDIT' | 'DEBIT';
  amount_cents: number;
  created_at: string;
  reference_id: string;
  metadata_json: Record<string, unknown>;
}

export interface UserWalletLedger {
  user_id: string;
  current_balance_cents: number;
  transactions: WalletTransaction[];
}

export async function getUserWalletLedger(userId: string): Promise<UserWalletLedger> {
  return apiRequest<UserWalletLedger>(`/api/admin/users/${userId}/wallet-ledger`);
}
