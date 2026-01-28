/**
 * Week Verification Panel
 *
 * Read-only panel for at-a-glance week verification visibility.
 * Composes existing admin API - no new endpoints.
 *
 * SOLID Alignment:
 * - Single Responsibility: Operational visibility only (not post-transition verification)
 * - Open/Closed: Composes existing admin API capabilities, doesn't extend them
 * - No Duplication: Reuses existing verifyLockStatus(), getWeekVerificationStatus()
 *
 * Boundary Note:
 * - This panel = passive operational awareness (auto-refresh)
 * - Admin.tsx inline = manual post-action confirmation (button-triggered)
 */

import { useQuery } from '@tanstack/react-query';
import {
  verifyLockStatus,
  getIncompleteLineups,
  getWeekVerificationStatus,
  type LockVerificationResponse,
  type VerificationStatus,
} from '../api/admin';

// ============================================
// STATUS BADGE COMPONENT
// ============================================

function StatusBadge({ status, label }: { status: 'ok' | 'warning' | 'error'; label: string }) {
  const colors = {
    ok: 'bg-green-100 text-green-800',
    warning: 'bg-amber-100 text-amber-800',
    error: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status]}`}>
      {label}
    </span>
  );
}

// ============================================
// LOCK STATUS CARD
// ============================================

interface LockStatusCardProps {
  lockData: LockVerificationResponse | undefined;
  isLoading: boolean;
  error: Error | null;
}

function LockStatusCard({ lockData, isLoading, error }: LockStatusCardProps) {
  if (isLoading) {
    return (
      <div className="rounded-md border border-gray-200 p-3">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-gray-200 rounded w-24"></div>
          <div className="h-5 bg-gray-200 rounded w-32"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3">
        <p className="text-sm text-red-600">Failed to verify lock status</p>
      </div>
    );
  }

  if (!lockData) return null;

  const { verification } = lockData;
  const lockStatus = verification.isLocked ? 'ok' : 'warning';
  const lockLabel = verification.isLocked ? 'Locked' : 'Unlocked';

  return (
    <div className={`rounded-md border p-3 ${
      verification.isLocked ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'
    }`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-500 mb-1">Lock Status</div>
          <div className="flex items-center gap-2">
            <StatusBadge status={lockStatus} label={lockLabel} />
            <span className="text-sm text-gray-700">
              Playoff Week {verification.currentPlayoffWeek}
              {verification.effectiveNflWeek && ` / NFL Week ${verification.effectiveNflWeek}`}
            </span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-gray-600">{verification.message}</p>
    </div>
  );
}

// ============================================
// VERIFICATION STATUS CARD
// ============================================

interface VerificationStatusCardProps {
  verification: VerificationStatus | undefined;
  weekNumber: number | null;
  isLoading: boolean;
  error: Error | null;
}

function VerificationStatusCard({ verification, weekNumber, isLoading, error }: VerificationStatusCardProps) {
  if (isLoading) {
    return (
      <div className="rounded-md border border-gray-200 p-3">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-gray-200 rounded w-32"></div>
          <div className="h-4 bg-gray-200 rounded w-48"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3">
        <p className="text-sm text-red-600">Failed to load verification status</p>
      </div>
    );
  }

  if (!verification || weekNumber === null) return null;

  const hasAnomalies = verification.anomalies.length > 0;
  const verificationStatus = hasAnomalies ? 'warning' : 'ok';
  const verificationLabel = hasAnomalies ? 'Warnings' : 'Clean';

  return (
    <div className={`rounded-md border p-3 ${
      hasAnomalies ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-gray-500">Week {weekNumber} Verification</div>
        <StatusBadge status={verificationStatus} label={verificationLabel} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <span className="text-gray-500">Picks:</span>
          <span className="ml-1 font-medium">
            {verification.pickCount === -1 ? '—' : verification.pickCount}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Scores:</span>
          <span className={`ml-1 font-medium ${verification.scoreCount > 0 ? 'text-amber-700' : ''}`}>
            {verification.scoreCount === -1 ? '—' : verification.scoreCount}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Multipliers:</span>
          <span className="ml-1 font-medium text-xs">
            {Object.keys(verification.multiplierDistribution).length === 0
              ? '—'
              : Object.entries(verification.multiplierDistribution)
                  .map(([k, v]) => `${k}:${v}`)
                  .join(', ')}
          </span>
        </div>
      </div>
      {hasAnomalies && (
        <div className="mt-2 text-xs text-amber-700">
          {verification.anomalies.map((a, i) => (
            <div key={i}>{a}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// MAIN WEEK VERIFICATION PANEL
// ============================================

export function WeekVerificationPanel() {
  // Fetch weekNumber from admin API as source of truth
  const lineupsQuery = useQuery({
    queryKey: ['incompleteLineups'],
    queryFn: getIncompleteLineups,
    refetchInterval: 30000,
  });

  // Use weekNumber from API as source of truth
  const currentNflWeek = lineupsQuery.data?.weekNumber ?? null;

  // Fetch lock verification status (auto-refresh for passive awareness)
  const lockQuery = useQuery({
    queryKey: ['admin', 'lockVerification'],
    queryFn: verifyLockStatus,
    refetchInterval: 30000,
  });

  // Fetch week verification status for current week
  const verificationQuery = useQuery({
    queryKey: ['admin', 'weekVerification', currentNflWeek],
    queryFn: () => currentNflWeek ? getWeekVerificationStatus(currentNflWeek) : Promise.reject('No week'),
    enabled: currentNflWeek !== null,
    refetchInterval: 30000,
  });

  const isAnyFetching = lockQuery.isFetching || verificationQuery.isFetching || lineupsQuery.isFetching;

  const handleRefresh = () => {
    lineupsQuery.refetch();
    lockQuery.refetch();
    if (currentNflWeek !== null) {
      verificationQuery.refetch();
    }
  };

  // Determine last checked timestamp
  const lastChecked = lockQuery.data?.verification?.lastUpdated;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900">Week Verification</h2>
            <p className="text-sm text-gray-500">
              {lastChecked
                ? `Last verified: ${new Date(lastChecked).toLocaleString()}`
                : 'At-a-glance week status'}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isAnyFetching}
            className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            {isAnyFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <LockStatusCard
          lockData={lockQuery.data}
          isLoading={lockQuery.isLoading}
          error={lockQuery.error}
        />
        <VerificationStatusCard
          verification={verificationQuery.data}
          weekNumber={currentNflWeek}
          isLoading={verificationQuery.isLoading}
          error={verificationQuery.error}
        />
      </div>
    </div>
  );
}
