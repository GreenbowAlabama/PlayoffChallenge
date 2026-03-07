import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getIncompleteLineups,
  getAllLineups,
  getGameConfig,
} from '../api/admin';
import { getUserPicks } from '../api/picks';
import { getUsers } from '../api/users';
import type { User, UserWithPicks, Pick } from '../types';

type LineupView = 'incomplete' | 'complete' | 'all';
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

export function Lineups() {
  const [lineupView, setLineupView] = useState<LineupView>('incomplete');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [usersWithPicks, setUsersWithPicks] = useState<UserWithPicks[]>([]);
  const [loadingProgress, setLoadingProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [expandedWeeks, setExpandedWeeks] = useState<Map<string, Set<number>>>(new Map());

  // Fetch game config
  const { data: gameConfig } = useQuery({
    queryKey: ['gameConfig'],
    queryFn: getGameConfig,
    staleTime: 60000,
  });

  const currentPlayoffWeek = gameConfig?.current_playoff_week ?? 1;

  // Incomplete lineups
  const { data: incompleteLineups, isLoading: incompleteLoading, refetch: refetchIncomplete } = useQuery({
    queryKey: ['incompleteLineups'],
    queryFn: getIncompleteLineups,
    staleTime: Infinity,
  });

  // All lineups
  const { data: allLineups, isLoading: allLineupsLoading, refetch: refetchAllLineups } = useQuery({
    queryKey: ['allLineups'],
    queryFn: getAllLineups,
    staleTime: Infinity,
    enabled: lineupView !== 'incomplete',
  });

  // Load all users for picks
  const { data: users } = useQuery({
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

  const isWeekExpanded = (userId: string, weekNumber: number): boolean => {
    const userWeeks = expandedWeeks.get(userId);
    if (!userWeeks) {
      return weekNumber === currentPlayoffWeek;
    }
    return userWeeks.has(weekNumber);
  };

  const initializeUserWeeks = (userId: string) => {
    if (!expandedWeeks.has(userId)) {
      const weeks = new Set<number>();
      weeks.add(currentPlayoffWeek);
      setExpandedWeeks(prev => new Map(prev).set(userId, weeks));
    }
  };

  // Get lineup data
  const getLineupsData = () => {
    if (lineupView === 'incomplete') {
      return incompleteLineups?.users ?? [];
    }
    if (!allLineups) return [];
    if (lineupView === 'complete') {
      return allLineups.users.filter(u => u.isComplete);
    }
    return allLineups.users;
  };

  const lineupsToShow = getLineupsData();
  const isLineupLoading = lineupView === 'incomplete' ? incompleteLoading : allLineupsLoading;

  // Get selected user's picks
  const selectedUserWithPicks = selectedUserId
    ? usersWithPicks.find(u => u.user.id === selectedUserId)
    : null;

  const handleRefreshLineups = () => {
    if (lineupView === 'incomplete') {
      refetchIncomplete();
    } else {
      refetchAllLineups();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Lineups & Picks Management</h1>
        <p className="mt-1 text-sm text-gray-600">
          View and manage user lineups and their player picks
        </p>
      </div>

      {/* Summary Stats */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Lineup Summary</h2>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-md p-3">
              <dt className="text-sm font-medium text-gray-500">Incomplete</dt>
              <dd className="mt-1 text-2xl font-semibold text-yellow-600">
                {incompleteLineups?.incompleteCount ?? 0}
              </dd>
            </div>
            <div className="bg-gray-50 rounded-md p-3">
              <dt className="text-sm font-medium text-gray-500">Complete</dt>
              <dd className="mt-1 text-2xl font-semibold text-green-600">
                {(incompleteLineups?.totalPaidUsers ?? 0) - (incompleteLineups?.incompleteCount ?? 0)}
              </dd>
            </div>
            <div className="bg-gray-50 rounded-md p-3">
              <dt className="text-sm font-medium text-gray-500">Total Users</dt>
              <dd className="mt-1 text-2xl font-semibold text-gray-900">
                {incompleteLineups?.totalPaidUsers ?? 0}
              </dd>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lineups Table */}
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-medium text-gray-900">Lineups</h2>
                <p className="text-sm text-gray-500">
                  Week {incompleteLineups?.weekNumber ?? '—'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="inline-flex rounded-md shadow-sm">
                  <button
                    onClick={() => setLineupView('incomplete')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-l-md border ${
                      lineupView === 'incomplete'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Incomplete
                  </button>
                  <button
                    onClick={() => setLineupView('complete')}
                    className={`px-3 py-1.5 text-xs font-medium border-t border-b ${
                      lineupView === 'complete'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Complete
                  </button>
                  <button
                    onClick={() => setLineupView('all')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-r-md border ${
                      lineupView === 'all'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    All
                  </button>
                </div>
                <button
                  onClick={handleRefreshLineups}
                  className="text-sm text-indigo-600 hover:text-indigo-500"
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>
          <div className="p-4 max-h-96 overflow-y-auto">
            {isLineupLoading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded"></div>
              </div>
            ) : lineupsToShow.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                {lineupView === 'incomplete' ? 'All lineups complete!' : 'No lineups found'}
              </div>
            ) : (
              <div className="space-y-1">
                {lineupsToShow.map((user) => (
                  <button
                    key={user.userId}
                    onClick={() => setSelectedUserId(user.userId)}
                    className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                      selectedUserId === user.userId
                        ? 'bg-indigo-50 ring-1 ring-indigo-200'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium text-gray-900">
                          {user.username || user.email}
                        </span>
                        {user.isAdmin && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                            Admin
                          </span>
                        )}
                      </div>
                      <span className={`text-xs font-medium px-2 py-1 rounded ${
                        'isComplete' in user && user.isComplete
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {user.totalPicks}/{incompleteLineups?.totalRequired ?? 0}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Picks Detail */}
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h2 className="text-lg font-medium text-gray-900">
              {selectedUserWithPicks ? `Picks: ${selectedUserWithPicks.user.name || selectedUserWithPicks.user.email}` : 'Select a user'}
            </h2>
            <p className="text-sm text-gray-500">Player picks by week</p>
          </div>
          <div className="p-4 max-h-96 overflow-y-auto">
            {!selectedUserWithPicks ? (
              <div className="text-center py-8 text-gray-500">
                Select a user from the lineup table to view their picks
              </div>
            ) : selectedUserWithPicks.loading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded"></div>
              </div>
            ) : selectedUserWithPicks.error ? (
              <div className="text-sm text-red-600">{selectedUserWithPicks.error}</div>
            ) : selectedUserWithPicks.picks.length === 0 ? (
              <div className="text-center py-4 text-gray-500">No picks yet</div>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const groupedPicks = groupPicksByWeek(selectedUserWithPicks.picks);
                  const weeks = Array.from(groupedPicks.keys()).sort((a, b) => a - b);
                  initializeUserWeeks(selectedUserWithPicks.user.id);

                  return weeks.map((weekNum) => {
                    const weekPicks = groupedPicks.get(weekNum) ?? [];
                    const isExpanded = isWeekExpanded(selectedUserWithPicks.user.id, weekNum);
                    const isCurrentWeek = weekNum === currentPlayoffWeek;
                    const isIncomplete = weekPicks.length < REQUIRED_PICKS_PER_WEEK;

                    return (
                      <div
                        key={weekNum}
                        className={`rounded-md border ${
                          isCurrentWeek
                            ? 'border-indigo-200 bg-indigo-50/30'
                            : 'border-gray-200'
                        }`}
                      >
                        <button
                          onClick={() => toggleWeekExpanded(selectedUserWithPicks.user.id, weekNum)}
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
                              Week {weekNum}
                            </span>
                            {isCurrentWeek && (
                              <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                                Current
                              </span>
                            )}
                          </div>
                          <span className={`text-xs ${isIncomplete ? 'text-yellow-600 font-medium' : 'text-gray-500'}`}>
                            {weekPicks.length}/{REQUIRED_PICKS_PER_WEEK}
                          </span>
                        </button>

                        {isExpanded && weekPicks.length > 0 && (
                          <div className="px-3 py-2 border-t border-gray-200">
                            <table className="min-w-full text-xs">
                              <thead>
                                <tr>
                                  <th className="text-left py-1 px-2 font-medium text-gray-600">Player</th>
                                  <th className="text-left py-1 px-2 font-medium text-gray-600">Pos</th>
                                  <th className="text-left py-1 px-2 font-medium text-gray-600">Team</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {weekPicks.map((pick) => (
                                  <tr key={pick.id} className="hover:bg-white/50">
                                    <td className="py-1 px-2 text-gray-900">{pick.full_name || 'Unknown'}</td>
                                    <td className="py-1 px-2 text-gray-600">
                                      <span className="inline-flex items-center rounded px-1 py-0.5 text-xs bg-gray-100">
                                        {pick.player_position || pick.position || '—'}
                                      </span>
                                    </td>
                                    <td className="py-1 px-2 text-gray-600">{pick.team || '—'}</td>
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
        </div>
      </div>
    </div>
  );
}
