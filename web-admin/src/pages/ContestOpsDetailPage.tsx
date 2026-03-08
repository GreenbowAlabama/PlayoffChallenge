/**
 * Contest Ops Detail Page
 *
 * Operational diagnostics for a specific contest.
 * Exposes signals for troubleshooting contest lifecycle issues:
 * - Tournament event attachment
 * - Active tournament config
 * - Contest instances for template
 * - Lock time alignment
 * - Lifecycle transitions
 * - Event snapshot health
 *
 * Renders panels in troubleshooting order:
 * 1. Contest Overview
 * 2. Integrity Warnings
 * 3. Tournament Config (attached to this contest)
 * 4. All Tournament Configs (event family)
 * 5. Template Contest Instances
 * 6. Lifecycle History
 * 7. Snapshot Health
 */

import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getContestOpsSnapshot, type ContestOpsSnapshot } from '../api/contest-ops';
import '../styles/ContestOpsDetail.css';

// Format currency
function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Format timestamp
function formatTimestamp(timestamp: string | null | undefined): string {
  if (!timestamp) return '—';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '—';
  }
}

// Format relative time
function formatRelativeTime(timestamp: string | null | undefined): string {
  if (!timestamp) return '—';
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  } catch {
    return '—';
  }
}

// Status badge
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    LIVE: 'bg-red-100 text-red-800',
    LOCKED: 'bg-amber-100 text-amber-800',
    COMPLETE: 'bg-green-100 text-green-800',
    SCHEDULED: 'bg-blue-100 text-blue-800',
    CANCELLED: 'bg-gray-100 text-gray-800',
    ERROR: 'bg-red-200 text-red-900',
    unknown: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`status-badge ${colors[status] || colors.unknown}`}>
      {status}
    </span>
  );
}

// Integrity warning alert
function IntegrityWarning({ children }: { children: React.ReactNode }) {
  return <div className="integrity-warning">{children}</div>;
}

// Panel wrapper
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-title">{title}</div>
      <div className="panel-content">{children}</div>
    </div>
  );
}

/**
 * Compute integrity checks from snapshot data.
 */
function computeIntegrityChecks(snapshot: ContestOpsSnapshot): string[] {
  const warnings: string[] = [];
  const serverTime = new Date(snapshot.server_time).getTime();

  // Check 1: No active tournament config
  const activeConfigs = snapshot.tournament_configs.filter((c) => c.is_active);
  if (activeConfigs.length === 0) {
    warnings.push('⚠️ No active tournament config');
  }

  // Check 2: More than one active config
  if (activeConfigs.length > 1) {
    warnings.push(`⚠️ Multiple active configs (${activeConfigs.length})`);
  }

  // Check 3: LIVE but no snapshots
  if (snapshot.contest.status === 'LIVE' && snapshot.snapshot_health.latest_snapshot === null) {
    warnings.push('⚠️ Contest LIVE but no event snapshots');
  }

  // Check 4: lock_time in past but status still SCHEDULED
  if (snapshot.contest.lock_time) {
    const lockTime = new Date(snapshot.contest.lock_time).getTime();
    if (lockTime < serverTime && snapshot.contest.status === 'SCHEDULED') {
      warnings.push('⚠️ Lock time passed but contest still SCHEDULED');
    }
  }

  return warnings;
}

/**
 * Get snapshot freshness status and color.
 */
function getSnapshotFreshnessStatus(
  latestSnapshot: string | null,
  serverTime: string
): { status: 'green' | 'yellow' | 'red'; message: string } {
  if (!latestSnapshot) {
    return { status: 'red', message: 'No snapshots' };
  }

  const latestMs = new Date(latestSnapshot).getTime();
  const serverMs = new Date(serverTime).getTime();
  const diffSeconds = (serverMs - latestMs) / 1000;

  if (diffSeconds < 120) {
    return { status: 'green', message: `${Math.floor(diffSeconds)}s ago` };
  } else if (diffSeconds < 300) {
    return { status: 'yellow', message: `${Math.floor(diffSeconds / 60)}m ago` };
  } else {
    return { status: 'red', message: `${Math.floor(diffSeconds / 60)}m ago` };
  }
}

