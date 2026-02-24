/**
 * Diagnostics Users List
 *
 * Read-only user list with diagnostic information.
 * Click on a user to view their detail + timeline.
 *
 * No auto-refresh. No actions.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getAllUserDiagnostics } from '../api/diagnostics';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString();
}

function AuthBadge({ provider }: { provider: string }) {
  const colors: Record<string, string> = {
    apple: 'bg-gray-900 text-white',
    email: 'bg-blue-100 text-blue-800',
    unknown: 'bg-gray-100 text-gray-600',
  };

  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${colors[provider] || colors.unknown}`}>
      {provider}
    </span>
  );
}

function BooleanBadge({ value, trueLabel, falseLabel }: { value: boolean; trueLabel: string; falseLabel: string }) {
  return value ? (
    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
      {trueLabel}
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
      {falseLabel}
    </span>
  );
}

export function DiagnosticsUsers() {
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['diagnostics', 'users'],
    queryFn: getAllUserDiagnostics,
    staleTime: Infinity,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link
              to="/diagnostics"
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ← Diagnostics
            </Link>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">User Diagnostics</h1>
          <p className="mt-1 text-sm text-gray-500">
            Read-only user entitlement and auth information
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
        >
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Users Table */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6">
            <div className="animate-pulse space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-8 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="p-6 text-red-600">Failed to load users</div>
        ) : data ? (
          <>
            <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-sm text-gray-600">
                {data.count} users • Click a row to view timeline
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="py-3 pl-4 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      User
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Auth
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Status
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      State
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Created
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Last Activity
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {data.users.map((user) => (
                    <tr
                      key={user.user_id}
                      className="hover:bg-gray-50"
                    >
                      <td className="whitespace-nowrap py-3 pl-4 pr-3">
                        <Link
                          to={`/diagnostics/users/${user.user_id}`}
                          className="block"
                        >
                          <div className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
                            {user.username || user.email || 'No username'}
                          </div>
                          <div className="text-xs text-gray-500 font-mono">
                            {user.user_id.slice(0, 8)}...
                          </div>
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <AuthBadge provider={user.auth_provider} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          <BooleanBadge value={user.paid} trueLabel="Paid" falseLabel="Unpaid" />
                          {user.is_admin && (
                            <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
                              Admin
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-500">
                        {user.state || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-500">
                        {formatDate(user.account_created_at)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-500">
                        {formatDate(user.last_activity_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>

      {data && (
        <p className="text-xs text-gray-400">
          Data as of: {new Date(data.timestamp).toLocaleString()}
        </p>
      )}
    </div>
  );
}
