/**
 * User Ops API
 *
 * Provides access to operational diagnostics for user growth, engagement, and wallet health.
 */

import { apiRequest } from './client';

export interface UserCounts {
  users_total: number;
  users_created_today: number;
  users_created_last_7_days: number;
}

export interface WalletSignals {
  users_with_wallet_balance: number;
  users_with_zero_balance: number;
  wallet_balance_total: number;
  wallet_balance_avg: number;
}

export interface ParticipationSignals {
  users_joined_contests_today: number;
  users_joined_contests_last_7_days: number;
  avg_contests_per_user: number;
  users_with_no_entries: number;
}

export interface UserOpsSnapshot {
  server_time: string;
  users: UserCounts;
  wallets: WalletSignals;
  participation: ParticipationSignals;
}

/**
 * Fetch operational snapshot for user growth and engagement.
 *
 * @returns Promise containing full user operations snapshot
 */
export async function getUserOpsSnapshot(): Promise<UserOpsSnapshot> {
  return apiRequest<UserOpsSnapshot>('/api/admin/user-ops/ops');
}
