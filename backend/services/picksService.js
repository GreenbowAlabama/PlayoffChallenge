/**
 * Picks Service
 *
 * Extracted from server.js as part of SOLID refactor.
 * Contains picks-related business logic with injected dependencies.
 */

const PICKS_ERROR_CODES = {
  // State errors from contest instance
  CONTEST_NOT_FOUND: 'CONTEST_NOT_FOUND',
  CONTEST_LOCKED: 'CONTEST_LOCKED',
  CONTEST_UNAVAILABLE: 'CONTEST_UNAVAILABLE', // For statuses like COMPLETE, CANCELLED, ERROR
  NOT_PARTICIPANT: 'NOT_PARTICIPANT',

  // Existing picks-related errors
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  WEEK_LOCKED: 'WEEK_LOCKED',
  WEEK_MISMATCH: 'WEEK_MISMATCH',
  PLAYER_NOT_FOUND: 'PLAYER_NOT_FOUND',
  PLAYER_INELIGIBLE: 'PLAYER_INELIGIBLE',
  POSITION_LIMIT_EXCEEDED: 'POSITION_LIMIT_EXCEEDED',
  PICK_NOT_FOUND: 'PICK_NOT_FOUND',
};

/**
 * Custom error class for picks operations with HTTP status codes.
 */
class PicksError extends Error {
  constructor(message, statusCode = 400, details = null, code = null) {
    super(message);
    this.name = 'PicksError';
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
  }
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
  const { contestInstanceId, userId, playerId, weekNumber, position, multiplier, consecutiveWeeks } = params;

