/**
 * Contest Integrity Type Definitions
 *
 * TypeScript interfaces for contest integrity diagnostics API.
 * Defines the contract returned by GET /api/admin/contest-ops/contest-integrity
 */

/**
 * Tier Integrity Record
 * Shows contest count per event and entry fee tier.
 * UI computes status: 1 contest = GREEN, otherwise RED
 */
export interface TierIntegrityRecord {
  provider_event_id: string;
  entry_fee_cents: number;
  contests: number;
}

/**
 * Capacity Summary Record
 * Aggregates contest and capacity info per event.
 */
export interface CapacitySummaryRecord {
  provider_event_id: string;
  contests: number;
  total_capacity: number;
}

/**
 * Player Pool Status Record
 * Shows golfer count per contest tier.
 * UI computes status: >50 golfers = GREEN, <=50 = RED
 */
export interface PlayerPoolStatusRecord {
  provider_event_id: string;
  entry_fee_cents: number;
  golfers: number;
}

/**
 * Duplicate Contest Record
 * Only returned when duplicates exist (contests > 1 per tier).
 */
export interface DuplicateContestRecord {
  provider_event_id: string;
  entry_fee_cents: number;
  duplicates: number;
}

/**
 * Tournament Timeline Record
 * Contest lifecycle timing information.
 */
export interface TournamentTimelineRecord {
  contest_name: string;
  entry_fee_cents: number;
  max_entries: number;
  tournament_start_time: string | null;
  lock_time: string | null;
}

/**
 * Full Contest Integrity Response
 * API contract for GET /api/admin/contest-ops/contest-integrity
 */
export interface ContestIntegrityResponse {
  tier_integrity: TierIntegrityRecord[];
  capacity_summary: CapacitySummaryRecord[];
  player_pool_status: PlayerPoolStatusRecord[];
  duplicate_contests: DuplicateContestRecord[];
  tournament_timeline: TournamentTimelineRecord[];
  timestamp: string;
}
