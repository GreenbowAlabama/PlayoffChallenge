/**
 * PGA ESPN Ingestion Adapter
 *
 * Ingestion implementation for PGA Tour (Masters) via ESPN API.
 * Implements snapshot binding per PGA v1 Section 4.1.
 */

'use strict';

const crypto = require('crypto');
const { scoreContestRosters } = require('../../scoring/pgaRosterScoringService');

/**
 * Canonicalize JSON for deterministic hashing.
 * Recursively sorts all object keys alphabetically, preserves array order.
 * (Reuse from settlementStrategy or implement minimally here)
 *
 * @param {*} obj - Object to canonicalize
 * @returns {*} Canonicalized object
 */
function canonicalizeJson(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => canonicalizeJson(item));
  }
  const keys = Object.keys(obj).sort();
  const canonical = {};
  keys.forEach(key => {
    canonical[key] = canonicalizeJson(obj[key]);
  });
  return canonical;
}

/**
 * Extract the earliest competitor tee time from ESPN API payload.
 *
 * Searches all competitors in the first event/competition and finds the earliest
 * valid startTime. Returns null if no valid tee times are found.
 *
 * All timestamps preserved in UTC (no timezone conversion).
 *
 * @param {Object} providerData - ESPN API response
 * @returns {Date|null} Earliest tee time in UTC, or null if not found
 */
function extractEarliestTeeTime(providerData) {
  // Guard: missing or invalid structure
  if (!providerData || !Array.isArray(providerData.events) || providerData.events.length === 0) {
    return null;
  }

  const event = providerData.events[0];
  if (!event || !Array.isArray(event.competitions) || event.competitions.length === 0) {
    return null;
  }

  const competition = event.competitions[0];
  if (!competition || !Array.isArray(competition.competitors) || competition.competitors.length === 0) {
    return null;
  }

  let earliestTime = null;

  for (const competitor of competition.competitors) {
    if (!competitor || !competitor.startTime) {
      continue;
    }

    // Attempt to parse startTime
    let teeTimeDate;
    try {
      teeTimeDate = new Date(competitor.startTime);
      // Validate that it's a valid date
      if (isNaN(teeTimeDate.getTime())) {
        continue;
      }
    } catch (err) {
      continue;
    }

    // Update earliest if this is the first valid time or earlier than current earliest
    if (!earliestTime || teeTimeDate < earliestTime) {
      earliestTime = teeTimeDate;
    }
  }

  return earliestTime;
}

/**
 * Derive lock_time from provider data with fallback chain.
 *
 * Fallback order:
 * 1. Earliest competitor teeTime (first tee time)
 *    only if >= fixture.start_time (prevents practice round/pro-am locking)
 * 2. Fallback event date (broadcast/tournament boundary)
 *
 * Returns object with lockTime and source for auditability.
 *
 * All timestamps preserved in UTC.
 *
 * @param {Object} providerData - ESPN API response
 * @param {Date} fallbackEventDate - Tournament broadcast date (fallback)
 * @returns {Object} { lockTime: Date, source: string }
 */
function deriveLockTimeFromProviderData(providerData, fallbackEventDate) {
  const earliestTeeTime = extractEarliestTeeTime(providerData);

  // Guard: Only use ESPN tee time if it's not before fixture start
  // Prevents contests locking early due to practice rounds or pro-am times
  if (earliestTeeTime && earliestTeeTime >= fallbackEventDate) {
    return {
      lockTime: earliestTeeTime,
      source: 'competitor_tee_time'
    };
  }

  // Log when rejecting early ESPN data
  if (earliestTeeTime && earliestTeeTime < fallbackEventDate) {
    console.warn(
      '[DISCOVERY] ESPN tee time earlier than fixture start, ignoring',
      {
        earliestTeeTime: earliestTeeTime.toISOString(),
        fallbackEventDate: fallbackEventDate.toISOString()
      }
    );
  }

  return {
    lockTime: fallbackEventDate,
    source: 'fallback_event_date'
  };
}

/**
 * Validate PGA template configuration
 * Called by contestTemplateService before template persistence.
 * @param {Object} input - Template input
 * @throws {Error} If validation fails
 */
function validateConfig(input) {
  // eventId validation
  if (!input.eventId || typeof input.eventId !== 'string' || input.eventId.trim() === '') {
    throw new Error('INVALID_PGA_TEMPLATE: eventId is required for pga_espn and must be a non-empty string');
  }

  // roster_size validation
  if (!Number.isInteger(input.roster_size) || input.roster_size < 1) {
    throw new Error('INVALID_PGA_TEMPLATE: roster_size is required for pga_espn and must be an integer >= 1');
  }

  // cut_after_round validation
  if (!Number.isInteger(input.cut_after_round) || input.cut_after_round < 1) {
    throw new Error('INVALID_PGA_TEMPLATE: cut_after_round is required for pga_espn and must be an integer >= 1');
  }

  // drop_lowest validation
  if (typeof input.drop_lowest !== 'boolean') {
    throw new Error('INVALID_PGA_TEMPLATE: drop_lowest is required for pga_espn and must be a boolean');
  }

  // payout_structure validation (using allowed_payout_structures field)
  if (!Array.isArray(input.allowed_payout_structures) || input.allowed_payout_structures.length === 0) {
    throw new Error('INVALID_PGA_TEMPLATE: payout_structure is required for pga_espn and must be a non-empty array');
  }
}

