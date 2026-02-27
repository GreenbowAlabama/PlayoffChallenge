/**
 * PGA ESPN Polling Orchestrator — Batch 2.2+ (External Worker Model)
 *
 * Accepts pre-fetched ESPN work units from external worker.
 * Backend does NOT call ESPN directly (403 constraint in production).
 *
 * Responsibilities:
 * - Load contest instance + template config from DB
 * - Validate template config (provider_league_id, season_year required)
 * - Validate input workUnits array
 * - Extract eventId from first work unit
 * - Pass workUnits to ingestionService.run()
 *
 * Non-responsibilities (delegated):
 * - No ESPN API calls (external worker responsibility)
 * - No calendar fetch or event selection (external worker responsibility)
 * - No ESPN payload validation (adapter handles normalization)
 * - No database writes (except via ingestionService)
 */

'use strict';

const logger = console; // TODO: Replace with structured logger in production

/**
 * Poll ingestion pipeline with pre-fetched ESPN work units.
 *
 * External worker fetches ESPN calendar and leaderboard, then supplies workUnits.
 * Backend validates input and calls ingestionService.run().
 *
 * This is a stateless "one cycle" function. No scheduling, no loops.
 * External worker calls this once per cycle with fetched data.
 *
 * @param {string} contestInstanceId - UUID of contest to ingest
 * @param {Object} pool - pg.Pool instance
 * @param {Array} workUnits - Pre-fetched work units from external worker
 *   [{ providerEventId: string, providerData: object }, ...]
 * @returns {Promise<Object>} {
 *   success: bool,
 *   eventId: string|null,
 *   summary: { processed, skipped, errors }
 * }
 */
async function pollAndIngest(contestInstanceId, pool, workUnits) {
  if (!contestInstanceId || !pool) {
    throw new Error('pollAndIngest: contestInstanceId and pool are required');
  }

  // ─── 1. Load contest instance from DB ───────────────────────────────────
  let contestInstance;
  try {
    const result = await pool.query(
      `SELECT ci.*, ct.ingestion_strategy_key, ct.config as template_config
       FROM contest_instances ci
       JOIN contest_templates ct ON ci.template_id = ct.id
       WHERE ci.id = $1`,
      [contestInstanceId]
    );

    if (result.rows.length === 0) {
      logger.warn(
        `[pgaEspnPollingOrchestrator] Contest ${contestInstanceId} not found`
      );
      return {
        success: false,
        eventId: null,
        summary: {
          processed: 0,
          skipped: 0,
          errors: [`Contest ${contestInstanceId} not found`]
        }
      };
    }

    contestInstance = result.rows[0];
  } catch (err) {
    logger.error(
      `[pgaEspnPollingOrchestrator] Failed to load contest ${contestInstanceId}: ${err.message}`
    );
    throw err;
  }

  // Ensure contest has required config fields
  const templateConfig = contestInstance.template_config || {};
  const providerLeagueId = templateConfig.provider_league_id;
  const seasonYear = templateConfig.season_year;

  if (!providerLeagueId || !seasonYear) {
    logger.error(
      `[pgaEspnPollingOrchestrator] Contest ${contestInstanceId}: ` +
      `Missing provider_league_id or season_year in template config`
    );
    return {
      success: false,
      eventId: null,
      summary: {
        processed: 0,
        skipped: 0,
        errors: ['Missing required config: provider_league_id or season_year']
      }
    };
  }

  // ─── 2. Validate input workUnits ────────────────────────────────────────
  if (!Array.isArray(workUnits) || workUnits.length === 0) {
    logger.warn(
      `[pgaEspnPollingOrchestrator] Contest ${contestInstanceId}: ` +
      `Missing or invalid workUnits array`
    );
    return {
      success: false,
      eventId: null,
      summary: {
        processed: 0,
        skipped: 0,
        errors: ['Missing or invalid workUnits']
      }
    };
  }

  // Validate each work unit
  for (let i = 0; i < workUnits.length; i++) {
    const unit = workUnits[i];

    if (!unit || typeof unit !== 'object') {
      logger.error(
        `[pgaEspnPollingOrchestrator] Contest ${contestInstanceId}: ` +
        `workUnit[${i}] is not an object`
      );
      return {
        success: false,
        eventId: null,
        summary: {
          processed: 0,
          skipped: 0,
          errors: [`Invalid workUnit at index ${i}: not an object`]
        }
      };
    }

    if (!unit.providerEventId || typeof unit.providerEventId !== 'string') {
      logger.error(
        `[pgaEspnPollingOrchestrator] Contest ${contestInstanceId}: ` +
        `workUnit[${i}] missing or invalid providerEventId`
      );
      return {
        success: false,
        eventId: null,
        summary: {
          processed: 0,
          skipped: 0,
          errors: [`Invalid workUnit at index ${i}: providerEventId required and must be a string`]
        }
      };
    }

    if (!unit.providerData || typeof unit.providerData !== 'object') {
      logger.error(
        `[pgaEspnPollingOrchestrator] Contest ${contestInstanceId}: ` +
        `workUnit[${i}] missing or invalid providerData`
      );
      return {
        success: false,
        eventId: null,
        summary: {
          processed: 0,
          skipped: 0,
          errors: [`Invalid workUnit at index ${i}: providerData required and must be an object`]
        }
      };
    }
  }

  const eventId = workUnits[0].providerEventId;

  logger.info(
    `[pgaEspnPollingOrchestrator] Contest ${contestInstanceId} | ` +
    `Received ${workUnits.length} work unit(s), eventId: ${eventId}`
  );

  // ─── 3. Call ingestionService.run() with work units ──────────────────────
  const ingestionService = require('../../ingestionService');
  let summary;
  try {
    summary = await ingestionService.run(contestInstanceId, pool, workUnits);
  } catch (err) {
    logger.error(
      `[pgaEspnPollingOrchestrator] ingestionService.run failed for ` +
      `contest ${contestInstanceId}: ${err.message}`
    );
    return {
      success: false,
      eventId,
      summary: {
        processed: 0,
        skipped: 0,
        errors: [`Ingestion failed: ${err.message}`]
      }
    };
  }

  logger.info(
    `[pgaEspnPollingOrchestrator] Contest ${contestInstanceId} | ` +
    `Ingestion complete | processed=${summary.processed}, skipped=${summary.skipped}, ` +
    `errors=${summary.errors.length}`
  );

  return {
    success: summary.errors.length === 0,
    eventId,
    summary
  };
}

module.exports = {
  pollAndIngest
};
