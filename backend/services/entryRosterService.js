/**
 * Entry Roster Service
 *
 * Manages user golfer/player picks for PGA contests.
 * - submitPicks: upsert user's roster (validated, time-gated, participant-scoped)
 * - getMyEntry: read user's current picks + context
 * - getContestRules: read scoring rules for a contest
 *
 * Invariants:
 * - entry_rosters stores ONLY picks (declaration layer)
 * - Scoring authority is always golfer_scores
 * - No computed totals stored
 * - No settlement interaction
 * - No ledger interaction
 * - Column: player_ids (text array)
 */

const { validateRoster } = require('./ContestRulesValidator');
const { getStrategy } = require('./scoringStrategyRegistry');

/**
 * Sport mapping layer: convert template sport to player sport
 * contest_templates.sport uses lowercase (nfl, pga)
 * players.sport uses uppercase (NFL, GOLF)
 */
const SPORT_PLAYER_MAP = {
  nfl: 'NFL',
  pga: 'GOLF'
};

/**
 * Error codes (map to HTTP status)
 */
const ERROR_CODES = {
  CONTEST_NOT_FOUND: { code: 'CONTEST_NOT_FOUND', status: 404 },
  CONTEST_NOT_SCHEDULED: { code: 'CONTEST_NOT_SCHEDULED', status: 409 },
  CONTEST_LOCKED: { code: 'CONTEST_LOCKED', status: 409 },
  NOT_A_PARTICIPANT: { code: 'NOT_A_PARTICIPANT', status: 403 },
  VALIDATION_FAILED: { code: 'VALIDATION_FAILED', status: 400 },
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', status: 500 }
};

/**
 * Derive roster config from scoring strategy.
 * Falls back to PGA defaults if strategy not found (with warning).
 * MUST return complete config matching OpenAPI RosterConfig schema.
 *
 * @param {string} strategyKey - e.g. 'pga_standard_v1'
 * @returns {Object} Complete roster config with all required fields
 */
function deriveRosterConfigFromStrategy(strategyKey) {
  try {
    const strategy = getStrategy(strategyKey);
    return strategy.rosterConfig();
  } catch (err) {
    // Error in strategy lookup or rosterConfig() call
    console.error(
      `[entryRosterService] Failed to derive roster config for strategy '${strategyKey}':`,
      err.message
    );

    // Return PGA defaults (safe fallback for most contests)
    // GOVERNANCE: Must match OpenAPI RosterConfig schema
    return {
      roster_size: 7,
      lineup_size: 7,
      scoring_count: 6,
      drop_lowest: true,
      entry_fields: ['player_ids'],
      validation_rules: {
        no_duplicates: true,
        must_be_in_field: true
      }
    };
  }
}

/**
 * Submit (upsert) player/golfer picks for a user in a contest.
 *
 * Validation sequence (atomic transaction):
 * 1. Lock contest row → fail if not found
 * 2. Validate status = SCHEDULED → CONTEST_NOT_SCHEDULED
 * 3. Validate now < lock_time (if lock_time not null) → CONTEST_LOCKED
 * 4. Validate user is in contest_participants → NOT_A_PARTICIPANT
 * 5. Derive roster config from scoring_strategy_key
 * 6. Fetch field_selections if available
 * 7. Validate roster via ContestRulesValidator → VALIDATION_FAILED
 * 8. Upsert into entry_rosters (column: player_ids)
 *
 * @param {Object} pool - Database pool
 * @param {string} contestInstanceId - UUID
 * @param {string} userId - UUID
 * @param {Array<string>} playerIds - Array of player IDs to submit
 * @returns {Promise<Object>} { success: true, player_ids: [...], updated_at: ISO string }
 * @throws {Error} with code property matching ERROR_CODES
 */