/**
 * Normalize ESPN payload for deterministic hashing.
 * Extracts competitors and complete rounds (18 holes), sorts deterministically.
 * Only includes rounds where all 18 holes have non-null/non-undefined values.
 *
 * @param {Object} providerData - ESPN API response
 * @returns {Object} Normalized structure { competitors: [...] }
 * @throws {Error} If required structure is missing
 */
function normalizeEspnPayload(providerData) {
  // Validate base structure and extract competitors (handles both formats)
  if (!providerData || typeof providerData !== 'object') {
    throw new Error('providerData is required and must be an object');
  }

  let competitors = [];

  // New format: competitors directly at root (ESPN /scoreboard endpoint)
  if (Array.isArray(providerData.competitors) && providerData.competitors.length > 0) {
    competitors = providerData.competitors;
  }
  // Old format: nested under events > competitions
  else if (Array.isArray(providerData.events) && providerData.events.length > 0) {
    const event = providerData.events[0];
    if (!event || !Array.isArray(event.competitions) || event.competitions.length === 0) {
      throw new Error('competitors array is missing in events format');
    }
    const competition = event.competitions[0];
    if (!competition || !Array.isArray(competition.competitors) || competition.competitors.length === 0) {
      throw new Error('competitors array is missing in competitions');
    }
    competitors = competition.competitors;
  } else {
    throw new Error('competitors array is missing in both formats (direct or nested)');
  }
  const normalizedCompetitors = [];

  competitors.forEach(competitor => {
    // Skip competitors with no id
    if (!competitor.id) {
      return;
    }

    const normalizedRounds = [];

    // Extract complete rounds (exactly 18 holes with non-null values)
    if (Array.isArray(competitor.linescores)) {
      competitor.linescores.forEach(linescore => {
        const holes = linescore.linescores || [];

        // Filter to holes with non-null, non-undefined values
        const validHoles = holes.filter(
          hole => hole.value !== null && hole.value !== undefined
        );

        // Only include round if it has exactly 18 valid holes
        if (validHoles.length === 18) {
          // Normalize each hole: include only period and rounded value
          const normalizedHoles = validHoles
            .map(hole => ({
              period: hole.period,
              value: Math.round(hole.value)
            }))
            .sort((a, b) => a.period - b.period);

          normalizedRounds.push({
            period: linescore.period,
            linescores: normalizedHoles
          });
        }
      });
    }

    // Sort rounds by period for deterministic ordering
    normalizedRounds.sort((a, b) => a.period - b.period);

    // Add competitor (with empty linescores if no complete rounds)
    normalizedCompetitors.push({
      id: competitor.id,
      linescores: normalizedRounds
    });
  });

  // Sort competitors by id for deterministic ordering
  normalizedCompetitors.sort((a, b) => {
    const aId = String(a.id);
    const bId = String(b.id);
    return aId.localeCompare(bId);
  });

  return {
    competitors: normalizedCompetitors
  };
}

