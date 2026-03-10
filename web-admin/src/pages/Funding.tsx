/**
 * Funding Page — Financial Consolidation
 *
 * Single source of truth for all financial operations and anomalies.
 *
 * Sections:
 * 1. Financial Summary — Stripe balance, wallets, contest pools, platform float, liquidity coverage
 * 2. Anomalies — Contests with negative pools + orphaned/stranded funds
 * 3. Ledger Drill-Down — Click to see full ledger breakdown per contest
 * 4. Reconciliation History — Last 30 days trend graph
 */

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getFinancialHealth,
  getFinancialReconciliationHistory,
  repairContestPools,
  type FinancialHealthResponse,
} from '../api/admin';
import {
  getNegativePoolContests,
  getContestPoolDetails,
  type NegativePoolContest,
  type RootCauseBreakdown,
} from '../api/contest-pools';
import {
  getOrphanedFundsSummary,
  getContestAffectedUsers,
  refundContest,
  addCaseNote,
  getCaseNotes,
  type OrphanedFundsContest,
  type AffectedUser,
  type CaseNote,
} from '../api/orphaned-funds';

// ============================================
// FORMATTING UTILITIES
// ============================================

function formatCurrency(cents: number): string {
  const dollars = (cents / 100).toFixed(2);
  return `$${dollars}`;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

// ============================================
// ROOT CAUSE BADGE & CONFIG
// ============================================

const ROOT_CAUSE_CONFIG: Record<string, {
  label: string;
  shortLabel: string;
  color: string;
  bgColor: string;
}> = {
  PAYOUTS_EXCEED_ENTRIES: {
    label: 'Prize payouts exceed entry fees collected',
    shortLabel: 'Payouts > Entries',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
  },
  NO_ENTRIES_WITH_PAYOUTS: {
    label: 'Payouts issued with no entries',
    shortLabel: 'No Entries',
    color: 'text-orange-700',
    bgColor: 'bg-orange-100',
  },
  REFUNDED_ENTRIES_WITH_PAYOUTS: {
    label: 'Entry refunds issued but payouts remain',
    shortLabel: 'Refunded + Payouts',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-100',
  },
  MIXED: {
    label: 'Multiple financial issues',
    shortLabel: 'Mixed',
    color: 'text-purple-700',
    bgColor: 'bg-purple-100',
  },
};

function RootCauseBadge({ cause }: { cause: string }) {
  const config = ROOT_CAUSE_CONFIG[cause] || {
    shortLabel: cause,
    label: cause,
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bgColor} ${config.color}`}
      title={config.label}
    >
      {config.shortLabel}
    </span>
  );
}

// ============================================
// STATUS BADGE
// ============================================

interface StatusBadgeProps {
  status: 'healthy' | 'warning' | 'critical';
  label: string;
}

function StatusBadge({ status, label }: StatusBadgeProps) {
  const colors: Record<string, string> = {
    healthy: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    critical: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${colors[status]}`}>
      {status === 'healthy' && <span className="h-2 w-2 rounded-full bg-green-600 mr-1.5"></span>}
      {status === 'warning' && <span className="h-2 w-2 rounded-full bg-yellow-600 mr-1.5"></span>}
      {status === 'critical' && <span className="h-2 w-2 rounded-full bg-red-600 mr-1.5"></span>}
      {label}
    </span>
  );
}

// ============================================
// REPAIR CONTEST POOLS MODAL
// ============================================

