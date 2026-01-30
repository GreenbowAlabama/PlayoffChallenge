/**
 * Picks Service
 *
 * Extracted from server.js as part of SOLID refactor.
 * Contains picks-related business logic with injected dependencies.
 */

/**
 * Add display fields to picks based on playoff start week.
 *
 * @param {Object[]} picks - Array of pick objects
 * @param {number} playoffStartWeek - The NFL week when playoffs start
 * @returns {Object[]} - Picks with display fields added
 */
function addDisplayFields(picks, playoffStartWeek) {
  return picks.map(pick => {
    const isPlayoff = pick.week_number >= playoffStartWeek;
    const playoffWeek = isPlayoff ? pick.week_number - playoffStartWeek + 1 : null;
    return {
      ...pick,
      is_playoff: isPlayoff,
      playoff_week: playoffWeek,
      display_week: isPlayoff ? `Playoff Week ${playoffWeek}` : `Week ${pick.week_number}`
    };
  });
}

/**
 * Get position limits from game settings.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} - Position limits keyed by position
 */
async function getPositionLimits(pool) {
  const result = await pool.query(
    `SELECT qb_limit, rb_limit, wr_limit, te_limit, k_limit, def_limit FROM game_settings LIMIT 1`
  );
  const settings = result.rows[0] || {};
  return {
    'QB': settings.qb_limit || 1,
    'RB': settings.rb_limit || 2,
    'WR': settings.wr_limit || 2,
    'TE': settings.te_limit || 1,
    'K': settings.k_limit || 1,
    'DEF': settings.def_limit || 1
  };
}

/**
 * Get playoff start week from game settings.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<number>} - Playoff start week (defaults to 19)
 */
async function getPlayoffStartWeek(pool) {
  const result = await pool.query('SELECT playoff_start_week FROM game_settings LIMIT 1');
  return result.rows[0]?.playoff_start_week || 19;
}

/**
 * Get all picks for a user with display fields.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Promise<Object[]>} - Picks with display fields
 */
async function getPicksForUser(pool, userId) {
  const playoffStartWeek = await getPlayoffStartWeek(pool);

  const result = await pool.query(`
    SELECT pk.*, p.full_name, p.position, p.team
    FROM picks pk
    JOIN players p ON pk.player_id = p.id
    WHERE pk.user_id = $1
    ORDER BY pk.week_number, pk.position
  `, [userId]);

  return addDisplayFields(result.rows, playoffStartWeek);
}

/**
 * Get all picks for a user with extended player info (used by /user/:userId route).
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Promise<Object[]>} - Picks with display fields and extended player info
 */
async function getPicksForUserExtended(pool, userId) {
  const playoffStartWeek = await getPlayoffStartWeek(pool);

  const result = await pool.query(`
    SELECT pk.*, p.full_name, p.position, p.team, p.sleeper_id, p.image_url
    FROM picks pk
    JOIN players p ON pk.player_id = p.id
    WHERE pk.user_id = $1
    ORDER BY pk.week_number, pk.position
  `, [userId]);

  return addDisplayFields(result.rows, playoffStartWeek);
}

/**
 * Get all picks for a user via query param (used by GET /api/picks route).
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Promise<Object[]>} - Picks with display fields
 */
async function getPicksByQuery(pool, userId) {
  const playoffStartWeek = await getPlayoffStartWeek(pool);

  const result = await pool.query(
    `SELECT p.*, pl.full_name, pl.position as player_position, pl.team, pl.sleeper_id, pl.image_url
      FROM picks p
      LEFT JOIN players pl ON p.player_id = pl.id
      WHERE p.user_id = $1
      ORDER BY p.week_number, p.position`,
    [userId]
  );

  return addDisplayFields(result.rows, playoffStartWeek);
}

/**
 * Get picks for v2 API with scores.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {number} weekNumber - NFL week number
 * @returns {Promise<{picks: Object[], positionLimits: Object}>}
 */
async function getPicksV2(pool, userId, weekNumber) {
  const picksResult = await pool.query(`
    SELECT
      pk.id AS pick_id,
      pk.player_id,
      pk.position,
      pk.multiplier,
      pk.locked,
      pk.consecutive_weeks,
      COALESCE(p.full_name, p.first_name || ' ' || p.last_name) AS full_name,
      p.team,
      p.sleeper_id,
      p.image_url,
      COALESCE(s.final_points, 0) AS final_points
    FROM picks pk
    JOIN players p
      ON pk.player_id = p.id
    LEFT JOIN scores s
      ON s.player_id = pk.player_id
    AND s.user_id = pk.user_id
    AND s.week_number = pk.week_number
    WHERE pk.user_id = $1
      AND pk.week_number = $2
    ORDER BY
      CASE pk.position
        WHEN 'QB' THEN 1
        WHEN 'RB' THEN 2
        WHEN 'WR' THEN 3
        WHEN 'TE' THEN 4
        WHEN 'K' THEN 5
        WHEN 'DEF' THEN 6
        ELSE 7
      END;
  `, [userId, weekNumber]);

  const positionLimits = await getPositionLimits(pool);

  return {
    picks: picksResult.rows,
    positionLimits
  };
}

