/**
 * System Health Panel
 *
 * Read-only operational health monitoring for the Admin console.
 * Displays system status, infrastructure health, background jobs, and cache status.
 *
 * This panel answers:
 * - "Is anything broken right now?"
 * - "Are background jobs running?"
 * - "Are external data providers reachable?"
 *
 * No mutations. No auto-remediation. Visibility only.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getHealthCheck, getJobsStatus, getCacheStatus } from '../api/diagnostics';
import type {
  HealthCheckResponse,
  JobsStatusResponse,
  JobStatus,
  CacheStatusResponse,
} from '../types';

// ============================================
// STATUS BADGE COMPONENT
// ============================================

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
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] || colors.unknown}`}
    >
      {status}
    </span>
  );
}

// ============================================
// HELPER FUNCTIONS
// ============================================

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

// ============================================
// OVERALL STATUS CARD
// ============================================

interface OverallStatusCardProps {
  health: HealthCheckResponse | undefined;
  isLoading: boolean;
  error: Error | null;
}

function OverallStatusCard({ health, isLoading, error }: OverallStatusCardProps) {
  if (isLoading) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
        <div className="animate-pulse space-y-2">
          <div className="h-6 bg-gray-200 rounded w-24"></div>
          <div className="h-4 bg-gray-200 rounded w-48"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">Failed to load health status</p>
      </div>
    );
  }

  if (!health) return null;

  const { api_process } = health.checks;

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">Overall Status</span>
        <StatusBadge status={health.status} />
      </div>
      <div className="text-xs text-gray-500 space-x-3">
        <span>Uptime: {formatUptime(api_process.uptime_seconds)}</span>
        <span>·</span>
        <span>Memory: {api_process.memory_usage_mb} MB</span>
        <span>·</span>
        <span>Env: {api_process.environment}</span>
      </div>
    </div>
  );
}

// ============================================
// INFRASTRUCTURE CARD
// ============================================

interface InfrastructureCardProps {
  health: HealthCheckResponse | undefined;
  isLoading: boolean;
  error: Error | null;
}

function InfrastructureCard({ health, isLoading, error }: InfrastructureCardProps) {
  if (isLoading) {
    return (
      <div className="rounded-md border border-gray-200 p-4">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex justify-between">
              <div className="h-4 bg-gray-200 rounded w-24"></div>
              <div className="h-4 bg-gray-200 rounded w-16"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">Failed to load infrastructure status</p>
      </div>
    );
  }

  if (!health) return null;

  const { database, espn_api, sleeper_api } = health.checks;

  const components = [
    { name: 'Database', data: database },
    { name: 'ESPN API', data: espn_api },
    { name: 'Sleeper API', data: sleeper_api },
  ];

  return (
    <div className="rounded-md border border-gray-200 p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-3">Infrastructure</h3>
      <div className="space-y-2">
        {components.map(({ name, data }) => (
          <div key={name} className="flex items-center justify-between text-sm">
            <span className="text-gray-600">{name}</span>
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-xs">
                {data.latency_ms != null ? `${data.latency_ms}ms` : '—'}
              </span>
              <StatusBadge status={data.status} />
            </div>
          </div>
        ))}
      </div>
      {(database.error || espn_api.error || sleeper_api.error) && (
        <div className="mt-3 space-y-1">
          {database.error && (
            <p className="text-xs text-red-600">Database: {database.error}</p>
          )}
          {espn_api.error && (
            <p className="text-xs text-red-600">ESPN: {espn_api.error}</p>
          )}
          {sleeper_api.error && (
            <p className="text-xs text-red-600">Sleeper: {sleeper_api.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// BACKGROUND JOBS CARD
// ============================================

interface BackgroundJobsCardProps {
  jobs: JobsStatusResponse | undefined;
  isLoading: boolean;
  error: Error | null;
}

function BackgroundJobsCard({ jobs, isLoading, error }: BackgroundJobsCardProps) {
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="rounded-md border border-gray-200 p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-32"></div>
          <div className="h-12 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">Failed to load job status</p>
      </div>
    );
  }

  if (!jobs) return null;

  const { summary } = jobs;

  const toggleJob = (jobName: string) => {
    setExpandedJob(expandedJob === jobName ? null : jobName);
  };

  return (
    <div className="rounded-md border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700">Background Jobs</h3>
        <StatusBadge status={summary.status} />
      </div>

      <p className="text-xs text-gray-500 mb-3">
        {summary.job_count} jobs · {summary.healthy ?? 0} healthy · {summary.error ?? 0} errors
        {summary.running ? ` · ${summary.running} running` : ''}
      </p>

      {jobs.jobs.length === 0 ? (
        <p className="text-sm text-gray-500">{summary.message || 'No background jobs registered'}</p>
      ) : (
        <div className="space-y-2">
          {jobs.jobs.map((job: JobStatus) => (
            <div key={job.name} className="border border-gray-100 rounded">
              <button
                onClick={() => toggleJob(job.name)}
                className="w-full flex items-center justify-between p-2 text-left hover:bg-gray-50"
              >
                <div className="flex items-center gap-2">
                  <svg
                    className={`h-3 w-3 text-gray-400 transform transition-transform ${expandedJob === job.name ? 'rotate-90' : ''}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm text-gray-700">{job.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">
                    {job.last_run_at ? `Last: ${formatTimestamp(job.last_run_at)}` : 'Never run'}
                  </span>
                  <StatusBadge status={job.status} />
                </div>
              </button>

              {expandedJob === job.name && (
                <div className="px-4 pb-3 pt-1 border-t border-gray-100 bg-gray-50">
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-gray-500">Last Run</dt>
                      <dd className="text-gray-900">{formatTimestamp(job.last_run_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Last Success</dt>
                      <dd className="text-gray-900">{formatTimestamp(job.last_success_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Last Error</dt>
                      <dd className="text-gray-900">{formatTimestamp(job.last_error_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Run Count</dt>
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
                      {job.last_error_message}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// LIVE STATS CACHE CARD
// ============================================

interface LiveStatsCacheCardProps {
  cache: CacheStatusResponse | undefined;
  isLoading: boolean;
  error: Error | null;
}

function LiveStatsCacheCard({ cache, isLoading, error }: LiveStatsCacheCardProps) {
  if (isLoading) {
    return (
      <div className="rounded-md border border-gray-200 p-4">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-gray-200 rounded w-32"></div>
          <div className="h-4 bg-gray-200 rounded w-48"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">Failed to load cache status</p>
      </div>
    );
  }

  if (!cache) return null;

  return (
    <div className="rounded-md border border-gray-200 p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-3">Live Stats Cache</h3>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Active Games</span>
          <span className="text-gray-900">{cache.activeGames.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Cached Players</span>
          <span className="text-gray-900">{cache.cachedPlayerCount}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Last Scoreboard Update</span>
          <span className={cache.lastScoreboardUpdate ? 'text-gray-900' : 'text-gray-400'}>
            {cache.lastScoreboardUpdate
              ? formatTimestamp(cache.lastScoreboardUpdate)
              : 'No recent update'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================
// MAIN SYSTEM HEALTH PANEL
// ============================================

export function SystemHealthPanel() {
  const healthQuery = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: getHealthCheck,
    refetchInterval: 30000,
  });

  const jobsQuery = useQuery({
    queryKey: ['admin', 'jobs'],
    queryFn: getJobsStatus,
    refetchInterval: 30000,
  });

  const cacheQuery = useQuery({
    queryKey: ['admin', 'cacheStatus'],
    queryFn: getCacheStatus,
    refetchInterval: 30000,
  });

  const isAnyFetching =
    healthQuery.isFetching || jobsQuery.isFetching || cacheQuery.isFetching;

  const handleRefresh = () => {
    healthQuery.refetch();
    jobsQuery.refetch();
    cacheQuery.refetch();
  };

  // Determine last checked timestamp from health response
  const lastChecked = healthQuery.data?.timestamp;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900">System Health</h2>
            <p className="text-sm text-gray-500">
              {lastChecked
                ? `Last checked: ${formatTimestamp(lastChecked)}`
                : 'Read-only system status'}
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

      <div className="p-4 space-y-4">
        <OverallStatusCard
          health={healthQuery.data}
          isLoading={healthQuery.isLoading}
          error={healthQuery.error}
        />

        <InfrastructureCard
          health={healthQuery.data}
          isLoading={healthQuery.isLoading}
          error={healthQuery.error}
        />

        <BackgroundJobsCard
          jobs={jobsQuery.data}
          isLoading={jobsQuery.isLoading}
          error={jobsQuery.error}
        />

        <LiveStatsCacheCard
          cache={cacheQuery.data}
          isLoading={cacheQuery.isLoading}
          error={cacheQuery.error}
        />
      </div>
    </div>
  );
}
