/**
 * PGA ESPN Ingestion Adapter
 *
 * Ingestion implementation for PGA Tour (Masters) via ESPN API.
 * Implements snapshot binding per PGA v1 Section 4.1.
 */

'use strict';

const crypto = require('crypto');

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
  // Validate base structure
  if (!providerData || typeof providerData !== 'object' || !Array.isArray(providerData.events)) {
    throw new Error('events array is missing or empty');
  }

  const events = providerData.events;
  if (!events || events.length === 0) {
    throw new Error('events array is missing or empty');
  }

  const event = events[0];
  if (!event || !Array.isArray(event.competitions)) {
    throw new Error('competitions array is missing');
  }

  const competition = event.competitions[0];
  if (!competition || !Array.isArray(competition.competitors)) {
    throw new Error('competitors array is missing');
  }

  // Extract and normalize competitors
  const competitors = competition.competitors || [];
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

  // Return empty array if providerEventId is missing
  if (!ctx.providerEventId) {
    console.warn('[pgaEspnIngestion] No providerEventId in context, skipping PLAYER_POOL units');
    return [];
  }

  // PLAYER_POOL Phase: Emit one unit per golfer from ESPN leaderboard
  // Idempotency is handled by ingestionService via ingestion_runs table
  // Each unit with a unique externalPlayerId will only be processed once

  const espnPgaPlayerService = require('../espn/espnPgaPlayerService');
  let golfers = [];

  try {
    // Fetch tournament field from ESPN leaderboard (optimized for player pool)
    // Returns complete field with tee times and positions
    golfers = await espnPgaPlayerService.fetchTournamentField(ctx.providerEventId);
  } catch (err) {
    console.warn('[pgaEspnIngestion] Failed to fetch tournament field for PLAYER_POOL units:', err.message);
    // Don't throw - allow graceful degradation
    // Ingestion will retry on the next cycle
    return [];
  }

  if (!Array.isArray(golfers) || golfers.length === 0) {
    console.log('[pgaEspnIngestion] No golfers fetched from leaderboard, skipping PLAYER_POOL unit generation');
    return [];
  }

  console.log(`[pgaEspnIngestion] Fetched ${golfers.length} golfers from leaderboard for event ${ctx.providerEventId}`);

  // Emit one unit per golfer
  // Idempotency: each unit with unique externalPlayerId is processed only once
  // (tracked in ingestion_runs table by ingestionService)
  // Attach golfer data to unit so ingestWorkUnit doesn't need to call ESPN again
  const units = golfers.map(golfer => ({
    externalPlayerId: golfer.external_id,
    providerEventId: ctx.providerEventId,
    providerData: null,
    golfer: golfer  // Attach golfer data to avoid re-fetching
  }));

  console.log(`[pgaEspnIngestion] Generated ${units.length} PLAYER_POOL units from leaderboard`);
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
 * so we avoid redundant ESPN API calls. This method only performs the database upsert.
 *
 * @param {Object} ctx - Ingestion context { contestInstanceId, dbClient, ... }
 * @param {Object} unit - PLAYER_POOL unit { externalPlayerId, providerEventId, golfer }
 * @returns {Promise<Array>} Empty array (no scores for PLAYER_POOL phase)
 * @throws {Error} If database upsert fails
 */
async function handlePlayerPoolIngestion(ctx, unit) {
  const { contestInstanceId, dbClient } = ctx;

  // Extract golfer data from unit (pre-fetched by getWorkUnits)
  const golfer = unit.golfer;

  if (!golfer) {
    throw new Error('handlePlayerPoolIngestion: unit.golfer is required (must be populated by getWorkUnits)');
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

    console.log(`[pgaEspnIngestion] Upserted golfer ${golfer.name} (${golfer.external_id}) to players table`);
  } catch (err) {
    console.error(`[pgaEspnIngestion] Failed to upsert golfer ${golfer.external_id}:`, err.message);
    throw err;
  }

  // Return empty scores array (PLAYER_POOL phase has no scores)
  return [];
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

  console.log(`[pgaEspnIngestion] Created event_data_snapshot ${snapshotHash} for contest ${contestInstanceId}`);

  // ── Step 6: Canonicalize full provider data for ingestion_events hash ──
  // (kept separate from snapshot_hash for backward compatibility)
  const canonicalizedFull = canonicalizeJson(providerData);
  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalizedFull))
    .digest('hex');

  // ── Step 7: Insert metadata into ingestion_events ──────────────────────
  // This remains unchanged per requirements (Option B).
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
    RETURNING id, payload_hash
  `, [
    contestInstanceId,
    'pga_espn',
    'tournament_data',
    JSON.stringify(providerData),
    payloadHash,
    'VALID'
  ]);

  const ingestionEvent = result.rows[0];
  console.log(`[pgaEspnIngestion] Created ingestion_events ${ingestionEvent.id} with hash ${ingestionEvent.payload_hash}`);

  // Return placeholder scores (actual scoring implementation out of scope for Batch 2)
  // In production, this would parse providerData and normalize to { user_id, player_id, points, ... }
  return [];
}

async function upsertScores(_ctx, _normalizedScores) {
  throw new Error("Ingestion adapter 'pga_espn' is not yet implemented");
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
