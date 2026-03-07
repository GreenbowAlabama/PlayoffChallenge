/**
 * Contest Pool Diagnostics Page
 *
 * Displays contests with negative pool balances and classifies root causes.
 * Section 21 Compliance: Plain language explanations, help section, and action paths included.
 *
 * - Summary stats: total negative contests and total deficit
 * - Root cause breakdown with stat cards
 * - Expandable table showing detailed ledger breakdown
 * - Help/Legend section with plain English explanations
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  NegativePoolContest,
  RootCauseBreakdown,
} from '../api/contest-pools';
import {
  getNegativePoolContests,
  getContestPoolDetails,
} from '../api/contest-pools';

// Root cause colors, labels, and plain English explanations (Section 21)
const ROOT_CAUSE_CONFIG: Record<string, {
  label: string;
  shortLabel: string;
  explanation: string;
  impact: string;
  color: string;
  bgColor: string;
}> = {
  PAYOUTS_EXCEED_ENTRIES: {
    label: 'Prize payouts exceed entry fees collected',
    shortLabel: 'Payouts > Entries',
    explanation: 'The total amount paid out to winners is more than the total entry fees collected from all participants.',
    impact: 'Platform is carrying a financial loss on this contest.',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
  },
  NO_ENTRIES_WITH_PAYOUTS: {
    label: 'Payouts issued with no entries',
    shortLabel: 'No Entries',
    explanation: 'Prize payouts were issued but no one (or very few) actually joined this contest.',
    impact: 'Prize money was paid from contest with minimal or zero revenue.',
    color: 'text-orange-700',
    bgColor: 'bg-orange-100',
  },
  REFUNDED_ENTRIES_WITH_PAYOUTS: {
    label: 'Entry refunds issued but payouts remain',
    shortLabel: 'Refunded + Payouts',
    explanation: 'Some entry fees were refunded to participants, but prize payouts were still issued (reducing the net entry fee available to cover payouts).',
    impact: 'Net available entry fees reduced while payouts remained fixed, creating a deficit.',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-100',
  },
  MIXED: {
    label: 'Multiple financial issues',
    shortLabel: 'Mixed',
    explanation: 'This contest has a combination of the above issues (high payouts, refunds, and low entries).',
    impact: 'Complex financial situation requiring manual review.',
    color: 'text-purple-700',
    bgColor: 'bg-purple-100',
  },
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString();
}

function RootCauseBadge({ cause, showTooltip = false }: { cause: string; showTooltip?: boolean }) {
  const config = ROOT_CAUSE_CONFIG[cause] || {
    shortLabel: cause,
    label: cause,
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
  };
  return (
    <div className={showTooltip ? 'relative group' : ''}>
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bgColor} ${config.color} cursor-help`}
        title={config.label}
      >
        {config.shortLabel}
      </span>
      {showTooltip && (
        <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
          {config.label}
        </div>
      )}
    </div>
  );
}

function ContestDetailRow({ contest }: { contest: NegativePoolContest }) {
  const [expanded, setExpanded] = useState(false);
  const {
    data: details,
    isLoading: detailsLoading,
    error: detailsError,
  } = useQuery({
    queryKey: ['contestPoolDetails', contest.contest_id],
    queryFn: () => getContestPoolDetails(contest.contest_id),
    enabled: expanded, // Only fetch when expanded
  });

  return (
    <>
      <tr className="border-t border-gray-200 hover:bg-gray-50">
        <td className="whitespace-nowrap px-4 py-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-indigo-600 hover:text-indigo-900 font-medium"
          >
            {expanded ? '▼' : '▶'}
          </button>
        </td>
        <td className="px-4 py-3 text-sm font-medium text-gray-900">{contest.contest_name}</td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{contest.status}</td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{formatDate(contest.created_at)}</td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{contest.participant_count}</td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
          {formatCents(contest.entry_fee_debits_cents)}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
          {formatCents(contest.entry_fee_refunds_cents)}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
          {formatCents(contest.prize_payout_cents)}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-red-700">
          {formatCents(contest.pool_balance_cents)}
        </td>
        <td className="whitespace-nowrap px-4 py-3">
          <RootCauseBadge cause={contest.root_cause} />
        </td>
      </tr>

      {/* Detail Row */}
      {expanded && (
        <tr className="bg-gray-50 border-t border-gray-200">
          <td colSpan={10} className="px-4 py-4">
            {detailsLoading ? (
              <div className="text-sm text-gray-600">Loading details...</div>
            ) : detailsError ? (
              <div className="text-sm text-red-600">Failed to load details</div>
            ) : details ? (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Ledger Breakdown</h4>
                  <table className="w-full text-sm">
                    <thead className="bg-white">
                      <tr>
                        <th className="text-left px-2 py-2 font-medium text-gray-700">Entry Type</th>
                        <th className="text-left px-2 py-2 font-medium text-gray-700">Direction</th>
                        <th className="text-right px-2 py-2 font-medium text-gray-700">Count</th>
                        <th className="text-right px-2 py-2 font-medium text-gray-700">Total</th>
                        <th className="text-left px-2 py-2 font-medium text-gray-700">Date Range</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {details.ledger_breakdown.map((entry, idx) => (
                        <tr key={idx} className="hover:bg-white">
                          <td className="px-2 py-2 text-gray-900">{entry.entry_type}</td>
                          <td className="px-2 py-2">
                            <span className={entry.direction === 'CREDIT' ? 'text-green-700' : 'text-red-700'}>
                              {entry.direction}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right text-gray-700">{entry.transaction_count}</td>
                          <td className="px-2 py-2 text-right text-gray-900 font-medium">
                            {formatCents(entry.total_amount_cents)}
                          </td>
                          <td className="px-2 py-2 text-gray-600 text-xs">
                            {new Date(entry.first_transaction_at).toLocaleDateString()} to{' '}
                            {new Date(entry.last_transaction_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </td>
        </tr>
      )}
    </>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-5 shadow-sm">
      <dt className="text-sm font-medium text-gray-600">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold ${color}`}>{value}</dd>
    </div>
  );
}

export function ContestPoolDiagnostics() {
  const {
    data: response,
    isLoading,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['contestPools', 'negative'],
    queryFn: getNegativePoolContests,
    staleTime: Infinity,
  });

  const handleRefresh = () => {
    refetch();
  };

  const contests = response?.contests || [];
  const totalCount = response?.total_count || 0;
  const totalNegativeCents = response?.total_negative_cents || 0;
  const breakdown: RootCauseBreakdown = response?.root_cause_breakdown || {
    PAYOUTS_EXCEED_ENTRIES: 0,
    NO_ENTRIES_WITH_PAYOUTS: 0,
    REFUNDED_ENTRIES_WITH_PAYOUTS: 0,
    MIXED: 0,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Contest Pool Analysis</h1>
          <p className="mt-1 text-sm text-gray-500">Identify contests with negative pool balances</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isFetching}
          className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
        >
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Summary Panel */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Summary</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 px-4 py-5">
          <div>
            <dt className="text-sm font-medium text-gray-600">Total Contests with Negative Pools</dt>
            <dd className="mt-1 text-3xl font-semibold text-gray-900">{totalCount}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-600">Total Negative Amount</dt>
            <dd className="mt-1 text-3xl font-semibold text-red-700">{formatCents(totalNegativeCents)}</dd>
          </div>
        </div>
      </div>

      {/* Root Cause Breakdown */}
      <div>
        <h2 className="text-lg font-medium text-gray-900 mb-4">Root Cause Breakdown</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard
            label="Payouts Exceed Entries"
            value={breakdown.PAYOUTS_EXCEED_ENTRIES || 0}
            color="text-red-700"
          />
          <StatCard
            label="No Entries With Payouts"
            value={breakdown.NO_ENTRIES_WITH_PAYOUTS || 0}
            color="text-orange-700"
          />
          <StatCard
            label="Refunded Entries With Payouts"
            value={breakdown.REFUNDED_ENTRIES_WITH_PAYOUTS || 0}
            color="text-yellow-700"
          />
          <StatCard label="Mixed" value={breakdown.MIXED || 0} color="text-purple-700" />
        </div>
      </div>

      {/* Contests Table */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Contests with Negative Pools</h2>
        </div>

        {isLoading ? (
          <div className="px-4 py-8 text-center text-gray-600">Loading...</div>
        ) : error ? (
          <div className="px-4 py-8 text-center text-red-600">Error loading contests</div>
        ) : contests.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-600">No contests with negative pools</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700"></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Contest Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Created</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 whitespace-nowrap">
                    <span title="Number of people who joined">Participants</span>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 whitespace-nowrap">
                    <span title="Total entry fees debited from participants">Fees Collected</span>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 whitespace-nowrap">
                    <span title="Entry fees returned to participants">Refunds Issued</span>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 whitespace-nowrap">
                    <span title="Total prizes paid to winners">Prizes Paid</span>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-red-700 whitespace-nowrap">
                    <span title="Fees Collected - Refunds - Prizes Paid">Pool Deficit</span>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">What Went Wrong?</th>
                </tr>
              </thead>
              <tbody>
                {contests.map((contest) => (
                  <ContestDetailRow key={contest.contest_id} contest={contest} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Help/Legend Section (Section 21 Compliance) */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">❓ Help & Information</h2>
        </div>
        <div className="divide-y divide-gray-200 px-4 py-5">
          {/* Why is the pool negative? */}
          <div className="pb-5 mb-5">
            <h3 className="font-semibold text-gray-900 mb-2">Why is the pool negative?</h3>
            <p className="text-sm text-gray-600">
              A contest has a negative pool balance when the total amount paid out in prizes exceeds the total
              amount collected in entry fees. This creates a financial deficit that the platform absorbs.
            </p>
          </div>

          {/* Root cause explanations */}
          <div className="pb-5 mb-5">
            <h3 className="font-semibold text-gray-900 mb-3">What does each "What Went Wrong?" category mean?</h3>
            <div className="space-y-3">
              {Object.entries(ROOT_CAUSE_CONFIG).map(([key, config]) => (
                <div key={key} className="border-l-4 pl-3" style={{ borderColor: config.color.replace('text-', 'from-').split('-')[1] ? '#' : '#ef4444' }}>
                  <div className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium mb-1 ${config.bgColor} ${config.color}`}>
                    {config.shortLabel}
                  </div>
                  <p className="text-sm text-gray-700 font-medium mt-1">{config.label}</p>
                  <p className="text-sm text-gray-600 mt-1">{config.explanation}</p>
                  <p className="text-sm text-red-700 font-medium mt-1">Impact: {config.impact}</p>
                </div>
              ))}
            </div>
          </div>

          {/* What to do */}
          <div className="pb-5">
            <h3 className="font-semibold text-gray-900 mb-2">What should I do?</h3>
            <div className="bg-blue-50 border border-blue-200 rounded p-3 space-y-2">
              <p className="text-sm text-gray-700">
                <strong>If numbers look suspicious:</strong> Verify the ledger breakdown by clicking the expand button on any contest.
                You'll see all entry fees, refunds, and payouts recorded.
              </p>
              <p className="text-sm text-gray-700">
                <strong>If there's a real deficit:</strong> This indicates a potential issue with contest setup or settlement.
                Contact engineering with the contest ID and root cause category for investigation.
              </p>
              <p className="text-sm text-gray-700">
                <strong>Common causes:</strong>
              </p>
              <ul className="text-sm text-gray-700 list-disc list-inside ml-2">
                <li>Payout structure was set higher than expected entry volume</li>
                <li>Entries were refunded but prizes were still paid</li>
                <li>Settlement ran before all entries were collected</li>
              </ul>
            </div>
          </div>

          {/* Escalation Path */}
          <div className="pt-5">
            <h3 className="font-semibold text-gray-900 mb-2">Need help?</h3>
            <p className="text-sm text-gray-600 mb-3">
              If you find a contest with an unexpected negative balance:
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded p-3">
              <p className="text-sm font-medium text-amber-900">⚠️ Escalation Path:</p>
              <ol className="text-sm text-gray-700 mt-2 list-decimal list-inside space-y-1">
                <li>Click expand on the contest to see the ledger breakdown</li>
                <li>Verify entry counts, refunds, and payouts match expectations</li>
                <li>Contact engineering with:
                  <ul className="ml-6 mt-1 text-xs text-gray-600 space-y-1">
                    <li>• Contest ID and name</li>
                    <li>• Root cause category (from "What Went Wrong?")</li>
                    <li>• Screenshot of ledger breakdown</li>
                    <li>• Deficit amount</li>
                  </ul>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
