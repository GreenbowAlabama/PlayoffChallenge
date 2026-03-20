/**
 * PGA Leaderboard Diagnostics API
 *
 * Provides access to current PGA leaderboard data and computed fantasy scores.
 * For LIVE contests, uses real-time ESPN data for scores.
 * For COMPLETE contests, uses settled golfer_event_scores data.
 */

import { apiRequest } from './client';

export interface PgaLeaderboardMetadata {
  contest_id: string;
  contest_name: string;
  template_name: string;
  status: 'LIVE' | 'COMPLETE';
  sport: string;
  tournament_start_time: string | null;
  tournament_end_time: string | null;
  provider_event_id: string | null;
  lock_time: string | null;
  generated_at: string;
  data_source: 'espn_live' | 'golfer_event_scores';
  last_ingestion_at: string | null;
}

export interface PgaLeaderboardEntry {
  golfer_id: string;
  player_name: string;
  position: number;
  score: number;
  finish_bonus: number;
  fantasy_score: number;
  rounds_scored: number;
}

export interface PgaLeaderboardResponse {
  metadata: PgaLeaderboardMetadata | null;
  entries: PgaLeaderboardEntry[];
}

/**
 * Fetch current PGA leaderboard with fantasy scores and contest metadata.
 *
 * @returns Promise containing metadata and leaderboard entries
 */
export async function getPgaLeaderboard(): Promise<PgaLeaderboardResponse> {
  return apiRequest<PgaLeaderboardResponse>('/api/admin/pga/leaderboard-debug');
}
