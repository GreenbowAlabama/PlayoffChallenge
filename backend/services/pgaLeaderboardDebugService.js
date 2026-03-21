/**
 * PGA Leaderboard Debug Service
 *
 * Purpose: Read-only operational diagnostic for PGA scoring validation
 * Exposes current leaderboard with cumulative fantasy scores and live ESPN data
 *
 * Constraints:
 * - No mutations
 * - No ledger interaction
 * - No lifecycle interaction
 * - Read-only diagnostic only
 *
 * Data Source Strategy:
 * - LIVE contests: Use latest raw ESPN payload from ingestion_events for real-time
 *   scores, merged with fantasy scores from golfer_event_scores (which lag by round).
 * - COMPLETE contests: Use golfer_event_scores exclusively (settled data).
 *
 * Scoring Model:
 * Fantasy score is cumulative across all rounds per golfer.
 * Computed as: SUM(total_points) GROUP BY golfer_id
 * Matches settlement aggregation model.
 */

/**
 * ⚠️ ESPN PGA PAYLOAD CONTRACT
 *
 * Snapshots contain payload.competitors[]
 *
 * Stroke structure:
 *
 * competitor.linescores[]
 *   → round
 *     linescores[]
 *       → hole
 *         value = strokes
 *
 * DO NOT attempt to read competitor.holes[].
 *
 * Golfer IDs must be normalized:
 * espn_<athlete_id>
 *
 * Breaking either rule will cause leaderboard joins to fail.
 *
 * See: docs/architecture/providers/espn_pga_payload.md
 * See: docs/architecture/scoring/golfer_identity.md
 */

/**
 * Get PGA leaderboard with computed fantasy scores and contest metadata.
 *
 * LIVE contests use the latest raw ESPN payload (from ingestion_events) for real-time
 * score-to-par and position, plus fantasy scores from golfer_event_scores (may lag).
 *
 * COMPLETE contests use golfer_event_scores exclusively (settled data).
 *
 * Returns structured response with metadata and entries:
 * - metadata: contest info (id, name, status, times, provider_event_id, data freshness)
 * - entries: array of leaderboard entries
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} { metadata, entries }
 */
