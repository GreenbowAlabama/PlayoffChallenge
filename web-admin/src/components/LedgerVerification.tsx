/**
 * Ledger Verification Component
 *
 * Displays overall ledger integrity check with breakdown by entry type.
 * Shows totals for debits, credits, and net balance.
 * Indicates whether the ledger is balanced or has variance.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LedgerVerificationResponse } from '../api/ledger-verification';
import { getLedgerVerification } from '../api/ledger-verification';

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function BalanceStatusBadge({ isBalanced }: { isBalanced: boolean }) {
  if (isBalanced) {
    return (
      <div className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium bg-green-100 text-green-700">
        ✓ BALANCED
      </div>
    );
  }
  return (
    <div className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium bg-red-100 text-red-700">
      ⚠️ MISMATCH
    </div>
  );
}

function EntryTypeTable({ data }: { data: LedgerVerificationResponse }) {
  const entries = Object.entries(data.by_entry_type || {}).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  if (entries.length === 0) {
    return <div className="text-sm text-gray-600">No ledger entries</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-gray-700">Entry Type</th>
            <th className="px-3 py-2 text-right font-medium text-gray-700">Credits</th>
            <th className="px-3 py-2 text-right font-medium text-gray-700">Debits</th>
            <th className="px-3 py-2 text-right font-medium text-gray-700">Net</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {entries.map(([entryType, breakdown]) => (
            <tr key={entryType} className="hover:bg-gray-50">
              <td className="px-3 py-2 font-medium text-gray-900">{entryType}</td>
              <td className="px-3 py-2 text-right text-green-700">
                {breakdown.credits > 0 ? `+${formatCents(breakdown.credits)}` : '—'}
              </td>
              <td className="px-3 py-2 text-right text-red-700">
                {breakdown.debits > 0 ? `−${formatCents(breakdown.debits)}` : '—'}
              </td>
              <td
                className={`px-3 py-2 text-right font-medium ${
                  breakdown.net >= 0 ? 'text-green-700' : 'text-red-700'
                }`}
              >
                {breakdown.net >= 0 ? '+' : '−'}
                {formatCents(Math.abs(breakdown.net))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LedgerVerification() {
  const [isExpanded, setIsExpanded] = useState(false);
  const {
    data: verification,
    isLoading,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['ledgerVerification'],
    queryFn: getLedgerVerification,
    staleTime: 60 * 1000, // 1 minute
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-medium text-gray-900">Ledger Integrity Check</h3>
          {!isLoading && verification && (
            <BalanceStatusBadge isBalanced={verification.is_balanced} />
          )}
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
        >
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Content */}
      <div className="px-4 py-5">
        {isLoading ? (
          <div className="text-center text-gray-600">Loading verification...</div>
        ) : error ? (
          <div className="text-center text-red-600">Failed to load verification</div>
        ) : !verification ? (
          <div className="text-center text-gray-600">No data</div>
        ) : (
          <>
            {/* Summary Panel */}
            <div className="mb-6 grid grid-cols-3 gap-4">
              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <dt className="text-xs font-medium text-gray-600 uppercase">Total Credits</dt>
                <dd className="mt-1 text-xl font-semibold text-green-700">
                  {formatCents(verification.total_credits)}
                </dd>
              </div>
              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <dt className="text-xs font-medium text-gray-600 uppercase">Total Debits</dt>
                <dd className="mt-1 text-xl font-semibold text-red-700">
                  {formatCents(verification.total_debits)}
                </dd>
              </div>
              <div
                className={`rounded border p-3 ${
                  verification.is_balanced
                    ? 'border-green-200 bg-green-50'
                    : 'border-red-200 bg-red-50'
                }`}
              >
                <dt className="text-xs font-medium text-gray-600 uppercase">Net Balance</dt>
                <dd
                  className={`mt-1 text-xl font-semibold ${
                    verification.net >= 0 ? 'text-green-700' : 'text-red-700'
                  }`}
                >
                  {verification.net >= 0 ? '+' : '−'}
                  {formatCents(Math.abs(verification.net))}
                </dd>
              </div>
            </div>

            {/* Details Section */}
            <div>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="mb-3 text-sm font-medium text-indigo-600 hover:text-indigo-900"
              >
                {isExpanded ? '▼' : '▶'} Breakdown by Entry Type ({Object.keys(verification.by_entry_type || {}).length} types)
              </button>

              {isExpanded && (
                <div className="rounded border border-gray-200 bg-gray-50 p-3">
                  <EntryTypeTable data={verification} />
                </div>
              )}
            </div>

            {/* Info Box */}
            <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-3">
              <p className="text-xs text-blue-900">
                <strong>What this means:</strong> The net balance should equal total credits minus total debits. If they don't
                match, there may be a ledger entry inconsistency requiring investigation.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