  const result = await pool.query(`
    INSERT INTO picks (id, contest_instance_id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, false, NOW())
    ON CONFLICT (contest_instance_id, user_id, player_id, week_number)
    DO UPDATE SET
      position = $5,
      multiplier = $6,
      consecutive_weeks = $7,
      created_at = NOW()
    RETURNING *
  `, [contestInstanceId, userId, playerId, weekNumber, position, multiplier, consecutiveWeeks]);

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
async function deletePick(pool, pickId, userId, contestInstanceId) {
  await pool.query('DELETE FROM picks WHERE id = $1 AND user_id = $2 AND contest_instance_id = $3', [pickId, userId, contestInstanceId]);
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
async function deletePickByPlayer(pool, contestInstanceId, userId, playerId, weekNumber) {
  await pool.query(
    'DELETE FROM picks WHERE contest_instance_id = $1 AND user_id = $2 AND player_id = $3 AND week_number = $4',
    [contestInstanceId, userId, playerId, weekNumber]
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

// ==============================================
// ORCHESTRATION FUNCTIONS
// ==============================================

/**
 * Get game state from database.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} - Game state settings
 */
async function getGameState(pool) {
  const result = await pool.query(
    'SELECT current_playoff_week, playoff_start_week, is_week_active FROM game_settings LIMIT 1'
  );
  return result.rows[0] || {};
}

/**
 * Calculate effective week number from game state.
 *
 * @param {Object} gameState - Game state from getGameState
 * @returns {number} - Effective NFL week number
 */
function calculateEffectiveWeek(gameState) {
  const { current_playoff_week, playoff_start_week } = gameState;
  if (current_playoff_week > 0) {
    return playoff_start_week + Math.min(current_playoff_week - 1, 3);
  }
  return playoff_start_week > 0 ? playoff_start_week : 1;
}

/**
 * Execute v2 pick operations (add/remove).
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} params - Operation parameters
 * @param {string} params.userId - User ID
 * @param {number} params.weekNumber - Client-provided week number (optional, for validation)
 * @param {Object[]} params.ops - Array of operations [{action: 'add'|'remove', playerId?, pickId?}]
 * @param {string[]} params.selectableTeams - Array of selectable team abbreviations
 * @param {Function} params.normalizeTeamAbbr - Team abbreviation normalizer function
 * @returns {Promise<Object>} - Result with operations and position counts
 */
async function executePicksV2Operations(pool, params) {
  const { contestInstanceId, userId, weekNumber, ops, selectableTeams, normalizeTeamAbbr } = params;

  // Basic input validation
  if (!contestInstanceId) {
    throw new PicksError('contestInstanceId is required', 400);
  }
  if (!userId) {
    throw new PicksError('userId is required', 400);
  }
  if (!ops || !Array.isArray(ops) || ops.length === 0) {
    throw new PicksError('ops array is required and must not be empty', 400);
  }

  // Execute operations within a transaction to ensure atomicity and proper locking
  const dbClient = await pool.connect();
  let validation; // Declare validation outside try block to be accessible in return
  let effectiveWeek; // Declare effectiveWeek outside try block to be accessible in return

  try {
    await dbClient.query('BEGIN');

    // GAP-10 Step 2: 1. Contest existence and lifecycle verification
    const contestResult = await dbClient.query(
      'SELECT status FROM contest_instances WHERE id = $1 FOR UPDATE',
      [contestInstanceId]
    );

    if (contestResult.rows.length === 0) {
      await dbClient.query('ROLLBACK');
      throw new PicksError('Contest not found', 404, null, PICKS_ERROR_CODES.CONTEST_NOT_FOUND);
    }
    const contestStatus = contestResult.rows[0].status;

    if (contestStatus !== 'SCHEDULED') {
      await dbClient.query('ROLLBACK');
      let reason = 'Contest is not in a modifiable state.';
      let errorCode = PICKS_ERROR_CODES.CONTEST_UNAVAILABLE;
      if (contestStatus === 'LOCKED') {
        reason = 'Contest is locked and picks cannot be modified.';
        errorCode = PICKS_ERROR_CODES.CONTEST_LOCKED;
      } else if (contestStatus === 'COMPLETE') {
        reason = 'Contest is complete and picks cannot be modified.';
        errorCode = PICKS_ERROR_CODES.CONTEST_UNAVAILABLE;
      } else if (contestStatus === 'CANCELLED') {
        reason = 'Contest is cancelled and picks cannot be modified.';
        errorCode = PICKS_ERROR_CODES.CONTEST_UNAVAILABLE;
      } else if (contestStatus === 'LIVE') {
        reason = 'Contest is live and picks cannot be modified.';
        errorCode = PICKS_ERROR_CODES.CONTEST_UNAVAILABLE;
      }
      throw new PicksError(reason, 403, null, errorCode);
    }

    // GAP-10 Step 2: 2. Verify user is a participant in this specific contest
    const participantCheck = await dbClient.query(
      'SELECT 1 FROM contest_participants WHERE contest_instance_id = $1 AND user_id = $2',
      [contestInstanceId, userId]
    );

    if (participantCheck.rows.length === 0) {
      await dbClient.query('ROLLBACK');
      throw new PicksError('User is not a participant in this contest.', 403, null, PICKS_ERROR_CODES.NOT_PARTICIPANT);
    }

    // 3. All other eligibility and pick rule checks (after lifecycle and participation)

    // User validation (only check existence here, participation already checked)
    if (!await userExists(dbClient, userId)) { // Pass dbClient for transaction context
      await dbClient.query('ROLLBACK');
      throw new PicksError('User not found', 404, null, PICKS_ERROR_CODES.USER_NOT_FOUND);
    }

    // Get game state
    const gameState = await getGameState(dbClient); // Pass dbClient
    const { current_playoff_week, is_week_active } = gameState;

    // Week lockout check (traditional system-wide lock)
    // This is a global system setting, separate from contest-specific locking
    if (!is_week_active) {
      await dbClient.query('ROLLBACK');
      throw new PicksError('Picks are locked for this week. The submission window has closed.', 403, null, PICKS_ERROR_CODES.WEEK_LOCKED);
    }

    // Server is the single source of truth for active week
    effectiveWeek = calculateEffectiveWeek(gameState); // Assign to effectiveWeek declared outside try

    // Guard: reject if client sent a mismatched week
    if (weekNumber && parseInt(weekNumber, 10) !== effectiveWeek) {
      await dbClient.query('ROLLBACK');
      throw new PicksError(
        'Week mismatch. The active playoff week has changed. Please refresh.',
        409,
        { serverWeek: effectiveWeek, clientWeek: parseInt(weekNumber, 10) },
        PICKS_ERROR_CODES.WEEK_MISMATCH
      );
    }
    const proposedOps = [];
    for (const op of ops) {
      if (op.action === 'add') {
        const eligibility = await validatePlayerEligibility(dbClient, op.playerId, selectableTeams, normalizeTeamAbbr); // Pass dbClient
        if (!eligibility.valid) {
          await dbClient.query('ROLLBACK');
          throw new PicksError(eligibility.error, 400, null, PICKS_ERROR_CODES.PLAYER_INELIGIBLE);
        }
        proposedOps.push({ action: 'add', position: eligibility.player.position, playerId: op.playerId });
      } else if (op.action === 'remove') {
        const pick = await getPickById(dbClient, op.pickId); // Pass dbClient
        if (!pick) {
          await dbClient.query('ROLLBACK');
          throw new PicksError(`Pick ${op.pickId} not found`, 400, null, PICKS_ERROR_CODES.PICK_NOT_FOUND);
        }
        proposedOps.push({ action: 'remove', position: pick.position, pickId: op.pickId, playerId: pick.playerId });
      }
    }

    // Validate position limits
    validation = await validatePositionCounts(dbClient, userId, effectiveWeek, proposedOps); // Assign to validation declared outside try
    if (!validation.valid) {
      await dbClient.query('ROLLBACK');
      throw new PicksError('Position limit exceeded', 400, { details: validation.errors }, PICKS_ERROR_CODES.POSITION_LIMIT_EXCEEDED);
    }

    // Track removals by position for swap detection
    const removalsByPosition = new Map();

    for (const op of proposedOps) {
      if (op.action === 'add') {
        // Get carry-forward values
        let preservedMultiplier = 1;
        let preservedConsecutiveWeeks = 1;
        if (current_playoff_week > 1) {
          const carryForward = await getCarryForwardValues(dbClient, userId, op.playerId, effectiveWeek - 1);
          preservedMultiplier = carryForward.multiplier;
          preservedConsecutiveWeeks = carryForward.consecutiveWeeks;
          if (preservedMultiplier > 1) {
            console.log(`[picks/v2] Carrying multiplier ${preservedMultiplier} and consecutive_weeks ${preservedConsecutiveWeeks} for player ${op.playerId}`);
          }
        }

        const pickParams = {
          contestInstanceId,
          userId,
          playerId: op.playerId,
          weekNumber: effectiveWeek,
          position: op.position,
          multiplier: preservedMultiplier,
          consecutiveWeeks: preservedConsecutiveWeeks
        };

        const insertResult = await upsertPick(dbClient, pickParams);
        results.push({ action: 'add', success: true, pick: insertResult });

        // Check for swap
        const removal = removalsByPosition.get(op.position);
        if (removal && removal.playerId !== op.playerId) {
          await logPlayerSwap(dbClient, {
            userId, oldPlayerId: removal.playerId, newPlayerId: op.playerId,
            position: op.position, weekNumber: effectiveWeek
          });
          console.log(`[picks/v2] Logged swap: user ${userId} replaced ${removal.playerId} with ${op.playerId} at ${op.position} for week ${effectiveWeek}`);
        }
      } else if (op.action === 'remove') {
        await deletePick(dbClient, op.pickId, userId, contestInstanceId);
        results.push({ action: 'remove', success: true, pickId: op.pickId });
        removalsByPosition.set(op.position, { playerId: op.playerId, pickId: op.pickId });
      }
    }

    await dbClient.query('COMMIT');
  } catch (txErr) {
    await dbClient.query('ROLLBACK');
    throw txErr;
  } finally {
    dbClient.release();
  }

  return {
    success: true,
    weekNumber: effectiveWeek,
    operations: results,
    positionCounts: validation.counts
  };
}

/**
 * Execute player replacement (for eliminated teams).
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} params - Replacement parameters
 * @param {string} params.userId - User ID
 * @param {string} params.oldPlayerId - Old player ID to replace
 * @param {string} params.newPlayerId - New player ID
 * @param {string} params.position - Position
 * @param {number} params.weekNumber - Client-provided week number
 * @param {Set<string>} params.activeTeams - Set of active team abbreviations (from ESPN)
 * @param {string[]} params.selectableTeams - Array of selectable team abbreviations
 * @param {Function} params.normalizeTeamAbbr - Team abbreviation normalizer function
 * @returns {Promise<Object>} - Result with old/new player info and pick
 */
async function executePlayerReplacement(pool, params) {
  const { contestInstanceId, userId, oldPlayerId, newPlayerId, position, weekNumber, activeTeams, selectableTeams, normalizeTeamAbbr } = params;

  // Input validation
  if (!contestInstanceId) {
    throw new PicksError('contestInstanceId is required', 400);
  }
  if (!userId || !oldPlayerId || !newPlayerId || !position || !weekNumber) {
    throw new PicksError('Missing required parameters for player replacement.', 400);
  }

  // Get game state
  const gameState = await getGameState(pool);
  const { current_playoff_week, playoff_start_week, is_week_active } = gameState;

  // Week lockout check
  if (!is_week_active) {
    throw new PicksError('Picks are locked for this week. The submission window has closed.', 403, null, PICKS_ERROR_CODES.WEEK_LOCKED);
  }

  // Calculate effective week
  const effectiveWeekNumber = current_playoff_week > 0
    ? playoff_start_week + Math.min(current_playoff_week - 1, 3)
    : weekNumber;

  // Check old player's team
  const oldPlayer = await getOldPlayerInfo(pool, oldPlayerId);
  if (!oldPlayer) {
    throw new PicksError('Old player not found', 404, null, PICKS_ERROR_CODES.PLAYER_NOT_FOUND);
  }

  if (activeTeams.has(oldPlayer.team)) {
    throw new PicksError(`Cannot replace ${oldPlayer.full_name} - their team (${oldPlayer.team}) is still active`, 400, null, PICKS_ERROR_CODES.PLAYER_INELIGIBLE);
  }

  // Get and validate new player
  const newPlayer = await getNewPlayerInfo(pool, newPlayerId);
  if (!newPlayer) {
    throw new PicksError('New player not found', 404, null, PICKS_ERROR_CODES.PLAYER_NOT_FOUND);
  }

  // Check IR status
  const ineligibleStatuses = ['IR', 'PUP', 'SUSP'];
  const normalizedStatus = newPlayer.injury_status ? newPlayer.injury_status.toUpperCase().trim() : null;
  if (normalizedStatus && ineligibleStatuses.includes(normalizedStatus)) {
    throw new PicksError(`${newPlayer.full_name} is on ${newPlayer.injury_status} and cannot be selected.`, 400, null, PICKS_ERROR_CODES.PLAYER_INELIGIBLE);
  }

  // Check team eligibility
  const normalizedNewTeam = normalizeTeamAbbr(newPlayer.team);
  if (!selectableTeams.includes(normalizedNewTeam)) {
    throw new PicksError(`${newPlayer.full_name}'s team (${newPlayer.team}) has been eliminated. Only players from active teams are selectable.`, 400, null, PICKS_ERROR_CODES.PLAYER_INELIGIBLE);
  }

  // Validate position limit
  const positionLimit = await pool.query(
    'SELECT required_count FROM position_requirements WHERE position = $1',
    [position]
  );
  const maxPicks = positionLimit.rows[0]?.required_count || 2;
  const currentCount = await getCurrentPositionCount(pool, userId, effectiveWeekNumber, position, oldPlayerId);

  if (currentCount >= maxPicks) {
    throw new PicksError(`Position limit exceeded for ${position}. Maximum allowed: ${maxPicks}`, 400, null, PICKS_ERROR_CODES.POSITION_LIMIT_EXCEEDED);
  }

  // Perform operations within a transaction
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    // GAP-10 Step 2: Write-time lifecycle verification for contest_instance (copied from executePicksV2Operations)
    const contestResult = await dbClient.query(
      'SELECT status FROM contest_instances WHERE id = $1 FOR UPDATE',
      [contestInstanceId]
    );

    if (contestResult.rows.length === 0) {
      await dbClient.query('ROLLBACK');
      throw new PicksError('Contest not found', 404, null, PICKS_ERROR_CODES.CONTEST_NOT_FOUND);
    }
    const contestStatus = contestResult.rows[0].status;

    if (contestStatus !== 'SCHEDULED') {
      await dbClient.query('ROLLBACK');
      let reason = 'Contest is not in a modifiable state for player replacement.';
      let errorCode = PICKS_ERROR_CODES.CONTEST_UNAVAILABLE;
      if (contestStatus === 'LOCKED') {
        reason = 'Contest is locked and players cannot be replaced.';
        errorCode = PICKS_ERROR_CODES.CONTEST_LOCKED;
      }
      throw new PicksError(reason, 403, null, errorCode);
    }

    // GAP-10 Step 2: Verify user is a participant (copied from executePicksV2Operations)
    const participantCheck = await dbClient.query(
      'SELECT 1 FROM contest_participants WHERE contest_instance_id = $1 AND user_id = $2',
      [contestInstanceId, userId]
    );

    if (participantCheck.rows.length === 0) {
      await dbClient.query('ROLLBACK');
      throw new PicksError('User is not a participant in this contest.', 403, null, PICKS_ERROR_CODES.NOT_PARTICIPANT);
    }


    // Delete old pick
    await deletePickByPlayer(dbClient, contestInstanceId, userId, oldPlayerId, effectiveWeekNumber);

    // Get carry-forward values for new player
    let preservedMultiplier = 1;
    let preservedConsecutiveWeeks = 1;
    if (current_playoff_week > 1) {
      const carryForward = await getCarryForwardValues(dbClient, userId, newPlayerId, effectiveWeekNumber - 1);
      preservedMultiplier = carryForward.multiplier;
      preservedConsecutiveWeeks = carryForward.consecutiveWeeks;
      if (preservedMultiplier > 1) {
        console.log(`[swap] Carrying multiplier ${preservedMultiplier} and consecutive_weeks ${preservedConsecutiveWeeks} for player ${newPlayerId}`);
      }
    }

    // Create new pick
    const newPick = await upsertPick(dbClient, {
      contestInstanceId, // NEW
      userId, playerId: newPlayerId, weekNumber: effectiveWeekNumber,
      position, multiplier: preservedMultiplier, consecutiveWeeks: preservedConsecutiveWeeks
    });

    // Log the swap
    await logPlayerSwap(dbClient, {
      userId, oldPlayerId, newPlayerId, position, weekNumber: effectiveWeekNumber
    });

    await dbClient.query('COMMIT');

    console.log(`[swap] User ${userId} replaced ${oldPlayer.full_name} with ${newPlayer.full_name} for week ${effectiveWeekNumber}`);

    return {
      success: true,
      oldPlayer: {
        id: oldPlayerId,
        name: oldPlayer.full_name,
        team: oldPlayer.team
      },
      newPlayer: {
        id: newPlayerId,
        name: newPlayer.full_name,
        team: newPlayer.team
      },
      pick: newPick
    };
  } catch (txErr) {
    await dbClient.query('ROLLBACK');
    throw txErr;
  } finally {
    dbClient.release();
  }
}

module.exports = {
  // Error class
  PicksError,

  // Helpers
  getPositionLimits,

  // Read operations
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
  logPlayerSwap,

  // Orchestration (command handlers)
  executePicksV2Operations,
  executePlayerReplacement
};