interface RepairPoolsModalProps {
  isOpen: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

function RepairPoolsModal({ isOpen, onConfirm, onClose }: RepairPoolsModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Repair Contest Pools</h3>
          <p className="text-sm text-gray-600 mt-1">Restore accounting for contests with negative balances</p>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded p-3">
            <p className="text-sm text-blue-800">
              This will insert compensating ledger entries to restore contest pool accounting.
              <br />
              <br />
              Historical ledger rows will not be modified.
              <br />
              <br />
              This operation is idempotent and safe to run multiple times.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {isLoading ? 'Repairing...' : 'Confirm Repair'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// REFUND MODAL
// ============================================

interface RefundModalProps {
  isOpen: boolean;
  contestName: string;
  affectedUsers: AffectedUser[];
  onConfirm: (reason: string, selectedUsers?: string[]) => Promise<void>;
  onClose: () => void;
}

function RefundModal({ isOpen, contestName, affectedUsers, onConfirm, onClose }: RefundModalProps) {
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    const finalReason = reason === 'Other' ? customReason : reason;
    if (!finalReason) {
      alert('Please enter a reason');
      return;
    }

    setIsLoading(true);
    try {
      await onConfirm(finalReason);
      setReason('');
      setCustomReason('');
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Refund Users</h3>
          <p className="text-sm text-gray-600 mt-1">Contest: {contestName}</p>
          <p className="text-sm text-gray-600">Affected Users: {affectedUsers.length}</p>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Reason for Refund</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500"
            >
              <option value="">Select a reason...</option>
              <option value="Test contest refund">Test contest refund</option>
              <option value="Entry fee reversal">Entry fee reversal</option>
              <option value="Stranded funds return">Stranded funds return</option>
              <option value="Other">Other (specify below)</option>
            </select>
          </div>

          {reason === 'Other' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Custom Reason</label>
              <textarea
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500"
                rows={3}
                placeholder="Enter custom reason..."
              />
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading || !reason}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {isLoading ? 'Processing...' : 'Confirm Refund'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// CASE NOTES PANEL
// ============================================

interface CaseNotesPanelProps {
  issueType: 'NEGATIVE_POOL' | 'STRANDED_FUNDS';
  issueContestId: string;
  issueUserId?: string;
}

function CaseNotesPanel({ issueType, issueContestId, issueUserId }: CaseNotesPanelProps) {
  const [caseNotes, setCaseNotes] = useState<CaseNote[]>([]);
  const [noteText, setNoteText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const loadNotes = async () => {
    try {
      setIsLoading(true);
      const response = await getCaseNotes(issueType, issueContestId, issueUserId);
      setCaseNotes(response.case_notes);
      setHasLoaded(true);
    } catch (err) {
      console.error('Failed to load case notes:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) {
      alert('Please enter a note');
      return;
    }

    try {
      setIsLoading(true);
      const newNote = await addCaseNote(issueType, issueContestId, noteText, issueUserId);
      setCaseNotes([newNote, ...caseNotes]);
      setNoteText('');
    } catch (err) {
      alert(`Failed to add note: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  if (!hasLoaded) {
    return (
      <button onClick={loadNotes} className="text-indigo-600 hover:text-indigo-900 text-sm font-medium">
        View case notes ({caseNotes.length})
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add case note..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500"
          disabled={isLoading}
        />
        <button
          onClick={handleAddNote}
          disabled={isLoading || !noteText.trim()}
          className="px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {caseNotes.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No case notes yet</p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {caseNotes.map((note) => (
            <div key={note.id} className="bg-gray-50 border border-gray-200 rounded p-2 text-xs">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{note.csa_username || 'Unknown'}</p>
                  <p className="text-gray-700 mt-1">{note.note_text}</p>
                </div>
                {note.resolved_at && (
                  <span className="text-green-700 font-medium ml-2">✓ Resolved</span>
                )}
              </div>
              <p className="text-gray-500 mt-1">{new Date(note.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// SECTION 1: FINANCIAL SUMMARY
// ============================================

interface FinancialSummaryProps {
  data: FinancialHealthResponse | undefined;
  isLoading: boolean;
  healthStatus: 'healthy' | 'warning' | 'critical';
  onRefresh: () => Promise<void>;
  isFetching: boolean;
}

function FinancialSummary({ data, isLoading, healthStatus, onRefresh, isFetching }: FinancialSummaryProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-lg font-medium text-gray-900">Financial Summary</h2>
              <p className="text-sm text-gray-500">Platform funds reconciliation and liquidity</p>
            </div>
            {data && (
              <StatusBadge
                status={healthStatus}
                label={healthStatus === 'healthy' ? 'Healthy' : healthStatus === 'warning' ? 'Warning' : 'Critical'}
              />
            )}
          </div>
          <button
            onClick={onRefresh}
            disabled={isFetching}
            className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="px-4 py-8 text-center text-gray-600">Loading financial data...</div>
      ) : data ? (
        <div className="space-y-4 px-4 py-5">
          {/* 3-Box Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <dt className="text-xs font-semibold text-gray-600 uppercase">Stripe Balance</dt>
              <dd className="mt-1 text-2xl font-semibold text-gray-900">{formatCurrency(data.stripe_total_balance)}</dd>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <dt className="text-xs font-semibold text-gray-600 uppercase">User Wallets</dt>
              <dd className="mt-1 text-2xl font-semibold text-gray-900">{formatCurrency(data.wallet_balance)}</dd>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <dt className="text-xs font-semibold text-gray-600 uppercase">Contest Pools</dt>
              <dd className="mt-1 text-2xl font-semibold text-gray-900">{formatCurrency(data.contest_pool_balance)}</dd>
            </div>
          </div>

          {/* Liquidity & Ledger Status */}
          <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-4">
            <div>
              <dt className="text-sm font-medium text-gray-600">Platform Float</dt>
              <dd className="mt-1 text-lg font-semibold text-gray-900">{formatCurrency(data.platform_float)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-600">Liquidity Coverage Ratio</dt>
              <dd className={`mt-1 text-lg font-semibold ${data.liquidity_ratio >= 1.0 ? 'text-green-700' : 'text-red-700'}`}>
                {formatPercent(data.liquidity_ratio)}
              </dd>
            </div>
          </div>

          {/* Ledger Integrity */}
          <div className="border-t border-gray-200 pt-4">
            <dt className="text-sm font-medium text-gray-600 mb-2">Ledger Integrity</dt>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-gray-600">Credits:</span>
                <span className="ml-2 font-semibold text-gray-900">{formatCurrency(data.ledger.credits)}</span>
              </div>
              <div>
                <span className="text-gray-600">Debits:</span>
                <span className="ml-2 font-semibold text-gray-900">{formatCurrency(data.ledger.debits)}</span>
              </div>
              <div>
                <span className="text-gray-600">Net:</span>
                <span className="ml-2 font-semibold text-gray-900">{formatCurrency(data.ledger.net)}</span>
              </div>
            </div>
            <div className="mt-2">
              {data.ledger.balanced ? (
                <StatusBadge status="healthy" label="Ledger Balanced" />
              ) : (
                <StatusBadge status="critical" label="Ledger Imbalanced" />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ============================================
// SECTION 2: ANOMALIES (Negative Pools)
// ============================================

interface AnomaliesSectionProps {
  contests: NegativePoolContest[];
  isLoading: boolean;
  error: Error | null;
  totalCount: number;
  breakdown: RootCauseBreakdown;
  onRepairComplete?: () => Promise<void>;
}

function AnomaliesSection({
  contests,
  isLoading,
  error,
  totalCount,
  breakdown,
  onRepairComplete,
}: AnomaliesSectionProps) {
  const [expandedContestId, setExpandedContestId] = useState<string | null>(null);
  const [repairModalOpen, setRepairModalOpen] = useState(false);
  const [repairResult, setRepairResult] = useState<{ contests_scanned: number; contests_repaired: number; total_adjusted_cents: number } | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [showRepairSuccess, setShowRepairSuccess] = useState(false);

  const { data: details, isLoading: detailsLoading } = useQuery({
    queryKey: ['contestPoolDetails', expandedContestId],
    queryFn: () => (expandedContestId ? getContestPoolDetails(expandedContestId) : null),
    enabled: !!expandedContestId,
  });

  const handleRepair = async () => {
    setRepairError(null);
    try {
      const result = await repairContestPools();
      setRepairResult(result);
      setShowRepairSuccess(true);
      // Refresh financial data after repair
      await onRepairComplete?.();
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : 'Failed to repair contest pools');
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">
            Anomalies ({totalCount} contests with negative pools)
          </h2>
          {totalCount > 0 && (
            <button
              onClick={() => setRepairModalOpen(true)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700"
            >
              Repair Contest Pools
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="px-4 py-8 text-center text-gray-600">Loading anomalies...</div>
      ) : error ? (
        <div className="px-4 py-8 text-center text-red-600">Error loading anomalies</div>
      ) : totalCount === 0 ? (
        <div className="px-4 py-8 text-center text-gray-600">No anomalies detected. All contest pools are healthy.</div>
      ) : (
        <div className="space-y-4 px-4 py-5">
          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <dt className="text-xs font-semibold text-gray-600 uppercase">Payouts {'>'}  Entries</dt>
              <dd className="mt-1 text-xl font-semibold text-red-700">{breakdown.PAYOUTS_EXCEED_ENTRIES || 0}</dd>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <dt className="text-xs font-semibold text-gray-600 uppercase">No Entries</dt>
              <dd className="mt-1 text-xl font-semibold text-orange-700">{breakdown.NO_ENTRIES_WITH_PAYOUTS || 0}</dd>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <dt className="text-xs font-semibold text-gray-600 uppercase">Refunded + Payouts</dt>
              <dd className="mt-1 text-xl font-semibold text-yellow-700">{breakdown.REFUNDED_ENTRIES_WITH_PAYOUTS || 0}</dd>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <dt className="text-xs font-semibold text-gray-600 uppercase">Mixed</dt>
              <dd className="mt-1 text-xl font-semibold text-purple-700">{breakdown.MIXED || 0}</dd>
            </div>
          </div>

          {/* Contests Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-700 w-8"></th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">Contest Name</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">Status</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-700">Participants</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-700">Entries (net)</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-700">Payouts (net)</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-700">Pool Balance</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">Root Cause</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {contests.map((contest) => (
                  <tbody key={contest.contest_id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() =>
                            setExpandedContestId(expandedContestId === contest.contest_id ? null : contest.contest_id)
                          }
                          className="text-indigo-600 hover:text-indigo-900"
                        >
                          {expandedContestId === contest.contest_id ? '▼' : '▶'}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900">{contest.contest_name}</td>
                      <td className="px-3 py-2 text-gray-700">{contest.status}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{contest.participant_count}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(contest.entry_fee_net_cents)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(contest.prize_net_cents)}</td>
                      <td className="px-3 py-2 text-right font-medium text-red-700">
                        {formatCurrency(contest.pool_balance_cents)}
                      </td>
                      <td className="px-3 py-2">
                        <RootCauseBadge cause={contest.root_cause} />
                      </td>
                    </tr>

                    {/* Expanded Ledger Details & Actions */}
                    {expandedContestId === contest.contest_id && (
                      <tr className="bg-gray-50">
                        <td colSpan={8} className="px-4 py-4">
                          {detailsLoading ? (
                            <div className="text-sm text-gray-600">Loading details...</div>
                          ) : details ? (
                            <div className="space-y-4">
                              {/* Ledger Breakdown Table */}
                              <div>
                                <h4 className="text-sm font-semibold text-gray-900 mb-2">Ledger Breakdown</h4>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-white border-b">
                                      <th className="text-left px-2 py-1 font-medium text-gray-700">Type</th>
                                      <th className="text-left px-2 py-1 font-medium text-gray-700">Direction</th>
                                      <th className="text-right px-2 py-1 font-medium text-gray-700">Count</th>
                                      <th className="text-right px-2 py-1 font-medium text-gray-700">Total</th>
                                      <th className="text-left px-2 py-1 font-medium text-gray-700">Date Range</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-200">
                                    {details.ledger_breakdown.map((entry, idx) => (
                                      <tr key={idx} className="hover:bg-white">
                                        <td className="px-2 py-1 text-gray-900">{entry.entry_type}</td>
                                        <td className="px-2 py-1">
                                          <span className={entry.direction === 'CREDIT' ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
                                            {entry.direction}
                                          </span>
                                        </td>
                                        <td className="px-2 py-1 text-right text-gray-700">{entry.transaction_count}</td>
                                        <td className="px-2 py-1 text-right font-medium text-gray-900">
                                          {formatCurrency(entry.total_amount_cents)}
                                        </td>
                                        <td className="px-2 py-1 text-gray-600">
                                          {new Date(entry.first_transaction_at).toLocaleDateString()} to{' '}
                                          {new Date(entry.last_transaction_at).toLocaleDateString()}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              {/* Case Notes Panel */}
                              <div className="border-t border-gray-200 pt-3">
                                <h4 className="text-sm font-semibold text-gray-900 mb-2">Case Notes</h4>
                                <CaseNotesPanel
                                  issueType="NEGATIVE_POOL"
                                  issueContestId={contest.contest_id}
                                />
                              </div>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    )}
                  </tbody>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Repair Modal */}
      <RepairPoolsModal
        isOpen={repairModalOpen}
        onConfirm={handleRepair}
        onClose={() => {
          setRepairModalOpen(false);
          setRepairResult(null);
          setRepairError(null);
        }}
      />

      {/* Repair Success Message */}
      {showRepairSuccess && repairResult && (
        <div className="mx-4 my-4 rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex items-start">
            <div className="flex-1">
              <h4 className="font-medium text-green-900">Repair Complete</h4>
              <p className="text-sm text-green-700 mt-1">
                Scanned {repairResult.contests_scanned} contests, repaired {repairResult.contests_repaired} with negative pools
              </p>
              {repairResult.total_adjusted_cents > 0 && (
                <p className="text-sm text-green-700 mt-1">
                  Total adjustments: {formatCurrency(repairResult.total_adjusted_cents)}
                </p>
              )}
            </div>
            <button
              onClick={() => setShowRepairSuccess(false)}
              className="text-green-700 hover:text-green-900"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Repair Error Message */}
      {repairError && (
        <div className="mx-4 my-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-start">
            <div className="flex-1">
              <h4 className="font-medium text-red-900">Repair Failed</h4>
              <p className="text-sm text-red-700 mt-1">{repairError}</p>
            </div>
            <button
              onClick={() => setRepairError(null)}
              className="text-red-700 hover:text-red-900"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// SECTION 3: ORPHANED FUNDS
// ============================================

interface OrphanedFundsSectionProps {
  contests: OrphanedFundsContest[];
  isLoading: boolean;
  error: string | null;
  totalAffectedUsers: number;
  totalStrandedCents: number;
  onRefund?: (contestId: string) => void;
}

function OrphanedFundsSection({
  contests,
  isLoading,
  error,
  totalAffectedUsers,
  totalStrandedCents,
  onRefund,
}: OrphanedFundsSectionProps) {
  const [expandedContestId, setExpandedContestId] = useState<string | null>(null);
  const [affectedUsers, setAffectedUsers] = useState<AffectedUser[]>([]);
  const [loadingAffected, setLoadingAffected] = useState(false);
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [refundingContestId, setRefundingContestId] = useState<string | null>(null);
  const [refundingContestName, setRefundingContestName] = useState('');

  const handleExpandContest = async (contestId: string) => {
    if (expandedContestId === contestId) {
      setExpandedContestId(null);
      return;
    }

    try {
      setLoadingAffected(true);
      const data = await getContestAffectedUsers(contestId);
      setAffectedUsers(data.affected_users);
      setExpandedContestId(contestId);
    } catch (err) {
      console.error('Failed to load affected users:', err);
    } finally {
      setLoadingAffected(false);
    }
  };

  const handleOpenRefundModal = (contestId: string, contestName: string) => {
    setRefundingContestId(contestId);
    setRefundingContestName(contestName);
    setRefundModalOpen(true);
  };

  const handleConfirmRefund = async (reason: string) => {
    if (!refundingContestId) return;

    try {
      await refundContest(refundingContestId, reason);
      alert('Refund executed successfully');
      // Reload the orphaned funds data
      onRefund?.(refundingContestId);
    } catch (err) {
      alert(`Refund failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <h2 className="text-lg font-medium text-gray-900">
          Orphaned Funds ({contests.length} contests with stranded funds)
        </h2>
      </div>

      {isLoading ? (
        <div className="px-4 py-8 text-center text-gray-600">Loading orphaned funds...</div>
      ) : error ? (
        <div className="px-4 py-8 text-center text-red-600">{error}</div>
      ) : contests.length === 0 ? (
        <div className="px-4 py-8 text-center text-gray-600">No orphaned funds detected.</div>
      ) : (
        <div className="space-y-4 px-4 py-5">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <dt className="text-xs font-semibold text-gray-600 uppercase">Affected Users</dt>
              <dd className="mt-1 text-2xl font-semibold text-gray-900">{totalAffectedUsers}</dd>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <dt className="text-xs font-semibold text-gray-600 uppercase">Total Stranded</dt>
              <dd className="mt-1 text-2xl font-semibold text-red-700">{formatCurrency(totalStrandedCents)}</dd>
            </div>
          </div>

          {/* Contests Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-700 w-8"></th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">Contest Name</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">Status</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-700">Affected Users</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-700">Stranded Amount</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {contests.map((contest) => (
                  <tbody key={contest.contest_id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => handleExpandContest(contest.contest_id)}
                          className="text-indigo-600 hover:text-indigo-900"
                        >
                          {expandedContestId === contest.contest_id ? '▼' : '▶'}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900">{contest.contest_name}</td>
                      <td className="px-3 py-2 text-gray-700">{contest.status}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{contest.affected_user_count}</td>
                      <td className="px-3 py-2 text-right font-medium text-red-700">
                        {formatCurrency(contest.total_stranded_cents)}
                      </td>
                      <td className="px-3 py-2"></td>
                    </tr>

                    {/* Expanded Affected Users & Actions */}
                    {expandedContestId === contest.contest_id && (
                      <tr className="bg-gray-50">
                        <td colSpan={6} className="px-4 py-4">
                          {loadingAffected ? (
                            <div className="text-sm text-gray-600">Loading affected users...</div>
                          ) : (
                            <div className="space-y-4">
                              {/* Affected Users Table */}
                              {affectedUsers.length > 0 && (
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Affected Users</h4>
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="bg-white border-b">
                                        <th className="text-left px-2 py-1 font-medium text-gray-700">User</th>
                                        <th className="text-left px-2 py-1 font-medium text-gray-700">Email</th>
                                        <th className="text-right px-2 py-1 font-medium text-gray-700">Stranded Amount</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                      {affectedUsers.map((user) => (
                                        <tr key={user.user_id} className="hover:bg-white">
                                          <td className="px-2 py-1 text-gray-900">{user.username || user.user_id}</td>
                                          <td className="px-2 py-1 text-gray-700">{user.email || '—'}</td>
                                          <td className="px-2 py-1 text-right font-medium text-gray-900">
                                            {formatCurrency(user.stranded_cents)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {/* Case Notes Panel */}
                              <div className="border-t border-gray-200 pt-3">
                                <h4 className="text-sm font-semibold text-gray-900 mb-2">Case Notes</h4>
                                <CaseNotesPanel
                                  issueType="STRANDED_FUNDS"
                                  issueContestId={contest.contest_id}
                                />
                              </div>

                              {/* Action Buttons */}
                              <div className="border-t border-gray-200 pt-3 flex gap-2">
                                <button
                                  onClick={() => handleOpenRefundModal(contest.contest_id, contest.contest_name)}
                                  className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700"
                                >
                                  Refund Users
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Refund Modal */}
      <RefundModal
        isOpen={refundModalOpen}
        contestName={refundingContestName}
        affectedUsers={affectedUsers}
        onConfirm={handleConfirmRefund}
        onClose={() => {
          setRefundModalOpen(false);
          setRefundingContestId(null);
          setRefundingContestName('');
        }}
      />
    </div>
  );
}

// ============================================
// MAIN FUNDING PAGE
// ============================================

export function Funding() {
  const queryClient = useQueryClient();

  // Financial Health
  const { data: healthData, isLoading: healthLoading, refetch: refetchHealth, isFetching: healthFetching } = useQuery({
    queryKey: ['admin', 'financial-health'],
    queryFn: getFinancialHealth,
    refetchInterval: 60000,
  });

  // Reconciliation History
  const { data: historyData } = useQuery({
    queryKey: ['admin', 'financial-reconciliation-history'],
    queryFn: () => getFinancialReconciliationHistory(30),
    refetchInterval: 300000,
  });

  // Negative Pool Contests
  const { data: poolsData, isLoading: poolsLoading, error: poolsError } = useQuery({
    queryKey: ['contestPools', 'negative'],
    queryFn: getNegativePoolContests,
    staleTime: Infinity,
  });

  // Orphaned Funds
  const [orphanedContests, setOrphanedContests] = useState<OrphanedFundsContest[]>([]);
  const [totalAffectedUsers, setTotalAffectedUsers] = useState(0);
  const [totalStrandedCents, setTotalStrandedCents] = useState(0);
  const [orphanedLoading, setOrphanedLoading] = useState(true);
  const [orphanedError, setOrphanedError] = useState<string | null>(null);

  // Load orphaned funds on mount
  const loadOrphanedFunds = async () => {
    try {
      setOrphanedLoading(true);
      setOrphanedError(null);
      const result = await getOrphanedFundsSummary();
      setOrphanedContests(result.contests_with_stranded_funds);
      setTotalAffectedUsers(result.total_affected_users);
      setTotalStrandedCents(result.total_stranded_cents);
    } catch (err) {
      setOrphanedError(err instanceof Error ? err.message : 'Failed to load orphaned funds');
    } finally {
      setOrphanedLoading(false);
    }
  };

  // Load on component mount
  React.useEffect(() => {
    loadOrphanedFunds();
  }, []);

  // Determine health status
  const getHealthStatus = (data: FinancialHealthResponse): 'healthy' | 'warning' | 'critical' => {
    const ledgerBalanced = data.ledger.balanced;
    const liquidityGood = data.liquidity_ratio >= 1.05;

    if (!ledgerBalanced || data.liquidity_ratio < 1.0) {
      return 'critical';
    }
    if (!liquidityGood) {
      return 'warning';
    }
    return 'healthy';
  };

  const healthStatus = healthData ? getHealthStatus(healthData) : 'critical';

  // Handle refunds
  const handleRefund = async (contestId: string) => {
    const reason = prompt('Enter reason for refund:');
    if (!reason) return;

    try {
      await refundContest(contestId, reason);
      alert('Refund executed successfully');
      loadOrphanedFunds();
    } catch (err) {
      alert(`Refund failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  // Handle refresh all
  const handleRefreshAll = async () => {
    await Promise.all([refetchHealth(), loadOrphanedFunds()]);
  };

  // Handle repair completion (refresh both pools and financial data)
  const handleRepairComplete = async () => {
    // Invalidate negative pools query to trigger refetch
    await queryClient.invalidateQueries({ queryKey: ['contestPools', 'negative'] });
    // Refresh financial health data
    await refetchHealth();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Funding</h1>
        <p className="mt-1 text-sm text-gray-600">
          Complete financial operations, anomalies, and reconciliation view
        </p>
      </div>

      {/* Section 1: Financial Summary */}
      <FinancialSummary
        data={healthData}
        isLoading={healthLoading}
        healthStatus={healthStatus}
        onRefresh={handleRefreshAll}
        isFetching={healthFetching}
      />

      {/* Section 2: Anomalies (Negative Pools) */}
      <AnomaliesSection
        contests={poolsData?.contests || []}
        isLoading={poolsLoading}
        error={poolsError}
        totalCount={poolsData?.total_count || 0}
        breakdown={poolsData?.root_cause_breakdown || {
          PAYOUTS_EXCEED_ENTRIES: 0,
          NO_ENTRIES_WITH_PAYOUTS: 0,
          REFUNDED_ENTRIES_WITH_PAYOUTS: 0,
          MIXED: 0,
        }}
        onRepairComplete={handleRepairComplete}
      />

      {/* Section 3: Orphaned Funds */}
      <OrphanedFundsSection
        contests={orphanedContests}
        isLoading={orphanedLoading}
        error={orphanedError}
        totalAffectedUsers={totalAffectedUsers}
        totalStrandedCents={totalStrandedCents}
        onRefund={handleRefund}
      />

      {/* Section 4: Reconciliation History */}
      {historyData && historyData.records && historyData.records.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h2 className="text-lg font-medium text-gray-900">Reconciliation History</h2>
            <p className="text-sm text-gray-500">Last 30 days of financial reconciliation records</p>
          </div>
          <div className="overflow-x-auto px-4 py-5">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">Date</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">Status</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-700">Difference</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {historyData.records.map((record: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-900">
                      {new Date(record.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        status={record.status === 'HEALTHY' ? 'healthy' : record.status === 'WARNING' ? 'warning' : 'critical'}
                        label={record.status}
                      />
                    </td>
                    <td className={`px-3 py-2 text-right font-medium ${record.difference === 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {formatCurrency(record.difference)}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{record.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
