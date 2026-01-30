/**
 * Admin Service
 *
 * Extracted from server.js as part of SOLID refactor.
 * Contains admin-related business logic with injected dependencies.
 */

/**
 * Verify if a user is an admin.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Promise<boolean>}
 */
async function isAdmin(pool, userId) {
  const result = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
  return result.rows.length > 0 && result.rows[0].is_admin === true;
}

/**
 * Update week lock status.
 *
 * @param {Object} pool - Database connection pool
 * @param {boolean} isWeekActive - Whether the week should be active (unlocked)
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function updateWeekStatus(pool, isWeekActive) {
  await pool.query(
    'UPDATE game_settings SET is_week_active = $1 RETURNING *',
    [isWeekActive]
  );

  console.log(`Week lock status updated: is_week_active = ${isWeekActive}`);

  return {
    success: true,
    message: isWeekActive ? 'Week unlocked' : 'Week locked'
  };
}

/**
 * Get current lock status verification.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} - Lock status verification data
 */
async function getLockStatusVerification(pool) {
  const result = await pool.query(
    `SELECT
      is_week_active,
      current_playoff_week,
      playoff_start_week,
      updated_at
     FROM game_settings LIMIT 1`
  );

  if (result.rows.length === 0) {
    return null;
  }

  const { is_week_active, current_playoff_week, playoff_start_week, updated_at } = result.rows[0];
  // Cap offset at 3 to handle Pro Bowl skip (round 5 = Super Bowl = offset 3)
  const effectiveNflWeek = current_playoff_week > 0
    ? playoff_start_week + Math.min(current_playoff_week - 1, 3)
    : null;

  // Test that a picks write would actually be blocked
  const lockEnforced = !is_week_active;

  return {
    isLocked: lockEnforced,
    isWeekActive: is_week_active,
    currentPlayoffWeek: current_playoff_week,
    effectiveNflWeek: effectiveNflWeek,
    lastUpdated: updated_at,
    message: lockEnforced
      ? 'Week is LOCKED. All pick modifications will be rejected by the API.'
      : 'Week is UNLOCKED. Users can currently modify picks.'
  };
}

/**
 * Get game state for admin operations.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object|null>}
 */