export const ContestOpsDetailPage: React.FC = () => {
  const { contestId } = useParams<{ contestId: string }>();

  const { data: snapshot, isLoading, error } = useQuery({
    queryKey: ['contest-ops', contestId],
    queryFn: () => getContestOpsSnapshot(contestId!),
    enabled: !!contestId,
  });

  if (isLoading) {
    return (
      <div className="contest-ops-detail">
        <div className="loading">Loading contest diagnostics...</div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="contest-ops-detail">
        <div className="error">
          Failed to load contest diagnostics
          {error && <p>{(error as Error).message}</p>}
        </div>
      </div>
    );
  }

  const integrityWarnings = computeIntegrityChecks(snapshot);
  const freshness = getSnapshotFreshnessStatus(
    snapshot.snapshot_health.latest_snapshot,
    snapshot.server_time
  );

  // Compute expected next lifecycle state
  const serverTime = new Date(snapshot.server_time).getTime();
  const lockTime = snapshot.contest.lock_time ? new Date(snapshot.contest.lock_time).getTime() : null;
  const tournamentStartTime = snapshot.contest.tournament_start_time
    ? new Date(snapshot.contest.tournament_start_time).getTime()
    : null;

  let expectedNextState = 'Unknown';
  switch (snapshot.contest.status) {
    case 'SCHEDULED':
      expectedNextState = lockTime && serverTime >= lockTime ? 'LOCKED' : 'SCHEDULED (waiting for lock_time)';
      break;
    case 'LOCKED':
      expectedNextState = tournamentStartTime && serverTime >= tournamentStartTime
        ? 'LIVE'
        : 'LOCKED (waiting for tournament_start_time)';
      break;
    case 'LIVE':
      expectedNextState = 'LIVE (awaiting manual settlement or ERROR)';
      break;
    case 'COMPLETE':
      expectedNextState = 'COMPLETE (terminal state)';
      break;
    case 'CANCELLED':
      expectedNextState = 'CANCELLED (terminal state)';
      break;
    case 'ERROR':
      expectedNextState = 'ERROR (awaiting resolution)';
      break;
  }

  // Get timestamp of most recent lifecycle transition
  const lastLifecycleWorkerRun =
    snapshot.lifecycle.length > 0 ? snapshot.lifecycle[0].created_at : 'Never';

  // Compute status distribution for template contests
  const statusCounts = {
    LIVE: snapshot.template_contests.filter((c) => c.status === 'LIVE').length,
    LOCKED: snapshot.template_contests.filter((c) => c.status === 'LOCKED').length,
    SCHEDULED: snapshot.template_contests.filter((c) => c.status === 'SCHEDULED').length,
    COMPLETE: snapshot.template_contests.filter((c) => c.status === 'COMPLETE').length,
    CANCELLED: snapshot.template_contests.filter((c) => c.status === 'CANCELLED').length,
  };

  const totalEntries = snapshot.template_contests.reduce((sum, c) => sum + c.current_entries, 0);

  return (
    <div className="contest-ops-detail">
      <div className="page-header">
        <div>
          <h1>{snapshot.contest.contest_name}</h1>
          <p className="server-time">Server time: {formatTimestamp(snapshot.server_time)}</p>
        </div>
      </div>

      {/* Panel 1: Contest Overview */}
      <Panel title="Contest Overview">
        <div className="overview-grid">
          <div className="overview-item">
            <span className="label">Contest Name</span>
            <span className="value">{snapshot.contest.contest_name}</span>
          </div>
          <div className="overview-item">
            <span className="label">Status</span>
            <StatusBadge status={snapshot.contest.status} />
          </div>
          <div className="overview-item">
            <span className="label">Entry Fee</span>
            <span className="value">{formatCurrency(snapshot.contest.entry_fee_cents)}</span>
          </div>
          <div className="overview-item">
            <span className="label">Entries</span>
            <span className="value">
              {snapshot.contest.current_entries} / {snapshot.contest.max_entries || 'Unlimited'}
            </span>
          </div>
          <div className="overview-item">
            <span className="label">Lock Time</span>
            <span className="value">{formatTimestamp(snapshot.contest.lock_time)}</span>
          </div>
          <div className="overview-item">
            <span className="label">Tournament Start</span>
            <span className="value">{formatTimestamp(snapshot.contest.tournament_start_time)}</span>
          </div>
          <div className="overview-item">
            <span className="label">Provider Event ID</span>
            <code className="value">{snapshot.contest.provider_event_id || '—'}</code>
          </div>
          <div className="overview-item">
            <span className="label">Organizer ID</span>
            <code className="value">{snapshot.contest.organizer_id}</code>
          </div>
          <div className="overview-item">
            <span className="label">System Generated</span>
            <span className="value">{snapshot.contest.is_system_generated ? 'Yes' : 'No'}</span>
          </div>
          <div className="overview-item">
            <span className="label">Primary Marketing</span>
            <span className="value">{snapshot.contest.is_primary_marketing ? 'Yes' : 'No'}</span>
          </div>
          <div className="overview-item">
            <span className="label">Platform Owned</span>
            <span className="value">{snapshot.contest.is_platform_owned ? 'Yes' : 'No'}</span>
          </div>
          <div className="overview-item">
            <span className="label">Created</span>
            <span className="value">{formatTimestamp(snapshot.contest.created_at)}</span>
          </div>
          <div className="overview-item">
            <span className="label">Updated</span>
            <span className="value">{formatTimestamp(snapshot.contest.updated_at)}</span>
          </div>
        </div>
      </Panel>

      {/* Panel 2: Lifecycle Engine */}
      <Panel title="Lifecycle Engine">
        <div className="lifecycle-grid">
          <div className="lifecycle-item">
            <span className="label">Current Status</span>
            <StatusBadge status={snapshot.contest.status} />
          </div>
          <div className="lifecycle-item">
            <span className="label">Server Time</span>
            <span className="value">{formatTimestamp(snapshot.server_time)}</span>
          </div>
          <div className="lifecycle-item">
            <span className="label">Lock Time</span>
            <span className="value">{formatTimestamp(snapshot.contest.lock_time)}</span>
          </div>
          <div className="lifecycle-item">
            <span className="label">Tournament Start</span>
            <span className="value">{formatTimestamp(snapshot.contest.tournament_start_time)}</span>
          </div>
          <div className="lifecycle-item full-width">
            <span className="label">Expected Next State</span>
            <span className="value next-state">{expectedNextState}</span>
          </div>
          <div className="lifecycle-item full-width">
            <span className="label">Last State Transition</span>
            <span className="value">
              {lastLifecycleWorkerRun === 'Never'
                ? '—'
                : `${formatTimestamp(lastLifecycleWorkerRun)} (${formatRelativeTime(lastLifecycleWorkerRun)})`}
            </span>
          </div>
        </div>
      </Panel>

      {/* Panel 3: Template Contest Status Distribution */}
      <Panel title="Template Contest Status Distribution">
        <div className="status-distribution">
          <div className="status-count">
            <span className="count-value">{statusCounts.LIVE}</span>
            <span className="count-label">Live</span>
          </div>
          <div className="status-count">
            <span className="count-value">{statusCounts.LOCKED}</span>
            <span className="count-label">Locked</span>
          </div>
          <div className="status-count">
            <span className="count-value">{statusCounts.SCHEDULED}</span>
            <span className="count-label">Scheduled</span>
          </div>
          <div className="status-count">
            <span className="count-value">{statusCounts.COMPLETE}</span>
            <span className="count-label">Complete</span>
          </div>
          <div className="status-count">
            <span className="count-value">{statusCounts.CANCELLED}</span>
            <span className="count-label">Cancelled</span>
          </div>
          <div className="status-count highlight">
            <span className="count-value">{totalEntries}</span>
            <span className="count-label">Total Entries</span>
          </div>
        </div>
        {statusCounts.LIVE === 0 && statusCounts.LOCKED === 0 && (
          <div className="status-message">
            <p>
              No active contests. {statusCounts.SCHEDULED} contest{statusCounts.SCHEDULED !== 1 ? 's' : ''} currently scheduled and will appear here after lock time.
            </p>
          </div>
        )}
      </Panel>

      {/* Panel 4: Integrity Warnings */}
      {integrityWarnings.length > 0 && (
        <Panel title="Integrity Warnings">
          <div className="warnings-container">
            {integrityWarnings.map((warning, idx) => (
              <IntegrityWarning key={idx}>{warning}</IntegrityWarning>
            ))}
          </div>
        </Panel>
      )}

      {/* Panel 5: Tournament Config (attached to this contest) */}
      {snapshot.contest_tournament_config && (
        <Panel title="Tournament Config (Attached to This Contest)">
          <div className="config-grid">
            <div className="config-item">
              <span className="label">Config ID</span>
              <code className="value">{snapshot.contest_tournament_config.id}</code>
            </div>
            <div className="config-item">
              <span className="label">Provider Event ID</span>
              <code className="value">{snapshot.contest_tournament_config.provider_event_id}</code>
            </div>
            <div className="config-item">
              <span className="label">Event Start</span>
              <span className="value">
                {formatTimestamp(snapshot.contest_tournament_config.event_start_date)}
              </span>
            </div>
            <div className="config-item">
              <span className="label">Event End</span>
              <span className="value">
                {formatTimestamp(snapshot.contest_tournament_config.event_end_date)}
              </span>
            </div>
            <div className="config-item">
              <span className="label">Field Source</span>
              <span className="value">{snapshot.contest_tournament_config.field_source}</span>
            </div>
            <div className="config-item">
              <span className="label">Active</span>
              <span
                className={`value badge ${snapshot.contest_tournament_config.is_active ? 'active' : 'inactive'}`}
              >
                {snapshot.contest_tournament_config.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="config-item">
              <span className="label">Created</span>
              <span className="value">
                {formatTimestamp(snapshot.contest_tournament_config.created_at)}
              </span>
            </div>
          </div>
        </Panel>
      )}

      {/* Panel 6: All Tournament Configs (event family) */}
      <Panel title="All Tournament Configs (Event Family)">
        {snapshot.tournament_configs.length === 0 ? (
          <p className="no-data">No tournament configs found</p>
        ) : (
          <table className="configs-table">
            <thead>
              <tr>
                <th>Contest</th>
                <th>Provider Event ID</th>
                <th>Event Start</th>
                <th>Active</th>
                <th>Field Source</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.tournament_configs.map((config) => (
                <tr key={config.id} className={config.is_active ? 'active-row' : ''}>
                  <td>{config.contest_name}</td>
                  <td>
                    <code>{config.provider_event_id}</code>
                  </td>
                  <td>{formatTimestamp(config.event_start_date)}</td>
                  <td>
                    <span className={`badge ${config.is_active ? 'active' : 'inactive'}`}>
                      {config.is_active ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td>{config.field_source}</td>
                  <td>{formatTimestamp(config.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* Panel 7: Template Contest Instances */}
      <Panel title="Template Contest Instances">
        {snapshot.template_contests.length === 0 ? (
          <p className="no-data">No contests found for this template</p>
        ) : (
          <table className="contests-table">
            <thead>
              <tr>
                <th>Contest Name</th>
                <th>Status</th>
                <th>Entry Fee</th>
                <th>Entries</th>
                <th>Lock Time</th>
                <th>Organizer</th>
                <th>System</th>
                <th>Marketing</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.template_contests.map((contest) => (
                <tr key={contest.id} className={contest.id === contestId ? 'current-contest' : ''}>
                  <td>{contest.contest_name}</td>
                  <td>
                    <StatusBadge status={contest.status} />
                  </td>
                  <td>{formatCurrency(contest.entry_fee_cents)}</td>
                  <td>
                    {contest.current_entries} / {contest.max_entries || '∞'}
                  </td>
                  <td>{formatTimestamp(contest.lock_time)}</td>
                  <td>
                    <code className="small">{contest.organizer_id.slice(0, 8)}...</code>
                  </td>
                  <td>{contest.is_system_generated ? 'Yes' : 'No'}</td>
                  <td>{contest.is_primary_marketing ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* Panel 8: Lifecycle History */}
      <Panel title="Lifecycle History">
        {snapshot.lifecycle.length === 0 ? (
          <p className="no-data">No lifecycle transitions recorded</p>
        ) : (
          <table className="lifecycle-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>From</th>
                <th>To</th>
                <th>Triggered By</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.lifecycle.map((transition, idx) => (
                <tr key={idx}>
                  <td>{formatTimestamp(transition.created_at)}</td>
                  <td>
                    <StatusBadge status={transition.from_state} />
                  </td>
                  <td>
                    <StatusBadge status={transition.to_state} />
                  </td>
                  <td>{transition.triggered_by}</td>
                  <td>{transition.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* Panel 9: Snapshot Health */}
      <Panel title="Snapshot Health">
        <div className="health-grid">
          <div className="health-item">
            <span className="label">Snapshot Count</span>
            <span className="value">{snapshot.snapshot_health.snapshot_count}</span>
          </div>
          <div className="health-item">
            <span className="label">Latest Snapshot</span>
            <div className={`freshness ${freshness.status}`}>
              <span>{formatRelativeTime(snapshot.snapshot_health.latest_snapshot)}</span>
              <span className="status-dot" />
            </div>
          </div>
          <div className="health-item full-width">
            <span className="label">Snapshot Freshness</span>
            <div className={`freshness-bar ${freshness.status}`}>
              {freshness.status === 'green' && '✓ Fresh'}
              {freshness.status === 'yellow' && '⚠️ Stale'}
              {freshness.status === 'red' && '✗ Critical'}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
};

export default ContestOpsDetailPage;
