/**
 * PGA Leaderboard Diagnostics API
 *
 * Provides access to current PGA leaderboard data and computed fantasy scores.
 */

import { apiRequest } from './client';

export interface PgaLeaderboardEntry {
  golfer_id: string;
  player_name: string;
  position: number;
  total_strokes: number;
  fantasy_score: number;
}

/**
 * Fetch current PGA leaderboard with fantasy scores.
 *
 * @returns Promise containing array of leaderboard entries sorted by position
 */
export async function getPgaLeaderboard(): Promise<PgaLeaderboardEntry[]> {
  return apiRequest<PgaLeaderboardEntry[]>('/api/admin/pga/leaderboard-debug');
}