async function getWorkUnits(ctx) {
  // Return empty array if ctx is missing or contestInstanceId is missing
  if (!ctx || !ctx.contestInstanceId) {
    return [];
  }

  // Resolve provider_event_id from multiple possible sources (camelCase or snake_case)
  const providerEventId =
    ctx.providerEventId ||
    ctx.provider_event_id ||
    ctx.contest?.provider_event_id;

  if (!providerEventId) {
    return [];
  }

  // PLAYER_POOL Phase: Emit one unit per golfer from ESPN leaderboard
  // Idempotency is handled by ingestionService via ingestion_runs table
  // Each unit with a unique externalPlayerId will only be processed once

  const espnPgaPlayerService = require('../espn/espnPgaPlayerService');
  const espnPgaApi = require('../espn/espnPgaApi');
  let golfers = [];

  try {
    // Extract numeric ESPN event ID from full provider_event_id (format: espn_pga_401811935)
    // ESPN API endpoints expect just the numeric ID (401811935)
    const espnEventId = providerEventId.includes('espn_pga_')
      ? providerEventId.replace(/^espn_pga_/, '')
      : providerEventId;

    // ── Event-scoped caching for PLAYER_POOL ────────────────────────────────
    // Multiple contests sharing the same provider_event_id will reuse the cached
    // field within a single ingestion cycle. Cache is lifecycle-scoped to one cycle.
    if (!ctx.__eventCache) {
      ctx.__eventCache = new Map();
    }

    const fieldCacheKey = `field:${espnEventId}`;
    if (ctx.__eventCache.has(fieldCacheKey)) {
      golfers = ctx.__eventCache.get(fieldCacheKey);
    } else {
      // Fetch tournament field from ESPN leaderboard (optimized for player pool)
      // Returns complete field with tee times and positions
      golfers = await espnPgaPlayerService.fetchTournamentField(espnEventId);
      ctx.__eventCache.set(fieldCacheKey, golfers);
    }
  } catch (err) {
    console.warn('[pgaEspnIngestion] Failed to fetch tournament field for PLAYER_POOL units:', err.message);
    // Don't throw - allow graceful degradation
    // Ingestion will retry on the next cycle
    return [];
  }

  if (!Array.isArray(golfers) || golfers.length === 0) {
    return [];
  }

  // INVARIANT: Competitor count must exceed minimum threshold
  // If ESPN returns fewer than 10 competitors, the field is invalid.
  // This prevents contests from completing with empty or undersized player pools.
  const competitorCount = golfers.length;
  if (competitorCount < 10) {
    throw new Error(
      `[PGA INGESTION] INVALID_COMPETITOR_COUNT event=${providerEventId} count=${competitorCount} expected_minimum=10`
    );
  }

  // Emit one unit per golfer
  // Idempotency: each unit with unique externalPlayerId is processed only once
  // (tracked in ingestion_runs table by ingestionService)
  // Attach golfer data to unit so ingestWorkUnit doesn't need to call ESPN again
  const units = golfers
    .filter(golfer => {
      // Guard: ensure external_id is present before creating unit
      if (!golfer.external_id) {
        return false;
      }
      return true;
    })
    .map(golfer => ({
      externalPlayerId: golfer.external_id,
      providerEventId: providerEventId,
      providerData: null,
      golfer: golfer  // Attach golfer data to avoid re-fetching
    }));

  // FIELD_BUILD Phase: Add a single unit to construct the contest field
  // Executes after all PLAYER_POOL units (maintains phase ordering)
  // Queries the players table and builds field_selections
  units.push({
    phase: 'FIELD_BUILD',
    providerEventId: providerEventId,
    providerData: null
  });

  // ── SCORING Phase: Fetch leaderboard and create SCORING work unit ──────────
  // Guarantees exactly one SCORING unit per polling cycle.
  // This ensures handleScoringIngestion() executes and scores populate golfer_event_scores.
  //
  // Event-scoped caching: Multiple contests sharing the same provider_event_id
  // will share the same leaderboard fetch within a single ingestion cycle.
  // Cache is stored in ctx.__eventCache (lifecycle = one cycle).
  try {
    const espnEventId = providerEventId.includes('espn_pga_')
      ? providerEventId.replace(/^espn_pga_/, '')
      : providerEventId;

    // Initialize cycle-scoped cache if not present
    if (!ctx.__eventCache) {
      ctx.__eventCache = new Map();
    }

    // Check cache for this event (using namespaced key to avoid collisions)
    const leaderboardCacheKey = `leaderboard:${espnEventId}`;
    let leaderboard;
    if (ctx.__eventCache.has(leaderboardCacheKey)) {
      leaderboard = ctx.__eventCache.get(leaderboardCacheKey);
    } else {
      // Fetch from ESPN and cache for remaining contests in this cycle
      leaderboard = await espnPgaApi.fetchLeaderboard({ eventId: espnEventId });
      ctx.__eventCache.set(leaderboardCacheKey, leaderboard);
    }

    // Create SCORING unit with fetched leaderboard
    units.push({
      phase: 'SCORING',
      providerEventId: providerEventId,
      providerData: leaderboard
    });
  } catch (err) {
    // Re-throw: SCORING unit is critical for the platform
    // Without it, scores never populate and contests cannot progress
    throw err;
  }

  return units;
}

function computeIngestionKey(contestInstanceId, unit) {
  // Validate contestInstanceId
  if (!contestInstanceId) {
    throw new Error('contestInstanceId is required');
  }
  if (typeof contestInstanceId !== 'string') {
    throw new Error('contestInstanceId is required and must be a string');
  }

  // Validate unit
  if (!unit) {
    throw new Error('unit is required');
  }

  // FIELD_BUILD phase: unique key per contest instance
  // FIELD_BUILD is a one-time operation per contest, so key is deterministic
  if (unit.phase === 'FIELD_BUILD') {
    if (!unit.providerEventId) {
      throw new Error('FIELD_BUILD units require providerEventId');
    }
    return `field_build:${contestInstanceId}`;
  }

  // PLAYER_POOL phase units may not contain providerData
  if (!unit.providerData) {
    // Deterministic fallback for player pool ingestion
    if (unit.playerId) {
      return `player_pool:${unit.playerId}`;
    }

    if (unit.externalPlayerId) {
      return `player_pool:${unit.externalPlayerId}`;
    }

    // Defensive guard
    throw new Error('Cannot compute ingestion key: missing providerData and player identifier');
  }

  // SCORING phase: validate providerEventId and providerData
  // Validate providerEventId
  if (!unit.providerEventId) {
    throw new Error('unit.providerEventId is required');
  }
  if (typeof unit.providerEventId !== 'string' || unit.providerEventId.trim() === '') {
    throw new Error('unit.providerEventId is required and must be a non-empty string');
  }

  // Validate providerData is an object
  if (typeof unit.providerData !== 'object') {
    throw new Error('unit.providerData must be an object');
  }

  // Normalize payload (validates structure and extracts score-relevant fields)
  const normalized = normalizeEspnPayload(unit.providerData);

  // Build canonical structure with providerEventId
  const canonical = {
    providerEventId: unit.providerEventId,
    competitors: normalized.competitors
  };

  // Canonicalize and hash for deterministic key
  const canonicalized = canonicalizeJson(canonical);
  const hashHex = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalized))
    .digest('hex');

  return `pga_espn:${contestInstanceId}:${hashHex}`;
}

/**
 * Handle PLAYER_POOL phase ingestion: upsert one golfer to players table.
 *
 * The golfer data is already fetched and attached to the unit by getWorkUnits(),
 * so we avoid redundant ESPN API calls. This method performs two operations:
 * 1. Upsert golfer to players table
 * 2. Store external_player_id in ingestion_runs for FIELD_BUILD phase scope isolation
 *
 * @param {Object} ctx - Ingestion context { contestInstanceId, dbClient, ... }
 * @param {Object} unit - PLAYER_POOL unit { externalPlayerId, workUnitKey, providerEventId, golfer }
 * @returns {Promise<Array>} Empty array (no scores for PLAYER_POOL phase)
 * @throws {Error} If database operations fail
 */
