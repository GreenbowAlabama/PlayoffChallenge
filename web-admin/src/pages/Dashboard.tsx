import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCacheStatus,
  getUsers,
  getGameConfig,
  getIncompleteLineups,
  getAllLineups,
} from '../api/admin';

type LineupView = 'incomplete' | 'complete' | 'all';

// Game phase derived from ESPN game state
type GamePhase = 'pre-kickoff' | 'live' | 'post-games';

// First live score confirmation (persisted in localStorage)
interface FirstLiveScoreInfo {
  timestamp: string;
  gameId: string;
  description: string;
  weekNumber: number;
}

const FIRST_LIVE_SCORE_KEY = 'playoff_challenge_first_live_score';

function getStoredFirstLiveScore(): FirstLiveScoreInfo | null {
  try {
    const stored = localStorage.getItem(FIRST_LIVE_SCORE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function storeFirstLiveScore(info: FirstLiveScoreInfo): void {
  try {
    localStorage.setItem(FIRST_LIVE_SCORE_KEY, JSON.stringify(info));
  } catch {
    // Ignore storage errors
  }
}

export function Dashboard() {
  const queryClient = useQueryClient();
  const [lineupView, setLineupView] = useState<LineupView>('incomplete');
  const [firstLiveScore, setFirstLiveScore] = useState<FirstLiveScoreInfo | null>(getStoredFirstLiveScore);

  // Read-only queries with auto-refresh
  const { data: cacheStatus, isLoading: cacheLoading, isFetching: cacheRefetching } = useQuery({
    queryKey: ['cacheStatus'],
    queryFn: getCacheStatus,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  const { data: userStats, isLoading: usersLoading, isFetching: usersRefetching } = useQuery({
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
  const { data: incompleteLineups, isLoading: incompleteLineupsLoading, isFetching: incompleteRefetching, refetch: refetchIncompleteLineups } = useQuery({
    queryKey: ['incompleteLineups'],
    queryFn: getIncompleteLineups,
    refetchInterval: 30000,
  });

  // All lineups query (for complete/all views)
  const { data: allLineups, isLoading: allLineupsLoading, isFetching: allLineupsRefetching, refetch: refetchAllLineups } = useQuery({
    queryKey: ['allLineups'],
    queryFn: getAllLineups,
    refetchInterval: 30000,
    enabled: lineupView !== 'incomplete', // Only fetch when needed
  });

  // Derive currentNflWeek from API responses (fallback chain)
  // pick.week_number is the source of truth - if picks exist, display them
  const currentNflWeek = incompleteLineups?.weekNumber ?? allLineups?.weekNumber ?? null;
  const currentPlayoffWeek = gameConfig?.current_playoff_week ?? null;
  const isWeekLocked = gameConfig ? !gameConfig.is_week_active : false;

  // DEFENSIVE: Super Bowl detection - Playoff Week 4 is the final week
  // TODO: Remove this guard after Super Bowl when backend handles end-of-season state
  const isSuperBowlWeek = currentPlayoffWeek === 4;

  // Only compute "next week" if not at Super Bowl (there is no week after Super Bowl)
  const nextNflWeek = (!isSuperBowlWeek && currentNflWeek) ? currentNflWeek + 1 : null;
  const nextPlayoffWeek = (!isSuperBowlWeek && currentPlayoffWeek !== null) ? currentPlayoffWeek + 1 : null;

  const isLoading = cacheLoading || usersLoading;
  const isSystemHealthRefetching = cacheRefetching || usersRefetching;
  const cacheHealthy = cacheStatus?.lastScoreboardUpdate !== null;

  // Derive game phase from ESPN game state data
  const deriveGamePhase = (): GamePhase => {
    if (!cacheStatus) return 'pre-kickoff';

    const hasActiveGames = (cacheStatus.activeGames?.length ?? 0) > 0;
    const hasScoreboardUpdate = cacheStatus.lastScoreboardUpdate !== null;

    // If we have active games, we're live
    if (hasActiveGames) return 'live';

    // If we have had updates but no active games, games have concluded
    if (hasScoreboardUpdate && !hasActiveGames) return 'post-games';

    // No updates yet, awaiting first kickoff
    return 'pre-kickoff';
  };

  const gamePhase = deriveGamePhase();

  // Track first live score confirmation
  useEffect(() => {
    // Only track if we're transitioning to live phase and haven't recorded yet
    if (gamePhase === 'live' && cacheStatus && !firstLiveScore) {
      const currentWeek = currentPlayoffWeek ?? 0;
      const storedScore = getStoredFirstLiveScore();

      // Check if we already have a score for this week
      if (storedScore && storedScore.weekNumber === currentWeek) {
        setFirstLiveScore(storedScore);
        return;
      }

      // Record first live score
      const activeGame = cacheStatus.activeGames?.[0];
      const gameInfo: FirstLiveScoreInfo = {
        timestamp: new Date().toISOString(),
        gameId: typeof activeGame === 'object' && activeGame !== null && 'gameId' in activeGame
          ? String((activeGame as { gameId: unknown }).gameId)
          : 'Unknown',
        description: `First active game detected at ${new Date().toLocaleString()}`,
        weekNumber: currentWeek,
      };

      storeFirstLiveScore(gameInfo);
      setFirstLiveScore(gameInfo);
    }
  }, [gamePhase, cacheStatus, firstLiveScore, currentPlayoffWeek]);

  // Check if stored first live score is for current week
  const isFirstLiveScoreForCurrentWeek = firstLiveScore && firstLiveScore.weekNumber === (currentPlayoffWeek ?? 0);

  // Determine which lineups data to show based on view
  const getLineupsData = () => {
    if (lineupView === 'incomplete') {
      return incompleteLineups?.users ?? [];
    }
    if (!allLineups) return [];

    if (lineupView === 'complete') {
      return allLineups.users.filter(u => u.isComplete);
    }
    return allLineups.users; // 'all' view
  };

  const lineupsToShow = getLineupsData();
  const isLineupsLoading = lineupView === 'incomplete' ? incompleteLineupsLoading : allLineupsLoading;
  const isLineupsRefetching = lineupView === 'incomplete' ? incompleteRefetching : allLineupsRefetching;

  const handleLineupsRefresh = () => {
    if (lineupView === 'incomplete') {
      refetchIncompleteLineups();
    } else {
      refetchAllLineups();
    }
  };

  // Spinner component for refresh buttons
  const RefreshSpinner = () => (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );

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

          {/* Next Week Info + Admin Link - DEFENSIVE: Explicit Super Bowl state display */}
          <div className="text-right">
            {isSuperBowlWeek ? (
              <>
                <div className="text-sm text-amber-600 font-medium">Super Bowl</div>
                <div className="text-sm text-amber-700">(Final Week)</div>
              </>
            ) : (
              <>
                <div className="text-sm text-gray-500">Next Week</div>
                <div className="text-sm font-medium text-gray-700">
                  Playoff Week {nextPlayoffWeek ?? '—'} / NFL Week {nextNflWeek ?? '—'}
                </div>
              </>
            )}
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

      {/* Game Phase Indicator Banner */}
      <div className={`rounded-lg border-2 p-4 ${
        gamePhase === 'pre-kickoff'
          ? 'border-blue-300 bg-blue-50'
          : gamePhase === 'live'
            ? 'border-green-300 bg-green-50'
            : 'border-gray-300 bg-gray-50'
      }`}>
        <div className="flex items-center gap-4">
          {/* Phase Icon */}
          <div className={`flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-full ${
            gamePhase === 'pre-kickoff'
              ? 'bg-blue-100'
              : gamePhase === 'live'
                ? 'bg-green-100'
                : 'bg-gray-100'
          }`}>
            {gamePhase === 'pre-kickoff' ? (
              <svg className="h-5 w-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
              </svg>
            ) : gamePhase === 'live' ? (
              <svg className="h-5 w-5 text-green-600 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </div>

          {/* Phase Info */}
          <div className="flex-1">
            <div className={`text-lg font-semibold ${
              gamePhase === 'pre-kickoff'
                ? 'text-blue-900'
                : gamePhase === 'live'
                  ? 'text-green-900'
                  : 'text-gray-900'
            }`}>
              {gamePhase === 'pre-kickoff' && 'Pre-Kickoff'}
              {gamePhase === 'live' && 'Live Scoring Active'}
              {gamePhase === 'post-games' && 'Games Complete'}
            </div>
            <div className={`text-sm ${
              gamePhase === 'pre-kickoff'
                ? 'text-blue-700'
                : gamePhase === 'live'
                  ? 'text-green-700'
                  : 'text-gray-700'
            }`}>
              {gamePhase === 'pre-kickoff' && 'Awaiting first live game — System ready, scores will update automatically'}
              {gamePhase === 'live' && `${cacheStatus?.activeGames?.length ?? 0} active game(s) — Scores updating in real-time`}
              {gamePhase === 'post-games' && 'All scheduled games have concluded — Finalizing results'}
            </div>
          </div>

          {/* Last Update Time */}
          {cacheStatus?.lastScoreboardUpdate && (
            <div className="text-right text-sm text-gray-500">
              <div className="text-xs">Last Update</div>
              <div className="font-medium">
                {new Date(cacheStatus.lastScoreboardUpdate).toLocaleTimeString()}
              </div>
            </div>
          )}
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
                {gamePhase === 'pre-kickoff' && cacheStatus?.cachedPlayerCount === 0 && (
                  <span className="text-xs text-blue-600">Will populate at first kickoff</span>
                )}
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">Active Games</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {cacheStatus?.activeGames?.length ?? '—'}
                </dd>
                {gamePhase === 'pre-kickoff' && (cacheStatus?.activeGames?.length ?? 0) === 0 && (
                  <span className="text-xs text-blue-600">Pre-kickoff</span>
                )}
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">Cache Status</dt>
                <dd className="mt-1">
                  {gamePhase === 'pre-kickoff' && !cacheHealthy ? (
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium bg-blue-100 text-blue-800">
                      Awaiting first game
                    </span>
                  ) : (
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium ${
                        cacheHealthy
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {cacheHealthy ? 'Healthy' : 'Stale'}
                    </span>
                  )}
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
              disabled={isSystemHealthRefetching}
              className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSystemHealthRefetching ? (
                <>
                  <RefreshSpinner />
                  Refreshing...
                </>
              ) : (
                'Refresh'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Leaderboard Readiness Status */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Leaderboard Readiness</h2>
          <p className="text-sm text-gray-500">Pre-flight checks for live scoring</p>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Leaderboard Queries */}
            <div className="flex items-center gap-3 bg-gray-50 rounded-md p-3">
              <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
                userStats ? 'bg-green-100' : 'bg-gray-100'
              }`}>
                {userStats ? (
                  <svg className="h-4 w-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <div>
                <div className="text-sm font-medium text-gray-900">Leaderboard Queries</div>
                <div className="text-xs text-gray-500">
                  {userStats ? 'Healthy' : 'Checking...'}
                </div>
              </div>
            </div>

            {/* Cache Ready */}
            <div className="flex items-center gap-3 bg-gray-50 rounded-md p-3">
              <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
                cacheStatus ? 'bg-green-100' : 'bg-gray-100'
              }`}>
                {cacheStatus ? (
                  <svg className="h-4 w-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <div>
                <div className="text-sm font-medium text-gray-900">Cache Ready</div>
                <div className="text-xs text-gray-500">
                  {cacheStatus ? 'Connected' : 'Checking...'}
                </div>
              </div>
            </div>

            {/* Ready for Live Scoring */}
            <div className="flex items-center gap-3 bg-gray-50 rounded-md p-3">
              <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
                userStats && cacheStatus && gameConfig ? 'bg-green-100' : 'bg-yellow-100'
              }`}>
                {userStats && cacheStatus && gameConfig ? (
                  <svg className="h-4 w-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <div>
                <div className="text-sm font-medium text-gray-900">Ready for Live Scoring</div>
                <div className="text-xs text-gray-500">
                  {userStats && cacheStatus && gameConfig
                    ? 'All systems ready'
                    : 'Initializing...'}
                </div>
              </div>
            </div>
          </div>

          {/* Summary message */}
          <div className={`mt-4 p-3 rounded-md text-sm ${
            userStats && cacheStatus && gameConfig
              ? 'bg-green-50 text-green-800'
              : 'bg-yellow-50 text-yellow-800'
          }`}>
            {userStats && cacheStatus && gameConfig ? (
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Leaderboards will populate automatically once live scores arrive</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-yellow-600 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Verifying system readiness...</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* First Live Score Confirmation - Only shown when first score has been received */}
      {isFirstLiveScoreForCurrentWeek && firstLiveScore && (
        <div className="rounded-lg border-2 border-green-300 bg-green-50 shadow-sm">
          <div className="border-b border-green-200 bg-green-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <h2 className="text-lg font-medium text-green-900">First Live Score Received</h2>
            </div>
            <p className="text-sm text-green-700 mt-1">Scoring system confirmed operational for Playoff Week {firstLiveScore.weekNumber}</p>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-green-600 font-medium">Timestamp</div>
                <div className="text-green-900">{new Date(firstLiveScore.timestamp).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-green-600 font-medium">Game ID</div>
                <div className="text-green-900">{firstLiveScore.gameId}</div>
              </div>
              <div>
                <div className="text-green-600 font-medium">Description</div>
                <div className="text-green-900">{firstLiveScore.description}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lineups Panel */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-900">User Lineups</h2>
              <p className="text-sm text-gray-500">
                Week {incompleteLineups?.weekNumber ?? '—'}
                {incompleteLineups?.isWeekActive === false && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                    Week Locked
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* View Toggle */}
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
                onClick={handleLineupsRefresh}
                disabled={isLineupsRefetching}
                className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLineupsRefetching ? (
                  <>
                    <RefreshSpinner />
                    Refreshing...
                  </>
                ) : (
                  'Refresh'
                )}
              </button>
            </div>
          </div>
        </div>
        <div className="p-4">
          {isLineupsLoading ? (
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
                <div className={`rounded-md p-2 ${lineupView === 'incomplete' ? 'bg-yellow-50 ring-1 ring-yellow-200' : 'bg-gray-50'}`}>
                  <span className="text-gray-600">Incomplete:</span>
                  <span className={`ml-1 font-medium ${
                    (incompleteLineups?.incompleteCount ?? 0) > 0 ? 'text-yellow-700' : 'text-green-700'
                  }`}>
                    {incompleteLineups?.incompleteCount ?? 0}
                  </span>
                </div>
                <div className={`rounded-md p-2 ${lineupView === 'complete' ? 'bg-green-50 ring-1 ring-green-200' : 'bg-gray-50'}`}>
                  <span className="text-gray-600">Complete:</span>
                  <span className="ml-1 font-medium text-green-700">
                    {(incompleteLineups?.totalPaidUsers ?? 0) - (incompleteLineups?.incompleteCount ?? 0)}
                  </span>
                </div>
                <div className={`rounded-md p-2 ${lineupView === 'all' ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'bg-gray-50'}`}>
                  <span className="text-gray-600">Total Paid Users:</span>
                  <span className="ml-1 font-medium text-gray-900">{incompleteLineups?.totalPaidUsers ?? 0}</span>
                </div>
              </div>

              {/* Users table */}
              {lineupsToShow.length === 0 ? (
                <div className="text-center py-4">
                  {lineupView === 'incomplete' ? (
                    <>
                      <svg className="mx-auto h-8 w-8 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <p className="mt-2 text-sm text-green-700 font-medium">All paid users have complete lineups</p>
                    </>
                  ) : lineupView === 'complete' ? (
                    <p className="text-sm text-gray-500">No users with complete lineups yet</p>
                  ) : (
                    <p className="text-sm text-gray-500">No users found</p>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 pr-4 font-medium text-gray-600">User</th>
                        <th className="text-left py-2 px-2 font-medium text-gray-600">Picks</th>
                        <th className="text-left py-2 px-2 font-medium text-gray-600">
                          {lineupView === 'incomplete' ? 'Missing Positions' : 'Status'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineupsToShow.map((user) => {
                        const isComplete = 'isComplete' in user ? user.isComplete : false;
                        return (
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
                              {user.totalPicks}/{incompleteLineups?.totalRequired ?? allLineups?.totalRequired ?? 0}
                            </td>
                            <td className="py-2 px-2">
                              {lineupView === 'incomplete' && 'missingPositions' in user ? (
                                <div className="flex flex-wrap gap-1">
                                  {user.missingPositions.map((pos, i) => (
                                    <span key={i} className="inline-flex items-center rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-800">
                                      {pos}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                  isComplete
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-yellow-100 text-yellow-800'
                                }`}>
                                  {isComplete ? 'Complete' : 'Incomplete'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
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
