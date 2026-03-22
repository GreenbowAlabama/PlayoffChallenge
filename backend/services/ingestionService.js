/**
 * Ingestion Service — Platform Orchestrator
 *
 * Sport-agnostic ingestion pipeline. Responsible for:
 *   - Loading contest instance + template
 *   - Resolving ingestion adapter via ingestionRegistry
 *   - Acquiring SELECT FOR UPDATE on contest_instance
 *   - Driving the work-unit loop with idempotency enforcement
 *   - Calling adapter methods: getWorkUnits → ingestWorkUnit → upsertScores
 *   - Marking ingestion_runs RUNNING → COMPLETE (or ERROR)
 *
 * This file contains ZERO sport-specific logic.
 * Sport-specific logic lives in services/ingestion/strategies/*.
 */

'use strict';

const ingestionRegistry = require('./ingestionRegistry');
const { resolveStrategyKey } = require('./ingestionStrategyResolver');
const { selectField } = require('./golfEngine/selectField');
const { resolveTier } = require('./tierResolutionService');

/**
 * Diagnostic wrapper for database queries.
 * Logs the failing SQL statement and parameters on error with context.
 *
 * @param {Object} client - Database client
 * @param {string} sql - SQL query string
 * @param {Array} params - Query parameters
 * @param {Object} context - Diagnostic context { contestInstanceId, workUnitKey }
 * @returns {Promise<Object>} Query result
 * @throws {Error} If query fails (after logging)
 */
async function executeQuery(client, sql, params = [], context = {}) {
  try {
    return await client.query(sql, params);
  } catch (err) {
    console.error('[Ingestion SQL ERROR]', {
      contestInstanceId: context.contestInstanceId,
      workUnitKey: context.workUnitKey,
      sql,
      params,
      message: err.message,
      code: err.code
    });
    throw err;
  }
}

/**
 * Fetch all active GOLF players from the database.
 *
 * Used as fallback when re-runs have no newly ingested players (idempotency guard skipped them).
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Array<string>>} Array of player UUIDs
 */
async function fetchExistingGolfPlayerIds(pool) {
  const result = await executeQuery(
    pool,
    `SELECT id FROM players WHERE sport = 'GOLF' AND is_active = true AND id LIKE 'espn_%' ORDER BY id`
  );
  return result.rows.map(r => r.id);
}

/**
 * Populate field_selections with ingested players.
 *
 * Called after PLAYER_POOL ingestion completes. Fetches the ingested players
 * from the players table, builds a field selection, and updates field_selections.
 *
 * @param {Object} dbClient - Database client (from transaction)
 * @param {string} contestInstanceId - UUID of contest_instance
 * @param {Array<string>} espnPlayerIds - Array of ESPN player IDs that were ingested
 * @returns {Promise<void>}
 * @throws {Error} If field population fails (but caller may suppress)
 */