async function handlePlayerPoolIngestion(ctx, unit) {
  const { contestInstanceId, dbClient } = ctx;

  // Extract golfer data from unit (pre-fetched by getWorkUnits)
  const golfer = unit.golfer;

  if (!golfer) {
    throw new Error('handlePlayerPoolIngestion: unit.golfer is required (must be populated by getWorkUnits)');
  }

  // Validate unit.workUnitKey is present
  if (!unit.workUnitKey) {
    throw new Error('PLAYER_POOL unit missing workUnitKey');
  }

  // Upsert single golfer into players table
  // Use ON CONFLICT DO UPDATE to handle re-ingestion gracefully
  const upsertQuery = `
    INSERT INTO players (
      id,
      espn_id,
      full_name,
      image_url,
      sport,
      position,
      is_active,
      available,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, true, true, NOW())
    ON CONFLICT (espn_id) DO UPDATE
    SET
      full_name = EXCLUDED.full_name,
      image_url = EXCLUDED.image_url,
      sport = EXCLUDED.sport,
      position = EXCLUDED.position,
      is_active = true,
      available = true,
      updated_at = NOW()
  `;

  const playerId = `espn_${golfer.external_id}`;

  try {
    await dbClient.query(upsertQuery, [
      playerId,                    // id (synthetic, based on external_id)
      golfer.external_id,          // espn_id (authoritative external ID)
      golfer.name,                 // full_name
      golfer.image_url || null,    // image_url (safe null handling)
      golfer.sport,                // sport (GOLF)
      golfer.position,             // position (G for golfer)
    ]);
  } catch (err) {
    console.error(`[pgaEspnIngestion] Upsert failed for golfer ${golfer.external_id}:`, err.message);
    throw err;
  }

  // Store external_player_id in ingestion_runs for FIELD_BUILD phase scope isolation
  // This allows FIELD_BUILD to query only golfers ingested for this specific contest
  try {
    await dbClient.query(`
      UPDATE ingestion_runs
      SET external_player_id = $1
      WHERE contest_instance_id = $2
      AND work_unit_key = $3
    `, [
      golfer.external_id,
      contestInstanceId,
      unit.workUnitKey
    ]);
  } catch (err) {
    console.error(`[pgaEspnIngestion] Failed to update ingestion_runs with external_player_id:`, err.message);
    throw err;
  }

  // Return empty scores array (PLAYER_POOL phase has no scores)
  return [];
}

/**
 * Handle FIELD_BUILD phase ingestion: construct contest field from contest-specific PLAYER_POOL results.
 *
 * CRITICAL: Field is scoped to golfers ingested for this specific contest_instance_id.
 *
 * Algorithm:
 * 1. Get tournament_config_id for this contest
 * 2. Query ingestion_runs for PLAYER_POOL units (via external_player_id)
 * 3. Query players table using those espn_ids
 * 4. Build field_selections with deterministically ordered player ids
 * 5. Insert/update with idempotent ON CONFLICT
 *
 * @param {Object} ctx - Ingestion context { contestInstanceId, dbClient, ... }
 * @param {Object} unit - FIELD_BUILD unit { phase: 'FIELD_BUILD', workUnitKey, providerEventId }
 * @returns {Promise<Array>} Empty array (no scores for FIELD_BUILD phase)
 * @throws {Error} If database operations fail
 */
