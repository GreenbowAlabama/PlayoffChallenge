/**
 * Golf Player Repository
 *
 * Handles persistence of golf players to the database.
 */

/**
 * Upsert golf players by external_id (espn_id)
 *
 * @param {Pool} pool - Database connection pool
 * @param {Array} golfers - Array of golfer objects with fields:
 *   - external_id: ESPN player ID
 *   - name: Full name
 *   - image_url: Player image URL
 *   - sport: Sport code (e.g., 'GOLF')
 *   - position: Position code (e.g., 'G')
 * @returns {Promise<{inserted: number, updated: number}>}
 */
async function upsertGolfPlayers(pool, golfers) {
  if (!golfers || golfers.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  let inserted = 0;
  let updated = 0;

  for (const golfer of golfers) {
    // Check if player exists by espn_id
    const existingPlayer = await pool.query(
      'SELECT id FROM players WHERE espn_id = $1',
      [golfer.external_id]
    );

    if (existingPlayer.rows.length > 0) {
      // Update existing player
      await pool.query(
        `UPDATE players
         SET image_url = $1, updated_at = CURRENT_TIMESTAMP
         WHERE espn_id = $2`,
        [golfer.image_url, golfer.external_id]
      );
      updated++;
    } else {
      // Insert new player with deterministic id based on external_id
      const playerId = `golf_${golfer.external_id}`;
      await pool.query(
        `INSERT INTO players
         (id, full_name, espn_id, position, sport, image_url, available, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          playerId,
          golfer.name,
          golfer.external_id,
          golfer.position,
          golfer.sport,
          golfer.image_url,
          true,
          true
        ]
      );
      inserted++;
    }
  }

  return { inserted, updated };
}

/**
 * Get golf players by sport
 *
 * @param {Pool} pool - Database connection pool
 * @param {Object} options - Pagination options
 *   - limit: Maximum number of results
 *   - offset: Number of results to skip
 * @returns {Promise<Array>} Array of active, available golf players
 */
async function getGolfPlayersBySport(pool, options = {}) {
  const { limit, offset } = options;

  let query = `SELECT * FROM players
               WHERE sport = 'GOLF'
               AND available = true
               AND is_active = true
               ORDER BY full_name`;

  const params = [];

  if (limit !== undefined) {
    query += ' LIMIT $' + (params.length + 1);
    params.push(limit);
  }

  if (offset !== undefined) {
    query += ' OFFSET $' + (params.length + 1);
    params.push(offset);
  }

  const result = await pool.query(query, params);
  return result.rows;
}

module.exports = {
  upsertGolfPlayers,
  getGolfPlayersBySport
};
