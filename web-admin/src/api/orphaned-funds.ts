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

export interface CaseNote {
  id: string;
  issue_type: 'NEGATIVE_POOL' | 'STRANDED_FUNDS';
  issue_contest_id: string;
  issue_user_id?: string;
  csa_user_id: string;
  csa_username?: string;
  note_text: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
}

export interface CaseNotesResponse {
  case_notes: CaseNote[];
  total: number;
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

/**
 * Add a case note to an issue (negative pool or stranded funds)
 */
export async function addCaseNote(
  issueType: 'NEGATIVE_POOL' | 'STRANDED_FUNDS',
  issueContestId: string,
  noteText: string,
  issueUserId?: string
): Promise<CaseNote> {
  return apiRequest<CaseNote>(
    '/api/admin/case-notes',
    {
      method: 'POST',
      body: JSON.stringify({
        issue_type: issueType,
        issue_contest_id: issueContestId,
        issue_user_id: issueUserId,
        note_text: noteText
      })
    }
  );
}

/**
 * Get all case notes for an issue
 */
export async function getCaseNotes(
  issueType: 'NEGATIVE_POOL' | 'STRANDED_FUNDS',
  contestId: string,
  issueUserId?: string
): Promise<CaseNotesResponse> {
  const queryParams = issueUserId ? `?issue_user_id=${issueUserId}` : '';
  return apiRequest<CaseNotesResponse>(
    `/api/admin/case-notes/${issueType}/${contestId}${queryParams}`
  );
}

/**
 * Mark a case note as resolved or unresolved
 */
export async function updateCaseNoteResolved(
  caseNoteId: string,
  resolved: boolean
): Promise<CaseNote> {
  return apiRequest<CaseNote>(
    `/api/admin/case-notes/${caseNoteId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ resolved })
    }
  );
}