async function handleFieldBuildIngestion(ctx, unit) {
  const { contestInstanceId, dbClient } = ctx;

  if (!unit.providerEventId) {
    throw new Error('handleFieldBuildIngestion: unit.providerEventId is required');
  }

  // Step 1: Get tournament_config_id for this contest
  const configResult = await dbClient.query(`
    SELECT id FROM tournament_configs
    WHERE contest_instance_id = $1
  `, [contestInstanceId]);

  if (configResult.rows.length === 0) {
    throw new Error(`handleFieldBuildIngestion: No tournament_config found for contest ${contestInstanceId}`);
  }

  const tournamentConfigId = configResult.rows[0].id;

  // Step 2: Query ingestion_runs for PLAYER_POOL external_player_ids
  // Only golfers actually ingested for this contest are included
  const runsResult = await dbClient.query(`
    SELECT external_player_id
    FROM ingestion_runs
    WHERE contest_instance_id = $1
    AND external_player_id IS NOT NULL
    AND status = 'COMPLETE'
  `, [contestInstanceId]);

  if (runsResult.rows.length === 0) {
    throw new Error(`handleFieldBuildIngestion: No completed PLAYER_POOL units found for contest ${contestInstanceId}`);
  }

  // Extract external_player_ids from query results
  const externalPlayerIds = runsResult.rows.map(row => row.external_player_id);

  // Step 3: Query players table using espn_ids
  // Results are ordered by ID for deterministic field composition
  const playersResult = await dbClient.query(`
    SELECT id
    FROM players
    WHERE espn_id = ANY($1)
    ORDER BY id ASC
  `, [externalPlayerIds]);

  if (playersResult.rows.length === 0) {
    throw new Error(`handleFieldBuildIngestion: No players found for external_ids [${externalPlayerIds.join(', ')}]`);
  }

  const playerIds = playersResult.rows.map(row => row.id);

  // Step 4: Build field selection JSON with primary roster
  const selectionJson = {
    primary: playerIds
  };

  // Step 5: Insert into field_selections with idempotent ON CONFLICT
  await dbClient.query(`
    INSERT INTO field_selections (
      id,
      contest_instance_id,
      tournament_config_id,
      selection_json,
      created_at
    ) VALUES (
      gen_random_uuid(),
      $1,
      $2,
      $3,
      NOW()
    )
    ON CONFLICT (contest_instance_id) DO UPDATE
    SET
      selection_json = $3,
      tournament_config_id = $2
  `, [
    contestInstanceId,
    tournamentConfigId,
    JSON.stringify(selectionJson)
  ]);

  // Logging summarized in ingestion_runs update below

  // ── Create ingestion_event for PLAYER_POOL snapshot ──────────────────────────
  //
  // ARCHITECTURE NOTE: This ingestion_event represents the full PLAYER_POOL
  // snapshot for the contest at this point in time. Ingestion events are emitted
  // per provider payload snapshot, NOT per individual golfer record.
  //
  // This event is required for:
  //   • Deterministic settlement (binding snapshots)
  //   • Auditability (record of field at contest creation time)
  //   • Replay safety (can re-run settlement from snapshot)
  //   • Append-only ledger (immutable ingestion history)
  //
  // See docs/architecture/ESPN-PGA-Ingestion.md (PLAYER_POOL Snapshot Event)
  // and docs/architecture/DATA_INGESTION_MODEL.md (Event Granularity Invariant)
  //
  // After all PLAYER_POOL units have been ingested and field built,
  // emit ONE ingestion_event representing the entire field snapshot.
  // This snapshot is required for downstream settlement pipeline.
  const playersForSnapshot = await dbClient.query(`
    SELECT espn_id, full_name
    FROM players
    WHERE id = ANY($1)
    ORDER BY id ASC
  `, [playerIds]);

  const golfersList = playersForSnapshot.rows.map(p => ({
    external_id: p.espn_id,
    name: p.full_name
  }));

  const payloadSnapshot = {
    provider_event_id: unit.providerEventId,
    golfers: golfersList
  };

  const payloadHashSnapshot = crypto
    .createHash('sha256')
    .update(JSON.stringify(payloadSnapshot))
    .digest('hex');

  try {
    await dbClient.query(`
      INSERT INTO ingestion_events (
        id,
        contest_instance_id,
        provider,
        event_type,
        provider_data_json,
        payload_hash,
        validation_status,
        validated_at
      ) VALUES (
        gen_random_uuid(),
        $1,
        $2,
        $3,
        $4,
        $5,
        'VALID',
        NOW()
      )
      ON CONFLICT (contest_instance_id, payload_hash) DO NOTHING
    `, [
      contestInstanceId,
      'pga_espn',
      'player_pool',
      JSON.stringify(payloadSnapshot),
      payloadHashSnapshot
    ]);
    console.log(`[pgaEspnIngestion] Created PLAYER_POOL ingestion_event for contest ${contestInstanceId}: ${golfersList.length} golfers`);
  } catch (err) {
    console.error(`[pgaEspnIngestion] Failed to create PLAYER_POOL ingestion_event for ${contestInstanceId}:`, err.message);
    throw err;
  }

  // Return empty scores array (FIELD_BUILD phase has no scores)
  return [];
}

/**
 * Handle SCORING phase ingestion: parse ESPN leaderboard, score golfers, return normalized scores.
 *
 * Flow:
 * 1. Parse ESPN competitors and rounds
 * 2. Map ESPN player IDs to database golfer IDs via players table
 * 3. Determine current round and final round status
 * 4. Build normalized round payload (golfers with holes, par, strokes)
 * 5. Fetch template scoring rules
 * 6. Call pgaStandardScoring.scoreRound()
 * 7. Return golfer-level scores for golfer_event_scores table
 *
 * CRITICAL: This function produces GOLFER-LEVEL scores only.
 * Do NOT map to users. Do NOT create entry totals.
 * Entry aggregation happens later via pgaEntryAggregation.
 *
 * @param {Object} ctx - Ingestion context { contestInstanceId, dbClient, ... }
 * @param {Object} unit - SCORING unit { providerEventId, providerData }
 * @returns {Promise<Array>} Golfer scores for golfer_event_scores
 */