async function getGameState(pool) {
  const result = await pool.query(
    'SELECT current_playoff_week, playoff_start_week, is_week_active FROM game_settings LIMIT 1'
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Validate week transition preconditions.
 *
 * @param {Object} gameState - Game state object
 * @returns {{valid: boolean, error?: string, currentState?: Object}}
 */
function validateTransitionPreconditions(gameState) {
  const { current_playoff_week, is_week_active } = gameState;

  // PRECONDITION 1: Week must be locked
  if (is_week_active) {
    return {
      valid: false,
      error: 'Week must be locked before advancing. Set is_week_active = false first.',
      currentState: { is_week_active, current_playoff_week }
    };
  }

  // PRECONDITION 2: Cannot advance beyond Super Bowl
  const currentOffset = Math.min(current_playoff_week - 1, 3);
  if (currentOffset >= 3) {
    return {
      valid: false,
      error: 'Cannot advance beyond Super Bowl (already at final round)',
      currentState: { current_playoff_week, effectiveOffset: currentOffset }
    };
  }

  return { valid: true };
}

/**
 * Calculate week numbers for transition.
 *
 * @param {Object} gameState - Game state object
 * @returns {Object} - Week calculation results
 */
function calculateTransitionWeeks(gameState) {
  const { current_playoff_week, playoff_start_week } = gameState;

  const fromPlayoffWeek = current_playoff_week;
  const fromWeekOffset = Math.min(fromPlayoffWeek - 1, 3);
  const fromWeek = playoff_start_week + fromWeekOffset;

  const initialToPlayoffWeek = current_playoff_week + 1;
  const initialToWeekOffset = Math.min(initialToPlayoffWeek - 1, 3);
  const initialToWeek = playoff_start_week + initialToWeekOffset;

  return {
    fromPlayoffWeek,
    fromWeek,
    initialToPlayoffWeek,
    initialToWeek,
    playoffStartWeek: playoff_start_week
  };
}

/**
 * Get preview data for week transition (no mutations).
 *
 * @param {Object} pool - Database connection pool
 * @param {Function} fetchValidPostseasonWeek - Function to fetch ESPN data
 * @returns {Promise<Object>}
 */
async function getWeekTransitionPreview(pool, fetchValidPostseasonWeek) {
  const gameState = await getGameState(pool);

  if (!gameState) {
    throw new Error('Game settings not found');
  }

  const validation = validateTransitionPreconditions(gameState);
  if (!validation.valid) {
    const error = new Error(validation.error);
    error.statusCode = 400;
    error.currentState = validation.currentState;
    throw error;
  }

  const weeks = calculateTransitionWeeks(gameState);

  // Fetch ESPN data
  const validWeekData = await fetchValidPostseasonWeek(weeks.initialToWeek, weeks.playoffStartWeek);

  const activeTeamsArray = Array.from(validWeekData.activeTeams).sort();
  const toPlayoffWeek = validWeekData.playoffWeek;
  const toWeekOffset = Math.min(toPlayoffWeek - 1, 3);
  const effectiveNflWeek = weeks.playoffStartWeek + toWeekOffset;

  return {
    fromPlayoffWeek: weeks.fromPlayoffWeek,
    toPlayoffWeek,
    nflWeek: effectiveNflWeek,
    espnNflWeek: validWeekData.nflWeek,
    eventCount: validWeekData.eventCount,
    activeTeams: activeTeamsArray,
    teamCount: activeTeamsArray.length,
    skippedProBowlWeeks: validWeekData.skippedProBowlWeeks
  };
}

/**
 * Process week transition (atomic operation).
 *
 * @param {Object} client - Database client (from pool.connect())
 * @param {Object} params - Transition parameters
 * @param {string} params.userId - Admin user ID
 * @param {Function} params.fetchValidPostseasonWeek - Function to fetch ESPN data
 * @param {Function} params.getESPNScoreboardUrl - Function to get ESPN URL
 * @returns {Promise<Object>}
 */
async function processWeekTransition(client, params) {
  const { userId, fetchValidPostseasonWeek, getESPNScoreboardUrl } = params;

  // Verify user is admin
  const userCheck = await client.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
  if (userCheck.rows.length === 0 || !userCheck.rows[0].is_admin) {
    const error = new Error('Admin access required');
    error.statusCode = 403;
    throw error;
  }

  // Get current game state
  const gameState = await client.query(
    'SELECT current_playoff_week, playoff_start_week, is_week_active FROM game_settings LIMIT 1'
  );

  if (gameState.rows.length === 0) {
    throw new Error('Game settings not found');
  }

  const { current_playoff_week, playoff_start_week, is_week_active } = gameState.rows[0];

  // Validate preconditions
  const validation = validateTransitionPreconditions({ current_playoff_week, is_week_active });
  if (!validation.valid) {
    const error = new Error(validation.error);
    error.statusCode = 400;
    error.currentState = validation.currentState;
    throw error;
  }

  // Calculate weeks
  const weeks = calculateTransitionWeeks({ current_playoff_week, playoff_start_week });

  console.log(`[admin] Processing week transition: Playoff ${weeks.fromPlayoffWeek} -> ${weeks.initialToPlayoffWeek} (NFL ${weeks.fromWeek} -> ${weeks.initialToWeek})`);

  // Fetch ESPN data
  const validWeekData = await fetchValidPostseasonWeek(weeks.initialToWeek, playoff_start_week);

  const toPlayoffWeek = validWeekData.playoffWeek;
  const activeTeams = validWeekData.activeTeams;
  const toWeekOffset = Math.min(toPlayoffWeek - 1, 3);
  const toWeek = playoff_start_week + toWeekOffset;

  if (validWeekData.skippedProBowlWeeks > 0) {
    console.log(`[admin] Skipped ${validWeekData.skippedProBowlWeeks} Pro Bowl week(s). ESPN returned NFL week ${validWeekData.nflWeek}, using capped effective week ${toWeek}`);
  }

  // Validate ESPN data
  if (activeTeams.size === 0) {
    const error = new Error(`ESPN returned no active teams for NFL week ${toWeek}. Cannot proceed with empty data.`);
    error.statusCode = 400;
    error.espnUrl = getESPNScoreboardUrl(toWeek);
    throw error;
  }

  const expectedTeamCounts = { 1: 12, 2: 8, 3: 4, 4: 2 };
  const expectedCount = expectedTeamCounts[toPlayoffWeek];
  if (expectedCount && activeTeams.size !== expectedCount) {
    console.warn(`[admin] WARNING: Expected ${expectedCount} teams for playoff week ${toPlayoffWeek}, got ${activeTeams.size}`);
  }

  console.log(`[admin] Active teams for NFL week ${toWeek}:`, Array.from(activeTeams));

  // Begin transaction
  await client.query('BEGIN');

  try {
    // Get all picks from the current week
    const picksResult = await client.query(`
      SELECT pk.id, pk.user_id, pk.player_id, pk.position, pk.multiplier, pk.consecutive_weeks, p.team, p.full_name
      FROM picks pk
      JOIN players p ON pk.player_id = p.id
      WHERE pk.week_number = $1
    `, [weeks.fromWeek]);

    let advancedCount = 0;
    let eliminatedCount = 0;
    const eliminated = [];
    const activeTeamsArray = Array.from(activeTeams);

    // Process each pick
    for (const pick of picksResult.rows) {
      const playerTeam = pick.team;
      const isActive = activeTeams.has(playerTeam);

      if (isActive) {
        const newMultiplier = (pick.multiplier || 1) + 1;
        const newConsecutiveWeeks = (pick.consecutive_weeks || 1) + 1;

        await client.query(`
          INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, false, NOW())
          ON CONFLICT (user_id, player_id, week_number) DO UPDATE SET
            multiplier = $5,
            consecutive_weeks = $6
        `, [pick.user_id, pick.player_id, toWeek, pick.position, newMultiplier, newConsecutiveWeeks]);

        advancedCount++;
      } else {
        eliminated.push({
          userId: pick.user_id,
          playerId: pick.player_id,
          playerName: pick.full_name,
          position: pick.position,
          team: playerTeam
        });
        eliminatedCount++;
      }
    }

    // Update game_settings atomically
    await client.query(
      'UPDATE game_settings SET active_teams = $1, current_playoff_week = $2',
      [activeTeamsArray, toPlayoffWeek]
    );

    await client.query('COMMIT');

    console.log(`[admin] Week transition COMMITTED: ${advancedCount} advanced, ${eliminatedCount} eliminated`);
    console.log(`[admin] game_settings updated: current_playoff_week = ${toPlayoffWeek}, active_teams = [${activeTeamsArray.join(', ')}]`);

    return {
      success: true,
      fromPlayoffWeek: weeks.fromPlayoffWeek,
      toPlayoffWeek,
      fromWeek: weeks.fromWeek,
      toWeek,
      activeTeams: activeTeamsArray,
      advancedCount,
      eliminatedCount,
      eliminated,
      skippedProBowlWeeks: validWeekData.skippedProBowlWeeks,
      newState: {
        current_playoff_week: toPlayoffWeek,
        effective_nfl_week: toWeek
      }
    };
  } catch (txErr) {
    await client.query('ROLLBACK');
    console.error('[admin] Week transition ROLLED BACK:', txErr.message);
    throw txErr;
  }
}

/**
 * Set the active playoff week (admin only).
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - Admin user ID
 * @param {number} weekNumber - Week number to set
 * @returns {Promise<Object>}
 */
async function setActiveWeek(pool, userId, weekNumber) {
  // Verify user is admin
  if (!await isAdmin(pool, userId)) {
    const error = new Error('Admin access required');
    error.statusCode = 403;
    throw error;
  }

  await pool.query(
    `INSERT INTO game_settings (setting_key, setting_value, updated_by, updated_at)
      VALUES ('playoff_start_week', $1, $2, NOW())
      ON CONFLICT (setting_key)
      DO UPDATE SET setting_value = $1, updated_by = $2, updated_at = NOW()`,
    [weekNumber.toString(), userId]
  );

  return {
    success: true,
    message: `Active week set to ${weekNumber}`,
    weekNumber
  };
}

module.exports = {
  // Admin verification
  isAdmin,

  // Week status
  updateWeekStatus,
  getLockStatusVerification,

  // Game state
  getGameState,

  // Week transition
  validateTransitionPreconditions,
  calculateTransitionWeeks,
  getWeekTransitionPreview,
  processWeekTransition,

  // Active week
  setActiveWeek
};
