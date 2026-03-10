/**
 * Contest Ops API
 *
 * Provides access to operational diagnostics for contest troubleshooting.
 */

import { apiRequest } from './client';

export interface ContestOpsSnapshot {
  server_time: string;
  contest: {
    id: string;
    contest_name: string;
    template_id: string;
    status: string;
    entry_fee_cents: number;
    max_entries: number | null;
    current_entries: number;
    lock_time: string | null;
    start_time: string | null;
    tournament_start_time: string | null;
    provider_event_id: string | null;
    organizer_id: string;
    is_platform_owned: boolean;
    is_system_generated: boolean;
    is_primary_marketing: boolean;
    created_at: string;
    updated_at: string;
  };
  template: {
    id: string;
    name: string;
    sport: string;
    provider_tournament_id: string | null;
    status: string;
    is_system_generated: boolean;
  } | null;
  template_contests: Array<{
    id: string;
    contest_name: string;
    status: string;
    lock_time: string | null;
    entry_fee_cents: number;
    max_entries: number | null;
    current_entries: number;
    organizer_id: string;
    is_platform_owned: boolean;
    is_system_generated: boolean;
    is_primary_marketing: boolean;
  }>;
  contest_tournament_config: {
    id: string;
    provider_event_id: string;
    event_start_date: string;
    event_end_date: string;
    field_source: string;
    is_active: boolean;
    created_at: string;
  } | null;
  tournament_configs: Array<{
    id: string;
    contest_instance_id: string;
    provider_event_id: string;
    event_start_date: string;
    event_end_date: string;
    field_source: string;
    is_active: boolean;
    created_at: string;
    contest_name: string;
  }>;
  lifecycle: {
    transitions: Array<{
      from_state: string;
      to_state: string;
      triggered_by: string;
      reason: string | null;
      created_at: string;
    }>;
    aggregated: {
      current_state: string;
      last_transition: string | null;
      transition_count: number;
    };
  };
  snapshot_health: {
    snapshot_count: number;
    latest_snapshot: string | null;
  };
  capacity: {
    participants_count: number;
    max_entries: number | null;
    remaining_slots: number | null;
  };
  tournament: {
    provider_event_id: string | null;
    event_start_date: string | null;
    event_end_date: string | null;
    is_active: boolean;
    published_at: string | null;
  };
  player_pool: {
    exists: boolean;
    player_count: number;
    created_at: string | null;
  };
  ingestion: {
    latest_runs: Array<{
      work_unit_key: string;
      status: string;
      started_at: string;
      completed_at: string | null;
      error_message: string | null;
    }>;
  };
  workers: Array<{
    worker_name: string;
    status: string;
    last_run_at: string | null;
    error_count: number;
  }>;
  joinability: {
    joinable: boolean;
    reason: string | null;
  };
}

/**
 * Fetch operational snapshot for a contest.
 *
 * @param contestId - Contest instance UUID
 * @returns Promise containing full operational snapshot
 */
export async function getContestOpsSnapshot(
  contestId: string
): Promise<ContestOpsSnapshot> {
  return apiRequest<ContestOpsSnapshot>(`/api/admin/contests/${contestId}/ops`);
}