/**
 * Get eliminated players for a user in a specific week.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {number} weekNumber - Current NFL week number
 * @param {Set<string>} activeTeams - Set of active team abbreviations
 * @returns {Promise<Object[]>} - Array of eliminated player info
 */
async function getEliminatedPlayers(pool, userId, weekNumber, activeTeams) {
  const prevWeek = weekNumber - 1;
  const picksResult = await pool.query(`
    SELECT pk.id, pk.user_id, pk.player_id, pk.position, pk.multiplier, p.team, p.full_name
    FROM picks pk
    JOIN players p ON pk.player_id = p.id
    WHERE pk.user_id = $1 AND pk.week_number = $2
  `, [userId, prevWeek]);

  const eliminated = [];

  for (const pick of picksResult.rows) {
    const playerTeam = pick.team;
    const isActive = activeTeams.has(playerTeam);

    if (!isActive) {
      eliminated.push({
        pickId: pick.id,
        playerId: pick.player_id,
        playerName: pick.full_name,
        position: pick.position,
        team: playerTeam,
        multiplier: pick.multiplier
      });
    }
  }

  return eliminated;
}

/**
 * Validate position counts against limits.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {number} weekNumber - NFL week number
 * @param {Object[]} proposedOps - Array of proposed operations
 * @returns {Promise<{valid: boolean, errors: string[], counts: Object, limits: Object}>}
 */
async function validatePositionCounts(pool, userId, weekNumber, proposedOps = []) {
  const limits = await getPositionLimits(pool);

  // Get current pick counts by position
  const currentPicks = await pool.query(`
    SELECT position, COUNT(*) as count
    FROM picks
    WHERE user_id = $1 AND week_number = $2
    GROUP BY position
  `, [userId, weekNumber]);

  const counts = {};
  for (const row of currentPicks.rows) {
    counts[row.position] = parseInt(row.count, 10);
  }

  // Apply proposed operations
  for (const op of proposedOps) {
    const pos = op.position;
    if (!counts[pos]) counts[pos] = 0;

    if (op.action === 'add') {
      counts[pos]++;
    } else if (op.action === 'remove') {
      counts[pos]--;
    }
  }

  // Validate against limits
  const errors = [];
  for (const [pos, count] of Object.entries(counts)) {
    if (count > limits[pos]) {
      errors.push(`${pos}: ${count} exceeds limit of ${limits[pos]}`);
    }
    if (count < 0) {
      errors.push(`${pos}: cannot have negative count`);
    }
  }

  return { valid: errors.length === 0, errors, counts, limits };
}

/**
 * Get carry-forward multiplier and consecutive weeks for a player.
 *
 * @param {Object} pool - Database connection pool (or db client)
 * @param {string} userId - User ID
 * @param {string} playerId - Player ID
 * @param {number} previousWeekNumber - Previous week number to check
 * @returns {Promise<{multiplier: number, consecutiveWeeks: number}>}
 */
async function getCarryForwardValues(pool, userId, playerId, previousWeekNumber) {
  const result = await pool.query(
    'SELECT multiplier, consecutive_weeks FROM picks WHERE user_id = $1 AND player_id = $2 AND week_number = $3',
    [userId, playerId, previousWeekNumber]
  );

  if (result.rows.length > 0) {
    return {
      multiplier: (result.rows[0].multiplier || 1) + 1,
      consecutiveWeeks: (result.rows[0].consecutive_weeks || 1) + 1
    };
  }

  return { multiplier: 1, consecutiveWeeks: 1 };
}

/**
 * Validate player eligibility (team not eliminated, not on IR).
 *
 * @param {Object} pool - Database connection pool
 * @param {string} playerId - Player ID
 * @param {string[]} selectableTeams - Array of selectable team abbreviations
 * @param {Function} normalizeTeamAbbr - Team abbreviation normalizer
 * @returns {Promise<{valid: boolean, error?: string, player?: Object}>}
 */
async function validatePlayerEligibility(pool, playerId, selectableTeams, normalizeTeamAbbr) {
  const playerResult = await pool.query(
    'SELECT position, team, injury_status, COALESCE(full_name, first_name || \' \' || last_name) AS full_name FROM players WHERE id = $1',
    [playerId]
  );

  if (playerResult.rows.length === 0) {
    return { valid: false, error: `Player ${playerId} not found` };
  }

  const player = playerResult.rows[0];

  // Check IR/ineligible status
  const ineligibleStatuses = ['IR', 'PUP', 'SUSP'];
  const normalizedStatus = player.injury_status ? player.injury_status.toUpperCase().trim() : null;
  if (normalizedStatus && ineligibleStatuses.includes(normalizedStatus)) {
    return {
      valid: false,
      error: `${player.full_name || playerId} is on ${player.injury_status} and cannot be selected.`
    };
  }

  // Check team eligibility
  const normalizedTeam = normalizeTeamAbbr(player.team);
  if (!selectableTeams.includes(normalizedTeam)) {
    return {
      valid: false,
      error: `Player ${playerId}'s team (${player.team}) has been eliminated. Only players from active teams are selectable.`
    };
  }

  return { valid: true, player };
}

