/**
 * Compliance Overview Panel
 *
 * Read-only panel for admin compliance visibility.
 * Composes existing diagnostics API - no new endpoints.
 *
 * SOLID Alignment:
 * - Single Responsibility: Operational visibility only (not detailed inspection)
 * - Open/Closed: Composes existing diagnostics capabilities, doesn't extend them
 * - No Duplication: Reuses existing getUserStats() from diagnostics.ts
 */

import { useQuery } from '@tanstack/react-query';
import { getUserStats } from '../api/diagnostics';
import type { UserStatsResponse } from '../types';

// ============================================
// STAT CARD COMPONENT
// ============================================

interface StatCardProps {
  label: string;
  value: string;
  total?: string;
  highlight?: 'success' | 'warning' | 'neutral';
}

function StatCard({ label, value, total, highlight = 'neutral' }: StatCardProps) {
  const highlightColors = {
    success: 'text-green-700',
    warning: 'text-amber-700',
    neutral: 'text-gray-900',
  };

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-lg font-semibold ${highlightColors[highlight]}`}>
        {value}
        {total && <span className="text-sm font-normal text-gray-500"> / {total}</span>}
      </div>
    </div>
  );
}

// ============================================
// COMPLIANCE SUMMARY COMPONENT
// ============================================

interface ComplianceSummaryProps {
  stats: UserStatsResponse | undefined;
  isLoading: boolean;
  error: Error | null;
}

function ComplianceSummary({ stats, isLoading, error }: ComplianceSummaryProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="animate-pulse space-y-2">
              <div className="h-3 bg-gray-200 rounded w-16"></div>
              <div className="h-6 bg-gray-200 rounded w-12"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">Failed to load compliance data</p>
      </div>
    );
  }

  if (!stats) return null;

  const { stats: s } = stats;
  const ageVerified = parseInt(s.age_verified_users, 10);
  const tosAccepted = parseInt(s.tos_accepted_users, 10);
  const paidUsers = parseInt(s.paid_users, 10);

  // Determine highlight based on compliance gaps
  const ageVerifiedHighlight = ageVerified === paidUsers ? 'success' : 'warning';
  const tosAcceptedHighlight = tosAccepted === paidUsers ? 'success' : 'warning';

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        label="Total Users"
        value={s.total_users}
        highlight="neutral"
      />
      <StatCard
        label="Paid Users"
        value={s.paid_users}
        total={s.total_users}
        highlight="neutral"
      />
      <StatCard
        label="Age Verified"
        value={s.age_verified_users}
        total={s.paid_users}
        highlight={ageVerifiedHighlight}
      />
      <StatCard
        label="TOS Accepted"
        value={s.tos_accepted_users}
        total={s.paid_users}
        highlight={tosAcceptedHighlight}
      />
    </div>
  );
}

// ============================================
// MAIN COMPLIANCE OVERVIEW PANEL
// ============================================

export function ComplianceOverviewPanel() {
  const statsQuery = useQuery({
    queryKey: ['admin', 'userStats'],
    queryFn: getUserStats,
    refetchInterval: 30000,
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900">Compliance Overview</h2>
            <p className="text-sm text-gray-500">
              {statsQuery.data?.timestamp
                ? `Last updated: ${new Date(statsQuery.data.timestamp).toLocaleString()}`
                : 'User compliance summary'}
            </p>
          </div>
          <button
            onClick={() => statsQuery.refetch()}
            disabled={statsQuery.isFetching}
            className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            {statsQuery.isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>
      <div className="p-4">
        <ComplianceSummary
          stats={statsQuery.data}
          isLoading={statsQuery.isLoading}
          error={statsQuery.error}
        />
      </div>
    </div>
  );
}
