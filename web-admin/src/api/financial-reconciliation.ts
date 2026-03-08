/**
 * Financial Reconciliation API Client
 *
 * Methods:
 * - getPlatformReconciliation()
 * - repairOrphanWithdrawal()
 * - convertIllegalEntryFee()
 * - rollbackNonAtomicJoin()
 * - freezeWallet()
 * - getFinancialAuditLog()
 */

import { apiRequest } from './client';

export interface ReconciliationData {
  reconciliation: {
    wallet_liability_cents: number;
    contest_pools_cents: number;
    deposits_cents: number;
    withdrawals_cents: number;
    difference_cents: number;
  };
  invariants: {
    negative_wallets: number;
    illegal_entry_fee_direction: number;
    illegal_refund_direction: number;
    orphaned_ledger_entries: number;
    orphaned_withdrawals: number;
    negative_contest_pools: number;
    health_status: 'PASS' | 'WARN' | 'FAIL';
  };
  status: {
    is_coherent: boolean;
    health_status: 'PASS' | 'WARN' | 'FAIL';
    timestamp: string;
  };
}

export interface RepairResponse {
  success: boolean;
  action: string;
  repair_id: string;
  audit_log_id: string;
  message: string;
  error?: string;
}

export interface AuditLogEntry {
  id: string;
  admin_id: string;
  action_type: string;
  amount_cents: number;
  reason: string;
  status: string;
  reference_id: string | null;
  details: Record<string, any>;
  created_at: string;
}

export interface AuditLogResponse {
  entries: AuditLogEntry[];
  count: number;
  filters: {
    action_type: string | null;
    from_date: string | null;
    to_date: string | null;
  };
}

/**
 * Get platform financial reconciliation data
 */
export async function getPlatformReconciliation(): Promise<ReconciliationData> {
  return apiRequest<ReconciliationData>('/admin/financial-reconciliation');
}

/**
 * Repair an orphaned withdrawal
 */
export async function repairOrphanWithdrawal(
  ledgerId: string,
  reason: string
): Promise<RepairResponse> {
  return apiRequest<RepairResponse>('/admin/financial-repair', {
    method: 'POST',
    body: JSON.stringify({
      action: 'repair_orphan_withdrawal',
      params: { ledger_id: ledgerId },
      reason
    })
  });
}

/**
 * Convert illegal ENTRY_FEE CREDIT to refund
 */
export async function convertIllegalEntryFee(
  ledgerId: string,
  reason: string
): Promise<RepairResponse> {
  return apiRequest<RepairResponse>('/admin/financial-repair', {
    method: 'POST',
    body: JSON.stringify({
      action: 'convert_entry_fee_credit',
      params: { ledger_id: ledgerId },
      reason
    })
  });
}

/**
 * Rollback non-atomic join
 */
export async function rollbackNonAtomicJoin(
  ledgerId: string,
  reason: string
): Promise<RepairResponse> {
  return apiRequest<RepairResponse>('/admin/financial-repair', {
    method: 'POST',
    body: JSON.stringify({
      action: 'rollback_non_atomic_join',
      params: { ledger_id: ledgerId },
      reason
    })
  });
}

/**
 * Freeze a user's wallet
 */
export async function freezeWallet(
  userId: string,
  reason: string
): Promise<RepairResponse> {
  return apiRequest<RepairResponse>('/admin/financial-repair', {
    method: 'POST',
    body: JSON.stringify({
      action: 'freeze_wallet',
      params: { user_id: userId },
      reason
    })
  });
}

/**
 * Get financial audit log with optional filters
 */
export async function getFinancialAuditLog(filters?: {
  action_type?: string;
  from_date?: string;
  to_date?: string;
}): Promise<AuditLogResponse> {
  const params = new URLSearchParams();
  if (filters?.action_type) params.append('action_type', filters.action_type);
  if (filters?.from_date) params.append('from_date', filters.from_date);
  if (filters?.to_date) params.append('to_date', filters.to_date);

  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<AuditLogResponse>(`/admin/financial-audit-log${query}`);
}
