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

  if (competitors.length === 0) {
    return { metadata, entries: [] };
  }

  // Step 6: Build golfer ID list
  const golferIds = competitors
    .map(c => {
      const id = c.athlete?.id || c.id;
      return id ? `espn_${id}` : null;
    })
    .filter(Boolean);

  if (golferIds.length === 0) {
    return { metadata, entries: [] };
  }

  // Step 7: Query golfer_event_scores for fantasy scoring data
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
       AND ges.golfer_id = ANY($2)
     GROUP BY ges.golfer_id, p.full_name`,
    [contestId, golferIds]
  );

  // Build lookup map from fantasy scores
  const scoresMap = {};
  scoresResult.rows.forEach(row => {
    if (row.golfer_id) {
      scoresMap[row.golfer_id] = {
        player_name: row.player_name || 'Unknown',
        score_to_par: row.score_to_par || 0,
        finish_bonus: row.finish_bonus || 0,
        fantasy_score: row.fantasy_score || 0,
        rounds_scored: Number(row.rounds_scored) || 0
      };
    }
  });

  // Step 8: Also build player name lookup from players table for names not in golfer_event_scores
  const playerNameResult = await pool.query(
    `SELECT espn_id::text AS espn_id, full_name
     FROM players
     WHERE espn_id::text = ANY($1)`,
    [golferIds.map(id => id.replace('espn_', ''))]
  );
  const playerNameMap = {};
  playerNameResult.rows.forEach(row => {
    playerNameMap[`espn_${row.espn_id}`] = row.full_name;
  });

  // Step 9: Build entries — strategy differs for LIVE vs COMPLETE
  const entries = [];

  for (const competitor of competitors) {
    const competitorId = competitor.athlete?.id || competitor.id;
    if (!competitorId) continue;

    const normalizedGolferId = `espn_${competitorId}`;
    const scoreData = scoresMap[normalizedGolferId] || null;
    const playerName = scoreData?.player_name
      || playerNameMap[normalizedGolferId]
      || competitor.athlete?.displayName
      || 'Unknown';

    if (isLive) {
      // LIVE: ESPN score is HARD authority for score column. NEVER use golfer_event_scores here.
      // ESPN returns score as number OR string ("-8", "E", "+2"). Must parse both.
      const espnScore = _parseEspnScore(competitor.score);
      const dbScore = scoreData?.score_to_par || 0;
      const finalScore = espnScore != null ? espnScore : dbScore;

      // TEMP: Score source debug log — remove after validation
      if (espnScore != null && espnScore !== dbScore) {
        console.log(
          `[SCORE SOURCE] ${normalizedGolferId} | espn=${espnScore} | db=${dbScore} | final=${finalScore} | raw=${competitor.score}`
        );
      }

      entries.push({
        golfer_id: normalizedGolferId,
        player_name: playerName,
        position: 0,  // Computed below after sorting
        score: finalScore,
        finish_bonus: scoreData?.finish_bonus || 0,
        fantasy_score: scoreData?.fantasy_score || 0,
        rounds_scored: scoreData?.rounds_scored || 0
      });
    } else {
      // COMPLETE: Use golfer_event_scores exclusively (settled data)
      entries.push({
        golfer_id: normalizedGolferId,
        player_name: playerName,
        position: 0,
        score: scoreData?.score_to_par || 0,
        finish_bonus: scoreData?.finish_bonus || 0,
        fantasy_score: scoreData?.fantasy_score || 0,
        rounds_scored: scoreData?.rounds_scored || 0
      });
    }
  }

  // Step 10: Sort and rank by fantasy_score (primary), ESPN score tie-breaker (secondary), golfer_id (tertiary)
  entries.sort((a, b) => {
    const fantasyDiff = Number(b.fantasy_score) - Number(a.fantasy_score);
    if (fantasyDiff !== 0) return fantasyDiff;

    const aScore = a.score ?? Number.POSITIVE_INFINITY;
    const bScore = b.score ?? Number.POSITIVE_INFINITY;
    if (aScore !== bScore) return aScore - bScore;

    return String(a.golfer_id).localeCompare(String(b.golfer_id));
  });

  let rank = 1;
  for (const entry of entries) {
    entry.position = rank++;
  }

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
