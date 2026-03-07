import { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';
import type {
  PlayerPickTrend,
  TeamPickTrend,
} from '../api/admin';

interface TrendsState {
  playerTrends: PlayerPickTrend[];
  teamTrends: TeamPickTrend[];
  loading: boolean;
  error: string | null;
}

export function Trends() {
  const [playerTrendLimit, setPlayerTrendLimit] = useState<10 | 25 | 'all'>(10);
  const [trends, setTrends] = useState<TrendsState>({
    playerTrends: [],
    teamTrends: [],
    loading: true,
    error: null,
  });

  // Load trends from backend aggregate endpoints
  useEffect(() => {
    let cancelled = false;

    async function loadTrends() {
      try {
        setTrends((prev) => ({ ...prev, loading: true, error: null }));

        const [playerRes, teamRes] = await Promise.all([
          apiRequest<PlayerPickTrend[]>(
            `/api/admin/trends/players?weekRange=all`
          ),
          apiRequest<TeamPickTrend[]>(
            `/api/admin/trends/teams?weekRange=all`
          ),
        ]);

        if (!cancelled) {
          setTrends({
            playerTrends: playerRes || [],
            teamTrends: teamRes || [],
            loading: false,
            error: null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setTrends((prev) => ({
            ...prev,
            loading: false,
            error:
              err instanceof Error ? err.message : 'Failed to load trends data',
          }));
        }
      }
    }

    loadTrends();
    return () => {
      cancelled = true;
    };
  }, []);

  // Player trends with limit applied
  const displayedPlayerTrends =
    playerTrendLimit === 'all'
      ? trends.playerTrends
      : trends.playerTrends.slice(0, playerTrendLimit);

  // Team trends max for bar scaling
  const maxTeamPicks =
    trends.teamTrends.length > 0 ? trends.teamTrends[0].pickCount : 0;

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

      {/* Disclaimer banner */}
      <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
        <p className="text-xs text-blue-700">
          <strong>Informational only:</strong> These analytics are for observation purposes. They do
          not enable, disable, or influence any admin controls.
        </p>
      </div>

      {/* Error state */}
      {trends.error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4">
          <p className="text-sm text-red-800">
            Failed to load trends: {trends.error}
          </p>
        </div>
      )}


      {/* Team Pick Trends */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Team Pick Trends</h2>
          <p className="text-sm text-gray-500">Pick distribution by team</p>
        </div>
        <div className="p-4">
          {trends.loading ? (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-6 bg-gray-200 rounded"></div>
              ))}
            </div>
          ) : trends.teamTrends.length === 0 ? (
            <div className="text-sm text-gray-500 italic">No team pick data available</div>
          ) : (
            <div className="space-y-1">
              {trends.teamTrends.map((team) => {
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
          {trends.loading ? (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-8 bg-gray-200 rounded"></div>
              ))}
            </div>
          ) : trends.playerTrends.length === 0 ? (
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
