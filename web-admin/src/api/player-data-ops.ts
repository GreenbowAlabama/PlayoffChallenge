/**
 * Player Data Ops API
 *
 * Provides access to operational diagnostics for player data pipeline troubleshooting.
 */

import { apiRequest } from './client';

export interface IngestionRun {
  work_unit_key: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface Ingestion {
  latest_runs: IngestionRun[];
  lag_seconds: number | null;
  last_success: string | null;
  errors_last_hour: number;
}

export interface PlayerPool {
  tournaments_with_pool: number;
  missing_pools: number;
}

export interface Snapshots {
  total_snapshots: number;
  latest_snapshot: string | null;
  snapshot_lag_seconds: number | null;
  contests_missing_snapshots: number;
}

export interface Scoring {
  last_scoring_run: string | null;
  scoring_lag_seconds: number | null;
}

export interface Worker {
  worker_name: string;
  status: string;
  last_run_at: string | null;
  error_count: number;
}

export interface PlayerDataOpsSnapshot {
  server_time: string;
  ingestion: Ingestion;
  player_pool: PlayerPool;
  snapshots: Snapshots;
  scoring: Scoring;
  workers: Worker[];
}

/**
 * Fetch operational snapshot for player data pipeline.
 *
 * @returns Promise containing full player data operational snapshot
 */
export async function getPlayerDataOpsSnapshot(): Promise<PlayerDataOpsSnapshot> {
  return apiRequest<PlayerDataOpsSnapshot>('/api/admin/player-data/ops');
}