async function populateFieldSelections(dbClient, contestInstanceId, espnPlayerIds) {
  if (!espnPlayerIds || espnPlayerIds.length === 0) {
    console.log(`[ingestionService] No players ingested for ${contestInstanceId}, skipping field population`);
    return;
  }


  // Fetch tournament config for selectField validation and tier definition
  const configResult = await executeQuery(
    dbClient,
    `SELECT provider_event_id, ingestion_endpoint, event_start_date, event_end_date, round_count,
            cut_after_round, leaderboard_schema_version, field_source, tier_definition
     FROM tournament_configs
     WHERE contest_instance_id = $1`,
    [contestInstanceId],
    { contestInstanceId }
  );

  if (configResult.rows.length === 0) {
    console.warn(`[ingestionService] tournament_configs not found for ${contestInstanceId}, skipping field population`);
    return;
  }

  const tourConfig = configResult.rows[0];
  const tierDefinitionRaw = tourConfig.tier_definition;

  // TODO: Remove excessive ingestion logging (currently hitting Railway 500 logs/sec limit)
  // Remove: TIER DEF RAW, TIER DEF PARSED, scoring debug spam below
  // TEMP LOGGING: Diagnose tier_definition parsing
  console.log('TIER DEF RAW:', tierDefinitionRaw);

  // Fix: Parse tier_definition if it's a string
  let tierDefinition;
  if (typeof tierDefinitionRaw === 'string') {
    try {
      tierDefinition = JSON.parse(tierDefinitionRaw);
      console.log('TIER DEF PARSED:', tierDefinition);
    } catch (err) {
      console.warn(`[ingestionService] Failed to parse tier_definition as JSON for ${contestInstanceId}, treating as null:`, err.message);
      tierDefinition = null;
    }
  } else {
    tierDefinition = tierDefinitionRaw;
    // TODO: Remove this debug log as part of ingestion spam cleanup
    console.log('TIER DEF PARSED:', tierDefinition);
  }

  // Fetch all players that were ingested (by id, which includes espn_ prefix)
  const playersResult = await executeQuery(
    dbClient,
    `SELECT id, full_name, espn_id, image_url FROM players WHERE id = ANY($1) AND sport = 'GOLF' ORDER BY id`,
    [espnPlayerIds],
    { contestInstanceId }
  );

  const players = playersResult.rows;

  if (players.length === 0) {
    console.warn(`[ingestionService] No golf players found for ${contestInstanceId}`);
    return;
  }

  // Build participant list for selectField()
  const participants = players.map(p => ({
    player_id: p.id,
    name: p.full_name,
    espn_id: p.espn_id
  }));

  // Create map of player_id → image_url for lookups
  const playerImageMap = new Map();
  players.forEach(p => {
    playerImageMap.set(p.id, p.image_url || null);
  });

  // Call selectField to build field selection
  let fieldSelection;
  try {
    fieldSelection = selectField(tourConfig, participants);
  } catch (err) {
    console.error(`[ingestionService] selectField failed for ${contestInstanceId}:`, err.message);
    throw err;
  }

  // INVARIANT: Primary field must contain players
  // An empty primary field is an illegal system state that violates contest structure.
  // This guard prevents incomplete ingestion from being written to the database.
  if (!fieldSelection.primary || fieldSelection.primary.length === 0) {
    throw new Error(
      `[PGA INGESTION] REFUSING_EMPTY_FIELD contest=${contestInstanceId} players_available=${players.length} primary_count=0`
    );
  }
  console.log(`[PGA INGESTION] contest=${contestInstanceId} players=${players.length} primary=${fieldSelection.primary.length} alternates=${fieldSelection.alternates.length}`);

  // Enhance field selection with player details (including image_url from playerImageMap)
  // For tier-based contests, resolve tier_id for each player based on rank (deterministic)
  const tierDef = tierDefinition || null;

  const enhancedField = {
    primary: fieldSelection.primary.map((p, index) => {
      const rank = index + 1;  // deterministic ordering (1-based position)
      const tierId = tierDef ? resolveTier(rank, tierDef) : null;

      // TEMP LOGGING: Log first few ranks to verify tier resolution
      if (index < 3) {
        console.log('SAMPLE RANK + TIER:', { rank, tierId, playerName: p.name });
      }

      return {
        player_id: p.player_id,
        name: p.name,
        espn_id: p.espn_id,
        image_url: playerImageMap.get(p.player_id) || null,
        ...(tierId && { tier_id: tierId })  // Only include tier_id if resolved
      };
    }),
    alternates: fieldSelection.alternates.map((p, index) => {
      const primaryCount = fieldSelection.primary.length;
      const rank = primaryCount + index + 1;  // Continue rank numbering after primary
      const tierId = tierDef ? resolveTier(rank, tierDef) : null;

      return {
        player_id: p.player_id,
        name: p.name,
        espn_id: p.espn_id,
        image_url: playerImageMap.get(p.player_id) || null,
        ...(tierId && { tier_id: tierId })  // Only include tier_id if resolved
      };
    })
  };

  // Update field_selections with new selection_json
  const updateResult = await executeQuery(
    dbClient,
    `UPDATE field_selections
     SET selection_json = $1
     WHERE contest_instance_id = $2
     RETURNING id`,
    [JSON.stringify(enhancedField), contestInstanceId],
    { contestInstanceId }
  );

  if (updateResult.rows.length === 0) {
    console.warn(`[ingestionService] FIELD_SELECTION_ROW_MISSING: field_selections row does not exist for contest_instance_id ${contestInstanceId}, skipping field population. This row must be created during contest publish.`);
    return;
  }

  console.log(`[ingestionService] Updated field_selections for ${contestInstanceId}: ${players.length} players (${fieldSelection.primary.length} primary, ${fieldSelection.alternates.length} alternates)`);
}

