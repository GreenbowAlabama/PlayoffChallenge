import { apiRequest } from './client';

// ============================================
// ORPHANED FUNDS TYPES
// ============================================

export interface OrphanedFundsContest {
  contest_id: string;
  contest_name: string;
  status: string;
  affected_user_count: number;
  total_stranded_cents: number;
  created_at: string;
  refunded_at?: string;
}

export interface AffectedUser {
  user_id: string;
  email: string | null;
  username: string | null;
  stranded_cents: number;
}

export interface ContestAffectedUsersResponse {
  contest_id: string;
  contest_name: string;
  status: string;
  affected_users: AffectedUser[];
  total_stranded_cents: number;
}

export interface RefundSummaryResponse {
  contests_with_stranded_funds: OrphanedFundsContest[];
  total_affected_users: number;
  total_stranded_cents: number;
  timestamp: string;
}

export interface RefundResult {
  success: boolean;
  refund_run_id: string;
  contest_id: string;
  refunded_count: number;
  total_refunded_cents: number;
  errors?: Array<{ user_id: string; error: string }>;
  timestamp: string;
}

// ============================================
// API FUNCTIONS
// ============================================

/**
 * Get summary of all contests with orphaned/stranded funds
 */
export async function getOrphanedFundsSummary(): Promise<RefundSummaryResponse> {
  return apiRequest<RefundSummaryResponse>('/api/admin/orphaned-funds/summary');
}

/**
 * Get affected users for a specific contest with stranded funds
 */
export async function getContestAffectedUsers(
  contestId: string
): Promise<ContestAffectedUsersResponse> {
  return apiRequest<ContestAffectedUsersResponse>(
    `/api/admin/orphaned-funds/${contestId}`
  );
}

/**
 * Execute refund for all affected users in a contest
 */
export async function refundContest(
  contestId: string,
  reason: string
): Promise<RefundResult> {
  return apiRequest<RefundResult>(
    `/api/admin/orphaned-funds/${contestId}/refund-all`,
    {
      method: 'POST',
      body: JSON.stringify({ reason })
    }
  );
}
