import { apiRequest } from './client';

// ============================================
// LEDGER VERIFICATION TYPES
// ============================================

export interface EntryTypeBreakdown {
  debits: number;
  credits: number;
  net: number;
}

export interface LedgerVerificationResponse {
  by_entry_type: Record<string, EntryTypeBreakdown>;
  total_credits: number;
  total_debits: number;
  net: number;
  is_balanced: boolean;
  timestamp: string;
}

// ============================================
// API FUNCTIONS
// ============================================

/**
 * Get ledger verification summary
 * Returns aggregated ledger breakdown by entry type and overall balance status
 */
export async function getLedgerVerification(): Promise<LedgerVerificationResponse> {
  return apiRequest<LedgerVerificationResponse>('/api/admin/ledger/verification');
}
