/**
 * PGA Leaderboard Diagnostics Page
 *
 * Displays current PGA leaderboard with computed fantasy scores and tournament context.
 *
 * Data source strategy:
 * - LIVE contests: Real-time ESPN scores (updated every ~5s by ingestion worker),
 *   with fantasy scores from completed rounds (may lag mid-round).
 * - COMPLETE contests: Settled golfer_event_scores data (final/immutable).
 *
 * Auto-refreshes every 20 seconds for LIVE contests, 60 seconds for COMPLETE.
 */

import { useQuery } from '@tanstack/react-query';
import { getPgaLeaderboard } from '../../api/pga-leaderboard';
import type { PgaLeaderboardEntry, PgaLeaderboardMetadata } from '../../api/pga-leaderboard';

const LIVE_REFRESH_INTERVAL = 20000;     // 20s for LIVE contests
const COMPLETE_REFRESH_INTERVAL = 60000; // 60s for COMPLETE contests

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isLive = status === 'LIVE';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
        isLive
          ? 'bg-green-100 text-green-800'
          : 'bg-gray-100 text-gray-700'
      }`}
    >
      {isLive && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
        </span>
      )}
      {status}
    </span>
  );
}

function TournamentContext({ metadata }: { metadata: PgaLeaderboardMetadata }) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString();
  };

  const dataSourceLabel = metadata.data_source === 'espn_live'
    ? 'ESPN Live Feed'
    : 'Settled Scores';

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900">
          {metadata.contest_name || metadata.template_name || 'PGA Tournament'}
        </h2>
        <StatusBadge status={metadata.status} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <span className="text-gray-500 block">Tournament Start</span>
          <span className="font-medium text-gray-900">{formatDate(metadata.tournament_start_time)}</span>
        </div>
        <div>
          <span className="text-gray-500 block">Tournament End</span>
          <span className="font-medium text-gray-900">{formatDate(metadata.tournament_end_time)}</span>
        </div>
        <div>
          <span className="text-gray-500 block">Data Source</span>
          <span className={`font-medium ${metadata.data_source === 'espn_live' ? 'text-green-700' : 'text-gray-900'}`}>
            {dataSourceLabel}
          </span>
        </div>
        <div>
          <span className="text-gray-500 block">Last Ingestion</span>
          <span className="font-medium text-gray-900">{formatDate(metadata.last_ingestion_at)}</span>
        </div>
      </div>
      {metadata.provider_event_id && (
        <div className="mt-2 text-xs text-gray-400 font-mono">
          Provider Event: {metadata.provider_event_id} | Contest: {metadata.contest_id}
        </div>
      )}
    </div>
  );
}

function LeaderboardTable({ entries, isLive }: { entries: PgaLeaderboardEntry[]; isLive: boolean }) {
  const sorted = [...entries].sort((a, b) => a.position - b.position);

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Pos</th>
            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Player</th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
              {isLive ? 'Score (Live)' : 'Score'}
            </th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Finish Bonus</th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Fantasy Score</th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Rounds</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {sorted.map((entry) => (
            <tr key={entry.golfer_id} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 text-sm text-gray-900 font-medium w-12">{entry.position}</td>
              <td className="px-4 py-3 text-sm text-gray-900">
                <div className="font-medium">{entry.player_name}</div>
                <div className="text-xs text-gray-500 font-mono">{entry.golfer_id}</div>
              </td>
              <td className="px-4 py-3 text-sm text-right text-gray-900 font-medium">
                {entry.score > 0 ? '+' : ''}{entry.score}
              </td>
              <td className="px-4 py-3 text-sm text-right text-green-600 font-medium">{entry.finish_bonus}</td>
              <td className="px-4 py-3 text-sm text-right text-indigo-600 font-semibold">{entry.fantasy_score}</td>
              <td className="px-4 py-3 text-sm text-right text-gray-500">{entry.rounds_scored}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PgaLeaderboardPage() {
  const { data, isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ['pgaLeaderboard'],
    queryFn: async () => {
      const result = await getPgaLeaderboard();
      // TEMP: Polling proof logs — remove after validation
      console.log(`[LEADERBOARD POLL] ${new Date().toISOString()} | entries=${result.entries?.length ?? 0} | source=${result.metadata?.data_source ?? 'none'} | ingestion=${result.metadata?.last_ingestion_at ?? 'null'}`);
      return result;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.metadata?.status;
      return status === 'LIVE' ? LIVE_REFRESH_INTERVAL : COMPLETE_REFRESH_INTERVAL;
    },
  });

  const metadata = data?.metadata ?? null;
  const entries = data?.entries ?? [];
  const isLive = metadata?.status === 'LIVE';

  const lastRefreshed = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">PGA Leaderboard Diagnostics</h1>
        <p className="mt-1 text-sm text-gray-600">
          Operational view of the current PGA leaderboard and computed fantasy scores.
          {isLive && ' Scores update automatically from ESPN live feed.'}
        </p>
      </div>

      {/* Tournament Context */}
      {metadata && <TournamentContext metadata={metadata} />}

      {/* Main Content */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <LoadingSpinner />
          </div>
        ) : isError ? (
          <div className="p-6">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-medium text-red-800">Failed to load leaderboard diagnostics.</p>
              <p className="mt-1 text-xs text-red-700">
                Unable to fetch current PGA leaderboard data. Please check backend connectivity.
              </p>
            </div>
          </div>
        ) : entries.length === 0 ? (
          <div className="p-6">
            <div className="text-center">
              <p className="text-sm text-gray-600">No active PGA leaderboard data available.</p>
            </div>
          </div>
        ) : (
          <div className="p-6">
            {isLive && (
              <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Fantasy scores are calculated from completed rounds only.
                Score-to-par column reflects ESPN live data and updates every {LIVE_REFRESH_INTERVAL / 1000}s.
              </div>
            )}
            <LeaderboardTable entries={entries} isLive={isLive} />
            <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-between">
              <p className="text-xs text-gray-500">
                Showing {entries.length} golfers.
                Auto-refreshing every {isLive ? LIVE_REFRESH_INTERVAL / 1000 : COMPLETE_REFRESH_INTERVAL / 1000} seconds.
              </p>
              {lastRefreshed && (
                <p className="text-xs text-gray-400">
                  Last refreshed: {lastRefreshed}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
