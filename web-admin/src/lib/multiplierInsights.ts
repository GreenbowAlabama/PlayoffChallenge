/**
 * Multiplier utilization aggregation helpers for the Trends tab.
 * Pure functions only. No React imports. No formatting logic.
 */

import type { Pick } from '../types';

/**
 * Extended Pick type for multiplier access.
 * The multiplier field exists in the database and API response
 * but is not typed in the global Pick interface.
 */
type PickWithMultiplier = Pick & { multiplier?: number };

export interface MultiplierInsight {
  playerId: string;
  playerName: string;
  team: string;
  oneX: number;
  twoX: number;
  threeXPlus: number;
  totalUsers: number;
}

/**
 * Compute multiplier utilization insights from scoped picks.
 *
 * Rules:
 * - Count users, not picks (each user contributes once per player)
 * - Buckets: 1x (multiplier === 1), 2x (multiplier === 2), 3x+ (multiplier >= 3)
 * - Sort by highest total users with multiplier >= 2, tie-breaker: total users descending
 * - Return top 10 players only
 */
export function computeMultiplierInsights(picks: Pick[]): MultiplierInsight[] {
  // Map: playerId -> { playerName, team, usersByTier }
  const playerMap = new Map<
    string,
    {
      playerName: string;
      team: string;
      // Track which users are in which tier (user can only count once per player)
      userTiers: Map<string, number>; // userId -> multiplier
    }
  >();

  for (const pick of picks as PickWithMultiplier[]) {
    const playerId = pick.player_id;
    if (!playerId) continue;

    const multiplier = pick.multiplier ?? 1;
    const userId = pick.user_id;
    if (!userId) continue;

    let entry = playerMap.get(playerId);
    if (!entry) {
      entry = {
        playerName: pick.full_name ?? 'Unknown Player',
        team: pick.team ?? '—',
        userTiers: new Map(),
      };
      playerMap.set(playerId, entry);
    }

    // A user can only contribute once per player
    // If user already recorded, keep their highest multiplier
    const existing = entry.userTiers.get(userId);
    if (existing === undefined || multiplier > existing) {
      entry.userTiers.set(userId, multiplier);
    }
  }

  // Convert to insights array
  const insights: MultiplierInsight[] = [];

  for (const [playerId, data] of playerMap) {
    let oneX = 0;
    let twoX = 0;
    let threeXPlus = 0;

    for (const multiplier of data.userTiers.values()) {
      if (multiplier >= 3) {
        threeXPlus++;
      } else if (multiplier === 2) {
        twoX++;
      } else {
        oneX++;
      }
    }

    const totalUsers = oneX + twoX + threeXPlus;

    insights.push({
      playerId,
      playerName: data.playerName,
      team: data.team,
      oneX,
      twoX,
      threeXPlus,
      totalUsers,
    });
  }

  // Sort: highest total users with multiplier >= 2, tie-breaker: total users descending
  insights.sort((a, b) => {
    const aHighMultiplier = a.twoX + a.threeXPlus;
    const bHighMultiplier = b.twoX + b.threeXPlus;

    if (bHighMultiplier !== aHighMultiplier) {
      return bHighMultiplier - aHighMultiplier;
    }
    return b.totalUsers - a.totalUsers;
  });

  // Return top 10 only
  return insights.slice(0, 10);
}
