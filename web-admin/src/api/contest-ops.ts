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
  lifecycle: Array<{
    from_state: string;
    to_state: string;
    triggered_by: string;
    reason: string | null;
    created_at: string;
  }>;
  snapshot_health: {
    snapshot_count: number;
    latest_snapshot: string | null;
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
  return apiRequest<ContestOpsSnapshot>(`/admin/contests/${contestId}/ops`);
}
