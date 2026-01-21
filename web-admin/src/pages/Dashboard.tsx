import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCacheStatus,
  getUsers,
  getGameConfig,
  getIncompleteLineups,
} from '../api/admin';

export function Dashboard() {
  const queryClient = useQueryClient();

  // Read-only queries with auto-refresh
  const { data: cacheStatus, isLoading: cacheLoading } = useQuery({
    queryKey: ['cacheStatus'],
    queryFn: getCacheStatus,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  const { data: userStats, isLoading: usersLoading } = useQuery({
    queryKey: ['userStats'],
    queryFn: getUsers,
    refetchInterval: 30000,
  });

  // Fetch game config for week status display
  const { data: gameConfig } = useQuery({
    queryKey: ['gameConfig'],
    queryFn: getGameConfig,
    refetchInterval: 30000,
  });

  // Incomplete lineups query (read-only visibility)
  const { data: incompleteLineups, isLoading: incompleteLineupsLoading, refetch: refetchIncompleteLineups } = useQuery({
    queryKey: ['incompleteLineups'],
    queryFn: getIncompleteLineups,
    refetchInterval: 30000,
  });

  // Calculate current NFL week from game settings
  const currentNflWeek = gameConfig
    ? gameConfig.playoff_start_week + gameConfig.current_playoff_week - 1
    : null;
  const nextNflWeek = currentNflWeek ? currentNflWeek + 1 : null;
  const currentPlayoffWeek = gameConfig?.current_playoff_week ?? null;
  const isWeekLocked = gameConfig ? !gameConfig.is_week_active : false;

  const isLoading = cacheLoading || usersLoading;
  const cacheHealthy = cacheStatus?.lastScoreboardUpdate !== null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600">
          Overview of contest status and system health
        </p>
      </div>

      {/* Current Week Status Banner - Always visible at-a-glance status */}
      <div className={`rounded-lg border-2 p-4 ${
        isWeekLocked
          ? 'border-red-300 bg-red-50'
          : 'border-green-300 bg-green-50'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            {/* Lock Status Icon */}
            <div className="flex-shrink-0">
              {isWeekLocked ? (
                <div className="flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
                  <svg className="h-6 w-6 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                </div>
              ) : (
                <div className="flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
                  <svg className="h-6 w-6 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
                  </svg>
                </div>
              )}
            </div>

            {/* Week Info */}
            <div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-semibold text-gray-900">
                  Playoff Week {currentPlayoffWeek ?? '—'}
                </span>
                <span className="text-gray-400">|</span>
                <span className="text-lg text-gray-700">
                  NFL Week {currentNflWeek ?? '—'}
                </span>
              </div>
              <div className={`text-sm font-medium ${isWeekLocked ? 'text-red-700' : 'text-green-700'}`}>
                {isWeekLocked
                  ? 'Week is LOCKED — Users cannot modify picks'
                  : 'Week is UNLOCKED — Users can modify picks'}
              </div>
            </div>
          </div>

          {/* Next Week Info + Admin Link */}
          <div className="text-right">
            <div className="text-sm text-gray-500">Next Week</div>
            <div className="text-sm font-medium text-gray-700">
              Playoff Week {currentPlayoffWeek !== null ? currentPlayoffWeek + 1 : '—'} / NFL Week {nextNflWeek ?? '—'}
            </div>
            <Link
              to="/admin"
              className="mt-2 inline-flex items-center text-xs text-indigo-600 hover:text-indigo-500"
            >
              Manage week state
              <svg className="ml-1 h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </Link>
          </div>
        </div>
      </div>

      {/* Quick Links Panel */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Quick Links</h2>
          <p className="text-sm text-gray-500">Navigate to detailed views</p>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link
              to="/picks"
              className="flex flex-col items-center p-4 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
            >
              <svg className="h-8 w-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              <span className="mt-2 text-sm font-medium text-gray-900">Picks</span>
              <span className="text-xs text-gray-500">View all picks</span>
            </Link>

            <Link
              to="/trends"
              className="flex flex-col items-center p-4 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
            >
              <svg className="h-8 w-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
              </svg>
              <span className="mt-2 text-sm font-medium text-gray-900">Trends</span>
              <span className="text-xs text-gray-500">View analytics</span>
            </Link>

            <Link
              to="/diagnostics"
              className="flex flex-col items-center p-4 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
            >
              <svg className="h-8 w-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="mt-2 text-sm font-medium text-gray-900">Diagnostics</span>
              <span className="text-xs text-gray-500">System health</span>
            </Link>

            <Link
              to="/admin"
              className="flex flex-col items-center p-4 rounded-lg border border-amber-200 bg-amber-50 hover:border-amber-300 hover:bg-amber-100 transition-colors"
            >
              <svg className="h-8 w-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="mt-2 text-sm font-medium text-gray-900">Admin</span>
              <span className="text-xs text-amber-700">Manage contest</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Game State Panel (Read-Only) */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">System Health</h2>
          <p className="text-sm text-gray-500">Read-only system status</p>
        </div>
        <div className="p-4">
          {isLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/3"></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Link to="/users" className="bg-gray-50 rounded-md p-3 block hover:bg-gray-100 transition-colors">
                <dt className="text-sm font-medium text-gray-500">Users</dt>
                <dd className="mt-1 text-2xl font-semibold text-indigo-600">
                  {userStats?.count ?? '—'}
                </dd>
                <span className="text-xs text-indigo-500">View all</span>
              </Link>
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">Cached Players</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {cacheStatus?.cachedPlayerCount ?? '—'}
                </dd>
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">Active Games</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {cacheStatus?.activeGames?.length ?? '—'}
                </dd>
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">Cache Status</dt>
                <dd className="mt-1">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium ${
                      cacheHealthy
                        ? 'bg-green-100 text-green-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {cacheHealthy ? 'Healthy' : 'Stale'}
                  </span>
                </dd>
              </div>
            </div>
          )}
          <div className="mt-4 text-right">
            <button
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['cacheStatus'] });
                queryClient.invalidateQueries({ queryKey: ['userStats'] });
              }}
              className="text-sm text-indigo-600 hover:text-indigo-500"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Incomplete Lineups Panel (Read-Only Visibility) */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-900">Incomplete Lineups</h2>
              <p className="text-sm text-gray-500">
                Users with incomplete lineups for Week {incompleteLineups?.weekNumber ?? '—'}
                {incompleteLineups?.isWeekActive === false && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                    Week Locked
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={() => refetchIncompleteLineups()}
              className="text-sm text-indigo-600 hover:text-indigo-500"
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="p-4">
          {incompleteLineupsLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/4"></div>
              <div className="h-8 bg-gray-200 rounded"></div>
            </div>
          ) : incompleteLineups?.message ? (
            <div className="text-sm text-gray-500 italic">{incompleteLineups.message}</div>
          ) : (
            <>
              {/* Summary stats */}
              <div className="mb-4 grid grid-cols-3 gap-4 text-sm">
                <div className="bg-gray-50 rounded-md p-2">
                  <span className="text-gray-600">Incomplete:</span>
                  <span className={`ml-1 font-medium ${
                    (incompleteLineups?.incompleteCount ?? 0) > 0 ? 'text-yellow-700' : 'text-green-700'
                  }`}>
                    {incompleteLineups?.incompleteCount ?? 0}
                  </span>
                </div>
                <div className="bg-gray-50 rounded-md p-2">
                  <span className="text-gray-600">Total Paid Users:</span>
                  <span className="ml-1 font-medium text-gray-900">{incompleteLineups?.totalPaidUsers ?? 0}</span>
                </div>
                <div className="bg-gray-50 rounded-md p-2">
                  <span className="text-gray-600">Required Picks:</span>
                  <span className="ml-1 font-medium text-gray-900">{incompleteLineups?.totalRequired ?? 0}</span>
                </div>
              </div>

              {/* Incomplete users table */}
              {(incompleteLineups?.users?.length ?? 0) === 0 ? (
                <div className="text-center py-4">
                  <svg className="mx-auto h-8 w-8 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <p className="mt-2 text-sm text-green-700 font-medium">All paid users have complete lineups</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 pr-4 font-medium text-gray-600">User</th>
                        <th className="text-left py-2 px-2 font-medium text-gray-600">Picks</th>
                        <th className="text-left py-2 px-2 font-medium text-gray-600">Missing Positions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incompleteLineups?.users?.map((user) => (
                        <tr key={user.userId} className="border-b border-gray-100">
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-900">{user.username || user.email}</span>
                              {user.isAdmin && (
                                <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                                  Admin
                                </span>
                              )}
                            </div>
                            {user.username && (
                              <div className="text-xs text-gray-500">{user.email}</div>
                            )}
                          </td>
                          <td className="py-2 px-2 text-gray-600">
                            {user.totalPicks}/{incompleteLineups?.totalRequired ?? 0}
                          </td>
                          <td className="py-2 px-2">
                            <div className="flex flex-wrap gap-1">
                              {user.missingPositions.map((pos, i) => (
                                <span key={i} className="inline-flex items-center rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-800">
                                  {pos}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
