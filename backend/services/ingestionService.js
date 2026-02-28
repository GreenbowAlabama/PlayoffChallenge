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
      `SELECT ci.*, ct.scoring_strategy_key, ct.settlement_strategy_key,
              COALESCE(ct.ingestion_strategy_key, 'nfl_espn') AS ingestion_strategy_key
       FROM contest_instances ci
       JOIN contest_templates ct ON ci.template_id = ct.id
       WHERE ci.id = $1
       FOR UPDATE`,
      [contestInstanceId]
    );

    if (ciResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error(`Contest instance not found: ${contestInstanceId}`);
    }

    const row = ciResult.rows[0];
    const strategyKey = row.ingestion_strategy_key;

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
      const workUnitKey = adapter.computeIngestionKey(contestInstanceId, unit);

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
        const normalizedScores = await adapter.ingestWorkUnit(ctx, unit);
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

module.exports = { run };