async function handleScoringIngestion(ctx, unit) {
  const { contestInstanceId, dbClient } = ctx;

  if (!unit.providerData) {
    throw new Error('handleScoringIngestion: unit.providerData is required (ESPN leaderboard)');
  }

  const providerData = unit.providerData;
  const providerEventId = unit.providerEventId;

  // ── Step 1: Parse ESPN structure (handles both old and new formats) ────────
  // ESPN endpoints return different structures:
  // - New format (/scoreboard): { competitors: [...] }
  // - Old format (full event): { events: [{competitions: [{competitors: [...]}]}] }
  // Extract competitors regardless of which format we receive.

  let competitors = [];

  // Try new format first: direct competitors at root (most common now)
  if (Array.isArray(providerData.competitors) && providerData.competitors.length > 0) {
    competitors = providerData.competitors;
    console.log(`[SCORING] Using scoreboard format (direct competitors)`);
  }
  // Fallback to old format: nested under events > competitions
  else if (Array.isArray(providerData.events) && providerData.events.length > 0) {
    const eventId = providerEventId.replace(/^espn_pga_/, '');
    const event = providerData.events.find(e => e.id === eventId);

    if (event && Array.isArray(event.competitions) && event.competitions.length > 0) {
      const competition = event.competitions[0];
      competitors = competition.competitors || [];
      console.log(`[SCORING] Using event format (nested competitions)`);
    }
  }

  if (competitors.length === 0) {
    console.warn(`[SCORING] No competitors found in either format, returning empty`);
    return [];
  }

  // ── Step 2: Determine current round number ───────────────────────────────
  // Round number = highest period in competitors' linescores
  let currentRound = 1;
  for (const competitor of competitors) {
    if (competitor.linescores && Array.isArray(competitor.linescores)) {
      for (const linescore of competitor.linescores) {
        if (linescore.period && linescore.period > currentRound) {
          currentRound = linescore.period;
        }
      }
    }
  }

  // ── Step 3: Query which rounds already exist in golfer_event_scores ───────
  // IDEMPOTENCY SAFEGUARD: Only score new rounds, skip already-processed ones
  const existingRoundsResult = await dbClient.query(
    `SELECT DISTINCT round_number
     FROM golfer_event_scores
     WHERE contest_instance_id = $1`,
    [contestInstanceId]
  );

  const scoredRounds = new Set(
    existingRoundsResult.rows.map(r => Number(r.round_number))
  );

  // ── Step 4: Determine final round status ──────────────────────────────────
  // Tournament is final when NOW() >= tournament_end_time (deterministic, not ESPN-dependent)
  const endTimeResult = await dbClient.query(
    `SELECT tournament_end_time
     FROM contest_instances
     WHERE id = $1`,
    [contestInstanceId]
  );

  let is_final_round = false;
  if (endTimeResult.rows.length > 0 && endTimeResult.rows[0].tournament_end_time) {
    const endTime = new Date(endTimeResult.rows[0].tournament_end_time);
    const now = new Date();
    is_final_round = now >= endTime;
    console.log(
      `[SCORING] Tournament end check: endTime=${endTime.toISOString()}, now=${now.toISOString()}, is_final=${is_final_round}`
    );
  } else {
    console.log(`[SCORING] No tournament_end_time found for contest, is_final=false`);
  }

  // ── Step 5: Fetch template scoring strategy and resolve to rules object ────────
  const configResult = await dbClient.query(
    `SELECT ct.scoring_strategy_key
     FROM contest_instances ci
     JOIN contest_templates ct ON ci.template_id = ct.id
     WHERE ci.id = $1`,
    [contestInstanceId]
  );

  let templateRules = {};
  if (configResult.rows.length > 0 && configResult.rows[0].scoring_strategy_key) {
    const strategyKey = configResult.rows[0].scoring_strategy_key;

    // CRITICAL: Resolve strategy key to strategy module to get rules object
    // Strategy modules export rules function that returns {scoring, finish_bonus, ...}
    const { getStrategy } = require('../../scoringStrategyRegistry');
    const strategyModule = getStrategy(strategyKey);

    // Strategy modules export a rules(contestRow) function that returns the rules object
    // For now, we call rules without contest row (can be null for default rules)
    if (strategyModule && typeof strategyModule.rules === 'function') {
      templateRules = strategyModule.rules(null) || {};
    } else {
      console.warn(`[SCORING] Strategy module ${strategyKey} does not export rules function`);
    }
  }

  const pgaStandardScoring = require('../../scoring/strategies/pgaStandardScoring');
  const allFinalScores = [];

  // ── Step 6: Score only new rounds (rounds 1 to currentRound not yet scored) ──
  for (let roundNum = 1; roundNum <= currentRound; roundNum++) {
    // IDEMPOTENCY CHECK: Skip if this round already has scores
    // EXCEPTION: Allow final round to be reprocessed if tournament passes tournament_end_time
    // This ensures finish_bonus is applied even if round 4 was scored before tournament ended
    const isFinalRoundCandidate = roundNum === currentRound;
    const shouldSkip = scoredRounds.has(roundNum) && !(isFinalRoundCandidate && is_final_round);

    if (shouldSkip) {
      continue;
    }

    // ── Step 6a: Build golfers array for this specific round ────────────────
    const golfers = [];
    let skippedNoRoundData = 0;
    let skippedNoHoles = 0;

    for (const competitor of competitors) {
      const espnPlayerId = String(competitor.id);
      const golferId = `espn_${espnPlayerId}`;

      // Check if golfer has score data: either linescores or top-level score field
      const hasLinescores =
        competitor.linescores &&
        competitor.linescores.length > 0;

      const hasScore =
        competitor.score !== undefined &&
        competitor.score !== null;

      // Skip only if golfer has neither linescores nor score
      if (!hasLinescores && !hasScore) {
        skippedNoRoundData++;
        continue;
      }

      // Extract holes with par and strokes from THIS SPECIFIC ROUND
      const holes = [];
      if (hasLinescores) {
        const roundData =
          competitor.linescores.find(ls => ls.period === roundNum);

        if (roundData && roundData.linescores) {
          for (const hole of roundData.linescores) {
            // Only include holes with valid strokes
            if (typeof hole.value === 'number' && isFinite(hole.value)) {
              const parValue = hole.par || 4;
              holes.push({
                hole_number: holes.length + 1,
                par: parValue,
                strokes: Math.round(hole.value)
              });
            }
          }
        }
      }

      // Leave holes empty if ESPN linescores are missing for this round
      if (holes.length === 0 && !hasScore) {
        skippedNoHoles++;
        continue;
      }

      // Compute cumulative tournament strokes from all rounds in ESPN payload
      let tournamentStrokes = 0;
      if (hasLinescores && competitor.linescores && Array.isArray(competitor.linescores)) {
        for (const linescore of competitor.linescores) {
          if (linescore.linescores && Array.isArray(linescore.linescores)) {
            for (const hole of linescore.linescores) {
              if (typeof hole.value === 'number' && isFinite(hole.value)) {
                tournamentStrokes += Math.round(hole.value);
              }
            }
          }
        }
      }

      golfers.push({
        golfer_id: golferId,
        holes,
        tournament_strokes: tournamentStrokes,  // Cumulative tournament strokes for ranking
        position: 0,  // Position will be computed by scoring strategy for final round
        score: competitor.score
      });
    }

    if (golfers.length === 0) {
      continue;
    }

    // ── Step 6b: Score this round using pgaStandardScoring ──────────────────
    const scoringResult = pgaStandardScoring.scoreRound({
      normalizedRoundPayload: {
        event_id: providerEventId,
        round_number: roundNum,
        golfers,
        is_final_round: roundNum === currentRound && is_final_round
      },
      templateRules
    });

    // ── Step 6c: Add contest context to golfer scores for this round ────────
    const roundScores = scoringResult.golfer_scores.map(score => ({
      contest_instance_id: contestInstanceId,
      golfer_id: score.golfer_id,
      round_number: roundNum,
      hole_points: score.hole_points,
      bonus_points: score.bonus_points,
      finish_bonus: score.finish_bonus,
      total_points: score.total_points
    }));

    allFinalScores.push(...roundScores);
  }

  if (allFinalScores.length === 0) {
    return [];
  }

  const finalScores = allFinalScores;

  // Log summary of scoring run
  const roundCounts = finalScores.reduce((acc, row) => {
    acc[row.round_number] = (acc[row.round_number] || 0) + 1;
    return acc;
  }, {});

  console.log(
    `[SCORING] PGA scoring complete | contest=${contestInstanceId} | ` +
    `total_scores=${finalScores.length} | rounds=${Object.keys(roundCounts).sort().join(',')} | ` +
    `final_round=${is_final_round}`
  );

  return finalScores;
}

