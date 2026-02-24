/**
 * Trend insights helper for generating observational insights from pick data.
 * Pure functions only. No React imports.
 */

import type { TeamTrend, PlayerTrend } from './trendHelpers';
import type { Pick } from '../types';

export interface Insight {
  id: string;
  message: string;
}

interface InsightInput {
  scopedPicks: Pick[];
  teamTrends: TeamTrend[];
  playerTrends: PlayerTrend[];
}

/**
 * Generate all applicable trend insights from the provided data.
 * Returns an ordered array of insight objects.
 */
export function generateInsights(input: InsightInput): Insight[] {
  const insights: Insight[] = [];

  const pickConcentration = computePickConcentration(input.teamTrends);
  if (pickConcentration) insights.push(pickConcentration);

  const topHeavy = computeTopHeavyDistribution(input.teamTrends);
  if (topHeavy) insights.push(topHeavy);

  const longTail = computeLongTailSignal(input.teamTrends);
  if (longTail) insights.push(longTail);

  const playerCrowding = computePlayerCrowding(input.playerTrends, input.scopedPicks.length);
  if (playerCrowding) insights.push(playerCrowding);

  const positionBias = computePositionBias(input.scopedPicks);
  if (positionBias) insights.push(positionBias);

  return insights;
}

/**
 * Pick Concentration: Triggers when top team pick share >= 30%
 */
function computePickConcentration(teamTrends: TeamTrend[]): Insight | null {
  if (teamTrends.length === 0) return null;

  const totalTeamPicks = teamTrends.reduce((sum, t) => sum + t.pickCount, 0);
  if (totalTeamPicks === 0) return null;

  const topTeam = teamTrends[0];
  const pct = Math.round((topTeam.pickCount / totalTeamPicks) * 100);

  if (pct >= 30) {
    return {
      id: 'pick-concentration',
      message: `${topTeam.teamAbbr} accounts for ${pct}% of all team picks this week.`,
    };
  }

  return null;
}

/**
 * Top-Heavy Distribution: Triggers when top 3 teams combined >= 65% of team picks
 */
function computeTopHeavyDistribution(teamTrends: TeamTrend[]): Insight | null {
  if (teamTrends.length < 3) return null;

  const totalTeamPicks = teamTrends.reduce((sum, t) => sum + t.pickCount, 0);
  if (totalTeamPicks === 0) return null;

  const top3Picks = teamTrends.slice(0, 3).reduce((sum, t) => sum + t.pickCount, 0);
  const pct = Math.round((top3Picks / totalTeamPicks) * 100);

  if (pct >= 65) {
    return {
      id: 'top-heavy-distribution',
      message: `Top 3 teams represent ${pct}% of all team picks.`,
    };
  }

  return null;
}

/**
 * Long Tail Signal: Triggers when teams with <= 1 pick >= 6 teams
 */
function computeLongTailSignal(teamTrends: TeamTrend[]): Insight | null {
  const teamsWithSinglePick = teamTrends.filter((t) => t.pickCount === 1).length;

  if (teamsWithSinglePick >= 6) {
    return {
      id: 'long-tail-signal',
      message: `${teamsWithSinglePick} teams have only a single pick.`,
    };
  }

  return null;
}

/**
 * Player Crowding: Triggers when top player pick share >= 20%
 */
function computePlayerCrowding(playerTrends: PlayerTrend[], totalPicks: number): Insight | null {
  if (playerTrends.length === 0 || totalPicks === 0) return null;

  const topPlayer = playerTrends[0];
  const pct = Math.round((topPlayer.pickCount / totalPicks) * 100);

  if (pct >= 20) {
    return {
      id: 'player-crowding',
      message: `${topPlayer.playerName} appears in ${pct}% of all lineups.`,
    };
  }

  return null;
}

/**
 * Position Bias: Triggers when one position >= 40% of all picks
 */
function computePositionBias(picks: Pick[]): Insight | null {
  if (picks.length === 0) return null;

  const positionCounts = new Map<string, number>();

  for (const pick of picks) {
    const position = pick.player_position ?? pick.position;
    if (position) {
      const normalizedPosition = position.toUpperCase();
      positionCounts.set(normalizedPosition, (positionCounts.get(normalizedPosition) ?? 0) + 1);
    }
  }

  let maxPosition = '';
  let maxCount = 0;

  for (const [position, count] of positionCounts) {
    if (count > maxCount) {
      maxCount = count;
      maxPosition = position;
    }
  }

  if (maxCount === 0) return null;

  const pct = Math.round((maxCount / picks.length) * 100);

  if (pct >= 40) {
    return {
      id: 'position-bias',
      message: `${maxPosition}s account for ${pct}% of all picks.`,
    };
  }

  return null;
}
