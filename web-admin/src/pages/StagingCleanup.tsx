import React, { useState, useEffect } from 'react';
import type {
  OrphanedFundsContest,
  ContestAffectedUsersResponse
} from '../api/orphaned-funds';
import {
  getOrphanedFundsSummary,
  getContestAffectedUsers,
  refundContest,
} from '../api/orphaned-funds';

interface ExpandedState {
  [contestId: string]: boolean;
}

interface ContestWithUsers extends OrphanedFundsContest {
  affectedUsersData?: ContestAffectedUsersResponse;
  loading?: boolean;
}

export default function StagingCleanup() {
  const [contests, setContests] = useState<ContestWithUsers[]>([]);
  const [totalAffectedUsers, setTotalAffectedUsers] = useState(0);
  const [totalStrandedCents, setTotalStrandedCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedState, setExpandedState] = useState<ExpandedState>({});
  const [refundingContestId, setRefundingContestId] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  // Load summary on mount
  useEffect(() => {
    loadSummary();
  }, []);

  async function loadSummary() {
    try {
      setLoading(true);
      setError(null);
      const result = await getOrphanedFundsSummary();
      setContests(result.contests_with_stranded_funds);
      setTotalAffectedUsers(result.total_affected_users);
      setTotalStrandedCents(result.total_stranded_cents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orphaned funds data');
    } finally {
      setLoading(false);
    }
  }

  async function toggleExpand(contestId: string) {
    if (expandedState[contestId]) {
      // Already expanded, just collapse
      setExpandedState({ ...expandedState, [contestId]: false });
      return;
    }

    // Load affected users
    try {
      const updatedContests = contests.map(c => {
        if (c.contest_id === contestId) {
          return { ...c, loading: true };
        }
        return c;
      });
      setContests(updatedContests);

      const affectedUsersData = await getContestAffectedUsers(contestId);
      const updatedContests2 = contests.map(c => {
        if (c.contest_id === contestId) {
          return { ...c, affectedUsersData, loading: false };
        }
        return c;
      });
      setContests(updatedContests2);
      setExpandedState({ ...expandedState, [contestId]: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load affected users');
      setContests(contests.map(c => {
        if (c.contest_id === contestId) {
          return { ...c, loading: false };
        }
        return c;
      }));
    }
  }

  function openRefundModal(contestId: string) {
    setRefundingContestId(contestId);
    setRefundReason('');
    setShowRefundModal(true);
  }

  async function executeRefund() {
    if (!refundingContestId || !refundReason.trim()) {
      setError('Please enter a reason for the refund');
      return;
    }

    try {
      setError(null);
      const result = await refundContest(refundingContestId, refundReason);
      setSuccess(
        `Refunded ${result.refunded_count} users for ${result.contest_id} (${(result.total_refunded_cents / 100).toFixed(2)} cents)`
      );
      setShowRefundModal(false);
      setRefundingContestId(null);
      setRefundReason('');
      // Reload summary to reflect changes
      await loadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute refund');
    }
  }

  function closeRefundModal() {
    setShowRefundModal(false);
    setRefundingContestId(null);
    setRefundReason('');
  }

  const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  if (loading) {
    return <div className="page-container"><p>Loading orphaned funds data...</p></div>;
  }

  return (
    <div className="page-container">
      <h1>Staging Cleanup — Orphaned Funds Refunds</h1>

      {error && <div className="error-box">{error}</div>}
      {success && (
        <div className="success-box">
          {success}
          <button className="close-btn" onClick={() => setSuccess(null)}>×</button>
        </div>
      )}

      {/* Summary Panel */}
      <div className="summary-panel">
        <div className="summary-stat">
          <span className="label">Total Affected Users</span>
          <span className="value">{totalAffectedUsers}</span>
        </div>
        <div className="summary-stat">
          <span className="label">Total Stranded Funds</span>
          <span className="value">{formatCents(totalStrandedCents)}</span>
        </div>
        <div className="summary-stat">
          <span className="label">Contests with Stranded Funds</span>
          <span className="value">{contests.length}</span>
        </div>
      </div>

      {contests.length === 0 ? (
        <p className="no-data">No contests with orphaned funds found.</p>
      ) : (
        <table className="contests-table">
          <thead>
            <tr>
              <th>Expand</th>
              <th>Contest Name</th>
              <th>Status</th>
              <th>Affected Users</th>
              <th>Stranded Amount</th>
              <th>Refund Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {contests.map(contest => (
              <React.Fragment key={contest.contest_id}>
                <tr className="contest-row">
                  <td>
                    <button
                      className="expand-btn"
                      onClick={() => toggleExpand(contest.contest_id)}
                    >
                      {expandedState[contest.contest_id] ? '▼' : '▶'}
                    </button>
                  </td>
                  <td>{contest.contest_name}</td>
                  <td>{contest.status}</td>
                  <td>{contest.affected_user_count}</td>
                  <td>{formatCents(contest.total_stranded_cents)}</td>
                  <td>
                    {contest.refunded_at ? (
                      <div className="refund-status-badge refund-status-completed">
                        <span className="refund-status-icon">✓</span>
                        <span className="refund-status-text">
                          Refunded {new Date(contest.refunded_at).toLocaleDateString()}
                        </span>
                      </div>
                    ) : (
                      <div className="refund-status-badge refund-status-pending">
                        <span className="refund-status-icon">⚠</span>
                        <span className="refund-status-text">Pending</span>
                      </div>
                    )}
                  </td>
                  <td>
                    <button
                      className="refund-btn"
                      onClick={() => openRefundModal(contest.contest_id)}
                      disabled={!!contest.refunded_at}
                    >
                      {contest.refunded_at ? 'Already Refunded' : 'Refund All'}
                    </button>
                  </td>
                </tr>

                {expandedState[contest.contest_id] && (
                  <tr className="expansion-row">
                    <td colSpan={6}>
                      <div className="expansion-content">
                        {contest.loading ? (
                          <p>Loading affected users...</p>
                        ) : contest.affectedUsersData ? (
                          <div className="affected-users">
                            <h3>Affected Users ({contest.affectedUsersData.affected_users.length})</h3>
                            <table className="users-table">
                              <thead>
                                <tr>
                                  <th>Email</th>
                                  <th>Username</th>
                                  <th>Stranded Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {contest.affectedUsersData.affected_users.map(user => (
                                  <tr key={user.user_id}>
                                    <td>{user.email || 'N/A'}</td>
                                    <td>{user.username || 'N/A'}</td>
                                    <td>{formatCents(user.stranded_cents)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}

      {/* Refund Modal */}
      {showRefundModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Confirm Refund</h2>
            <p>
              Are you sure you want to refund all affected users for this contest?
            </p>
            <div className="form-group">
              <label htmlFor="refund-reason">Reason for refund (required):</label>
              <textarea
                id="refund-reason"
                className="form-control"
                value={refundReason}
                onChange={e => setRefundReason(e.target.value)}
                placeholder="e.g., Contest was cancelled due to technical issues"
                rows={4}
              />
            </div>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={closeRefundModal}>
                Cancel
              </button>
              <button
                className="confirm-btn"
                onClick={executeRefund}
                disabled={!refundReason.trim()}
              >
                Execute Refund
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .page-container {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }

        h1 {
          margin-bottom: 20px;
          color: #333;
        }

        .error-box,
        .success-box {
          padding: 12px 16px;
          margin-bottom: 20px;
          border-radius: 4px;
          font-size: 14px;
        }

        .error-box {
          background-color: #fee;
          border: 1px solid #fcc;
          color: #c33;
        }

        .success-box {
          background-color: #efe;
          border: 1px solid #cfc;
          color: #3c3;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .close-btn {
          background: none;
          border: none;
          font-size: 18px;
          cursor: pointer;
          color: inherit;
          padding: 0;
          margin-left: 10px;
        }

        .summary-panel {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          margin-bottom: 30px;
        }

        .summary-stat {
          padding: 16px;
          background: #f5f5f5;
          border-radius: 4px;
          border-left: 4px solid #007bff;
        }

        .summary-stat .label {
          display: block;
          font-size: 12px;
          color: #666;
          margin-bottom: 8px;
        }

        .summary-stat .value {
          display: block;
          font-size: 24px;
          font-weight: bold;
          color: #333;
        }

        .no-data {
          padding: 20px;
          text-align: center;
          color: #999;
        }

        .contests-table {
          width: 100%;
          border-collapse: collapse;
          border: 1px solid #ddd;
          margin-bottom: 20px;
        }

        .contests-table thead {
          background-color: #f5f5f5;
        }

        .contests-table th,
        .contests-table td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid #ddd;
        }

        .contests-table th {
          font-weight: 600;
          color: #333;
        }

        .expand-btn {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 12px;
          padding: 4px 8px;
          color: #007bff;
        }

        .refund-btn {
          padding: 6px 12px;
          background-color: #28a745;
          color: white;
          border: none;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
        }

        .refund-btn:hover:not(:disabled) {
          background-color: #218838;
        }

        .refund-btn:disabled {
          background-color: #6c757d;
          cursor: not-allowed;
          opacity: 0.7;
        }

        .refund-status-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 3px;
          font-size: 12px;
          font-weight: 500;
        }

        .refund-status-icon {
          font-size: 14px;
        }

        .refund-status-completed {
          background-color: #d4edda;
          border: 1px solid #c3e6cb;
          color: #155724;
        }

        .refund-status-pending {
          background-color: #fff3cd;
          border: 1px solid #ffeeba;
          color: #856404;
        }

        .expansion-row td {
          padding: 0;
          background-color: #fafafa;
        }

        .expansion-content {
          padding: 20px;
        }

        .affected-users h3 {
          margin: 0 0 15px 0;
          font-size: 14px;
          color: #333;
        }

        .users-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }

        .users-table thead {
          background-color: #efefef;
        }

        .users-table th,
        .users-table td {
          padding: 8px;
          text-align: left;
          border-bottom: 1px solid #ddd;
        }

        .users-table th {
          font-weight: 600;
          color: #333;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal {
          background: white;
          border-radius: 4px;
          padding: 20px;
          max-width: 500px;
          width: 90%;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        }

        .modal h2 {
          margin: 0 0 15px 0;
          color: #333;
        }

        .modal p {
          margin: 0 0 15px 0;
          color: #666;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-group label {
          display: block;
          margin-bottom: 8px;
          font-weight: 600;
          color: #333;
          font-size: 12px;
        }

        .form-control {
          width: 100%;
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 3px;
          font-family: inherit;
          font-size: 13px;
          resize: vertical;
        }

        .form-control:focus {
          outline: none;
          border-color: #007bff;
          box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
        }

        .modal-actions {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }

        .cancel-btn,
        .confirm-btn {
          padding: 8px 16px;
          border: none;
          border-radius: 3px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
        }

        .cancel-btn {
          background-color: #e9ecef;
          color: #333;
        }

        .cancel-btn:hover {
          background-color: #dee2e6;
        }

        .confirm-btn {
          background-color: #dc3545;
          color: white;
        }

        .confirm-btn:hover:not(:disabled) {
          background-color: #c82333;
        }

        .confirm-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