/**
 * Ingest one work unit: create immutable snapshot of provider data for settlement binding.
 *
 * Per PGA v1 Section 4.1:
 * - Normalize and canonicalize provider_data
 * - Compute SHA-256 hash (snapshot_hash)
 * - Insert into event_data_snapshots (immutable snapshot)
 * - Insert into ingestion_events (metadata)
 * - Return normalized scores for upsertScores
 *
 * Also handles PLAYER_POOL phase:
 * - Fetch golfers from ESPN scoreboard
 * - Upsert into players table
 * - Return empty scores array
 *
 * @param {Object} ctx - Ingestion context { contestInstanceId, dbClient, ... }
 * @param {Object} unit - Work unit { providerEventId, providerData, ... } or PLAYER_POOL unit { externalPlayerId }
 * @returns {Promise<Array>} Normalized score objects for upsertScores (empty for PLAYER_POOL)
 */
async function ingestWorkUnit(ctx, unit) {
  const { contestInstanceId, dbClient } = ctx;

  if (!unit) {
    throw new Error('ingestWorkUnit: unit is required');
  }

  // ── FIELD_BUILD Phase: Detect and handle ────────────────────────────────────
  if (unit.phase === 'FIELD_BUILD') {
    // This is a FIELD_BUILD unit: build contest field and insert into field_selections
    return await handleFieldBuildIngestion(ctx, unit);
  }

  // ── PLAYER_POOL Phase: Detect and handle ────────────────────────────────────
  if (!unit.providerData && unit.externalPlayerId) {
    // This is a PLAYER_POOL unit: fetch golfers and upsert to players table
    return await handlePlayerPoolIngestion(ctx, unit);
  }

  // ── SCORING Phase: Standard snapshot persistence ────────────────────────────
  if (!unit.providerData) {
    throw new Error('ingestWorkUnit: unit.providerData is required for SCORING phase (ESPN tournament data)');
  }

  const providerData = unit.providerData;
  const providerEventId = unit.providerEventId || null;

  // ── Step 1: Normalize payload (extract scoring-relevant fields) ────────
  const normalizedPayload = normalizeEspnPayload(providerData);

  // ── Step 2: Canonicalize normalized payload ────────────────────────────
  const canonicalizedNormalized = canonicalizeJson(normalizedPayload);

  // ── Step 3: Compute SHA-256 hash of canonical normalized payload ───────
  const snapshotHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalizedNormalized))
    .digest('hex');

  // ── Step 4: Derive provider_final_flag from ESPN event status ──────────
  // ESPN uses event.status.type.name = "STATUS_FINAL" when tournament is complete
  const providerFinalFlag = providerData.events?.[0]?.status?.type?.name === 'STATUS_FINAL' || false;

  // ── Step 5: Insert immutable snapshot into event_data_snapshots ────────
  // ON CONFLICT ensures idempotency: duplicate hashes for same contest are silently skipped.
  await dbClient.query(`
    INSERT INTO event_data_snapshots (
      id,
      contest_instance_id,
      snapshot_hash,
      provider_event_id,
      provider_final_flag,
      payload,
      ingested_at
    ) VALUES (
      gen_random_uuid(),
      $1,
      $2,
      $3,
      $4,
      $5,
      NOW()
    )
    ON CONFLICT (contest_instance_id, snapshot_hash) DO NOTHING
  `, [
    contestInstanceId,
    snapshotHash,
    providerEventId,
    providerFinalFlag,
    JSON.stringify(normalizedPayload) // payload stores normalized JSON (not canonical string)
  ]);

  // ── Step 6: Canonicalize full provider data for ingestion_events hash ──
  // (kept separate from snapshot_hash for backward compatibility)
  const canonicalizedFull = canonicalizeJson(providerData);
  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalizedFull))
    .digest('hex');

  // ── Step 7: Insert metadata into ingestion_events ──────────────────────
  // ON CONFLICT DO NOTHING ensures idempotency: duplicate payloads are skipped silently.
  // If duplicate detected (result.rows.length === 0), skip further processing.
  const result = await dbClient.query(`
    INSERT INTO ingestion_events (
      id,
      contest_instance_id,
      provider,
      event_type,
      provider_data_json,
      payload_hash,
      validation_status,
      validated_at
    ) VALUES (
      gen_random_uuid(),
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      NOW()
    )
    ON CONFLICT ON CONSTRAINT unique_payload_per_contest
    DO NOTHING
    RETURNING id, payload_hash
  `, [
    contestInstanceId,
    'pga_espn',
    'tournament_data',
    JSON.stringify(providerData),
    payloadHash,
    'VALID'
  ]);

  // ── Step 8: Handle duplicate payload (idempotency) ────────────────────────
  // If insert returned zero rows, payload was already processed.
  // Continue scoring parse anyway — scores may have changed during the round.
  if (result.rows.length === 0) {
    console.debug(
      `[pgaEspnIngestion] Duplicate payload detected for contest ${contestInstanceId}, continuing scoring parse`
    );
    // DO NOT return here
    // Continue execution so scoring parser still runs
  }

  // ── Step 9: Parse scores from leaderboard and return ──────────────────────
  // SCORING phase now calls handleScoringIngestion() to produce golfer scores
  return await handleScoringIngestion(ctx, unit);
}