async function getPgaLeaderboardWithScores(pool) {
  // Step 1: Locate the active PGA/GOLF contest with full metadata
  const contestResult = await pool.query(
    `SELECT
       ci.id AS contest_id,
       ci.contest_name,
       ci.status,
       ci.tournament_start_time,
       ci.tournament_end_time,
       ci.provider_event_id,
       ci.lock_time,
       ct.name AS template_name,
       ct.sport
     FROM contest_instances ci
     JOIN contest_templates ct ON ct.id = ci.template_id
     WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
       AND ci.status IN ('LIVE', 'COMPLETE')
     ORDER BY ci.tournament_start_time DESC
     LIMIT 1`
  );

  if (contestResult.rows.length === 0) {
    return {
      metadata: null,
      entries: []
    };
  }

  const contest = contestResult.rows[0];
  const contestId = contest.contest_id;
  const isLive = contest.status === 'LIVE';

  // Step 2: Build metadata object
  const metadata = {
    contest_id: contestId,
    contest_name: contest.contest_name,
    template_name: contest.template_name,
    status: contest.status,
    sport: contest.sport,
    tournament_start_time: contest.tournament_start_time,
    tournament_end_time: contest.tournament_end_time,
    provider_event_id: contest.provider_event_id,
    lock_time: contest.lock_time,
    generated_at: new Date().toISOString(),
    data_source: isLive ? 'espn_live' : 'golfer_event_scores',
    last_ingestion_at: null
  };

  // Step 3: For LIVE contests, get the latest raw ESPN payload from ingestion_events.
  // This contains real-time competitor scores (updated every ~66s by ingestion worker)
  // unlike golfer_event_scores which freezes per-round after first scoring.
  //
  // CRITICAL: Must filter validated_at IS NOT NULL and use COALESCE for ordering.
  // PostgreSQL sorts NULLs FIRST in DESC order, which would return stale placeholder
  // rows instead of the latest real ingestion data.
  let liveEspnData = null;
  if (isLive) {
    const ingestionResult = await pool.query(
      `SELECT provider_data_json, COALESCE(validated_at, created_at) AS ingested_at
       FROM ingestion_events
       WHERE contest_instance_id = $1
         AND provider = 'pga_espn'
         AND (validated_at IS NOT NULL OR created_at IS NOT NULL)
       ORDER BY COALESCE(validated_at, created_at) DESC
       LIMIT 1`,
      [contestId]
    );

    if (ingestionResult.rows.length > 0) {
      try {
        const rawData = ingestionResult.rows[0].provider_data_json;
        liveEspnData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
        metadata.last_ingestion_at = ingestionResult.rows[0].ingested_at;
      } catch (parseErr) {
        console.warn('[LEADERBOARD] Failed to parse ingestion_events payload:', parseErr.message);
        liveEspnData = null;
      }
    }
  }

  // Step 4: Get the latest snapshot for competitor list (fallback for both modes)
  const snapshotResult = await pool.query(
    `SELECT payload, ingested_at
     FROM event_data_snapshots
     WHERE contest_instance_id = $1
     ORDER BY ingested_at DESC
     LIMIT 1`,
    [contestId]
  );

  if (snapshotResult.rows.length === 0 && !liveEspnData) {
    return { metadata, entries: [] };
  }

  if (!metadata.last_ingestion_at && snapshotResult.rows.length > 0) {
    metadata.last_ingestion_at = snapshotResult.rows[0].ingested_at;
  }

  // Step 5: Extract competitors from the best available source
  // Priority: LIVE ESPN raw data → snapshot (fallback)
  let competitors = [];
  let usedFallback = false;

  if (isLive && liveEspnData) {
    competitors = _extractCompetitors(liveEspnData);
    if (competitors.length === 0) {
      console.warn('[LEADERBOARD] ESPN live extraction returned 0 competitors, falling back to event_data_snapshots');
    }
  }

  if (competitors.length === 0 && snapshotResult.rows.length > 0) {
    competitors = _extractCompetitors(snapshotResult.rows[0].payload);
    if (competitors.length > 0 && isLive) {
      usedFallback = true;
      metadata.data_source = 'golfer_event_scores';
      console.warn('[LEADERBOARD] ESPN extraction failed, fell back to golfer_event_scores via snapshot');
    }
  }

  // Step 6: (removed — golferIds no longer needed; querying all golfers from golfer_event_scores)

  // Step 7: Query golfer_event_scores for fantasy scoring data (all golfers, not filtered to ESPN competitors)
  const scoresResult = await pool.query(
    `SELECT
       ges.golfer_id,
       COALESCE(p.full_name, 'Unknown') as player_name,
       -SUM(COALESCE(ges.hole_points, 0)) as score_to_par,
       SUM(COALESCE(ges.finish_bonus, 0)) as finish_bonus,
       SUM(
         COALESCE(ges.hole_points, 0) +
         COALESCE(ges.bonus_points, 0) +
         COALESCE(ges.finish_bonus, 0)
       ) as fantasy_score,
       COUNT(DISTINCT ges.round_number) as rounds_scored
     FROM golfer_event_scores ges
     LEFT JOIN players p
       ON p.espn_id::text = REPLACE(ges.golfer_id, 'espn_', '')
     WHERE ges.contest_instance_id = $1
     GROUP BY ges.golfer_id, p.full_name`,
    [contestId]
  );

  // Build lookup map from fantasy scores
  const scoresMap = {};
  scoresResult.rows.forEach(row => {
    if (row.golfer_id) {
      scoresMap[row.golfer_id] = {
        golfer_id: row.golfer_id,
        player_name: row.player_name || 'Unknown',
        score_to_par: row.score_to_par || 0,
        finish_bonus: row.finish_bonus || 0,
        fantasy_score: row.fantasy_score || 0,
        rounds_scored: Number(row.rounds_scored) || 0
      };
    }
  });

  if (Object.keys(scoresMap).length === 0) {
    return { metadata, entries: [] };
  }

  // Step 8: (removed — player names already included in golfer_event_scores query via LEFT JOIN)

  // Step 9: Build entries from ALL golfers in scoresMap (including those not in ESPN competitors)
  // Step 9: Build entries directly from golfer_event_scores (all golfers, source of truth)
  const entries = Object.values(scoresMap).map(row => ({
    golfer_id: row.golfer_id,
    player_name: row.player_name,
    position: 0,
    score: row.score_to_par || 0,
    finish_bonus: row.finish_bonus || 0,
    fantasy_score: Number(row.fantasy_score) || 0,
    rounds_scored: row.rounds_scored || 0
  }));

  // Step 10: Sort and rank by fantasy_score DESC, golfer_id ASC (matches validation script exactly)
  entries.sort((a, b) => {
    const scoreDiff = Number(b.fantasy_score) - Number(a.fantasy_score);
    if (scoreDiff !== 0) return scoreDiff;

    return String(a.golfer_id).localeCompare(String(b.golfer_id));
  });

  let rank = 1;
  for (const entry of entries) {
    entry.position = rank++;
  }

  // DEBUG: Log top 10 before return to verify sort + rank
  console.log('[LEADERBOARD DEBUG] Top 10 entries BEFORE return:');
  console.log(
    entries.slice(0, 10).map(e => ({
      position: e.position,
      golfer_id: e.golfer_id,
      fantasy_score: e.fantasy_score
    }))
  );

  return { metadata, entries };
}

