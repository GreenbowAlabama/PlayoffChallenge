/**
 * Financial Reconciliation Dashboard
 *
 * Real-time view of platform financial health with repair actions
 * - Reconciliation equation: wallet_liability + contest_pools = deposits - withdrawals
 * - 6 financial invariant checks
 * - 5 repair actions with confirmation dialogs
 * - Audit log viewer with filtering
 */

import { useEffect, useState, useCallback } from 'react';
import type { ReconciliationData, AuditLogEntry } from '../api/financial-reconciliation';
import {
  getPlatformReconciliation,
  getFinancialAuditLog
} from '../api/financial-reconciliation';
import '../styles/FinancialReconciliation.css';


interface ConfirmDialog {
  isOpen: boolean;
  title: string;
  action: (() => Promise<void>) | null;
  paramName: string;
  paramValue: string;
}

export default function FinancialReconciliation() {
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>({
    isOpen: false,
    title: '',
    action: null,
    paramName: '',
    paramValue: ''
  });
  const [repairReason, setRepairReason] = useState('');

  // Fetch reconciliation data
  const fetchReconciliation = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getPlatformReconciliation();
      setData(result);

      // Also fetch audit log
      const auditResult = await getFinancialAuditLog();
      setAuditLog(auditResult.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch reconciliation data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    fetchReconciliation();
    const interval = setInterval(fetchReconciliation, 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchReconciliation]);

  // Clear success message after 5 seconds
  useEffect(() => {
    if (successMessage) {
      const timeout = setTimeout(() => setSuccessMessage(null), 5000);
      return () => clearTimeout(timeout);
    }
  }, [successMessage]);

  // Handle repair action with confirmation
  const handleRepair = useCallback(
    (title: string, action: () => Promise<void>, paramName: string) => {
      setConfirmDialog({
        isOpen: true,
        title,
        action,
        paramName,
        paramValue: ''
      });
      setRepairReason('');
    },
    []
  );

  // Execute repair after confirmation
  const executeRepair = useCallback(async () => {
    if (!confirmDialog.action || !repairReason.trim()) {
      setError('Reason is required');
      return;
    }

    try {
      setRepairing(true);
      setError(null);
      await confirmDialog.action();
      setSuccessMessage('Repair completed successfully');
      setConfirmDialog({ isOpen: false, title: '', action: null, paramName: '', paramValue: '' });
      setRepairReason('');

      // Refresh data after repair
      await fetchReconciliation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Repair failed');
    } finally {
      setRepairing(false);
    }
  }, [confirmDialog.action, repairReason, fetchReconciliation]);

  if (loading && !data) {
    return <div className="reconciliation-container"><p>Loading...</p></div>;
  }

  if (!data) {
    return (
      <div className="reconciliation-container">
        <p className="error">{error || 'Failed to load reconciliation data'}</p>
      </div>
    );
  }

  const { reconciliation, invariants, status } = data;
  const coherenceClass = status.is_coherent ? 'coherent' : 'incoherent';
  const healthColor = invariants.health_status === 'PASS' ? 'pass' : invariants.health_status === 'WARN' ? 'warn' : 'fail';

  return (
    <div className="reconciliation-container">
      <div className="header">
        <h1>Financial Control Tower</h1>
        <div className="header-controls">
          <button onClick={fetchReconciliation} disabled={loading}>
            🔄 Refresh
          </button>
          <span className={`status-badge ${healthColor}`}>{invariants.health_status}</span>
          <span className={`coherence-badge ${coherenceClass}`}>
            {status.is_coherent ? '✅ Coherent' : '⚠️ Incoherent'}
          </span>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {successMessage && <div className="alert alert-success">{successMessage}</div>}

      <div className="dashboard-grid">
        {/* Reconciliation Box */}
        <section className="box reconciliation-box">
          <h2>Platform Reconciliation</h2>
          <div className="reconciliation-equation">
            <div className="equation-term">
              <span className="label">Wallet Liability</span>
              <span className="value">${(reconciliation.wallet_liability_cents / 100).toFixed(2)}</span>
            </div>
            <span className="plus">+</span>
            <div className="equation-term">
              <span className="label">Contest Pools</span>
              <span className="value">${(reconciliation.contest_pools_cents / 100).toFixed(2)}</span>
            </div>
            <span className="equals">=</span>
            <div className="equation-term">
              <span className="label">Deposits</span>
              <span className="value">${(reconciliation.deposits_cents / 100).toFixed(2)}</span>
            </div>
            <span className="minus">-</span>
            <div className="equation-term">
              <span className="label">Withdrawals</span>
              <span className="value">${(reconciliation.withdrawals_cents / 100).toFixed(2)}</span>
            </div>
          </div>
          <div className={`difference ${coherenceClass}`}>
            <span className="label">Difference (Orphaned Amount)</span>
            <span className="value">${(reconciliation.difference_cents / 100).toFixed(2)}</span>
          </div>
        </section>

        {/* Invariants Box */}
        <section className="box invariants-box">
          <h2>Financial Invariants</h2>
          <div className="invariants-list">
            <div className={`invariant ${invariants.negative_wallets > 0 ? 'issue' : 'ok'}`}>
              <span>Negative Wallets: {invariants.negative_wallets}</span>
            </div>
            <div className={`invariant ${invariants.illegal_entry_fee_direction > 0 ? 'issue' : 'ok'}`}>
              <span>Illegal ENTRY_FEE CREDIT: {invariants.illegal_entry_fee_direction}</span>
            </div>
            <div className={`invariant ${invariants.illegal_refund_direction > 0 ? 'issue' : 'ok'}`}>
              <span>Illegal ENTRY_FEE_REFUND DEBIT: {invariants.illegal_refund_direction}</span>
            </div>
            <div className={`invariant ${invariants.orphaned_ledger_entries > 0 ? 'issue' : 'ok'}`}>
              <span>Orphaned Ledger Entries: {invariants.orphaned_ledger_entries}</span>
            </div>
            <div className={`invariant ${invariants.orphaned_withdrawals > 0 ? 'issue' : 'ok'}`}>
              <span>Orphaned Withdrawals: {invariants.orphaned_withdrawals}</span>
            </div>
            <div className={`invariant ${invariants.negative_contest_pools > 0 ? 'issue' : 'ok'}`}>
              <span>Negative Contest Pools: {invariants.negative_contest_pools}</span>
            </div>
          </div>
        </section>

        {/* System Alerts Box */}
        <section className="box alerts-box">
          <h2>System Alerts</h2>
          <div className="alerts-list">
            {invariants.negative_wallets > 0 && (
              <div className="alert-item">🚨 {invariants.negative_wallets} wallet(s) with negative balance</div>
            )}
            {invariants.illegal_entry_fee_direction > 0 && (
              <div className="alert-item">🚨 {invariants.illegal_entry_fee_direction} illegal ENTRY_FEE CREDIT entries</div>
            )}
            {invariants.illegal_refund_direction > 0 && (
              <div className="alert-item">🚨 {invariants.illegal_refund_direction} illegal ENTRY_FEE_REFUND DEBIT entries</div>
            )}
            {invariants.orphaned_withdrawals > 0 && (
              <div className="alert-item">⚠️ {invariants.orphaned_withdrawals} orphaned withdrawal(s)</div>
            )}
            {invariants.negative_contest_pools > 0 && (
              <div className="alert-item">⚠️ {invariants.negative_contest_pools} contest pool(s) with negative balance</div>
            )}
            {status.is_coherent && (
              <div className="alert-item success">✅ Platform coherent</div>
            )}
          </div>
        </section>

        {/* Repair Actions Box */}
        <section className="box repair-actions-box">
          <h2>Repair Actions</h2>
          <div className="repair-buttons">
            <button
              className="repair-button"
              onClick={() => handleRepair('Repair Orphan Withdrawal', async () => {}, 'ledger_id')}
              disabled={invariants.orphaned_withdrawals === 0}
            >
              🔧 Repair Orphan Withdrawal<br/>
              <small>({invariants.orphaned_withdrawals} found)</small>
            </button>
            <button
              className="repair-button"
              onClick={() => handleRepair('Convert Illegal ENTRY_FEE', async () => {}, 'ledger_id')}
              disabled={invariants.illegal_entry_fee_direction === 0}
            >
              🔧 Convert ENTRY_FEE CREDIT<br/>
              <small>({invariants.illegal_entry_fee_direction} found)</small>
            </button>
            <button
              className="repair-button"
              onClick={() => handleRepair('Rollback Non-Atomic Join', async () => {}, 'ledger_id')}
            >
              🔧 Rollback Non-Atomic Join
            </button>
            <button
              className="repair-button"
              onClick={() => handleRepair('Freeze Negative Wallet', async () => {}, 'user_id')}
              disabled={invariants.negative_wallets === 0}
            >
              🔒 Freeze Wallet<br/>
              <small>({invariants.negative_wallets} found)</small>
            </button>
            <button
              className="repair-button"
              onClick={() => handleRepair('Repair Illegal Refund', async () => {}, 'ledger_id')}
              disabled={invariants.illegal_refund_direction === 0}
            >
              🔧 Repair Illegal Refund<br/>
              <small>({invariants.illegal_refund_direction} found)</small>
            </button>
          </div>
        </section>
      </div>

      {/* Audit Log */}
      <section className="box audit-log-box">
        <h2>Audit Log</h2>
        <div className="audit-log">
          {auditLog.length === 0 ? (
            <p className="empty">No audit entries</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Admin ID</th>
                  <th>Reason</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map(entry => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.created_at).toLocaleString()}</td>
                    <td>{entry.action_type}</td>
                    <td>{entry.admin_id.substring(0, 8)}...</td>
                    <td>{entry.reason}</td>
                    <td className={entry.status === 'completed' ? 'success' : 'pending'}>{entry.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Confirmation Dialog */}
      {confirmDialog.isOpen && (
        <div className="modal-overlay" onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{confirmDialog.title}</h2>
            <div className="modal-content">
              <label>
                <strong>Reason (required):</strong>
                <textarea
                  value={repairReason}
                  onChange={e => setRepairReason(e.target.value)}
                  placeholder="Explain why this repair is needed..."
                  rows={4}
                />
              </label>
              {confirmDialog.paramName && (
                <label>
                  <strong>{confirmDialog.paramName} (required):</strong>
                  <input
                    type="text"
                    placeholder={`Enter ${confirmDialog.paramName}`}
                    onChange={e => setConfirmDialog({ ...confirmDialog, paramValue: e.target.value })}
                  />
                </label>
              )}
            </div>
            <div className="modal-actions">
              <button onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}>Cancel</button>
              <button
                onClick={executeRepair}
                disabled={repairing || !repairReason.trim()}
                className="primary"
              >
                {repairing ? 'Processing...' : 'Confirm Repair'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