/**
 * Upsert normalized scores to the database.
 *
 * For PLAYER_POOL phase: normalizedScores is empty, so this is a no-op.
 * For SCORING phase: batch insert golfer scores into golfer_event_scores table.
 *
 * Uses single batch INSERT with ON CONFLICT for idempotency:
 * - UNIQUE (contest_instance_id, golfer_id, round_number)
 * - Updates on re-ingestion produce same result
 * - Executes 1 query instead of N queries
 *
 * @param {Object} ctx - Ingestion context { contestInstanceId, dbClient, ... }
 * @param {Array} normalizedScores - Array of golfer score objects
 * @returns {Promise<void>}
 */
async function upsertScores(ctx, normalizedScores) {
  // PLAYER_POOL and FIELD_BUILD phases return empty scores array - nothing to upsert
  if (!normalizedScores || normalizedScores.length === 0) {
    return;
  }

  const { dbClient } = ctx;

  const values = [];
  const placeholders = [];

  normalizedScores.forEach((score, i) => {
    const offset = i * 7;

    placeholders.push(
      `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7})`
    );

    values.push(
      score.contest_instance_id,
      score.golfer_id,
      score.round_number,
      score.hole_points,
      score.bonus_points,
      score.finish_bonus,
      score.total_points
    );
  });

  // ── CANONICAL SCORING IDENTITY ──────────────────────────────────────────
  // CRITICAL INVARIANT:
  // golfer_event_scores.golfer_id MUST ALWAYS BE in format: espn_<athleteId>
  //
  // This format is the single source of truth for golfer identity across:
  // - pgaLeaderboardDebugService.js (expects espn_<athleteId> at line 107)
  // - leaderboard overlays and scoring displays
  // - player roster matching
  //
  // DO NOT use players.id (internal numeric ID) for golfer_event_scores.
  // The players.id lookup was removed in favor of direct ESPN ID normalization
  // to ensure consistency and prevent ID format mismatches.
  //
  // If you need to change this format, update ALL of:
  // 1. pgaEspnIngestion.js (handleScoringIngestion, lines 830-836)
  // 2. pgaLeaderboardDebugService.js (getPgaLeaderboardWithScores, line 107)
  // 3. All schema references and tests
  //
  // Future-proof this decision: normalize at ingestion time, not query time.
  await dbClient.query(`
    INSERT INTO golfer_event_scores (
      contest_instance_id,
      golfer_id,
      round_number,
      hole_points,
      bonus_points,
      finish_bonus,
      total_points
    )
    VALUES ${placeholders.join(',')}
    ON CONFLICT (contest_instance_id, golfer_id, round_number)
    DO UPDATE SET
      hole_points = EXCLUDED.hole_points,
      bonus_points = EXCLUDED.bonus_points,
      finish_bonus = EXCLUDED.finish_bonus,
      total_points = EXCLUDED.total_points
  `, values);

  // Populate user roster scores from golfer event scores
  if (normalizedScores?.length > 0 && ctx?.contestInstanceId) {
    await scoreContestRosters(ctx.contestInstanceId, dbClient);
  }
}

module.exports = {
  validateConfig,
  normalizeEspnPayload,
  getWorkUnits,
  computeIngestionKey,
  ingestWorkUnit,
  upsertScores,
  extractEarliestTeeTime,
  deriveLockTimeFromProviderData
};
