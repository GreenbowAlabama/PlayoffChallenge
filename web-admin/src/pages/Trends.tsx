import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getUsers } from '../api/users';
import { getUserPicks } from '../api/picks';
import { getGameConfig } from '../api/admin';
import type { User, Pick } from '../types';
import {
  filterPicksByScope,
  computeConferenceTrends,
  computeTeamTrends,
  computePlayerTrends,
} from '../lib/trendHelpers';
import { generateInsights } from '../lib/trendInsights';

const BATCH_SIZE = 10;

interface PicksLoadState {
  picks: Pick[];
  loading: boolean;
  progress: { loaded: number; total: number } | null;
  error: string | null;
}

export function Trends() {
  // UI state
  const [trendScope, setTrendScope] = useState<'current' | 'all'>('current');
  const [playerTrendLimit, setPlayerTrendLimit] = useState<10 | 25 | 'all'>(10);

  // Picks loading state (client-side aggregation)
  const [picksState, setPicksState] = useState<PicksLoadState>({
    picks: [],
    loading: false,
    progress: null,
    error: null,
  });

  // Fetch game config to determine current playoff week
  const { data: gameConfig } = useQuery({
    queryKey: ['gameConfig'],
    queryFn: getGameConfig,
    staleTime: 60000,
  });

  const currentPlayoffWeek = gameConfig?.current_playoff_week ?? 1;

  // Fetch users
  const {
    data: users,
    isLoading: usersLoading,
    error: usersError,
  } = useQuery({
    queryKey: ['adminUsers'],
    queryFn: getUsers,
    staleTime: 60000,
  });

  // Load picks in batches (same pattern as PicksExplorer)
  const loadPicksSequentially = useCallback(async (userList: User[]) => {
    setPicksState({
      picks: [],
      loading: true,
      progress: { loaded: 0, total: userList.length },
      error: null,
    });

    const allPicks: Pick[] = [];

    for (let i = 0; i < userList.length; i += BATCH_SIZE) {
      const batch = userList.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (user) => {
          try {
            return await getUserPicks(user.id);
          } catch {
            // Silently skip users with fetch errors for trend aggregation
            return [];
          }
        })
      );

      for (const picks of batchResults) {
        allPicks.push(...picks);
      }

      setPicksState((prev) => ({
        ...prev,
        picks: [...allPicks],
        progress: {
          loaded: Math.min(i + BATCH_SIZE, userList.length),
          total: userList.length,
        },
      }));
    }

    setPicksState((prev) => ({
      ...prev,
      loading: false,
      progress: null,
    }));
  }, []);

  // Trigger picks loading when users are available
  useEffect(() => {
    if (users && users.length > 0 && picksState.picks.length === 0 && !picksState.loading) {
      loadPicksSequentially(users);
    }
  }, [users, loadPicksSequentially, picksState.picks.length, picksState.loading]);

  // Filter picks by scope
  const scopedPicks = useMemo(() => {
    return filterPicksByScope(picksState.picks, trendScope, currentPlayoffWeek);
  }, [picksState.picks, trendScope, currentPlayoffWeek]);

  // Compute trends from scoped picks
  const conferenceTrends = useMemo(() => computeConferenceTrends(scopedPicks), [scopedPicks]);
  const teamTrends = useMemo(() => computeTeamTrends(scopedPicks), [scopedPicks]);
  const playerTrends = useMemo(() => computePlayerTrends(scopedPicks), [scopedPicks]);

  // Compute insights from trends
  const insights = useMemo(
    () => generateInsights({ scopedPicks, teamTrends, playerTrends }),
    [scopedPicks, teamTrends, playerTrends]
  );

  // Loading state
  const isLoading = usersLoading || picksState.loading;
  const hasError = usersError || picksState.error;

  // Conference distribution computed values
  const afcData = conferenceTrends.find((c) => c.conference === 'AFC');
  const nfcData = conferenceTrends.find((c) => c.conference === 'NFC');
  const afcCount = afcData?.pickCount ?? 0;
  const nfcCount = nfcData?.pickCount ?? 0;
  const totalConference = afcCount + nfcCount;
  const afcPct = totalConference > 0 ? Math.round((afcCount / totalConference) * 100) : 0;
  const nfcPct = totalConference > 0 ? 100 - afcPct : 0;

  // Player trends with limit applied
  const displayedPlayerTrends =
    playerTrendLimit === 'all' ? playerTrends : playerTrends.slice(0, playerTrendLimit);

  // Team trends max for bar scaling
  const maxTeamPicks = teamTrends.length > 0 ? teamTrends[0].pickCount : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Pick Trends</h1>
        <p className="mt-1 text-sm text-gray-600">Analyze pick patterns across the contest</p>
        <p className="mt-1 text-xs text-gray-400">
          Informational only. No admin actions are available.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label htmlFor="trendScope" className="text-sm font-medium text-gray-700">
            Scope:
          </label>
          <select
            id="trendScope"
            value={trendScope}
            onChange={(e) => setTrendScope(e.target.value as 'current' | 'all')}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="current">Current Week (Week {currentPlayoffWeek})</option>
            <option value="all">Entire Contest</option>
          </select>
        </div>
        {picksState.progress && (
          <span className="text-sm text-gray-500">
            Loading picks: {picksState.progress.loaded}/{picksState.progress.total}
          </span>
        )}
      </div>

      {/* Disclaimer banner */}
      <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
        <p className="text-xs text-blue-700">
          <strong>Informational only:</strong> These analytics are for observation purposes. They do
          not enable, disable, or influence any admin controls.
        </p>
      </div>

      {/* Error state */}
      {hasError && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4">
          <p className="text-sm text-red-800">
            Failed to load data:{' '}
            {usersError instanceof Error
              ? usersError.message
              : picksState.error || 'Unknown error'}
          </p>
        </div>
      )}

      {/* Trend Observations */}
      {!isLoading && insights.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h2 className="text-lg font-medium text-gray-900">Trend Observations</h2>
            <p className="text-sm text-gray-500">Notable patterns in current pick data</p>
          </div>
          <div className="p-4">
            <ul className="space-y-2 text-sm text-gray-700">
              {insights.map((insight) => (
                <li key={insight.id} className="flex items-start gap-2">
                  <span className="text-gray-400 mt-0.5">•</span>
                  <span>{insight.message}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Conference Distribution */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Conference Distribution</h2>
          <p className="text-sm text-gray-500">AFC vs NFC pick breakdown</p>
        </div>
        <div className="p-4">
          {isLoading ? (
            <div className="animate-pulse h-8 bg-gray-200 rounded"></div>
          ) : totalConference === 0 ? (
            <div className="text-sm text-gray-500 italic">No picks data available</div>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>
                  AFC: {afcCount} picks ({afcPct}%)
                </span>
                <span>
                  NFC: {nfcCount} picks ({nfcPct}%)
                </span>
              </div>
              <div className="h-6 rounded-full overflow-hidden flex bg-gray-200">
                <div
                  className="bg-blue-500 h-full transition-all"
                  style={{ width: `${afcPct}%` }}
                  title={`AFC: ${afcPct}%`}
                />
                <div
                  className="bg-red-500 h-full transition-all"
                  style={{ width: `${nfcPct}%` }}
                  title={`NFC: ${nfcPct}%`}
                />
              </div>
              <div className="flex justify-between text-sm">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 bg-blue-500 rounded"></span>
                  AFC
                </span>
                <span className="text-gray-500">Total: {totalConference} picks</span>
                <span className="flex items-center gap-1">
                  NFC
                  <span className="w-3 h-3 bg-red-500 rounded"></span>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Team Pick Trends */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Team Pick Trends</h2>
          <p className="text-sm text-gray-500">Pick distribution by team</p>
        </div>
        <div className="p-4">
          {isLoading ? (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-6 bg-gray-200 rounded"></div>
              ))}
            </div>
          ) : teamTrends.length === 0 ? (
            <div className="text-sm text-gray-500 italic">No team pick data available</div>
          ) : (
            <div className="space-y-1">
              {teamTrends.map((team) => {
                const widthPct = maxTeamPicks > 0 ? (team.pickCount / maxTeamPicks) * 100 : 0;
                return (
                  <div key={team.teamAbbr} className="flex items-center gap-2">
                    <span className="w-10 text-sm font-medium text-gray-700">{team.teamAbbr}</span>
                    <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
                      <div
                        className="h-full bg-indigo-400 transition-all"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="w-10 text-sm text-gray-600 text-right">{team.pickCount}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Player Pick Trends */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-900">Player Pick Trends</h2>
              <p className="text-sm text-gray-500">Most picked players</p>
            </div>
            <div className="flex gap-1">
              {([10, 25, 'all'] as const).map((limit) => (
                <button
                  key={limit}
                  onClick={() => setPlayerTrendLimit(limit)}
                  className={`px-3 py-1 text-sm rounded ${
                    playerTrendLimit === limit
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {limit === 'all' ? 'All' : `Top ${limit}`}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="p-4">
          {isLoading ? (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-8 bg-gray-200 rounded"></div>
              ))}
            </div>
          ) : playerTrends.length === 0 ? (
            <div className="text-sm text-gray-500 italic">No player pick data available</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 pr-4 font-medium text-gray-600">Rank</th>
                    <th className="text-left py-2 pr-4 font-medium text-gray-600">Player</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-600">Position</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-600">Team</th>
                    <th className="text-right py-2 pl-2 font-medium text-gray-600">Picks</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedPlayerTrends.map((player, index) => (
                    <tr
                      key={player.playerId}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="py-2 pr-4 text-gray-500">{index + 1}</td>
                      <td className="py-2 pr-4 text-gray-900 font-medium">{player.playerName}</td>
                      <td className="py-2 px-2">
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
                          {player.position}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-gray-600">{player.team}</td>
                      <td className="py-2 pl-2 text-right font-semibold text-indigo-600">
                        {player.pickCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