/**
 * Check current position count for a user (excluding a specific player).
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {number} weekNumber - NFL week number
 * @param {string} position - Position to check
 * @param {string} excludePlayerId - Player ID to exclude from count
 * @returns {Promise<number>} - Current count
 */
async function getCurrentPositionCount(pool, userId, weekNumber, position, excludePlayerId) {
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM picks
    WHERE user_id = $1
      AND week_number = $2
      AND position = $3
      AND player_id != $4
  `, [userId, weekNumber, position, excludePlayerId]);

  return parseInt(result.rows[0].count, 10);
}

/**
 * Insert or update a pick with carry-forward logic.
 *
 * @param {Object} pool - Database connection pool (or client)
 * @param {Object} params - Pick parameters
 * @returns {Promise<Object>} - Inserted/updated pick
 */
async function upsertPick(pool, params) {
  const { userId, playerId, weekNumber, position, multiplier, consecutiveWeeks } = params;

  const result = await pool.query(`
    INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, false, NOW())
    ON CONFLICT (user_id, player_id, week_number)
    DO UPDATE SET
      position = $4,
      multiplier = $5,
      consecutive_weeks = $6,
      created_at = NOW()
    RETURNING *
  `, [userId, playerId, weekNumber, position, multiplier, consecutiveWeeks]);

  return result.rows[0];
}

/**
 * Delete a pick by ID and user.
 *
 * @param {Object} pool - Database connection pool (or client)
 * @param {string} pickId - Pick ID
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
async function deletePick(pool, pickId, userId) {
  await pool.query('DELETE FROM picks WHERE id = $1 AND user_id = $2', [pickId, userId]);
}

/**
 * Delete a pick by user, player, and week.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {string} playerId - Player ID
 * @param {number} weekNumber - Week number
 * @returns {Promise<void>}
 */
async function deletePickByPlayer(pool, userId, playerId, weekNumber) {
  await pool.query(
    'DELETE FROM picks WHERE user_id = $1 AND player_id = $2 AND week_number = $3',
    [userId, playerId, weekNumber]
  );
}

/**
 * Log a player swap.
 *
 * @param {Object} pool - Database connection pool (or client)
 * @param {Object} params - Swap parameters
 * @returns {Promise<void>}
 */
async function logPlayerSwap(pool, params) {
  const { userId, oldPlayerId, newPlayerId, position, weekNumber } = params;

  await pool.query(`
    INSERT INTO player_swaps (user_id, old_player_id, new_player_id, position, week_number, swapped_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
  `, [userId, oldPlayerId, newPlayerId, position, weekNumber]);
}

/**
 * Get pick position and player_id by pick ID.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} pickId - Pick ID
 * @returns {Promise<{position: string, playerId: string}|null>}
 */
async function getPickById(pool, pickId) {
  const result = await pool.query('SELECT position, player_id FROM picks WHERE id = $1', [pickId]);
  if (result.rows.length === 0) {
    return null;
  }
  return {
    position: result.rows[0].position,
    playerId: result.rows[0].player_id
  };
}

/**
 * Check if a user exists.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Promise<boolean>}
 */
async function userExists(pool, userId) {
  const result = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
  return result.rows.length > 0;
}

/**
 * Get player info including team for validation.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} playerId - Player ID
 * @returns {Promise<Object|null>}
 */
async function getPlayerForValidation(pool, playerId) {
  const result = await pool.query(
    'SELECT team, injury_status, COALESCE(full_name, first_name || \' \' || last_name) AS full_name FROM players WHERE id = $1',
    [playerId]
  );
  return result.rows[0] || null;
}

/**
 * Get old player info for replacement validation.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} playerId - Player ID
 * @returns {Promise<Object|null>}
 */
async function getOldPlayerInfo(pool, playerId) {
  const result = await pool.query(
    'SELECT team, COALESCE(full_name, first_name || \' \' || last_name) AS full_name FROM players WHERE id = $1',
    [playerId]
  );
  return result.rows[0] || null;
}

/**
 * Get new player info for replacement.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} playerId - Player ID
 * @returns {Promise<Object|null>}
 */
async function getNewPlayerInfo(pool, playerId) {
  const result = await pool.query(
    'SELECT team, COALESCE(full_name, first_name || \' \' || last_name) AS full_name, position, injury_status FROM players WHERE id = $1',
    [playerId]
  );
  return result.rows[0] || null;
}

module.exports = {
  // Display helpers
  addDisplayFields,
  getPlayoffStartWeek,
  getPositionLimits,

  // Read operations
  getPicksForUser,
  getPicksForUserExtended,
  getPicksByQuery,
  getPicksV2,
  getEliminatedPlayers,

  // Validation
  validatePositionCounts,
  validatePlayerEligibility,
  getCurrentPositionCount,
  userExists,
  getPickById,

  // Player info
  getPlayerForValidation,
  getOldPlayerInfo,
  getNewPlayerInfo,

  // Carry-forward
  getCarryForwardValues,

  // Write operations
  upsertPick,
  deletePick,
  deletePickByPlayer,
  logPlayerSwap
};