async function submitPicks(pool, contestInstanceId, userId, playerIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock contest row
    const contestResult = await client.query(
      `SELECT ci.id, ci.status, ci.lock_time, ct.scoring_strategy_key
       FROM contest_instances ci
       LEFT JOIN contest_templates ct ON ct.id = ci.template_id
       WHERE ci.id = $1
       FOR UPDATE OF ci`,
      [contestInstanceId]
    );

    if (contestResult.rows.length === 0) {
      throw Object.assign(new Error('Contest not found'), ERROR_CODES.CONTEST_NOT_FOUND);
    }

    const contestRow = contestResult.rows[0];
    const now = Date.now();
    const lockTimeMs = contestRow.lock_time ? new Date(contestRow.lock_time).getTime() : null;

    // 2. Validate status = SCHEDULED
    if (contestRow.status !== 'SCHEDULED') {
      throw Object.assign(
        new Error(`Contest is ${contestRow.status}, not SCHEDULED`),
        ERROR_CODES.CONTEST_NOT_SCHEDULED
      );
    }

    // 3. Validate lock_time: only lock if lock_time exists AND now >= lock_time
    // If lock_time is NULL, contest is always open for picks (no time-based lock)
    if (lockTimeMs !== null && now >= lockTimeMs) {
      throw Object.assign(
        new Error('Entry window is closed (past lock_time)'),
        ERROR_CODES.CONTEST_LOCKED
      );
    }

    // 4. Validate user is a participant
    const participantResult = await client.query(
      `SELECT 1 FROM contest_participants WHERE contest_instance_id = $1 AND user_id = $2`,
      [contestInstanceId, userId]
    );

    if (participantResult.rows.length === 0) {
      throw Object.assign(
        new Error('User is not a participant in this contest'),
        ERROR_CODES.NOT_A_PARTICIPANT
      );
    }

    // 5. Derive roster config
    const rosterConfig = deriveRosterConfigFromStrategy(contestRow.scoring_strategy_key);

    // 6. Fetch field_selections if available
    const fieldResult = await client.query(
      `SELECT selection_json FROM field_selections WHERE contest_instance_id = $1 LIMIT 1`,
      [contestInstanceId]
    );

    let validatedField = [];
    if (fieldResult.rows.length > 0) {
      const selectionJson = fieldResult.rows[0].selection_json;
      // Extract primary field - each item has { player_id, name, ... }
      if (selectionJson && Array.isArray(selectionJson.primary)) {
        validatedField = selectionJson.primary.map(player => ({
          player_id: player.player_id
        }));
      }
    }

    // 7. Validate roster (size, duplicates, field membership)
    const validationResult = validateRoster(playerIds, rosterConfig, validatedField);
    if (!validationResult.valid) {
      throw Object.assign(
        new Error(`Roster validation failed: ${validationResult.errors.join('; ')}`),
        { ...ERROR_CODES.VALIDATION_FAILED, errors: validationResult.errors }
      );
    }

    // 8. Upsert into entry_rosters
    const upsertResult = await client.query(
      `INSERT INTO entry_rosters (contest_instance_id, user_id, player_ids, submitted_at, updated_at)
       VALUES ($1, $2, $3, now(), now())
       ON CONFLICT (contest_instance_id, user_id)
       DO UPDATE SET player_ids = EXCLUDED.player_ids, updated_at = now()
       RETURNING updated_at`,
      [contestInstanceId, userId, playerIds]
    );

    await client.query('COMMIT');

    return {
      success: true,
      player_ids: playerIds,
      updated_at: new Date(upsertResult.rows[0].updated_at).toISOString()
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get user's current entry (picks) and context for a contest.
 *
 * Returns:
 * - player_ids: current player IDs (empty array if no entry)
 * - can_edit: true if contest SCHEDULED and (lock_time null OR before lock_time)
 * - lock_time: ISO string or null
 * - roster_config: { roster_size, entry_fields, validation_rules }
 * - available_players: [{ player_id, name }] or null if no field_selections
 *
 * @param {Object} pool - Database pool
 * @param {string} contestInstanceId - UUID
 * @param {string} userId - UUID
 * @returns {Promise<Object>} MyEntry response
 */
async function getMyEntry(pool, contestInstanceId, userId) {
  // Fetch contest + template (including sport for player pool mapping)
  const contestResult = await pool.query(
    `SELECT ci.id, ci.status, ci.lock_time, ct.scoring_strategy_key, ct.sport
     FROM contest_instances ci
     LEFT JOIN contest_templates ct ON ct.id = ci.template_id
     WHERE ci.id = $1`,
    [contestInstanceId]
  );

  if (contestResult.rows.length === 0) {
    throw Object.assign(
      new Error('Contest not found'),
      ERROR_CODES.CONTEST_NOT_FOUND
    );
  }

  const contestRow = contestResult.rows[0];
  const now = Date.now();
  const lockTimeMs = contestRow.lock_time ? new Date(contestRow.lock_time).getTime() : null;

  // Fetch user's entry_rosters row
  const entryResult = await pool.query(
    `SELECT player_ids FROM entry_rosters WHERE contest_instance_id = $1 AND user_id = $2`,
    [contestInstanceId, userId]
  );

  const playerIds = entryResult.rows.length > 0 ? entryResult.rows[0].player_ids : [];

  // Derive can_edit: true if SCHEDULED AND (lock_time null OR before lock_time)
  const canEdit =
    contestRow.status === 'SCHEDULED' &&
    (lockTimeMs === null || now < lockTimeMs);

  // Derive roster_config
  const rosterConfig = deriveRosterConfigFromStrategy(contestRow.scoring_strategy_key);

  // Fetch field_selections for available players
  const fieldResult = await pool.query(
    `SELECT selection_json FROM field_selections WHERE contest_instance_id = $1 LIMIT 1`,
    [contestInstanceId]
  );

  let availablePlayers = [];  // Default to empty array (OpenAPI contract requirement)
  if (fieldResult.rows.length > 0) {
    const selectionJson = fieldResult.rows[0].selection_json;
    if (selectionJson && Array.isArray(selectionJson.primary)) {
      const playerIds = (selectionJson.primary || []).filter(Boolean);

      if (playerIds.length > 0) {
        const playersResult = await pool.query(
          `
          SELECT id, full_name, image_url
          FROM players
          WHERE id = ANY($1::text[])
          `,
          [playerIds]
        );

        availablePlayers = playersResult.rows.map(p => ({
          player_id: p.id,
          name: p.full_name,
          image_url: p.image_url || null
        }));
      }
    }
  } else if (contestRow.sport) {
    // Fallback: if field_selections is empty, query players table directly
    // This is the primary path for PGA contests where players are global and not event-scoped
    const playerSport = SPORT_PLAYER_MAP[contestRow.sport.toLowerCase()];
    if (playerSport) {
      const playersResult = await pool.query(
        `SELECT id, full_name, image_url
         FROM players
         WHERE sport = $1
         AND is_active = true
         ORDER BY full_name`,
        [playerSport]
      );

      // Map all returned players to response format
      // If no players found, availablePlayers remains empty array []
      availablePlayers = playersResult.rows.map(player => ({
        player_id: player.id,
        name: player.full_name,
        image_url: player.image_url || null
      }));
    }
  }

  return {
    player_ids: playerIds,
    can_edit: canEdit,
    lock_time: contestRow.lock_time ? new Date(contestRow.lock_time).toISOString() : null,
    roster_config: rosterConfig,
    available_players: availablePlayers
  };
}

/**
 * Get scoring rules for a contest.
 *
 * Returns scoring rules, roster info, and payout structure.
 * Rules are derived from the contest's scoring_strategy_key.
 *
 * @param {Object} pool - Database pool
 * @param {string} contestInstanceId - UUID
 * @returns {Promise<Object>} ContestRules response
 */
async function getContestRules(pool, contestInstanceId) {
  // Fetch contest + template + payout structure
  const result = await pool.query(
    `SELECT ci.payout_structure, ct.scoring_strategy_key
     FROM contest_instances ci
     LEFT JOIN contest_templates ct ON ct.id = ci.template_id
     WHERE ci.id = $1`,
    [contestInstanceId]
  );

  if (result.rows.length === 0) {
    throw Object.assign(
      new Error('Contest not found'),
      ERROR_CODES.CONTEST_NOT_FOUND
    );
  }

  const contestRow = result.rows[0];
  const strategyKey = contestRow.scoring_strategy_key;
  const payoutStructure = contestRow.payout_structure || {};

  // Dispatch to strategy-specific rules
  const strategy = getStrategy(strategyKey);
  const strategyRules = strategy.rules(contestRow);

  return {
    scoring_strategy: strategyKey,
    hole_scoring: strategyRules.scoringRules,
    roster: strategyRules.rosterInfo,
    bonuses: strategyRules.bonuses,
    tie_handling: strategyRules.tieHandling,
    payout_structure: payoutStructure
  };
}

module.exports = {
  submitPicks,
  getMyEntry,
  getContestRules,
  deriveRosterConfigFromStrategy,
  ERROR_CODES
};
