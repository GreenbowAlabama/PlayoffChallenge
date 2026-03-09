/**
 * Player Data Tower
 *
 * Displays ingestion pipeline health and player data status.
 * Fetches from /api/admin/player-data/ops
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlayerDataOpsSnapshot } from '../../../api/player-data-ops';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { AdminPanel } from '../../../components/admin/AdminPanel';
import { RefreshIndicator } from '../../../components/admin/RefreshIndicator';
import type { PlayerDataOpsSnapshot } from '../../../api/player-data-ops';

function formatLagSeconds(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  const date = new Date(ts);
  return date.toLocaleString();
}


function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    success: 'bg-green-100 text-green-800',
    pending: 'bg-blue-100 text-blue-800',
    failed: 'bg-red-100 text-red-800',
    error: 'bg-red-100 text-red-800',
    running: 'bg-blue-100 text-blue-800',
  };

  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
      {statusLabel}
    </span>
  );
}

export function PlayerDataPage() {
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['playerDataOps'],
    queryFn: getPlayerDataOpsSnapshot,
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (data) {
      setLastUpdated(new Date().toLocaleString());
    }
  }, [data?.server_time]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Player Data Tower</h1>
          <p className="mt-1 text-sm text-gray-600">Ingestion & scoring pipeline status</p>
        </div>
        <RefreshIndicator lastUpdated={lastUpdated} refreshInterval={10000} />
      </div>

      {isLoading && !data && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
          <p className="text-gray-600">Loading player data pipeline status...</p>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Ingestion Health */}
          <AdminPanel
            title="Ingestion Health"
            tooltip="Ingestion Lag shows the time since the last successful player data ingestion"
            alert={
              data.ingestion.lag_seconds && data.ingestion.lag_seconds > 300
                ? {
                    type: 'warning',
                    message: `⚠ Ingestion lag exceeds 5 minutes (${formatLagSeconds(data.ingestion.lag_seconds)})`,
                  }
                : undefined
            }
          >
            <div className="space-y-4">
              {/* Lag indicator */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Current Lag</span>
                  <span className={`text-sm font-mono font-bold ${
                    data.ingestion.lag_seconds === null || data.ingestion.lag_seconds < 300
                      ? 'text-green-700'
                      : data.ingestion.lag_seconds < 600
                      ? 'text-amber-700'
                      : 'text-red-700'
                  }`}>
                    {formatLagSeconds(data.ingestion.lag_seconds)}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      data.ingestion.lag_seconds === null || data.ingestion.lag_seconds < 300
                        ? 'bg-green-600'
                        : data.ingestion.lag_seconds < 600
                        ? 'bg-amber-600'
                        : 'bg-red-600'
                    }`}
                    style={{
                      width: `${Math.min(100, ((data.ingestion.lag_seconds ?? 0) / 900) * 100)}%`
                    }}
                  ></div>
                </div>
              </div>

              {/* Last success */}
              <div className="border-t pt-3">
                <p className="text-xs text-gray-600 mb-1">Last Success</p>
                <p className="text-sm text-gray-900 font-mono">{formatTimestamp(data.ingestion.last_success)}</p>
              </div>

              {/* Error count */}
              <div className="border-t pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Errors (Last Hour)</span>
                  <span className={`text-sm font-bold ${data.ingestion.errors_last_hour > 0 ? 'text-red-700' : 'text-green-700'}`}>
                    {data.ingestion.errors_last_hour}
                  </span>
                </div>
              </div>

              {/* Latest runs */}
              <div className="border-t pt-3">
                <p className="text-xs text-gray-600 font-semibold mb-2">Latest Runs</p>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {data.ingestion.latest_runs.slice(0, 3).map((run, i) => (
                    <div key={i} className="text-xs bg-gray-50 p-2 rounded border border-gray-200">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-gray-700">{run.work_unit_key}</span>
                        <StatusBadge status={run.status} />
                      </div>
                      {run.error_message && <p className="text-red-600 mt-1">{run.error_message}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </AdminPanel>

          {/* Player Pool Coverage */}
          <AdminPanel
            title="Player Pool Coverage"
            tooltip="Shows which tournaments have player pools created"
          >
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-green-800">Tournaments with Pool</span>
                  <span className="text-2xl font-bold text-green-700">{data.player_pool.tournaments_with_pool}</span>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-amber-800">Tournaments Missing Pool</span>
                  <span className="text-2xl font-bold text-amber-700">{data.player_pool.missing_pools}</span>
                </div>
              </div>
            </div>
          </AdminPanel>

          {/* Snapshot Health */}
          <AdminPanel
            title="Snapshot Health"
            tooltip="Shows the state of contest snapshots for scoring"
            alert={
              data.snapshots.contests_missing_snapshots > 0
                ? {
                    type: 'warning',
                    message: `⚠ ${data.snapshots.contests_missing_snapshots} contests missing snapshots`,
                  }
                : undefined
            }
          >
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">Total Snapshots</p>
                <p className="text-2xl font-bold text-gray-900">{data.snapshots.total_snapshots}</p>
              </div>

              <div className="border-t pt-3">
                <p className="text-sm font-medium text-gray-700 mb-1">Latest Snapshot</p>
                <p className="text-sm text-gray-900 font-mono">{formatTimestamp(data.snapshots.latest_snapshot)}</p>
              </div>

              <div className="border-t pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Snapshot Lag</span>
                  <span className={`text-sm font-mono font-bold ${
                    data.snapshots.snapshot_lag_seconds === null || data.snapshots.snapshot_lag_seconds < 600
                      ? 'text-green-700'
                      : data.snapshots.snapshot_lag_seconds < 1200
                      ? 'text-amber-700'
                      : 'text-red-700'
                  }`}>
                    {formatLagSeconds(data.snapshots.snapshot_lag_seconds)}
                  </span>
                </div>
              </div>

              <div className="border-t pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Missing Snapshots</span>
                  <span className={`text-sm font-bold ${data.snapshots.contests_missing_snapshots > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                    {data.snapshots.contests_missing_snapshots}
                  </span>
                </div>
              </div>
            </div>
          </AdminPanel>

          {/* Scoring Status */}
          <AdminPanel
            title="Scoring Status"
            tooltip="Last scoring execution and lag time"
          >
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">Last Scoring Run</p>
                <p className="text-sm text-gray-900 font-mono">{formatTimestamp(data.scoring.last_scoring_run)}</p>
              </div>

              <div className="border-t pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Scoring Lag</span>
                  <span className={`text-sm font-mono font-bold ${
                    data.scoring.scoring_lag_seconds === null || data.scoring.scoring_lag_seconds < 300
                      ? 'text-green-700'
                      : 'text-amber-700'
                  }`}>
                    {formatLagSeconds(data.scoring.scoring_lag_seconds)}
                  </span>
                </div>
              </div>
            </div>
          </AdminPanel>

          {/* Data Workers */}
          <AdminPanel
            title="Data Workers"
            tooltip="Background worker process health"
            className="md:col-span-2"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.workers.map((worker) => (
                <div key={worker.worker_name} className="border border-gray-200 rounded p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-gray-900">{worker.worker_name}</h4>
                    <StatusBadge status={worker.status} />
                  </div>
                  <div className="text-xs text-gray-600 space-y-1">
                    <p>Last run: {formatTimestamp(worker.last_run_at)}</p>
                    <p className={worker.error_count > 0 ? 'text-red-600 font-medium' : ''}>
                      Errors: {worker.error_count}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </AdminPanel>
        </div>
      )}
    </div>
  );
}
