/**
 * PGA Leaderboard Diagnostics Page
 *
 * Displays current PGA leaderboard and computed fantasy scores for operational diagnostics.
 */

import { useQuery } from '@tanstack/react-query';
import { getPgaLeaderboard } from '../../api/pga-leaderboard';
import type { PgaLeaderboardEntry } from '../../api/pga-leaderboard';

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
    </div>
  );
}

function LeaderboardTable({ entries }: { entries: PgaLeaderboardEntry[] }) {
  const sorted = [...entries].sort((a, b) => a.position - b.position);

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Player</th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Position</th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Total Strokes</th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Fantasy Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {sorted.map((entry) => (
            <tr key={entry.golfer_id} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 text-sm text-gray-900">
                <div className="font-medium">{entry.player_name}</div>
                <div className="text-xs text-gray-500 font-mono">{entry.golfer_id}</div>
              </td>
              <td className="px-4 py-3 text-sm text-right text-gray-900 font-medium">{entry.position}</td>
              <td className="px-4 py-3 text-sm text-right text-gray-900">{entry.total_strokes}</td>
              <td className="px-4 py-3 text-sm text-right text-gray-900 font-semibold text-indigo-600">{entry.fantasy_score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PgaLeaderboardPage() {
  const { data: entries = [], isLoading, isError } = useQuery({
    queryKey: ['pgaLeaderboard'],
    queryFn: () => getPgaLeaderboard(),
    refetchInterval: 30000, // Refresh every 30 seconds for operational monitoring
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">PGA Leaderboard Diagnostics</h1>
        <p className="mt-2 text-sm text-gray-600">
          Operational diagnostic view of the current PGA leaderboard and computed fantasy scores.
        </p>
      </div>

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
            <LeaderboardTable entries={entries} />
            <div className="mt-4 pt-4 border-t border-gray-200">
              <p className="text-xs text-gray-500">
                Showing {entries.length} golfers. Auto-refreshing every 30 seconds.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
