import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Switch } from '@headlessui/react';
import { getUsers } from '../api/users';
import { getUserPicks } from '../api/picks';
import { getGameConfig } from '../api/admin';
import type { User, UserWithPicks, Pick } from '../types';

const BATCH_SIZE = 10;
const REQUIRED_PICKS_PER_WEEK = 7;

// Group picks by playoff week
function groupPicksByWeek(picks: Pick[]): Map<number, Pick[]> {
  const grouped = new Map<number, Pick[]>();
  picks.forEach((pick) => {
    const week = pick.playoff_week ?? 0;
    if (!grouped.has(week)) {
      grouped.set(week, []);
    }
    grouped.get(week)!.push(pick);
  });
  return grouped;
}

export function PicksExplorer() {
  const [usersWithPicks, setUsersWithPicks] = useState<UserWithPicks[]>([]);
  const [loadingProgress, setLoadingProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [hideZeroPicks, setHideZeroPicks] = useState(true);
  // Track expanded weeks per user: Map<userId, Set<weekNumber>>
  const [expandedWeeks, setExpandedWeeks] = useState<Map<string, Set<number>>>(new Map());

  // Fetch game config to determine current playoff week
  const { data: gameConfig } = useQuery({
    queryKey: ['gameConfig'],
    queryFn: getGameConfig,
    staleTime: 60000,
  });

  const currentPlayoffWeek = gameConfig?.current_playoff_week ?? 1;

  const { data: users, isLoading: usersLoading, error: usersError } = useQuery({
    queryKey: ['adminUsers'],
    queryFn: getUsers,
    staleTime: Infinity,
  });

  const loadPicksSequentially = useCallback(async (userList: User[]) => {
    const results: UserWithPicks[] = userList.map(user => ({
      user,
      picks: [],
      loading: true,
      error: null,
    }));
    setUsersWithPicks([...results]);
    setLoadingProgress({ loaded: 0, total: userList.length });

    for (let i = 0; i < userList.length; i += BATCH_SIZE) {
      const batch = userList.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (user, batchIndex) => {
          const index = i + batchIndex;
          try {
            const picks = await getUserPicks(user.id);
            results[index] = {
              ...results[index],
              picks,
              loading: false,
            };
          } catch (err) {
            results[index] = {
              ...results[index],
              loading: false,
              error: err instanceof Error ? err.message : 'Failed to load picks',
            };
          }
        })
      );

      setUsersWithPicks([...results]);
      setLoadingProgress({ loaded: Math.min(i + BATCH_SIZE, userList.length), total: userList.length });
    }

    setLoadingProgress(null);
  }, []);

  useEffect(() => {
    if (users && users.length > 0) {
      loadPicksSequentially(users);
    }
  }, [users, loadPicksSequentially]);

  const toggleUserExpanded = (userId: string) => {
    setExpandedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (usersWithPicks.length > 0) {
      setExpandedUsers(new Set(usersWithPicks.map(u => u.user.id)));
    }
  };

  const collapseAll = () => {
    setExpandedUsers(new Set());
  };

  // Toggle week expansion for a specific user
  const toggleWeekExpanded = (userId: string, weekNumber: number) => {
    setExpandedWeeks(prev => {
      const newMap = new Map(prev);
      const userWeeks = new Set(newMap.get(userId) ?? []);
      if (userWeeks.has(weekNumber)) {
        userWeeks.delete(weekNumber);
      } else {
        userWeeks.add(weekNumber);
      }
      newMap.set(userId, userWeeks);
      return newMap;
    });
  };

  // Check if a week is expanded for a user
  const isWeekExpanded = (userId: string, weekNumber: number): boolean => {
    const userWeeks = expandedWeeks.get(userId);
    if (!userWeeks) {
      // Default: current week expanded, others collapsed
      return weekNumber === currentPlayoffWeek;
    }
    return userWeeks.has(weekNumber);
  };

  // Initialize expanded weeks for a user when they're first expanded
  const initializeUserWeeks = (userId: string) => {
    if (!expandedWeeks.has(userId)) {
      const weeks = new Set<number>();
      // Auto-expand current playoff week
      weeks.add(currentPlayoffWeek);
      setExpandedWeeks(prev => new Map(prev).set(userId, weeks));
    }
  };

  const totalPicks = usersWithPicks.reduce((sum, u) => sum + u.picks.length, 0);
  const usersWithPicksCount = usersWithPicks.filter(u => u.picks.length > 0).length;
  const usersWithZeroPicksCount = usersWithPicks.filter(u => u.picks.length === 0 && !u.loading).length;

  // Filter users based on toggle state
  const displayedUsers = hideZeroPicks
    ? usersWithPicks.filter(u => u.picks.length > 0 || u.loading)
    : usersWithPicks;

  if (usersLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Admin Picks Explorer (Pre-Game)</h1>
          <p className="mt-1 text-sm text-gray-600">Loading users...</p>
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (usersError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Admin Picks Explorer (Pre-Game)</h1>
        </div>
        <div className="rounded-md bg-red-50 border border-red-200 p-4">
          <p className="text-sm text-red-800">
            Failed to load users: {usersError instanceof Error ? usersError.message : 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Admin Picks Explorer (Pre-Game)</h1>
        <p className="mt-1 text-sm text-gray-600">
          View all user picks before games start. This works independently of the leaderboard.
        </p>
      </div>

      {/* Info Banner */}
      <div className="rounded-md bg-blue-50 border border-blue-200 p-4">
        <div className="flex">
          <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
          </svg>
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              This view shows picks even when scores are zero and the leaderboard is empty.
              Use it to verify that user picks are being saved correctly.
            </p>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Summary</h2>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-md p-3">
              <dt className="text-sm font-medium text-gray-500">Total Users</dt>
              <dd className="mt-1 text-2xl font-semibold text-gray-900">{users?.length ?? 0}</dd>
            </div>
            <div className="bg-gray-50 rounded-md p-3">
              <dt className="text-sm font-medium text-gray-500">Users with Picks</dt>
              <dd className="mt-1 text-2xl font-semibold text-indigo-600">{usersWithPicksCount}</dd>
            </div>
            <div className="bg-gray-50 rounded-md p-3">
              <dt className="text-sm font-medium text-gray-500">Total Picks</dt>
              <dd className="mt-1 text-2xl font-semibold text-gray-900">{totalPicks}</dd>
            </div>
            <div className="bg-gray-50 rounded-md p-3">
              <dt className="text-sm font-medium text-gray-500">Load Status</dt>
              <dd className="mt-1">
                {loadingProgress ? (
                  <span className="text-sm text-gray-600">
                    Loading {loadingProgress.loaded}/{loadingProgress.total}...
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-medium text-green-800">
                    Complete
                  </span>
                )}
              </dd>
            </div>
          </div>
        </div>
      </div>

      {/* Picks by User */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-medium text-gray-900">Picks by User</h2>
            <p className="text-sm text-gray-500">Click a user to expand their picks</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Hide {usersWithZeroPicksCount} (0 picks)</span>
              <Switch
                checked={hideZeroPicks}
                onChange={setHideZeroPicks}
                className={`${
                  hideZeroPicks ? 'bg-indigo-600' : 'bg-gray-400'
                } relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
              >
                <span className="sr-only">Hide users with zero picks</span>
                <span
                  className={`${
                    hideZeroPicks ? 'translate-x-5' : 'translate-x-0.5'
                  } inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform`}
                />
              </Switch>
            </div>
            <span className="text-gray-300">|</span>
            <button
              onClick={expandAll}
              className="text-sm text-indigo-600 hover:text-indigo-500"
            >
              Expand All
            </button>
            <span className="text-gray-300">|</span>
            <button
              onClick={collapseAll}
              className="text-sm text-indigo-600 hover:text-indigo-500"
            >
              Collapse All
            </button>
          </div>
        </div>
        <div className="divide-y divide-gray-200">
          {displayedUsers.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              {hideZeroPicks && usersWithPicks.length > 0
                ? 'No users with picks yet'
                : 'No users found'}
            </div>
          ) : (
            displayedUsers.map(({ user, picks, loading, error }) => (
              <div key={user.id} className="bg-white">
                <button
                  onClick={() => toggleUserExpanded(user.id)}
                  className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <svg
                      className={`h-4 w-4 text-gray-400 transition-transform ${expandedUsers.has(user.id) ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="2"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                    <div>
                      <span className="font-medium text-gray-900">
                        {user.name || user.username || user.email || 'Unknown User'}
                      </span>
                      {user.email && user.name && (
                        <span className="ml-2 text-sm text-gray-500">{user.email}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {loading ? (
                      <span className="text-sm text-gray-400">Loading...</span>
                    ) : error ? (
                      <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                        Error
                      </span>
                    ) : (
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        picks.length > 0 ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {picks.length} pick{picks.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {user.is_admin && (
                      <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800">
                        Admin
                      </span>
                    )}
                  </div>
                </button>

                {expandedUsers.has(user.id) && (
                  <div className="px-4 pb-4">
                    {loading ? (
                      <div className="animate-pulse space-y-2 pl-7">
                        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                      </div>
                    ) : error ? (
                      <div className="pl-7 text-sm text-red-600">{error}</div>
                    ) : picks.length === 0 ? (
                      <div className="pl-7 text-sm text-gray-500">No picks yet</div>
                    ) : (
                      <div className="pl-7 space-y-2">
                        {(() => {
                          const groupedPicks = groupPicksByWeek(picks);
                          const weeks = Array.from(groupedPicks.keys()).sort((a, b) => a - b);
                          initializeUserWeeks(user.id);

                          return weeks.map((weekNum) => {
                            const weekPicks = groupedPicks.get(weekNum) ?? [];
                            const isExpanded = isWeekExpanded(user.id, weekNum);
                            const isCurrentWeek = weekNum === currentPlayoffWeek;
                            const isIncomplete = weekPicks.length < REQUIRED_PICKS_PER_WEEK;

                            return (
                              <div
                                key={weekNum}
                                className={`rounded-md border ${
                                  isCurrentWeek
                                    ? 'border-indigo-200 bg-indigo-50/30'
                                    : 'border-gray-200 bg-gray-50/50'
                                }`}
                              >
                                {/* Week Header */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleWeekExpanded(user.id, weekNum);
                                  }}
                                  className="w-full px-3 py-2 text-left flex items-center justify-between hover:bg-gray-100/50 rounded-t-md"
                                >
                                  <div className="flex items-center gap-2">
                                    <svg
                                      className={`h-3.5 w-3.5 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      strokeWidth="2"
                                      stroke="currentColor"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                                    </svg>
                                    <span className={`text-sm font-medium ${isCurrentWeek ? 'text-indigo-700' : 'text-gray-700'}`}>
                                      Playoff Week {weekNum}
                                    </span>
                                    {isCurrentWeek && (
                                      <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                                        Current
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {isIncomplete && (
                                      <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                                        {weekPicks.length}/{REQUIRED_PICKS_PER_WEEK}
                                      </span>
                                    )}
                                    <span className={`text-xs ${isIncomplete ? 'text-yellow-600' : 'text-gray-500'}`}>
                                      {weekPicks.length} pick{weekPicks.length !== 1 ? 's' : ''}
                                    </span>
                                  </div>
                                </button>

                                {/* Week Picks Table */}
                                {isExpanded && (
                                  <div className="px-3 pb-2">
                                    <table className="min-w-full divide-y divide-gray-200">
                                      <thead>
                                        <tr>
                                          <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Player
                                          </th>
                                          <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Pos
                                          </th>
                                          <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Team
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {weekPicks.map((pick) => (
                                          <tr key={pick.id} className="hover:bg-white/50">
                                            <td className="px-2 py-1.5 text-sm text-gray-900">
                                              {pick.full_name || 'Unknown Player'}
                                            </td>
                                            <td className="px-2 py-1.5 text-sm text-gray-600">
                                              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-gray-100">
                                                {pick.player_position || pick.position || '—'}
                                              </span>
                                            </td>
                                            <td className="px-2 py-1.5 text-sm text-gray-600">
                                              {pick.team || '—'}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
