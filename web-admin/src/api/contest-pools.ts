import { apiRequest } from './client';

// ============================================
// CONTEST POOL DIAGNOSTICS TYPES
// ============================================

export interface NegativePoolContest {
  contest_id: string;
  contest_name: string;
  status: string;
  created_at: string;
  participant_count: number;
  entry_fee_debits_cents: number;
  entry_fee_refunds_cents: number;
  entry_fee_net_cents: number;
  prize_payout_cents: number;
  prize_reversal_cents: number;
  prize_net_cents: number;
  pool_balance_cents: number;
  root_cause: 'PAYOUTS_EXCEED_ENTRIES' | 'NO_ENTRIES_WITH_PAYOUTS' | 'REFUNDED_ENTRIES_WITH_PAYOUTS' | 'MIXED';
}

export interface RootCauseBreakdown {
  PAYOUTS_EXCEED_ENTRIES: number;
  NO_ENTRIES_WITH_PAYOUTS: number;
  REFUNDED_ENTRIES_WITH_PAYOUTS: number;
  MIXED: number;
}

export interface NegativePoolsResponse {
  contests: NegativePoolContest[];
  total_count: number;
  total_negative_cents: number;
  root_cause_breakdown: RootCauseBreakdown;
  timestamp: string;
}

export interface LedgerBreakdownEntry {
  entry_type: string;
  direction: 'DEBIT' | 'CREDIT';
  transaction_count: number;
  total_amount_cents: number;
  first_transaction_at: string;
  last_transaction_at: string;
}

export interface ContestPoolDetailsResponse {
  contest_id: string;
  contest_name: string;
  status: string;
  created_at: string;
  participant_count: number;
  ledger_breakdown: LedgerBreakdownEntry[];
}

// ============================================
// API FUNCTIONS
// ============================================

/**
 * Get all contests with negative pool balances
 * Returns contests ordered by most negative first with root cause classification
 */
export async function getNegativePoolContests(): Promise<NegativePoolsResponse> {
  return apiRequest<NegativePoolsResponse>('/api/admin/contest-pools/negative');
}

/**
 * Get detailed ledger breakdown for a specific contest
 */
export async function getContestPoolDetails(
  contestId: string
): Promise<ContestPoolDetailsResponse> {
  return apiRequest<ContestPoolDetailsResponse>(
    `/api/admin/contest-pools/${contestId}/details`
  );
}
