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

/**
 * Run ingestion for a contest instance.
 *
 * @param {string} contestInstanceId - UUID of the contest_instance to ingest
 * @param {Object} pool - pg.Pool (or compatible)
 * @param {Array} workUnits - (Optional) Pre-built work units from polling orchestrator.
 *                            If provided, skips adapter.getWorkUnits() call.
 *                            Enables Batch 2 polling orchestrator to supply ESPN data.
 * @returns {Promise<Object>} summary - { processed, skipped, errors }
 */
async function run(contestInstanceId, pool, workUnits = null) {
  if (!contestInstanceId) {
    throw new Error('ingestionService.run: contestInstanceId is required');
  }

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

    // Guard: provider_event_id is required for ingestion
    if (!row.provider_event_id) {
      await client.query('ROLLBACK');
      throw new Error(`provider_event_id missing for contest ${contestInstanceId}`);
    }

    // Determine ingestion strategy based on sport
    // GOLF uses pga_espn, all others default to nfl_espn
    const strategyKey = row.sport === 'GOLF' ? 'pga_espn' : 'nfl_espn';

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

    const summary = { processed: 0, skipped: 0, errors: [] };

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
        console.log(`[ingestionService] Skipping duplicate work unit: ${workUnitKey}`);
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
    `SELECT ci.id, ct.sport, ct.provider_tournament_id
     FROM contest_instances ci
     JOIN contest_templates ct ON ci.template_id = ct.id
     WHERE ci.id = $1`,
    [contestInstanceId]
  );

  if (ciResult.rows.length === 0) {
    throw new Error(`Contest instance not found: ${contestInstanceId}`);
  }

  const { sport, provider_tournament_id } = ciResult.rows[0];

  // Verify sport is GOLF
  if (sport !== 'GOLF') {
    throw new Error(`initializeTournamentField: sport must be GOLF, got ${sport}`);
  }

  // Resolve provider_event_id from provider_tournament_id
  const provider_event_id = provider_tournament_id;

  if (!provider_event_id) {
    throw new Error(`Contest template missing provider_tournament_id`);
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

module.exports = { run, initializeTournamentField };
