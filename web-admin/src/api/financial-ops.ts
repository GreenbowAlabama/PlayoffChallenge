/**
 * Financial Ops API Client
 *
 * Provides type-safe access to financial operations snapshot endpoint.
 */

import { apiClient } from './apiClient';

export interface LedgerMetrics {
  total_credits_cents: number;
  total_debits_cents: number;
  net_cents: number;
}

export interface WalletMetrics {
  wallet_liability_cents: number;
  users_with_positive_balance: number;
}

export interface ContestPoolMetrics {
  contest_pools_cents: number;
  negative_pool_contests: number;
}

export interface SettlementMetrics {
  pending_settlement_contests: number;
  settlement_failures: number;
}

export interface PayoutMetrics {
  pending_payout_jobs: number;
  failed_payout_transfers: number;
}

export interface ReconciliationMetrics {
  deposits_cents: number;
  withdrawals_cents: number;
  expected_cents: number;
  actual_cents: number;
  difference_cents: number;
  status: 'balanced' | 'drift';
}

export interface FinancialOpsSnapshot {
  server_time: string;
  ledger: LedgerMetrics;
  wallets: WalletMetrics;
  contest_pools: ContestPoolMetrics;
  settlement: SettlementMetrics;
  payouts: PayoutMetrics;
  reconciliation: ReconciliationMetrics;
  timestamp: string;
}

/**
 * Get complete financial operations snapshot.
 *
 * @returns Promise resolving to financial ops snapshot
 * @throws Error if API request fails
 */
export async function getFinancialOpsSnapshot(): Promise<FinancialOpsSnapshot> {
  const response = await apiClient.get<FinancialOpsSnapshot>('/admin/financial-ops');
  return response.data;
}
