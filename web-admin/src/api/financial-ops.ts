/**
 * Financial Ops API Client
 *
 * Provides type-safe access to financial operations snapshot endpoint.
 */

import { apiRequest } from './client';

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
  return apiRequest<FinancialOpsSnapshot>('/api/admin/financial-ops');
}

/**
 * Financial Reconciliation Diagnostics Types
 */

export interface StripeNetMetrics {
  deposits_cents: number;
  withdrawals_cents: number;
  net_cents: number;
}

export interface WalletBalanceByUser {
  user_id: string;
  balance_cents: number;
}

export interface ContestPoolDetails {
  entry_fees_cents: number;
  refunds_cents: number;
  net_cents: number;
}

export interface WalletBalancesReport {
  by_user: WalletBalanceByUser[];
  total_user_count: number;
}

export interface FinancialSummary {
  stripe_net_cents: number;
  ledger_net_cents: number;
  difference_cents: number;
  is_balanced: boolean;
}

export interface ReconciliationResult {
  status: 'balanced' | 'drift';
  expected_funding_cents: number;
  actual_funding_cents: number;
  difference_cents: number;
}

export interface DiagnosticsReport {
  timestamp: string;
  financial_summary: FinancialSummary;
  stripe_funding: StripeNetMetrics;
  wallet_balances: WalletBalancesReport;
  contest_pools: ContestPoolDetails;
  reconciliation: ReconciliationResult;
}

/**
 * Run financial reconciliation diagnostics.
 *
 * Executes all diagnostic queries needed for the reconciliation runbook.
 * Read-only operation (no mutations).
 *
 * @returns Promise resolving to diagnostics report
 * @throws Error if API request fails
 */
export async function runFinancialDiagnostics(): Promise<DiagnosticsReport> {
  return apiRequest<DiagnosticsReport>('/api/admin/financial-reconciliation/diagnostics');
}
