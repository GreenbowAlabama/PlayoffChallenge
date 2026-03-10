/**
 * Contest Integrity Service
 *
 * Provides read-only operational diagnostics for contest integrity.
 * Single aggregated snapshot method matches Control Tower architecture.
 *
 * This service aggregates data from:
 * - contest_instances
 * - field_selections
 *
 * All queries are deterministic and return empty arrays on missing data.
 */

/**
 * Query tier integrity for all platform events.
 *
 * Ensures each platform event has exactly one contest per entry fee tier.
 * Detects: missing tiers, duplicate contests.
 *
 * @private
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Array>} Array of tier records with contest counts
 */
async function queryTierIntegrity(pool) {
  const result = await pool.query(`
    SELECT
      provider_event_id,
      entry_fee_cents,
      COUNT(*) AS contests
    FROM contest_instances
    WHERE is_platform_owned = true
      AND status = 'SCHEDULED'
    GROUP BY provider_event_id, entry_fee_cents
    ORDER BY provider_event_id, entry_fee_cents
  `);
  return result.rows || [];
}

/**
 * Query capacity summary for all platform events.
 *
 * Confirms contests exist and capacity is correct.
 *
 * @private
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Array>} Array of event capacity records
 */
async function queryCapacitySummary(pool) {
  const result = await pool.query(`
    SELECT
      provider_event_id,
      COUNT(*) as contests,
      SUM(max_entries) as total_capacity
    FROM contest_instances
    WHERE status = 'SCHEDULED'
      AND is_platform_owned = true
    GROUP BY provider_event_id
    ORDER BY provider_event_id
  `);
  return result.rows || [];
}

/**
 * Query player pool readiness for all contests.
 *
 * Verifies player ingestion succeeded by checking field_selections.
 *
 * @private
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Array>} Array of player pool records
 */
async function queryPlayerPoolStatus(pool) {
  const result = await pool.query(`
    SELECT
      ci.provider_event_id,
      ci.entry_fee_cents,
      jsonb_array_length(fs.selection_json->'primary') AS golfers
    FROM field_selections fs
    JOIN contest_instances ci
      ON fs.contest_instance_id = ci.id
    WHERE ci.status = 'SCHEDULED'
    ORDER BY ci.provider_event_id, ci.entry_fee_cents
  `);
  return result.rows || [];
}

/**
 * Query for duplicate contests.
 *
 * Returns only events that have multiple contests for the same tier.
 *
 * @private
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Array>} Array of duplicate records (empty if none found)
 */
async function queryDuplicateContests(pool) {
  const result = await pool.query(`
    SELECT
      provider_event_id,
      entry_fee_cents,
      COUNT(*) as duplicates
    FROM contest_instances
    WHERE is_platform_owned = true
      AND status = 'SCHEDULED'
    GROUP BY provider_event_id, entry_fee_cents
    HAVING COUNT(*) > 1
  `);
  return result.rows || [];
}

/**
 * Query tournament timeline.
 *
 * Verifies contest lifecycle timing.
 *
 * @private
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Array>} Array of contest timeline records
 */
async function queryTournamentTimeline(pool) {
  const result = await pool.query(`
    SELECT
      contest_name,
      entry_fee_cents,
      max_entries,
      tournament_start_time,
      lock_time
    FROM contest_instances
    WHERE status = 'SCHEDULED'
    ORDER BY tournament_start_time, entry_fee_cents
  `);
  return result.rows || [];
}

/**
 * Get complete contest integrity operational snapshot.
 *
 * Aggregates all 5 diagnostic panels into a single operational snapshot.
 * Follows Control Tower single-snapshot pattern.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} Complete contest integrity snapshot with all diagnostics
 */
async function getContestIntegritySnapshot(pool) {
  const [
    tier_integrity,
    capacity_summary,
    player_pool_status,
    duplicate_contests,
    tournament_timeline
  ] = await Promise.all([
    queryTierIntegrity(pool),
    queryCapacitySummary(pool),
    queryPlayerPoolStatus(pool),
    queryDuplicateContests(pool),
    queryTournamentTimeline(pool)
  ]);

  return {
    tier_integrity,
    capacity_summary,
    player_pool_status,
    duplicate_contests,
    tournament_timeline,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  getContestIntegritySnapshot
};
