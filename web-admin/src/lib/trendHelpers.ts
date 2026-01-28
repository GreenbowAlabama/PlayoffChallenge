/**
 * Trend computation helpers for the Trends tab.
 * All logic is read-only and computes derived data from picks.
 */

import type { Pick } from '../types';

// Static NFL team to conference mapping
// This data is stable and does not require backend calls
const TEAM_CONFERENCES: Record<string, 'AFC' | 'NFC'> = {
  // AFC East
  BUF: 'AFC',
  MIA: 'AFC',
  NE: 'AFC',
  NYJ: 'AFC',
  // AFC North
  BAL: 'AFC',
  CIN: 'AFC',
  CLE: 'AFC',
  PIT: 'AFC',
  // AFC South
  HOU: 'AFC',
  IND: 'AFC',
  JAX: 'AFC',
  TEN: 'AFC',
  // AFC West
  DEN: 'AFC',
  KC: 'AFC',
  LV: 'AFC',
  LAC: 'AFC',
  // NFC East
  DAL: 'NFC',
  NYG: 'NFC',
  PHI: 'NFC',
  WAS: 'NFC',
  // NFC North
  CHI: 'NFC',
  DET: 'NFC',
  GB: 'NFC',
  MIN: 'NFC',
  // NFC South
  ATL: 'NFC',
  CAR: 'NFC',
  NO: 'NFC',
  TB: 'NFC',
  // NFC West
  ARI: 'NFC',
  LAR: 'NFC',
  SF: 'NFC',
  SEA: 'NFC',
};

export interface ConferenceTrend {
  conference: 'AFC' | 'NFC';
  pickCount: number;
}

export interface TeamTrend {
  teamAbbr: string;
  pickCount: number;
}

export interface PlayerTrend {
  playerId: string;
  playerName: string;
  position: string;
  team: string;
  pickCount: number;
}

/**
 * Get the conference for a team abbreviation.
 * Returns null if team is not recognized.
 */
export function getTeamConference(teamAbbr: string | null): 'AFC' | 'NFC' | null {
  if (!teamAbbr) return null;
  return TEAM_CONFERENCES[teamAbbr.toUpperCase()] ?? null;
}

/**
 * Filter picks by NFL week scope.
 * Uses week_number (NFL calendar week) as the source of truth, not computed playoff_week.
 */
export function filterPicksByScope(
  picks: Pick[],
  scope: 'current' | 'all',
  currentNflWeek: number
): Pick[] {
  if (scope === 'all') return picks;
  return picks.filter((p) => p.week_number === currentNflWeek);
}

/**
 * Compute conference distribution from picks.
 */
export function computeConferenceTrends(picks: Pick[]): ConferenceTrend[] {
  const counts: Record<'AFC' | 'NFC', number> = { AFC: 0, NFC: 0 };

  for (const pick of picks) {
    const conference = getTeamConference(pick.team);
    if (conference) {
      counts[conference]++;
    }
  }

  return [
    { conference: 'AFC', pickCount: counts.AFC },
    { conference: 'NFC', pickCount: counts.NFC },
  ];
}

/**
 * Compute team pick distribution from picks.
 * Returns teams sorted by pick count descending.
 */
export function computeTeamTrends(picks: Pick[]): TeamTrend[] {
  const counts = new Map<string, number>();

  for (const pick of picks) {
    const team = pick.team?.toUpperCase();
    if (team) {
      counts.set(team, (counts.get(team) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([teamAbbr, pickCount]) => ({ teamAbbr, pickCount }))
    .sort((a, b) => b.pickCount - a.pickCount);
}

/**
 * Compute player pick trends from picks.
 * Returns players sorted by pick count descending.
 */
export function computePlayerTrends(picks: Pick[]): PlayerTrend[] {
  const playerMap = new Map<
    string,
    { playerName: string; position: string; team: string; count: number }
  >();

  for (const pick of picks) {
    const playerId = pick.player_id;
    if (!playerId) continue;

    const existing = playerMap.get(playerId);
    if (existing) {
      existing.count++;
    } else {
      playerMap.set(playerId, {
        playerName: pick.full_name ?? 'Unknown Player',
        position: pick.player_position ?? pick.position ?? '—',
        team: pick.team ?? '—',
        count: 1,
      });
    }
  }

  return Array.from(playerMap.entries())
    .map(([playerId, data]) => ({
      playerId,
      playerName: data.playerName,
      position: data.position,
      team: data.team,
      pickCount: data.count,
    }))
    .sort((a, b) => b.pickCount - a.pickCount);
}