/**
 * Parse ESPN competitor score to a number.
 *
 * ESPN returns score in multiple formats:
 *   - Number: -8 (already numeric)
 *   - String: "-8", "+2" (parseable)
 *   - String: "E" (even par = 0)
 *   - null/undefined (not started or withdrawn)
 *
 * @param {*} rawScore - ESPN score value (number, string, or null)
 * @returns {number|null} Parsed score or null if unparseable
 */
function _parseEspnScore(rawScore) {
  if (rawScore == null) return null;

  if (typeof rawScore === 'number') {
    return isFinite(rawScore) ? rawScore : null;
  }

  if (typeof rawScore === 'string') {
    const trimmed = rawScore.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === 'WD' || trimmed === 'CUT' || trimmed === 'DQ') {
      return null;
    }
    if (trimmed === 'E') return 0;
    const parsed = Number(trimmed);
    return isFinite(parsed) ? parsed : null;
  }

  return null;
}

/**
 * Extract competitors array from ESPN payload.
 *
 * Handles all known ESPN response formats:
 *   Format A: { competitors: [...] }              — scoreboard endpoint (normalized snapshots)
 *   Format B: { events: [{ competitions: [{ competitors: [...] }] }] }  — full event endpoint (raw ingestion)
 *   Format C: { leaderboard: { players: [...] } } — alternate leaderboard endpoint (future-proof)
 *   Format D: { athletes: [...] }                  — alternate roster endpoint (future-proof)
 *
 * Guards against: null payload, non-object, missing arrays, empty arrays.
 *
 * @param {Object} payload - ESPN payload in any known format
 * @returns {Array} Competitors array (never null)
 */
function _extractCompetitors(payload) {
  if (!payload || typeof payload !== 'object') return [];

  // Format A: competitors at root (scoreboard / normalized snapshot)
  if (Array.isArray(payload.competitors) && payload.competitors.length > 0) {
    return payload.competitors;
  }

  // Format B: events > competitions > competitors (full event API / raw ingestion)
  if (Array.isArray(payload.events) && payload.events.length > 0) {
    for (const event of payload.events) {
      if (!event || !Array.isArray(event.competitions)) continue;
      for (const competition of event.competitions) {
        if (Array.isArray(competition?.competitors) && competition.competitors.length > 0) {
          return competition.competitors;
        }
      }
    }
  }

  // Format C: leaderboard.players (alternate ESPN format, future-proof)
  if (payload.leaderboard && Array.isArray(payload.leaderboard.players) && payload.leaderboard.players.length > 0) {
    return payload.leaderboard.players;
  }

  // Format D: athletes at root (alternate ESPN format, future-proof)
  if (Array.isArray(payload.athletes) && payload.athletes.length > 0) {
    return payload.athletes;
  }

  return [];
}

module.exports = {
  getPgaLeaderboardWithScores
};
