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
const { validateRoundOpen } = require('./pgaRoundValidator');

/**
 * Sport mapping layer: convert template sport to player sport
 * contest_templates.sport can be lowercase (nfl, pga) or uppercase (GOLF)
 * players.sport uses uppercase (NFL, GOLF)
 */
const SPORT_PLAYER_MAP = {
  nfl: 'NFL',
  pga: 'GOLF',
  golf: 'GOLF'
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
 * Normalize player IDs to the canonical "espn_" format.
 *
 * Accepts both formats from clients:
 * - "espn_5724" → "espn_5724" (already canonical)
 * - "5724" → "espn_5724" (normalized)
 *
 * Always stores canonical format in database to match existing FK relationships.
 *
 * @param {string} playerId - Raw player ID from client
 * @returns {string} Normalized player ID with "espn_" prefix
 */
function normalizePlayerId(playerId) {
  if (typeof playerId !== 'string') {
    return playerId;
  }
  return playerId.startsWith('espn_') ? playerId : `espn_${playerId}`;
}

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
 * 8. Fetch existing roster and check for regression
 * 9. Upsert into entry_rosters with concurrency protection (column: player_ids)
 *
 * @param {Object} pool - Database pool
 * @param {string} contestInstanceId - UUID
 * @param {string} userId - UUID
 * @param {Array<string>} playerIds - Array of player IDs to submit
 * @param {boolean} allowRegression - If true, allow incoming count < existing count (user intent explicit)
 * @param {string} expectedUpdatedAt - ISO timestamp of last known version (required for optimistic concurrency)
 * @returns {Promise<Object>} { success: true, player_ids: [...], updated_at: ISO string }
 * @throws {Error} with code property matching ERROR_CODES
 */
async function submitPicks(pool, contestInstanceId, userId, playerIds, allowRegression = false, expectedUpdatedAt) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Wrap entire logic in try block to ensure ROLLBACK on any error
    // This guarantees atomicity: either all changes commit or all rollback

    // 0. Normalize player IDs to canonical "espn_" format
    // Accepts both "5724" and "espn_5724" formats from client
    const normalizedPlayerIds = playerIds.map(normalizePlayerId);

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

    // 4. Validate tournament round is open for submissions
    // Use client (not pool) to maintain transactional consistency
    const roundValidation = await validateRoundOpen(client, contestInstanceId);
    if (!roundValidation.valid) {
      throw Object.assign(
        new Error(roundValidation.reason),
        { ...ERROR_CODES.CONTEST_LOCKED, code: 'ROUND_LOCKED' }
      );
    }

    // 5. Validate user is a participant
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

    // 6. Derive roster config
    const rosterConfig = deriveRosterConfigFromStrategy(contestRow.scoring_strategy_key);

    // 7. Fetch field_selections if available
    const fieldResult = await client.query(
      `SELECT selection_json FROM field_selections WHERE contest_instance_id = $1 LIMIT 1`,
      [contestInstanceId]
    );

    // GUARD: Reject if field_selections row doesn't exist
    if (fieldResult.rows.length === 0) {
      throw Object.assign(
        new Error('Contest field not initialized'),
        ERROR_CODES.CONTEST_NOT_SCHEDULED
      );
    }

    const selectionJson = fieldResult.rows[0].selection_json;

    // GUARD: Reject if selectionJson structure is invalid (null or primary is not an array)
    // This check is about data integrity, not about whether the field is populated
    if (!selectionJson || !Array.isArray(selectionJson.primary)) {
      throw Object.assign(
        new Error('Contest field not initialized'),
        ERROR_CODES.CONTEST_NOT_SCHEDULED
      );
    }

    // At this point, selectionJson.primary is guaranteed to be an array (may be empty)
    // Extract primary field - array of player IDs (may be strings or objects with player_id property)
    const validatedField = selectionJson.primary.map(item => {
      // Handle both formats:
      // - String IDs from legacy/test data: "p1" or "espn_5724"
      // - Objects from ingestion with player_id property: { player_id: "espn_5724", name: "..." }
      const playerId = typeof item === 'string' ? item : item.player_id;
      return {
        // Normalize field player IDs to canonical "espn_" format for consistent comparison
        player_id: normalizePlayerId(playerId)
      };
    });

    // 8. Validate roster (size, duplicates, field membership)
    // Use normalized IDs for validation
    const validationResult = validateRoster(normalizedPlayerIds, rosterConfig, validatedField);
    if (!validationResult.valid) {
      throw Object.assign(
        new Error(`Roster validation failed: ${validationResult.errors.join('; ')}`),
        { ...ERROR_CODES.VALIDATION_FAILED, errors: validationResult.errors }
      );
    }

    // 9. REGRESSION GUARD: Fetch existing roster before update
    // Check if incoming < existing AND user didn't explicitly allow regression
    const existingResult = await client.query(
      `SELECT player_ids, updated_at FROM entry_rosters
       WHERE contest_instance_id = $1 AND user_id = $2`,
      [contestInstanceId, userId]
    );

    const existingRoster = existingResult.rows.length > 0 ? existingResult.rows[0] : null;
    const existingCount = existingRoster?.player_ids?.length ?? 0;
    const incomingCount = normalizedPlayerIds.length;

    console.log('[PICKS_SERVICE_DEBUG]', {
      contestInstanceId,
      userId,
      hasExistingRoster: !!existingRoster,
      existingPlayerCount: existingRoster?.player_ids?.length ?? null,
      existingUpdatedAt: existingRoster?.updated_at ?? null,
      expectedUpdatedAt
    });

    // REGRESSION DETECTION: Incoming count < existing count AND NOT explicitly allowed
    if (existingRoster && incomingCount < existingCount && !allowRegression) {
      console.warn('[ROSTER_MUTATION_AUDIT] REGRESSION BLOCKED (no explicit intent)', {
        source: 'API:submitPicks',
        operation: 'UPDATE',
        contest_instance_id: contestInstanceId,
        user_id: userId,
        old_player_ids_count: existingCount,
        incoming_player_ids_count: incomingCount,
        allow_regression: allowRegression,
        reason: 'regression_blocked_no_intent',
        timestamp: new Date().toISOString()
      });

      // Graceful response: return existing roster, ignore incoming
      // This prevents accidental data loss when user didn't intend to reduce roster
      await client.query('COMMIT');
      return {
        success: true,
        ignored: true,
        reason: 'regression_blocked_no_intent',
        player_ids: existingRoster.player_ids,
        updated_at: new Date(existingRoster.updated_at).toISOString()
      };
    }

    // 10. OPTIMISTIC CONCURRENCY: Split first-submission vs update
    // GOVERNANCE: Only user intent (API call) may modify entry_rosters
    // No background workers, triggers, or scheduled tasks

    // Determine if this is effectively a first submission:
    // - No roster row exists, OR
    // - Roster exists but player_ids is empty (row created at join time with no picks)
    const isFirstSubmission =
      !existingRoster ||
      !existingRoster.player_ids ||
      existingRoster.player_ids.length === 0;

    if (isFirstSubmission) {
      // FIRST SUBMISSION: UPSERT without version check
      // Row may or may not exist (empty roster created at join time)
      const upsertResult = await client.query(
        `INSERT INTO entry_rosters (contest_instance_id, user_id, player_ids, submitted_at, updated_at)
         VALUES ($1, $2, $3, now(), now())
         ON CONFLICT (contest_instance_id, user_id)
         DO UPDATE SET
           player_ids = EXCLUDED.player_ids,
           updated_at = now()
         RETURNING updated_at`,
        [contestInstanceId, userId, normalizedPlayerIds]
      );

      console.info('[ROSTER_MUTATION_AUDIT] FIRST SUBMISSION SUCCESS', {
        source: 'API:submitPicks',
        operation: existingRoster ? 'UPSERT_EMPTY' : 'INSERT',
        contest_instance_id: contestInstanceId,
        user_id: userId,
        new_player_ids: normalizedPlayerIds,
        new_player_ids_count: normalizedPlayerIds.length,
        new_updated_at: new Date(upsertResult.rows[0].updated_at).toISOString(),
        timestamp: new Date().toISOString()
      });

      await client.query('COMMIT');

      return {
        success: true,
        ignored: false,
        player_ids: normalizedPlayerIds,
        updated_at: new Date(upsertResult.rows[0].updated_at).toISOString()
      };
    }

    // EXISTING NON-EMPTY ROSTER: Require version for optimistic concurrency
    if (!expectedUpdatedAt) {
      await client.query('COMMIT');
      return {
        success: false,
        error_code: 'MISSING_VERSION',
        reason: 'expected_updated_at is required when updating an existing roster'
      };
    }

    // WHERE clause enforces explicit version contract
    // expectedUpdatedAt comes from client, must match what's in DB
    const updateResult = await client.query(
      `UPDATE entry_rosters
       SET player_ids = $1, updated_at = now()
       WHERE contest_instance_id = $2
         AND user_id = $3
         AND updated_at = $4
       RETURNING updated_at`,
      [normalizedPlayerIds, contestInstanceId, userId, expectedUpdatedAt]
    );

    // If no rows updated, timestamp mismatch = concurrent modification
    if (updateResult.rows.length === 0) {
      console.warn('[ROSTER_MUTATION_AUDIT] UPDATE CONFLICT: version mismatch', {
        source: 'API:submitPicks',
        operation: 'UPDATE',
        contest_instance_id: contestInstanceId,
        user_id: userId,
        old_player_ids_count: existingRoster.player_ids?.length || 0,
        incoming_player_ids_count: normalizedPlayerIds.length,
        expected_updated_at: expectedUpdatedAt,
        actual_updated_at: existingRoster.updated_at,
        reason: 'version_mismatch',
        timestamp: new Date().toISOString()
      });

      await client.query('COMMIT');
      return {
        success: false,
        error_code: 'CONCURRENT_MODIFICATION',
        reason: 'Roster was modified by another request. Please refresh and try again.',
        conflict: true
      };
    }

    // Success: UPDATE succeeded with matching timestamp
    console.info('[ROSTER_MUTATION_AUDIT] UPDATE SUCCESS', {
      source: 'API:submitPicks',
      operation: 'UPDATE',
      contest_instance_id: contestInstanceId,
      user_id: userId,
      old_player_ids: existingRoster.player_ids,
      new_player_ids: normalizedPlayerIds,
      old_player_ids_count: existingRoster.player_ids?.length || 0,
      new_player_ids_count: normalizedPlayerIds.length,
      allow_regression: allowRegression,
      old_updated_at: existingRoster.updated_at,
      new_updated_at: new Date(updateResult.rows[0].updated_at).toISOString(),
      timestamp: new Date().toISOString()
    });

    await client.query('COMMIT');
    return {
      success: true,
      ignored: false,
      player_ids: normalizedPlayerIds,
      updated_at: new Date(updateResult.rows[0].updated_at).toISOString()
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
    `SELECT player_ids, updated_at FROM entry_rosters WHERE contest_instance_id = $1 AND user_id = $2`,
    [contestInstanceId, userId]
  );

  const playerIds = entryResult.rows.length > 0 ? entryResult.rows[0].player_ids : [];
  const updatedAt = entryResult.rows.length > 0 && entryResult.rows[0].updated_at
    ? new Date(entryResult.rows[0].updated_at).toISOString()
    : null;

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

  let availablePlayers = [];  // Always initialize to array (never null per OpenAPI contract)

  // Determine if we should use field_selections or fallback to players table
  const shouldUseFieldSelections = fieldResult.rows.length > 0;

  // Validate field_selections has primary array in either:
  // - NEW format: [{ player_id: "...", name: "...", image_url?: "..." }, ...]
  // - LEGACY format: ["espn_123", "espn_456", ...] (IDs only, will be hydrated)
  const hasValidPrimarySelection = shouldUseFieldSelections &&
    fieldResult.rows[0].selection_json &&
    Array.isArray(fieldResult.rows[0].selection_json.primary) &&
    (fieldResult.rows[0].selection_json.primary || []).filter(Boolean).length > 0 &&
    fieldResult.rows[0].selection_json.primary[0] && (
      // New format: object with player_id and name
      (fieldResult.rows[0].selection_json.primary[0].player_id &&
       fieldResult.rows[0].selection_json.primary[0].name) ||
      // Legacy format: string (player ID)
      typeof fieldResult.rows[0].selection_json.primary[0] === 'string'
    );

  if (hasValidPrimarySelection) {
    // Use the explicitly configured players from field_selections.primary
    const selectionJson = fieldResult.rows[0].selection_json;
    const playerList = (selectionJson.primary || []).filter(Boolean);

    // CRITICAL: Handle both legacy format (array of strings) and new format (array of objects)
    // Legacy format: ["espn_123", "espn_456"] (IDs only)
    // New format: [{ player_id: "espn_123", name: "John", image_url: null }, ...]

    const firstItem = playerList[0];
    const isLegacyFormat = typeof firstItem === 'string';

    if (isLegacyFormat) {
      // Hydrate legacy format: fetch full player data by ID
      const playersResult = await pool.query(
        `SELECT id, full_name, image_url
         FROM players
         WHERE id = ANY($1)
         ORDER BY array_position($2::text[], id)`,
        [playerList, playerList]
      );

      availablePlayers = playersResult.rows.map(player => ({
        player_id: player.id,
        name: player.full_name,
        image_url: player.image_url || null
      }));
    } else {
      // New format: already has full objects, just map to contract
      availablePlayers = playerList.map(p => ({
        player_id: p.player_id,
        name: p.name,
        image_url: p.image_url || null
      }));
    }
  } else {
    // Fallback to players table: use when field_selections is missing or empty
    const playerSport = contestRow.sport ? SPORT_PLAYER_MAP[contestRow.sport.toLowerCase()] : null;
    if (playerSport) {
      const playersResult = await pool.query(
        `SELECT id, full_name, image_url
         FROM players
         WHERE sport = $1
         AND is_active = true
         ORDER BY full_name`,
        [playerSport]
      );

      availablePlayers = playersResult.rows.map(player => ({
        player_id: player.id,
        name: player.full_name,
        image_url: player.image_url || null
      }));

      // LAZY CREATION: Persist field_selections if tournament_configs exists
      // Never fabricate foreign keys. Only write if tournament_configs is present.
      if (!shouldUseFieldSelections && availablePlayers.length > 0) {
        try {
          const tcResult = await pool.query(
            `SELECT id FROM tournament_configs WHERE contest_instance_id = $1 LIMIT 1`,
            [contestInstanceId]
          );

          if (tcResult.rows.length > 0) {
            const tourneyConfigId = tcResult.rows[0].id;
            const selectionJson = {
              primary: availablePlayers.map(p => ({
                player_id: p.player_id,
                name: p.name,
                image_url: p.image_url
              })),
              alternates: []
            };

            await pool.query(
              `INSERT INTO field_selections (
                 id,
                 contest_instance_id,
                 tournament_config_id,
                 selection_json,
                 created_at
               )
               VALUES (gen_random_uuid(), $1, $2, $3::jsonb, NOW())
               ON CONFLICT DO NOTHING`,
              [contestInstanceId, tourneyConfigId, JSON.stringify(selectionJson)]
            );
          }
        } catch (err) {
          console.warn(
            `[entryRosterService] Failed to lazy-create field_selections for contest ${contestInstanceId}:`,
            err.message
          );
        }
      }
    }
    // Otherwise availablePlayers stays as []
  }

  return {
    player_ids: playerIds,
    can_edit: canEdit,
    lock_time: contestRow.lock_time ? new Date(contestRow.lock_time).toISOString() : null,
    roster_config: rosterConfig,
    available_players: availablePlayers,
    updated_at: updatedAt
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
