/**
 * Diagnostics Dashboard
 *
 * Read-only diagnostics overview showing:
 * - Environment health status
 * - User statistics
 * - Background job status
 *
 * No auto-refresh. Manual refresh only.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getHealthCheck, getUserStats, getJobsStatus, getLifecycleHealth } from '../api/diagnostics';
import { LifecycleHealthPanel } from '../components/LifecycleHealthPanel';

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

export function DiagnosticsDashboard() {
  const {
    data: health,
    isLoading: healthLoading,
    error: healthError,
    refetch: refetchHealth,
    isFetching: healthFetching,
  } = useQuery({
    queryKey: ['diagnostics', 'health'],
    queryFn: getHealthCheck,
    staleTime: Infinity, // No auto-refresh
  });

  const {
    data: userStats,
    isLoading: statsLoading,
    refetch: refetchStats,
    isFetching: statsFetching,
  } = useQuery({
    queryKey: ['diagnostics', 'userStats'],
    queryFn: getUserStats,
    staleTime: Infinity,
  });

  const {
    data: jobs,
    isLoading: jobsLoading,
    refetch: refetchJobs,
    isFetching: jobsFetching,
  } = useQuery({
    queryKey: ['diagnostics', 'jobs'],
    queryFn: getJobsStatus,
    staleTime: Infinity,
  });

  const {
    refetch: refetchLifecycleHealth,
    isFetching: lifecycleFetching,
  } = useQuery({
    queryKey: ['diagnostics', 'lifecycleHealth'],
    queryFn: getLifecycleHealth,
    staleTime: Infinity,
  });

  const isAnyFetching = healthFetching || statsFetching || jobsFetching || lifecycleFetching;

  const handleRefreshAll = () => {
    refetchHealth();
    refetchStats();
    refetchJobs();
    refetchLifecycleHealth();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Diagnostics</h1>
          <p className="mt-1 text-sm text-gray-500">
            Read-only Diagnostics (No Production Actions)
          </p>
        </div>
        <button
          onClick={handleRefreshAll}
          disabled={isAnyFetching}
          className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
        >
          {isAnyFetching ? 'Refreshing...' : 'Refresh All'}
        </button>
      </div>

      {/* Health Status Panel */}
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
          ) : healthError ? (
            <p className="text-red-600 text-sm">Failed to load health status</p>
          ) : health ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* API Process */}
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

              {/* Database */}
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

              {/* ESPN API */}
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

              {/* Sleeper API */}
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

              {/* Background Jobs */}
              <div className="rounded-md border border-gray-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Background Jobs</span>
                  <StatusBadge status={health.checks.background_jobs.status} />
                </div>
                <dl className="text-xs text-gray-500 space-y-1">
                  <div className="flex justify-between">
                    <dt>Job Count</dt>
                    <dd className="text-gray-900">{health.checks.background_jobs.job_count}</dd>
                  </div>
                  {health.checks.background_jobs.message && (
                    <div className="text-gray-600 mt-1">{health.checks.background_jobs.message}</div>
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
              to="/diagnostics/users"
              className="text-sm text-indigo-600 hover:text-indigo-500"
            >
              View all users →
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
                <dt className="text-sm font-medium text-gray-500">Apple Auth</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {userStats.stats.apple_auth_users}
                </dd>
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">Email Auth</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {userStats.stats.email_auth_users}
                </dd>
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">Age Verified</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {userStats.stats.age_verified_users}
                </dd>
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">TOS Accepted</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {userStats.stats.tos_accepted_users}
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
    </div>
  );
}