/**
 * Run ingestion for a contest instance.
 *
 * @param {string} contestInstanceId - UUID of the contest_instance to ingest
 * @param {Object} pool - pg.Pool (or compatible)
 * @param {Array} workUnits - (Optional) Pre-built work units from polling orchestrator.
 *                            If provided, skips adapter.getWorkUnits() call.
 *                            Enables Batch 2 polling orchestrator to supply ESPN data.
 * @param {Object} options - (Optional) { phase: 'PLAYER_POOL' | 'SCORING' | 'BOTH' }
 *                            Controls phase-specific status gating.
 * @returns {Promise<Object>} summary - { processed, skipped, errors, phase, reason? }
 */
async function run(contestInstanceId, pool, workUnits = null, options = null) {
  if (!contestInstanceId) {
    throw new Error('ingestionService.run: contestInstanceId is required');
  }

  const phase = options?.phase || 'BOTH';

  // NOTE: ESPN caches are NOT cleared per-contest. They persist for the entire cycle.
  // Call resetCycleCache() at cycle boundaries (from the worker) to prevent cross-cycle staleness.
  // This ensures each eventId is fetched at most once per cycle, not once per contest.

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Load and lock contest instance ────────────────────────────────────────
    const ciResult = await executeQuery(
      client,
      `SELECT
         ci.*,
         ct.sport,
         ct.scoring_strategy_key,
         ct.settlement_strategy_key,
         ct.provider_tournament_id,
         tc.provider_event_id
       FROM contest_instances ci
       JOIN contest_templates ct ON ci.template_id = ct.id
       LEFT JOIN tournament_configs tc ON tc.contest_instance_id = ci.id
       WHERE ci.id = $1
       FOR UPDATE OF ci`,
      [contestInstanceId],
      { contestInstanceId }
    );

    if (ciResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error(`Contest instance not found: ${contestInstanceId}`);
    }

    const row = ciResult.rows[0];

    // Guard: provider_tournament_id is required for strategy resolution
    if (!row.provider_tournament_id) {
      await client.query('ROLLBACK');
      throw new Error(`provider_tournament_id missing for contest ${contestInstanceId}`);
    }

    // Guard: provider_event_id is required for ingestion
    if (!row.provider_event_id) {
      await client.query('ROLLBACK');
      throw new Error(`provider_event_id missing for contest ${contestInstanceId}`);
    }

    // Mismatch guard: provider_tournament_id and provider_event_id should be identical
    // Both store the full provider+sport+event identifier (e.g., "espn_pga_401811935")
    // provider_tournament_id comes from contest_templates (used for strategy resolution)
    // provider_event_id comes from tournament_configs (event reference)
    // If they differ, there's a data consistency issue
    if (row.provider_tournament_id !== row.provider_event_id) {
      console.warn(
        `[Ingestion] TOURNAMENT_ID_MISMATCH: contest_instance_id=${contestInstanceId}, ` +
        `provider_tournament_id=${row.provider_tournament_id}, ` +
        `provider_event_id=${row.provider_event_id}`
      );
    }

    // NOTE: provider_tournament_id stores the provider EVENT identifier
    // (e.g., espn_pga_401811935).
    // Despite the column name, this value represents the canonical event
    // identity used throughout the ingestion pipeline.
    // This identifier must remain stable across:
    // Discovery → Contest Templates → Contest Instances → Ingestion → Scoring.
    // Do not change this value format without updating the ingestion
    // strategy resolver and tournament discovery logic.

    // Determine ingestion strategy from provider_tournament_id
    // Derives strategy from prefix: espn_pga_* → pga_espn, espn_nfl_* → nfl_espn
    let strategyKey;
    try {
      strategyKey = resolveStrategyKey(row.provider_tournament_id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(
        `Failed to resolve ingestion strategy for contest ${contestInstanceId}: ${err.message}`
      );
    }

    // Identifier format guard: warn if malformed identifiers appear
    const identifierPattern = /^espn_[a-z]+_\d+$/;
    if (!identifierPattern.test(row.provider_tournament_id)) {
      console.warn(
        `[Ingestion] TOURNAMENT_IDENTIFIER_FORMAT_WARNING: ` +
        `contest_instance_id=${contestInstanceId}, ` +
        `value=${row.provider_tournament_id}`
      );
    }

    // ── Phase-specific status gating ──────────────────────────────────────────
    if (phase === 'SCORING' && row.status === 'SCHEDULED') {
      console.log(
        `[Ingestion] Skipped SCORING phase for SCHEDULED contest ${contestInstanceId}: scoring data unavailable in SCHEDULED status`
      );

      await client.query('ROLLBACK');

      return {
        contestInstanceId,
        status: 'REJECTED',
        reason: 'SCHEDULED_CONTEST_NO_SCORING',
        phase: 'SCORING',
        processed: 0,
        skipped: 0,
        errors: 0
      };
    }

    // ── Post-COMPLETE hard guard ─────────────────────────────────────────────
    if (row.status === 'COMPLETE') {
      const reason = 'POST_COMPLETE_REJECTION';

      console.warn(
        `[Ingestion] Rejected ingestion for COMPLETE contest ${contestInstanceId}`
      );

      await client.query('ROLLBACK');

      return {
        contestInstanceId,
        status: 'REJECTED',
        reason,
        phase,
        processed: 0,
        skipped: 0,
        errors: 0
      };
    }

    // ── Resolve adapter ───────────────────────────────────────────────────────
    const adapter = ingestionRegistry.getIngestionStrategy(strategyKey);

    const ctx = {
      contestInstanceId,
      providerEventId: row.provider_event_id,
      template: row,
      dbClient: client,
      now: new Date()
    };

    // ── Get work units (backward compatible) ────────────────────────────────
    // If workUnits provided (from Batch 2 orchestrator), use them.
    // Otherwise, call adapter.getWorkUnits() for backward compatibility (Batch 1, other sports).
    const unitsToProcess = workUnits !== null ? workUnits : await adapter.getWorkUnits(ctx);

    const summary = { processed: 0, skipped: 0, errors: [], phase };

    // ── Track ingested players for PLAYER_POOL phase ──────────────────────────
    const ingestedPlayerIds = [];

    // ── Track skipped work units for batch logging ────────────────────────────
    const skippedWorkUnits = [];

    // ── Process each work unit ────────────────────────────────────────────────
    for (const unit of unitsToProcess) {
      // Ensure every work unit has providerEventId (inject from context if missing)
      const enrichedUnit = {
        ...unit,
        providerEventId: unit.providerEventId || ctx.providerEventId
      };
      const workUnitKey = adapter.computeIngestionKey(contestInstanceId, enrichedUnit);

      // Set workUnitKey on enrichedUnit so adapter handlers can access it
      enrichedUnit.workUnitKey = workUnitKey;

      // ── GUARD 1: Pre-check for existing COMPLETE or RUNNING rows ──────────────
      // Query before INSERT to detect and skip already-processed work units
      // EXCEPTION: SCORING units must always run (scores update every cycle)
      const preCheckResult = await executeQuery(
        client,
        `SELECT status
         FROM ingestion_runs
         WHERE contest_instance_id = $1 AND work_unit_key = $2
         LIMIT 1`,
        [contestInstanceId, workUnitKey],
        { contestInstanceId, workUnitKey }
      );

      if (preCheckResult.rows.length > 0) {
        const existingStatus = preCheckResult.rows[0].status;

        // SCORING units must run every cycle (scores update as tournament progresses)
        // All other phases (PLAYER_POOL, FIELD_BUILD) are idempotent and can be skipped
        if (enrichedUnit.phase !== 'SCORING') {
          if (existingStatus === 'COMPLETE') {
            skippedWorkUnits.push(workUnitKey);
            summary.skipped++;
            continue;
          }
          if (existingStatus === 'RUNNING') {
            skippedWorkUnits.push(workUnitKey);
            summary.skipped++;
            continue;
          }
          if (existingStatus === 'ERROR') {
            skippedWorkUnits.push(workUnitKey);
            summary.skipped++;
            continue;
          }
        }
        // SCORING units fall through and are always processed
      }

      // ── GUARD 2: Atomic RUNNING insert ──────────────────────────────────────
      // Try to insert as RUNNING.
      // ON CONFLICT DO NOTHING ensures idempotency (skip if another worker inserted)
      // EXCEPTION: SCORING units must always run (skip INSERT conflict check for SCORING)
      const insertResult = await executeQuery(
        client,
        `INSERT INTO ingestion_runs
           (id, contest_instance_id, ingestion_strategy_key, work_unit_key, status, started_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, 'RUNNING', NOW())
         ON CONFLICT (contest_instance_id, work_unit_key) DO NOTHING
         RETURNING id`,
        [contestInstanceId, strategyKey, workUnitKey],
        { contestInstanceId, workUnitKey }
      );

      let runId;
      if (insertResult.rows.length === 0) {
        // INSERT conflict: another worker already started or completed
        // EXCEPTION: Allow SCORING units to proceed anyway (scores must update every cycle)
        if (enrichedUnit.phase !== 'SCORING') {
          skippedWorkUnits.push(workUnitKey);
          summary.skipped++;
          continue;
        }
        // For SCORING units: fetch existing runId and proceed (re-processing is safe)
        const existingRun = await executeQuery(
          client,
          `SELECT id FROM ingestion_runs
           WHERE contest_instance_id = $1 AND work_unit_key = $2
           LIMIT 1`,
          [contestInstanceId, workUnitKey],
          { contestInstanceId, workUnitKey }
        );
        if (existingRun.rows.length === 0) {
          throw new Error(`SCORING unit runId lookup failed for ${workUnitKey}`);
        }
        runId = existingRun.rows[0].id;
      } else {
        runId = insertResult.rows[0].id;
      }

      // ── Run adapter pipeline ────────────────────────────────────────────────
      try {
        const normalizedScores = await adapter.ingestWorkUnit(ctx, enrichedUnit);

        // [SCORING DEBUG] Step 1: Check adapter output
        console.log(
          "[SCORING DEBUG] normalizedScores length:",
          normalizedScores ? normalizedScores.length : "NULL",
          "| phase:",
          enrichedUnit.phase || "UNKNOWN"
        );

        // [SCORING DEBUG] Step 2: Before database write
        console.log(
          "[SCORING DEBUG] About to write scores:",
          normalizedScores ? normalizedScores.length : 0
        );

        await adapter.upsertScores(ctx, normalizedScores);

        await executeQuery(
          client,
          `UPDATE ingestion_runs
           SET status = 'COMPLETE', completed_at = NOW()
           WHERE id = $1`,
          [runId],
          { contestInstanceId, workUnitKey }
        );

        // Track ingested players for field population (all phases)
        if (enrichedUnit.externalPlayerId) {
          ingestedPlayerIds.push('espn_' + enrichedUnit.externalPlayerId);
        }

        summary.processed++;
      } catch (unitErr) {
        await executeQuery(
          client,
          `UPDATE ingestion_runs
           SET status = 'ERROR', error_message = $1
           WHERE id = $2`,
          [unitErr.message.slice(0, 1000), runId],
          { contestInstanceId, workUnitKey }
        );

        console.error(`[INGESTION] Work unit error: ${workUnitKey}: ${unitErr.message.slice(0, 100)}`);
        summary.errors.push({ workUnitKey, error: unitErr.message });
      }
    }

    // ── Log batch summary of skipped work units ──────────────────────────────
    if (skippedWorkUnits.length > 0) {
      console.log(`[ingestionService] Skipped ${skippedWorkUnits.length} duplicate work units (${phase})`);
    }

    // ── Populate field_selections for GOLF contests ────────────────────────────
    // On first run: ingestedPlayerIds contains newly ingested players.
    // On re-runs: ingestedPlayerIds is empty (idempotency skipped them).
    // Fallback for GOLF re-runs: query existing players from database.
    if (row.sport === 'GOLF') {
      let playerIdsToUse = ingestedPlayerIds;
      if (playerIdsToUse.length === 0) {
        playerIdsToUse = await fetchExistingGolfPlayerIds(client);
      }

      if (playerIdsToUse.length > 0) {
        try {
          await populateFieldSelections(client, contestInstanceId, playerIdsToUse);
        } catch (err) {
          console.error(`[ingestionService] Failed to populate field_selections for ${contestInstanceId}:`, err.message);
          // Don't fail the entire ingestion; field population is important but not blocking
        }
      }
    }

    // ── Emit PLAYER_POOL ingestion_event if field_selections exists ──────────
    // Runs every cycle. Creates event from existing field snapshot if event
    // does not already exist. Idempotent: only creates once per contest.
    const normalizedSport = String(row.sport).toUpperCase();
    if (normalizedSport === 'PGA' || normalizedSport === 'GOLF') {
      try {
        const fieldResult = await executeQuery(
          client,
          `SELECT selection_json FROM field_selections WHERE contest_instance_id = $1`,
          [contestInstanceId],
          { contestInstanceId }
        );

        if (fieldResult.rows.length > 0) {
          const eventCheck = await executeQuery(
            client,
            `SELECT id
             FROM ingestion_events
             WHERE contest_instance_id = $1
             AND event_type = 'PLAYER_POOL'`,
            [contestInstanceId],
            { contestInstanceId }
          );

          if (eventCheck.rows.length === 0) {
          const crypto = require('crypto');
          const payloadHash = crypto
            .createHash('sha256')
            .update(JSON.stringify(fieldResult.rows[0].selection_json))
            .digest('hex');

          await executeQuery(
            client,
            `INSERT INTO ingestion_events (
              id,
              contest_instance_id,
              provider,
              event_type,
              provider_data_json,
              payload_hash,
              validation_status,
              created_at
            ) VALUES (
              gen_random_uuid(),
              $1,
              'pga_espn',
              'PLAYER_POOL',
              $2,
              $3,
              'VALID',
              NOW()
            )`,
            [
              contestInstanceId,
              fieldResult.rows[0].selection_json,
              payloadHash
            ],
            { contestInstanceId }
          );

          console.log(
            `[ingestionService] PLAYER_POOL ingestion_event created for contest ${contestInstanceId}`
          );
        }
        }
      } catch (err) {
        console.error(`[ingestionService] Failed to create PLAYER_POOL ingestion_event for ${contestInstanceId}:`, err.message);
        // Do not fail ingestion; event creation is non-blocking
      }
    }

    await client.query('COMMIT');

    // RC3 Fix: Refresh all SCHEDULED contests for this sport (blocking call, synchronous)
    // Ensures deterministic state before run() returns.
    // Non-blocking error handling: failures don't break ingestion (same pattern as line 354-357)
    if (row.sport) {
      try {
        await refreshAllScheduledContestFields(pool, row.sport);
      } catch (refreshErr) {
        console.error(`[ingestionService] RC3 fan-out failed for sport ${row.sport}:`, refreshErr.message);
        // Don't fail the ingestion; refresh is important but not critical
      }
    }

    return summary;

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Initialize tournament field for a GOLF contest.
 *
 * Creates tournament_configs and field_selections entries when a GOLF contest
 * is published. Uses ON CONFLICT DO NOTHING for idempotency.
 *
 * RC1 Fix: Handles null provider_event_id by generating synthetic ID (manual_${contestInstanceId})
 * RC2 Fix: Immediately populates field_selections with active players after skeleton creation
 *
 * Transaction-safe: Manages BEGIN/COMMIT internally to ensure atomicity.
 * Race-condition safe: ON CONFLICT DO NOTHING + transaction isolation.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} contestInstanceId - UUID of the contest_instance
 * @throws {Error} If contest_instance not found or sport is not GOLF
 */
async function initializeTournamentField(pool, contestInstanceId) {
  if (!contestInstanceId) {
    throw new Error('initializeTournamentField: contestInstanceId is required');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Load contest instance + template with tournament dates
    const ciResult = await executeQuery(
      client,
      `SELECT ci.id, ci.provider_event_id, ci.tournament_start_time, ci.tournament_end_time,
              ct.sport, ct.template_type
       FROM contest_instances ci
       JOIN contest_templates ct ON ci.template_id = ct.id
       WHERE ci.id = $1`,
      [contestInstanceId],
      { contestInstanceId }
    );

    if (ciResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error(`Contest instance not found: ${contestInstanceId}`);
    }

    const { sport, template_type, provider_event_id, tournament_start_time, tournament_end_time } = ciResult.rows[0];

    // Verify sport is GOLF or PGA (normalize case-insensitively)
    const normalizedSport = String(sport).toUpperCase();

    if (normalizedSport !== 'GOLF' && normalizedSport !== 'PGA') {
      await client.query('ROLLBACK');
      throw new Error(
        `initializeTournamentField: unsupported sport ${sport}`
      );
    }

    // RC1 Fix: Generate synthetic provider_event_id if null (manual contests)
    const effectiveProviderId = provider_event_id || `manual_${contestInstanceId}`;

    // Determine ingestion_endpoint based on template type
    const ingestionEndpoint = template_type === 'PGA_TOURNAMENT' || template_type === 'PGA_DAILY'
      ? 'espn_pga_scoreboard'
      : 'provider_default';

    // Use tournament dates if available, otherwise use NOW()
    const eventStartDate = tournament_start_time || new Date();
    const eventEndDate = tournament_end_time || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Calculate hash from provider_event_id
    const crypto = require('crypto');
    const hash = crypto.createHash('md5')
      .update(contestInstanceId + '|' + effectiveProviderId)
      .digest('hex');

    // Insert tournament_configs (idempotent: ON CONFLICT DO NOTHING)
    const tcResult = await executeQuery(
      client,
      `INSERT INTO tournament_configs (
        id, contest_instance_id, provider_event_id, ingestion_endpoint,
        event_start_date, event_end_date, round_count, cut_after_round,
        leaderboard_schema_version, field_source, hash, published_at, is_active, created_at
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3,
        $4, $5, 4, NULL,
        1, 'provider_sync', $6, NOW(), true, NOW()
      )
      ON CONFLICT DO NOTHING
      RETURNING id`,
      [contestInstanceId, effectiveProviderId, ingestionEndpoint, eventStartDate, eventEndDate, hash],
      { contestInstanceId }
    );

    // Get tournament_config_id (either from insert or from existing row)
    let tourneyConfigId;
    if (tcResult.rows.length > 0) {
      tourneyConfigId = tcResult.rows[0].id;
      console.log(`[Discovery] Tournament config created for contest ${contestInstanceId}: ${ingestionEndpoint}`);
    } else {
      // If ON CONFLICT triggered, fetch the existing row
      const existingResult = await executeQuery(
        client,
        `SELECT id FROM tournament_configs
         WHERE contest_instance_id = $1`,
        [contestInstanceId],
        { contestInstanceId }
      );
      if (existingResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error(`Failed to create or find tournament_configs for ${contestInstanceId}`);
      }
      tourneyConfigId = existingResult.rows[0].id;
      console.log(`[Discovery] Tournament config already exists for contest ${contestInstanceId}`);
    }

    // Insert field_selections with placeholder structure (idempotent)
    const fsResult = await executeQuery(
      client,
      `INSERT INTO field_selections (
        id, contest_instance_id, tournament_config_id, selection_json, created_at
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3, NOW()
      )
      ON CONFLICT DO NOTHING
      RETURNING id`,
      [contestInstanceId, tourneyConfigId, JSON.stringify({ primary: [] })],
      { contestInstanceId }
    );

    if (fsResult.rows.length > 0) {
      console.log(`[Discovery] Field selections initialized for contest ${contestInstanceId}`);
    } else {
      console.log(`[Discovery] Field selections already exist for contest ${contestInstanceId}`);
    }

    // RC2 Fix: Immediately populate field_selections with active players
    const activePlayerIds = await fetchExistingGolfPlayerIds(pool);
    if (activePlayerIds.length > 0) {
      try {
        await populateFieldSelections(client, contestInstanceId, activePlayerIds);
      } catch (err) {
        console.error(`[ingestionService] Failed to populate field_selections during initialization for ${contestInstanceId}:`, err.message);
        // RC2: Don't fail the entire initialization; field population is important but not blocking
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Refresh field_selections for all SCHEDULED contests of a given sport.
 *
 * RC3 Fix: Fan-out mechanism to update field_selections whenever new players are ingested.
 * Ensures all SCHEDULED contests see updated player pool across the platform.
 *
 * Called after ingestion run completes successfully. Skips LOCKED, LIVE, and COMPLETE contests.
 * Sport-agnostic: works for all sports (GOLF, NFL, etc.).
 *
 * Transaction-safe (Option A): Each contest update is wrapped in its own transaction.
 * This ensures atomicity and idempotency of each refresh operation.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} sport - Sport type ('GOLF', 'NFL', etc.)
 * @returns {Promise<void>}
 */
async function refreshAllScheduledContestFields(pool, sport) {
  if (!sport) {
    console.warn('[ingestionService] refreshAllScheduledContestFields: sport is required, skipping refresh');
    return;
  }

  // Query all SCHEDULED contests for this sport
  const scheduledResult = await executeQuery(
    pool,
    `SELECT ci.id
     FROM contest_instances ci
     JOIN contest_templates ct ON ct.id = ci.template_id
     JOIN field_selections fs ON fs.contest_instance_id = ci.id
     WHERE ci.status = 'SCHEDULED'
       AND ct.sport = $1
     ORDER BY ci.created_at`,
    [sport],
    { sport }
  );

  if (scheduledResult.rows.length === 0) {
    return; // No SCHEDULED contests to refresh
  }

  // Fetch all active players for this sport
  let activePlayerIds = [];
  if (sport === 'GOLF') {
    activePlayerIds = await fetchExistingGolfPlayerIds(pool);
  }
  // Other sports can be added here in the future

  if (activePlayerIds.length === 0) {
    return; // No active players to populate
  }

  // Refresh field_selections for each SCHEDULED contest (Option A: transactional per-contest)
  let refreshedCount = 0;
  for (const row of scheduledResult.rows) {
    const contestInstanceId = row.id;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await populateFieldSelections(client, contestInstanceId, activePlayerIds);
      await client.query('COMMIT');
      refreshedCount++;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // Rollback already failed, just log and continue
        console.error(`[ingestionService] Rollback failed for ${contestInstanceId}:`, rollbackErr.message);
      }
      console.error(`[ingestionService] Failed to refresh field_selections for SCHEDULED contest ${contestInstanceId}:`, err.message);
      // Continue with other contests even if one fails
    } finally {
      client.release();
    }
  }

  if (refreshedCount > 0) {
    console.log(`[ingestionService] Refreshed field_selections for ${refreshedCount} SCHEDULED ${sport} contests`);
  }
}

/**
 * Run player pool ingestion for a contest instance.
 *
 * Ingests player field and baseline tournament metadata required for lineup selection.
 * Allowed for contests in status: SCHEDULED, LOCKED, LIVE
 *
 * @param {string} contestInstanceId - UUID of contest_instance
 * @param {Object} pool - pg.Pool
 * @returns {Promise<Object>} summary with phase='PLAYER_POOL'
 */
async function runPlayerPool(contestInstanceId, pool) {
  return run(contestInstanceId, pool, null, { phase: 'PLAYER_POOL' });
}

/**
 * Run scoring ingestion for a contest instance.
 *
 * Fetches ESPN leaderboard and constructs SCORING work unit.
 * Ingests leaderboard, live stats, and scoring data required for contest progression and settlement.
 * Only allowed for contests in status: LOCKED, LIVE
 * Rejects SCHEDULED contests (scoring data unavailable).
 *
 * @param {string} contestInstanceId - UUID of contest_instance
 * @param {Object} pool - pg.Pool
 * @returns {Promise<Object>} summary with phase='SCORING'
 * @throws {Error} If provider_event_id not found or leaderboard fetch fails
 */
async function runScoring(contestInstanceId, pool) {
  if (!contestInstanceId) {
    throw new Error('ingestionService.runScoring: contestInstanceId required');
  }

  const result = await pool.query(
    `SELECT provider_event_id
     FROM tournament_configs
     WHERE contest_instance_id = $1`,
    [contestInstanceId]
  );

  if (!result.rows.length) {
    throw new Error(
      `runScoring: provider_event_id not found for contest ${contestInstanceId}`
    );
  }

  const providerEventId = result.rows[0].provider_event_id;

  const espnEventId = providerEventId.replace(/^espn_pga_/, '');

  const { fetchLeaderboard } = require('./ingestion/espn/espnPgaApi');

  const providerData = await fetchLeaderboard({ eventId: espnEventId });

  const workUnit = {
    phase: 'SCORING',
    providerEventId,
    providerData
  };

  return run(contestInstanceId, pool, [workUnit], { phase: 'SCORING' });
}

/**
 * Reset all ESPN caches at ingestion cycle boundaries.
 *
 * Must be called once at the START of each ingestion cycle (before processing any contests).
 * Clears: leaderboard cache, player field cache, golfer cache.
 * Ensures fresh ESPN data each cycle while preventing duplicate fetches within a cycle.
 *
 * Called by: ingestionWorker.runCycle() (or equivalent cycle entry point)
 */
function resetCycleCache() {
  try {
    const espnPgaApi = require('./ingestion/espn/espnPgaApi');
    if (espnPgaApi && typeof espnPgaApi.clearLeaderboardCache === 'function') {
      espnPgaApi.clearLeaderboardCache();
    }
  } catch (err) {
    // Silently ignore if espnPgaApi is unavailable (e.g., in test mocks)
  }

  try {
    const espnPgaPlayerService = require('./ingestion/espn/espnPgaPlayerService');
    if (espnPgaPlayerService && typeof espnPgaPlayerService.clearFieldCache === 'function') {
      espnPgaPlayerService.clearFieldCache();
    }
  } catch (err) {
    // Silently ignore if espnPgaPlayerService is unavailable (e.g., in test mocks)
  }
}

module.exports = { run, runPlayerPool, runScoring, initializeTournamentField, populateFieldSelections, refreshAllScheduledContestFields, resetCycleCache };
