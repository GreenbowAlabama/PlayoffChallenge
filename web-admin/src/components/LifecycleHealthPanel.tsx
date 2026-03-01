/**
 * Lifecycle Health Panel
 *
 * Read-only monitoring of contest lifecycle state health.
 * Tracks anomalies in automatic lifecycle transitions.
 *
 * Displays:
 * - Scheduled contests past lock time (should transition to LOCKED)
 * - Locked contests past tournament start (should transition to LIVE)
 * - Live contests past end time (should transition to COMPLETE)
 * - Complete contests without settlement records
 * - Settlement failures
 * - Last reconciler run timestamp
 * - Transition count from last run
 *
 * No mutations. No auto-remediation. Visibility only.
 */

import { useQuery } from '@tanstack/react-query';
import { getLifecycleHealth } from '../api/diagnostics';
import type { LifecycleHealthResponse } from '../types';

// ============================================
// STATUS INDICATOR COMPONENT
// ============================================

interface StatusIndicatorProps {
  hasIssues: boolean;
}

function StatusIndicator({ hasIssues }: StatusIndicatorProps) {
  return (
    <div
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
        hasIssues
          ? 'bg-red-100 text-red-800'
          : 'bg-green-100 text-green-800'
      }`}
    >
      {hasIssues ? '⚠ Issues Detected' : '✓ Healthy'}
    </div>
  );
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  const date = new Date(ts);
  return date.toLocaleString();
}

// ============================================
// LIFECYCLE HEALTH PANEL
// ============================================

interface LifecycleHealthPanelProps {
  onRefetch?: () => void;
  isFetching?: boolean;
}

export function LifecycleHealthPanel({ onRefetch, isFetching = false }: LifecycleHealthPanelProps) {
  const {
    data: health,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['diagnostics', 'lifecycleHealth'],
    queryFn: getLifecycleHealth,
    staleTime: Infinity, // No auto-refresh
  });

  // Determine if there are issues
  const hasIssues = health && (
    health.scheduledPastLock > 0 ||
    health.lockedPastStart > 0 ||
    health.livePastEnd > 0 ||
    health.completeWithoutSettlement > 0 ||
    (health.settlementFailures ?? 0) > 0
  );

  const handleRefresh = () => {
    refetch();
    onRefetch?.();
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900">Lifecycle Health</h2>
            <p className="text-sm text-gray-500">Contest state transition monitoring</p>
          </div>
          {health && <StatusIndicator hasIssues={!!hasIssues} />}
        </div>
      </div>

      <div className="p-4">
        {isLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-200 rounded w-1/3"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-4 bg-gray-200 rounded w-2/5"></div>
          </div>
        ) : error ? (
          <p className="text-red-600 text-sm">Failed to load lifecycle health</p>
        ) : health ? (
          <div className="space-y-4">
            {/* State Transition Anomalies Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div
                className={`rounded-md border p-3 ${
                  health.scheduledPastLock > 0
                    ? 'border-red-200 bg-red-50'
                    : 'border-gray-200 bg-gray-50'
                }`}
              >
                <dt className="text-xs font-medium text-gray-600">Scheduled Past Lock</dt>
                <dd
                  className={`mt-1 text-2xl font-semibold ${
                    health.scheduledPastLock > 0 ? 'text-red-600' : 'text-gray-900'
                  }`}
                >
                  {health.scheduledPastLock}
                </dd>
              </div>

              <div
                className={`rounded-md border p-3 ${
                  health.lockedPastStart > 0
                    ? 'border-red-200 bg-red-50'
                    : 'border-gray-200 bg-gray-50'
                }`}
              >
                <dt className="text-xs font-medium text-gray-600">Locked Past Start</dt>
                <dd
                  className={`mt-1 text-2xl font-semibold ${
                    health.lockedPastStart > 0 ? 'text-red-600' : 'text-gray-900'
                  }`}
                >
                  {health.lockedPastStart}
                </dd>
              </div>

              <div
                className={`rounded-md border p-3 ${
                  health.livePastEnd > 0
                    ? 'border-red-200 bg-red-50'
                    : 'border-gray-200 bg-gray-50'
                }`}
              >
                <dt className="text-xs font-medium text-gray-600">Live Past End</dt>
                <dd
                  className={`mt-1 text-2xl font-semibold ${
                    health.livePastEnd > 0 ? 'text-red-600' : 'text-gray-900'
                  }`}
                >
                  {health.livePastEnd}
                </dd>
              </div>

              <div
                className={`rounded-md border p-3 ${
                  health.completeWithoutSettlement > 0
                    ? 'border-red-200 bg-red-50'
                    : 'border-gray-200 bg-gray-50'
                }`}
              >
                <dt className="text-xs font-medium text-gray-600">Complete Without Settlement</dt>
                <dd
                  className={`mt-1 text-2xl font-semibold ${
                    health.completeWithoutSettlement > 0 ? 'text-red-600' : 'text-gray-900'
                  }`}
                >
                  {health.completeWithoutSettlement}
                </dd>
              </div>

              <div
                className={`rounded-md border p-3 ${
                  (health.settlementFailures ?? 0) > 0
                    ? 'border-red-200 bg-red-50'
                    : 'border-gray-200 bg-gray-50'
                }`}
              >
                <dt className="text-xs font-medium text-gray-600">Settlement Failures</dt>
                <dd
                  className={`mt-1 text-2xl font-semibold ${
                    (health.settlementFailures ?? 0) > 0 ? 'text-red-600' : 'text-gray-900'
                  }`}
                >
                  {health.settlementFailures === null ? 'N/A' : health.settlementFailures}
                </dd>
              </div>
            </div>

            {/* Reconciler Status */}
            <div className="border-t border-gray-200 pt-3">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs font-medium text-gray-600">Last Reconciler Run</dt>
                  <dd className="mt-1 text-gray-900 text-xs">
                    {formatTimestamp(health.lastReconcilerRun)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-600">Transitions Last Run</dt>
                  <dd className="mt-1 text-gray-900 text-xs">
                    {health.transitionsLastRun !== null ? health.transitionsLastRun : '—'}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        ) : null}

        {health && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-200">
            <p className="text-xs text-gray-400">
              Checked: {formatTimestamp(health.timestamp)}
            </p>
            <button
              onClick={handleRefresh}
              disabled={isFetching}
              className="inline-flex items-center rounded-md bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
            >
              {isFetching ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
