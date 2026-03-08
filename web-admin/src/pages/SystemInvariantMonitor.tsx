/**
 * System Health Monitor Page
 *
 * Merged dashboard combining system invariants and diagnostics.
 * Monitors platform critical invariants and environmental health.
 */

import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { InvariantCard } from '../components/InvariantCard';
import { AnomalyList } from '../components/AnomalyList';
import { systemInvariantsApi } from '../api/system-invariants';
import { getHealthCheck, getUserStats, getJobsStatus, getLifecycleHealth } from '../api/diagnostics';
import { LifecycleHealthPanel } from '../components/LifecycleHealthPanel';
import type {
  SystemInvariantsResponse,
  HistoryRecord,
  FinancialInvariant,
  LifecycleInvariant,
  SettlementInvariant,
  PipelineInvariant,
  LedgerInvariant
} from '../types/SystemInvariants';
import '../styles/SystemInvariantMonitor.css';

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    healthy: 'bg-green-100 text-green-800',
    degraded: 'bg-amber-100 text-amber-800',
    unhealthy: 'bg-red-100 text-red-800',
    unknown: 'bg-gray-100 text-gray-800',
    running: 'bg-blue-100 text-blue-800',
    error: 'bg-red-100 text-red-800',
    registered: 'bg-gray-100 text-gray-600',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] || colors.unknown}`}>
      {status}
    </span>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  const date = new Date(ts);
  return date.toLocaleString();
}

export const SystemInvariantMonitor: React.FC = () => {
  const [data, setData] = useState<SystemInvariantsResponse | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedAnomalies, setExpandedAnomalies] = useState<Record<string, boolean>>({});
  const [historyPage, setHistoryPage] = useState(0);
  const [historyTotal, setHistoryTotal] = useState(0);

  const HISTORY_PAGE_SIZE = 20;
  const queryClient = useQueryClient();

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await systemInvariantsApi.getCurrentStatus();
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async (page: number) => {
    try {
      const response = await systemInvariantsApi.getHistory(HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);
      setHistory(response.records);
      setHistoryTotal(response.total_count);
      setHistoryPage(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch history');
    }
  };

  // Diagnostics queries
  const { data: health, isLoading: healthLoading, isFetching: healthFetching } = useQuery({
    queryKey: ['diagnostics', 'health'],
    queryFn: getHealthCheck,
    staleTime: Infinity,
  });

  const { data: userStats, isLoading: statsLoading, isFetching: statsFetching } = useQuery({
    queryKey: ['diagnostics', 'userStats'],
    queryFn: getUserStats,
    staleTime: Infinity,
  });

  const { data: jobs, isLoading: jobsLoading, isFetching: jobsFetching } = useQuery({
    queryKey: ['diagnostics', 'jobs'],
    queryFn: getJobsStatus,
    staleTime: Infinity,
  });

  const { isFetching: lifecycleFetching } = useQuery({
    queryKey: ['diagnostics', 'lifecycleHealth'],
    queryFn: getLifecycleHealth,
    staleTime: Infinity,
  });

  const isAnyFetching = healthFetching || statsFetching || jobsFetching || lifecycleFetching;

  const handleRefreshAll = () => {
    fetchData();
    fetchHistory(0);
    queryClient.invalidateQueries({ queryKey: ['diagnostics'] });
    queryClient.invalidateQueries({ queryKey: ['systemHealth'] });
  };

  useEffect(() => {
    fetchData();
    fetchHistory(0);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      handleRefreshAll();
    }, 10000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  const toggleAnomalyExpanded = (key: string) => {
    setExpandedAnomalies(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const renderFinancialDetails = (financial: FinancialInvariant) => (
    <div className="financial-details space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-blue-50 rounded-md p-3 border border-blue-200">
          <div className="text-xs text-blue-600 font-medium mb-1">Wallet Liability</div>
          <div className="text-lg font-semibold text-gray-900">${(financial.values.wallet_liability_cents / 100).toFixed(2)}</div>
        </div>
        <div className="bg-purple-50 rounded-md p-3 border border-purple-200">
          <div className="text-xs text-purple-600 font-medium mb-1">Contest Pools</div>
          <div className="text-lg font-semibold text-gray-900">${(financial.values.contest_pools_cents / 100).toFixed(2)}</div>
        </div>
        <div className="bg-green-50 rounded-md p-3 border border-green-200">
          <div className="text-xs text-green-600 font-medium mb-1">Deposits</div>
          <div className="text-lg font-semibold text-gray-900">${(financial.values.deposits_cents / 100).toFixed(2)}</div>
        </div>
        <div className="bg-red-50 rounded-md p-3 border border-red-200">
          <div className="text-xs text-red-600 font-medium mb-1">Withdrawals</div>
          <div className="text-lg font-semibold text-gray-900">${(financial.values.withdrawals_cents / 100).toFixed(2)}</div>
        </div>
      </div>
      <div className="bg-gray-50 rounded-md p-3 border border-gray-200">
        <div className="text-xs text-gray-500 font-medium mb-2">Invariant Equation</div>
        <div className="font-mono text-sm text-gray-900">
          {financial.values.wallet_liability_cents + financial.values.contest_pools_cents} = {financial.values.deposits_cents - financial.values.withdrawals_cents}
          {financial.values.difference_cents > 0 && (
            <span className="text-red-600"> (diff: {financial.values.difference_cents} cents)</span>
          )}
        </div>
      </div>
    </div>
  );

  const renderLifecycleDetails = (lifecycle: LifecycleInvariant) => (
    <div className="lifecycle-details space-y-3">
      <div className="bg-blue-50 rounded-md p-3 border border-blue-200">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-blue-600 font-medium mb-1">LOCKED Contests</div>
            <div className="text-2xl font-semibold text-gray-900">{lifecycle.details.total_locked_contests}</div>
          </div>
          {lifecycle.details.stuck_locked_count > 0 && (
            <div className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded-full font-medium">
              {lifecycle.details.stuck_locked_count} stuck
            </div>
          )}
        </div>
      </div>
      <div className="bg-orange-50 rounded-md p-3 border border-orange-200">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-orange-600 font-medium mb-1">LIVE Contests</div>
            <div className="text-2xl font-semibold text-gray-900">{lifecycle.details.total_live_contests}</div>
          </div>
          {lifecycle.details.stuck_live_count > 0 && (
            <div className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded-full font-medium">
              {lifecycle.details.stuck_live_count} stuck
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderSettlementDetails = (settlement: SettlementInvariant) => (
    <div className="settlement-details space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 rounded-md p-3 border border-gray-200">
          <div className="text-xs text-gray-500 font-medium mb-1">COMPLETE</div>
          <div className="text-2xl font-semibold text-gray-900">{settlement.details.total_complete_contests}</div>
        </div>
        <div className="bg-green-50 rounded-md p-3 border border-green-200">
          <div className="text-xs text-green-600 font-medium mb-1">Settled</div>
          <div className="text-2xl font-semibold text-gray-900">{settlement.details.total_settled_contests}</div>
        </div>
      </div>
      {settlement.details.settlement_lag_minutes > 0 && (
        <div className="bg-amber-50 rounded-md p-3 border border-amber-200">
          <div className="text-xs text-amber-600 font-medium mb-1">⚠ Max Settlement Lag</div>
          <div className="text-lg font-semibold text-amber-900">{settlement.details.settlement_lag_minutes} minutes</div>
        </div>
      )}
    </div>
  );

  const getWorkerFreshness = (lastRun: string | null) => {
    if (!lastRun) return null;
    const now = new Date();
    const lastRunDate = new Date(lastRun);
    const secondsAgo = Math.floor((now.getTime() - lastRunDate.getTime()) / 1000);

    if (secondsAgo < 60) return `${secondsAgo}s ago`;
    const minutesAgo = Math.floor(secondsAgo / 60);
    if (minutesAgo < 60) return `${minutesAgo}m ago`;
    const hoursAgo = Math.floor(minutesAgo / 60);
    return `${hoursAgo}h ago`;
  };

  const renderPipelineDetails = (pipeline: PipelineInvariant) => (
    <div className="pipeline-details space-y-3">
      <div className="worker border-l-4 border-blue-500 pl-3 py-2">
        <div className="flex items-center justify-between">
          <strong className="text-gray-900">Discovery Worker</strong>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
            pipeline.pipeline_status.discovery_worker.status === 'HEALTHY' ? 'bg-green-100 text-green-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {pipeline.pipeline_status.discovery_worker.status}
          </span>
        </div>
        {pipeline.pipeline_status.discovery_worker.last_run && (
          <small className="text-gray-500">{getWorkerFreshness(pipeline.pipeline_status.discovery_worker.last_run)}</small>
        )}
        {pipeline.pipeline_status.discovery_worker.error_count_1h > 0 && (
          <div className="text-xs text-red-600 mt-1">⚠ {pipeline.pipeline_status.discovery_worker.error_count_1h} errors in last hour</div>
        )}
      </div>

      <div className="worker border-l-4 border-blue-500 pl-3 py-2">
        <div className="flex items-center justify-between">
          <strong className="text-gray-900">Lifecycle Reconciler</strong>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
            pipeline.pipeline_status.lifecycle_reconciler.status === 'HEALTHY' ? 'bg-green-100 text-green-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {pipeline.pipeline_status.lifecycle_reconciler.status}
          </span>
        </div>
        {pipeline.pipeline_status.lifecycle_reconciler.last_run && (
          <small className="text-gray-500">{getWorkerFreshness(pipeline.pipeline_status.lifecycle_reconciler.last_run)}</small>
        )}
      </div>

      <div className="worker border-l-4 border-blue-500 pl-3 py-2">
        <div className="flex items-center justify-between">
          <strong className="text-gray-900">Ingestion Worker</strong>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
            pipeline.pipeline_status.ingestion_worker.status === 'HEALTHY' ? 'bg-green-100 text-green-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {pipeline.pipeline_status.ingestion_worker.status}
          </span>
        </div>
        {pipeline.pipeline_status.ingestion_worker.last_run && (
          <small className="text-gray-500">{getWorkerFreshness(pipeline.pipeline_status.ingestion_worker.last_run)}</small>
        )}
        {pipeline.pipeline_status.ingestion_worker.error_count_1h > 0 && (
          <div className="text-xs text-red-600 mt-1">⚠ {pipeline.pipeline_status.ingestion_worker.error_count_1h} stuck units</div>
        )}
      </div>
    </div>
  );

  const renderLedgerDetails = (ledger: LedgerInvariant) => (
    <div className="ledger-details space-y-3">
      <div className="bg-gray-50 rounded-md p-3 border border-gray-200">
        <div className="text-xs text-gray-500 font-medium mb-1">Total Entries</div>
        <div className="text-2xl font-semibold text-gray-900">{ledger.details.total_entries}</div>
      </div>
      <div className={`rounded-md p-3 border ${
        ledger.details.constraint_violations === 0
          ? 'bg-green-50 border-green-200'
          : 'bg-red-50 border-red-200'
      }`}>
        <div className={`text-xs font-medium mb-1 ${
          ledger.details.constraint_violations === 0 ? 'text-green-600' : 'text-red-600'
        }`}>
          Constraint Violations
        </div>
        <div className={`text-2xl font-semibold ${
          ledger.details.constraint_violations === 0 ? 'text-green-900' : 'text-red-900'
        }`}>
          {ledger.details.constraint_violations}
        </div>
      </div>
      <div className={`rounded-md p-3 border bg-green-50 border-green-200`}>
        <div className={`text-xs font-medium mb-1 text-green-600`}>
          Balance Status
        </div>
        <div className={`text-sm font-semibold text-green-900`}>
          {ledger.details.balance_status}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">System Health</h1>
          <p className="mt-1 text-sm text-gray-500">
            Platform invariants and operational infrastructure status (Read-only)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRefreshAll}
            disabled={isAnyFetching}
            className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            {isAnyFetching ? 'Refreshing...' : '🔄 Refresh All'}
          </button>
          <label className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="mr-2"
            />
            Auto-refresh (10s)
          </label>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700"><strong>Error:</strong> {error}</p>
        </div>
      )}

      {/* Overall Status Banner */}
      {data && (
        <div className="rounded-lg overflow-hidden shadow-lg border-2" style={{
          borderColor: data.overall_status === 'HEALTHY' ? '#16a34a' : data.overall_status === 'WARNING' ? '#f59e0b' : '#dc2626'
        }}>
          <div className="p-8" style={{
            background: data.overall_status === 'HEALTHY'
              ? 'linear-gradient(135deg, #dcfce7 0%, #86efac 100%)'
              : data.overall_status === 'WARNING'
              ? 'linear-gradient(135deg, #fef3c7 0%, #fcd34d 100%)'
              : 'linear-gradient(135deg, #fee2e2 0%, #fca5a5 100%)'
          }}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold" style={{
                  color: data.overall_status === 'HEALTHY' ? '#166534' : data.overall_status === 'WARNING' ? '#92400e' : '#7f1d1d'
                }}>
                  {data.overall_status === 'HEALTHY' ? '✓ All Systems Operational' :
                   data.overall_status === 'WARNING' ? '⚠ Warning: Check Details Below' :
                   '✗ Critical Issues Detected'}
                </h2>
                <p className="text-sm mt-2" style={{
                  color: data.overall_status === 'HEALTHY' ? '#166534' : data.overall_status === 'WARNING' ? '#92400e' : '#7f1d1d'
                }}>
                  Last check: {formatTimestamp(data.last_check_timestamp)} • Execution: {data.execution_time_ms}ms
                </p>
              </div>
              <div className="text-6xl font-bold" style={{
                color: data.overall_status === 'HEALTHY' ? '#16a34a' : data.overall_status === 'WARNING' ? '#f59e0b' : '#dc2626'
              }}>
                {data.overall_status === 'HEALTHY' && '✓'}
                {data.overall_status === 'WARNING' && '⚠'}
                {data.overall_status === 'CRITICAL' && '✗'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* System Invariants Grid */}
      {data && (
        <div className="system-invariant-monitor">
          <div className="invariants-grid">
            <div>
              <InvariantCard
                title="Financial Integrity"
                status={data.invariants.financial.status}
                executionTime={data.execution_time_ms}
                details={renderFinancialDetails(data.invariants.financial)}
                anomalyCount={data.invariants.financial.details.anomalies.length}
              />
              <AnomalyList
                title="Financial Anomalies"
                anomalies={data.invariants.financial.details.anomalies}
                isExpanded={expandedAnomalies['financial']}
                onToggle={() => toggleAnomalyExpanded('financial')}
              />
            </div>

            <div>
              <InvariantCard
                title="Lifecycle Correctness"
                status={data.invariants.lifecycle.status}
                details={renderLifecycleDetails(data.invariants.lifecycle)}
                anomalyCount={data.invariants.lifecycle.anomalies.length}
              />
              <AnomalyList
                title="Lifecycle Anomalies"
                anomalies={data.invariants.lifecycle.anomalies}
                isExpanded={expandedAnomalies['lifecycle']}
                onToggle={() => toggleAnomalyExpanded('lifecycle')}
              />
            </div>

            <div>
              <InvariantCard
                title="Settlement Integrity"
                status={data.invariants.settlement.status}
                details={renderSettlementDetails(data.invariants.settlement)}
                anomalyCount={data.invariants.settlement.anomalies.length}
              />
              <AnomalyList
                title="Settlement Anomalies"
                anomalies={data.invariants.settlement.anomalies}
                isExpanded={expandedAnomalies['settlement']}
                onToggle={() => toggleAnomalyExpanded('settlement')}
              />
            </div>

            <div>
              <InvariantCard
                title="Pipeline Health"
                status={data.invariants.pipeline.status}
                details={renderPipelineDetails(data.invariants.pipeline)}
                anomalyCount={data.invariants.pipeline.anomalies.length}
              />
              <AnomalyList
                title="Pipeline Anomalies"
                anomalies={data.invariants.pipeline.anomalies}
                isExpanded={expandedAnomalies['pipeline']}
                onToggle={() => toggleAnomalyExpanded('pipeline')}
              />
            </div>

            <div>
              <InvariantCard
                title="Ledger Integrity"
                status={data.invariants.ledger.status}
                details={renderLedgerDetails(data.invariants.ledger)}
                anomalyCount={data.invariants.ledger.anomalies.length}
              />
              <AnomalyList
                title="Ledger Anomalies"
                anomalies={data.invariants.ledger.anomalies}
                isExpanded={expandedAnomalies['ledger']}
                onToggle={() => toggleAnomalyExpanded('ledger')}
              />
            </div>
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm p-6">
          <p className="text-gray-500">Loading system health check...</p>
        </div>
      )}

      {/* Environment Health Panel */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-900">Environment Health</h2>
              <p className="text-sm text-gray-500">System component status</p>
            </div>
            {health && <StatusBadge status={health.status} />}
          </div>
        </div>
        <div className="p-4">
          {healthLoading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-1/3"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          ) : healthFetching ? (
            <p className="text-gray-500">Updating...</p>
          ) : health ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="rounded-md border border-gray-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">API Process</span>
                  <StatusBadge status={health.checks.api_process.status} />
                </div>
                <dl className="text-xs text-gray-500 space-y-1">
                  <div className="flex justify-between">
                    <dt>Uptime</dt>
                    <dd className="text-gray-900">{formatUptime(health.checks.api_process.uptime_seconds)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Memory</dt>
                    <dd className="text-gray-900">{health.checks.api_process.memory_usage_mb} MB</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Environment</dt>
                    <dd className="text-gray-900">{health.checks.api_process.environment}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-md border border-gray-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Database</span>
                  <StatusBadge status={health.checks.database.status} />
                </div>
                <dl className="text-xs text-gray-500 space-y-1">
                  <div className="flex justify-between">
                    <dt>Latency</dt>
                    <dd className="text-gray-900">
                      {health.checks.database.latency_ms != null ? `${health.checks.database.latency_ms}ms` : '—'}
                    </dd>
                  </div>
                  {health.checks.database.error && (
                    <div className="text-red-600 mt-1">{health.checks.database.error}</div>
                  )}
                </dl>
              </div>

              <div className="rounded-md border border-gray-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">ESPN API</span>
                  <StatusBadge status={health.checks.espn_api.status} />
                </div>
                <dl className="text-xs text-gray-500 space-y-1">
                  <div className="flex justify-between">
                    <dt>Latency</dt>
                    <dd className="text-gray-900">
                      {health.checks.espn_api.latency_ms != null ? `${health.checks.espn_api.latency_ms}ms` : '—'}
                    </dd>
                  </div>
                  {health.checks.espn_api.error && (
                    <div className="text-red-600 mt-1">{health.checks.espn_api.error}</div>
                  )}
                </dl>
              </div>

              <div className="rounded-md border border-gray-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Sleeper API</span>
                  <StatusBadge status={health.checks.sleeper_api.status} />
                </div>
                <dl className="text-xs text-gray-500 space-y-1">
                  <div className="flex justify-between">
                    <dt>Latency</dt>
                    <dd className="text-gray-900">
                      {health.checks.sleeper_api.latency_ms != null ? `${health.checks.sleeper_api.latency_ms}ms` : '—'}
                    </dd>
                  </div>
                  {health.checks.sleeper_api.error && (
                    <div className="text-red-600 mt-1">{health.checks.sleeper_api.error}</div>
                  )}
                </dl>
              </div>
            </div>
          ) : null}
          {health && (
            <p className="text-xs text-gray-400 mt-3">
              Last checked: {formatTimestamp(health.timestamp)}
            </p>
          )}
        </div>
      </div>

      {/* Lifecycle Health Panel */}
      <LifecycleHealthPanel isFetching={lifecycleFetching} />

      {/* User Statistics Panel */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-900">User Statistics</h2>
              <p className="text-sm text-gray-500">Aggregate user counts</p>
            </div>
            <Link
              to="/users"
              className="text-sm text-indigo-600 hover:text-indigo-500"
            >
              View all →
            </Link>
          </div>
        </div>
        <div className="p-4">
          {statsLoading ? (
            <div className="animate-pulse grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 bg-gray-200 rounded"></div>
              ))}
            </div>
          ) : userStats ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">Total Users</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {userStats.stats.total_users}
                </dd>
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">Paid Users</dt>
                <dd className="mt-1 text-2xl font-semibold text-green-600">
                  {userStats.stats.paid_users}
                </dd>
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">Admin Users</dt>
                <dd className="mt-1 text-2xl font-semibold text-indigo-600">
                  {userStats.stats.admin_users}
                </dd>
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">Age Verified</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {userStats.stats.age_verified_users}
                </dd>
              </div>
            </div>
          ) : null}
          {userStats && (
            <p className="text-xs text-gray-400 mt-3">
              As of: {formatTimestamp(userStats.timestamp)}
            </p>
          )}
        </div>
      </div>

      {/* Background Jobs Panel */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Background Jobs</h2>
          <p className="text-sm text-gray-500">Job execution status (visibility only)</p>
        </div>
        <div className="p-4">
          {jobsLoading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-12 bg-gray-200 rounded"></div>
            </div>
          ) : jobs && jobs.jobs.length > 0 ? (
            <div className="space-y-3">
              {jobs.jobs.map((job) => (
                <div key={job.name} className="rounded-md border border-gray-200 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-900">{job.name}</span>
                    <StatusBadge status={job.status} />
                  </div>
                  {job.description && (
                    <p className="text-xs text-gray-500 mb-2">{job.description}</p>
                  )}
                  <dl className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div>
                      <dt className="text-gray-500">Last Run</dt>
                      <dd className="text-gray-900">{formatTimestamp(job.last_run_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Runs</dt>
                      <dd className="text-gray-900">{job.run_count}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Success</dt>
                      <dd className="text-green-600">{job.success_count}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Failures</dt>
                      <dd className={job.failure_count > 0 ? 'text-red-600' : 'text-gray-900'}>
                        {job.failure_count}
                      </dd>
                    </div>
                  </dl>
                  {job.last_error_message && (
                    <div className="mt-2 text-xs text-red-600 bg-red-50 rounded p-2">
                      Last error: {job.last_error_message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No background jobs registered</p>
          )}
          {jobs && (
            <p className="text-xs text-gray-400 mt-3">
              As of: {formatTimestamp(jobs.timestamp)}
            </p>
          )}
        </div>
      </div>

      {/* Check History */}
      {data && (
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h2 className="text-lg font-medium text-gray-900">Check History</h2>
            <p className="text-sm text-gray-500">Recent system invariant checks</p>
          </div>
          <div className="p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 font-medium text-gray-900">Timestamp</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-900">Overall</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-900">Financial</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-900">Lifecycle</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-900">Settlement</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-900">Pipeline</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-900">Ledger</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-900">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((record) => (
                    <tr key={record.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="py-2 px-2 text-gray-600">{formatTimestamp(record.created_at)}</td>
                      <td className="py-2 px-2"><StatusBadge status={record.overall_status.toLowerCase()} /></td>
                      <td className="py-2 px-2 text-xs">{record.summary.financial_status}</td>
                      <td className="py-2 px-2 text-xs">{record.summary.lifecycle_status}</td>
                      <td className="py-2 px-2 text-xs">{record.summary.settlement_status}</td>
                      <td className="py-2 px-2 text-xs">{record.summary.pipeline_status}</td>
                      <td className="py-2 px-2 text-xs">{record.summary.ledger_status}</td>
                      <td className="py-2 px-2 text-xs text-gray-500">{record.execution_time_ms}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {historyTotal > HISTORY_PAGE_SIZE && (
              <div className="flex items-center justify-center gap-4 mt-4">
                <button
                  onClick={() => fetchHistory(historyPage - 1)}
                  disabled={historyPage === 0}
                  className="px-3 py-1 text-sm rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ← Previous
                </button>
                <span className="text-sm text-gray-600">
                  Page {historyPage + 1} of {Math.ceil(historyTotal / HISTORY_PAGE_SIZE)}
                </span>
                <button
                  onClick={() => fetchHistory(historyPage + 1)}
                  disabled={(historyPage + 1) * HISTORY_PAGE_SIZE >= historyTotal}
                  className="px-3 py-1 text-sm rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
};
