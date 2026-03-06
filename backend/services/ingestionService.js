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

/**
 * Fetch all active GOLF players from the database.
 *
 * Used as fallback when re-runs have no newly ingested players (idempotency guard skipped them).
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Array<string>>} Array of player UUIDs
 */
async function fetchExistingGolfPlayerIds(pool) {
  const result = await pool.query(
    `SELECT id FROM players WHERE sport = 'GOLF' AND is_active = true ORDER BY id`
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

  // Fetch tournament config for selectField validation
  const configResult = await dbClient.query(
    `SELECT provider_event_id, ingestion_endpoint, event_start_date, event_end_date, round_count,
            cut_after_round, leaderboard_schema_version, field_source
     FROM tournament_configs
     WHERE contest_instance_id = $1`,
    [contestInstanceId]
  );

  if (configResult.rows.length === 0) {
    console.warn(`[ingestionService] tournament_configs not found for ${contestInstanceId}, skipping field population`);
    return;
  }

  const tourConfig = configResult.rows[0];

  // Fetch all players that were ingested (by espn_id)
  const playersResult = await dbClient.query(
    `SELECT id, full_name, espn_id FROM players WHERE espn_id = ANY($1) AND sport = 'GOLF' ORDER BY id`,
    [espnPlayerIds]
  );

  const players = playersResult.rows;

  if (players.length === 0) {
    console.warn(`[ingestionService] No golf players found for ingested ESPN IDs, field_selections not updated`);
    return;
  }

  // Build participant list for selectField()
  const participants = players.map(p => ({
    player_id: p.id,
    name: p.full_name,
    espn_id: p.espn_id
  }));

  // Call selectField to build field selection
  let fieldSelection;
  try {
    fieldSelection = selectField(tourConfig, participants);
  } catch (err) {
    console.error(`[ingestionService] selectField failed for ${contestInstanceId}:`, err.message);
    throw err;
  }

  // Enhance field selection with player details
  const enhancedField = {
    primary: fieldSelection.primary.map(p => ({
      player_id: p.player_id,
      name: p.name,
      espn_id: p.espn_id
    })),
    alternates: fieldSelection.alternates.map(p => ({
      player_id: p.player_id,
      name: p.name,
      espn_id: p.espn_id
    }))
  };

  // Update field_selections with new selection_json
  const updateResult = await dbClient.query(
    `UPDATE field_selections
     SET selection_json = $1
     WHERE contest_instance_id = $2
     RETURNING id`,
    [JSON.stringify(enhancedField), contestInstanceId]
  );

  if (updateResult.rows.length === 0) {
    console.warn(`[ingestionService] field_selections not found for ${contestInstanceId}, skipping update`);
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

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Load and lock contest instance ────────────────────────────────────────
    const ciResult = await client.query(
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
      [contestInstanceId]
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

      // Idempotency: try to claim this work unit as RUNNING.
      // ON CONFLICT DO NOTHING — if a record already exists (RUNNING or COMPLETE) skip.
      const insertResult = await client.query(
        `INSERT INTO ingestion_runs
           (id, contest_instance_id, ingestion_strategy_key, work_unit_key, status, started_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, 'RUNNING', NOW())
         ON CONFLICT (contest_instance_id, work_unit_key) DO NOTHING
         RETURNING id`,
        [contestInstanceId, strategyKey, workUnitKey]
      );

      if (insertResult.rows.length === 0) {
        // Record already existed — skip (idempotency guard)
        skippedWorkUnits.push(workUnitKey);
        summary.skipped++;
        continue;
      }

      // ── Run adapter pipeline ────────────────────────────────────────────────
      try {
        const normalizedScores = await adapter.ingestWorkUnit(ctx, enrichedUnit);
        await adapter.upsertScores(ctx, normalizedScores);

        await client.query(
          `UPDATE ingestion_runs
           SET status = 'COMPLETE', completed_at = NOW()
           WHERE contest_instance_id = $1 AND work_unit_key = $2`,
          [contestInstanceId, workUnitKey]
        );

        // Track ingested players for field population (all phases)
        if (enrichedUnit.externalPlayerId) {
          ingestedPlayerIds.push(enrichedUnit.externalPlayerId);
        }

        summary.processed++;
      } catch (unitErr) {
        console.error(`[ingestionService] Work unit failed: ${workUnitKey}`, unitErr.message);

        await client.query(
          `UPDATE ingestion_runs
           SET status = 'ERROR', error_message = $1
           WHERE contest_instance_id = $2 AND work_unit_key = $3`,
          [unitErr.message.slice(0, 1000), contestInstanceId, workUnitKey]
        );

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

    await client.query('COMMIT');
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
 * @param {Object} pool - Database connection pool
 * @param {string} contestInstanceId - UUID of the contest_instance
 * @throws {Error} If contest_instance not found or sport is not GOLF
 */
async function initializeTournamentField(pool, contestInstanceId) {
  if (!contestInstanceId) {
    throw new Error('initializeTournamentField: contestInstanceId is required');
  }

  // Load contest instance + template
  const ciResult = await pool.query(
    `SELECT ci.id, ci.provider_event_id, ct.sport
     FROM contest_instances ci
     JOIN contest_templates ct ON ci.template_id = ct.id
     WHERE ci.id = $1`,
    [contestInstanceId]
  );

  if (ciResult.rows.length === 0) {
    throw new Error(`Contest instance not found: ${contestInstanceId}`);
  }

  const { sport, provider_event_id } = ciResult.rows[0];

  // Verify sport is GOLF
  if (sport !== 'GOLF') {
    throw new Error(`initializeTournamentField: sport must be GOLF, got ${sport}`);
  }

  // Verify provider_event_id is present (required for ingestion)
  if (!provider_event_id) {
    throw new Error(`Contest instance missing provider_event_id`);
  }

  // Insert tournament_configs (idempotent: ON CONFLICT DO NOTHING)
  const tcResult = await pool.query(
    `INSERT INTO tournament_configs (
      id, contest_instance_id, provider_event_id, ingestion_endpoint,
      event_start_date, event_end_date, round_count, cut_after_round,
      leaderboard_schema_version, field_source, hash, published_at, is_active, created_at
    )
    VALUES (
      gen_random_uuid(), $1, $2, '',
      NOW(), NOW() + interval '7 days', 4, NULL,
      1, 'provider_sync', '', NOW(), false, NOW()
    )
    ON CONFLICT DO NOTHING
    RETURNING id`,
    [contestInstanceId, provider_event_id]
  );

  // Get tournament_config_id (either from insert or from existing row)
  let tourneyConfigId;
  if (tcResult.rows.length > 0) {
    tourneyConfigId = tcResult.rows[0].id;
  } else {
    // If ON CONFLICT triggered, fetch the existing row
    const existingResult = await pool.query(
      `SELECT id FROM tournament_configs
       WHERE contest_instance_id = $1`,
      [contestInstanceId]
    );
    if (existingResult.rows.length === 0) {
      throw new Error(`Failed to create or find tournament_configs for ${contestInstanceId}`);
    }
    tourneyConfigId = existingResult.rows[0].id;
  }

  // Insert field_selections with placeholder structure (idempotent)
  await pool.query(
    `INSERT INTO field_selections (
      id, contest_instance_id, tournament_config_id, selection_json, created_at
    )
    VALUES (
      gen_random_uuid(), $1, $2, $3, NOW()
    )
    ON CONFLICT DO NOTHING`,
    [contestInstanceId, tourneyConfigId, JSON.stringify({ primary: [] })]
  );
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
 * Ingests leaderboard, live stats, and scoring data required for contest progression and settlement.
 * Only allowed for contests in status: LOCKED, LIVE
 * Rejects SCHEDULED contests (scoring data unavailable).
 *
 * @param {string} contestInstanceId - UUID of contest_instance
 * @param {Object} pool - pg.Pool
 * @returns {Promise<Object>} summary with phase='SCORING'
 */
async function runScoring(contestInstanceId, pool) {
  return run(contestInstanceId, pool, null, { phase: 'SCORING' });
}

module.exports = { run, runPlayerPool, runScoring, initializeTournamentField };
