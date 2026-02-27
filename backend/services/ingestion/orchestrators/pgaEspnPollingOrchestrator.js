/**
 * PGA ESPN Polling Orchestrator — Batch 2.1
 *
 * Orchestrates polling of ESPN PGA calendar and leaderboards.
 * Handles deterministic event selection and payload validation.
 *
 * Responsibilities:
 * - Fetch ESPN PGA calendar (scoped by league_id + season_year)
 * - Select providerEventId deterministically (6-tier algorithm per pga-espn-event-selection-mapping.md)
 * - Fetch ESPN event leaderboard
 * - Validate ESPN payload shape (fail-fast)
 * - Build work units { providerEventId, providerData }
 * - Pass to ingestionService.run() with pre-built units
 *
 * Non-responsibilities (delegated):
 * - No database writes (except via ingestionService)
 * - No adapter modifications
 * - No ESPN-specific logic in ingestionService
 * - Deterministic hashing happens in adapter
 */

'use strict';

const logger = console; // TODO: Replace with structured logger in production

/**
 * Validate that ESPN leaderboard payload has minimum required structure.
 * Fail fast if malformed — do not pass to pipeline.
 *
 * @param {Object} payload - ESPN leaderboard response
 * @returns {Object} { valid: bool, errors: [string] }
 */
function validateEspnLeaderboardShape(payload) {
  const errors = [];

  // Minimal shape required by adapter
  if (!payload || typeof payload !== 'object') {
    errors.push('payload is null or not an object');
    return { valid: false, errors };
  }

  if (!Array.isArray(payload.events) || payload.events.length === 0) {
    errors.push('events array missing or empty');
    return { valid: false, errors };
  }

  // events[0] must exist and be an object
  const event = payload.events[0];
  if (!event || typeof event !== 'object') {
    errors.push('events[0] is null or not an object');
    return { valid: false, errors };
  }

  if (!Array.isArray(event.competitions) || event.competitions.length === 0) {
    errors.push('competitions array missing or empty');
    return { valid: false, errors };
  }

  // competitions[0] must exist and be an object
  const competition = event.competitions[0];
  if (!competition || typeof competition !== 'object') {
    errors.push('competitions[0] is null or not an object');
    return { valid: false, errors };
  }

  if (!Array.isArray(competition.competitors)) {
    errors.push('competitors array missing');
    return { valid: false, errors };
  }

  return { valid: true, errors };
}

/**
 * Select ESPN event ID for a contest instance.
 *
 * Implements 6-tier deterministic selection algorithm:
 * 1. Config override (event_id) with validation
 * 2. Date window overlap
 * 3. Exact normalized name match
 * 4. Substring match
 * 5. Deterministic tie-breakers (closest date → earlier → lowest ID)
 * 6. Escalation (return null)
 *
 * Year validation is MANDATORY and enforced upfront:
 * - Calendar fetch is scoped by season_year by caller
 * - Selection filters to only events matching contest.season_year
 * - Config override is validated against year-filtered calendar
 *
 * @param {Object} contest - Contest instance with config
 *   {
 *     id: string,
 *     provider_league_id: number (REQUIRED),
 *     season_year: number (REQUIRED),
 *     event_name: string (OPTIONAL, for heuristic),
 *     start_date: string (OPTIONAL, for date window),
 *     end_date: string (OPTIONAL, for date window),
 *     config: { event_id?: string } (OPTIONAL override)
 *   }
 * @param {Object} espnCalendar - Calendar already scoped to league_id + season_year by caller
 *   { events: [{ id, label, startDate, endDate }, ...] }
 * @returns {string|null} Selected event ID or null if no match
 */
function selectEventIdForContest(contest, espnCalendar) {
  // ─── Validate required fields ───────────────────────────────────────────
  if (!contest.provider_league_id || !contest.season_year) {
    logger.error(
      '[selectEventIdForContest] league_id and season_year required ' +
      `(contest: ${contest.id})`
    );
    return null;
  }

  if (!espnCalendar || !Array.isArray(espnCalendar.events)) {
    logger.warn(
      `[selectEventIdForContest] Contest ${contest.id} | ` +
      `Calendar is invalid or empty`
    );
    return null;
  }

  // ─── Year Filtering (MANDATORY) ─────────────────────────────────────────
  // Filter calendar upfront to only events matching contest.season_year.
  // This ensures config override validation and all selection tiers are constrained
  // to the correct year, preventing silent cross-year ingestion.
  const yearFiltered = espnCalendar.events.filter(e => {
    try {
      return new Date(e.startDate).getFullYear() === contest.season_year;
    } catch (err) {
      return false;
    }
  });

  if (yearFiltered.length === 0) {
    logger.warn(
      `[selectEventIdForContest] Contest ${contest.id} | ` +
      `No events found for season_year ${contest.season_year}`
    );
    return null;
  }

  // ─── Tier 1: Config Override (Strongest) ───────────────────────────────
  if (contest.config?.event_id) {
    // Validate: must exist in year-filtered calendar
    const found = yearFiltered.find(e => e.id === contest.config.event_id);
    if (!found) {
      logger.error(
        `[selectEventIdForContest] Contest ${contest.id} | ` +
        `Config event_id ${contest.config.event_id} not found in calendar for year ${contest.season_year}`
      );
      return null;
    }

    logger.debug(
      `[selectEventIdForContest] Contest ${contest.id} | ` +
      `Using configured event_id: ${contest.config.event_id}`
    );
    return contest.config.event_id;
  }

  // ─── Tier 2: Date Window Overlap ───────────────────────────────────────
  let candidates = [];

  if (contest.start_date && contest.end_date) {
    const overlaps = (aStart, aEnd, bStart, bEnd) =>
      aStart <= bEnd && bStart <= aEnd;

    candidates = yearFiltered.filter(e => {
      try {
        return overlaps(
          new Date(e.startDate),
          new Date(e.endDate),
          new Date(contest.start_date),
          new Date(contest.end_date)
        );
      } catch (err) {
        return false;
      }
    });

    if (candidates.length === 1) {
      logger.info(
        `[selectEventIdForContest] Contest ${contest.id} | ` +
        `Selected event via date window: ${candidates[0].id}`
      );
      return candidates[0].id;
    }

    if (candidates.length === 0) {
      logger.warn(
        `[selectEventIdForContest] Contest ${contest.id} | ` +
        `No events overlap with ${contest.start_date} to ${contest.end_date}, falling back to name matching`
      );
      // Fall through to name matching with full year-filtered calendar
      candidates = yearFiltered;
    }

    // If multiple matches, continue to name matching (Tier 3)
  }

  // If no date window provided, use year-filtered calendar for name matching
  if (candidates.length === 0) {
    candidates = yearFiltered;
  }

  // ─── Tier 3: Exact Name Match ──────────────────────────────────────────
  if (!contest.event_name) {
    logger.warn(
      `[selectEventIdForContest] Contest ${contest.id} | ` +
      `event_name not provided, cannot apply name heuristic`
    );
    return null;
  }

  const normalize = (str) =>
    str.toLowerCase().replace(/[^a-z0-9]/g, '');

  const normalizedEventName = normalize(contest.event_name);

  // Exact match
  const exactMatches = candidates.filter(e =>
    normalize(e.label) === normalizedEventName
  );

  if (exactMatches.length === 1) {
    logger.info(
      `[selectEventIdForContest] Contest ${contest.id} | ` +
      `Selected event via exact name match: ${exactMatches[0].id}`
    );
    return exactMatches[0].id;
  }

  // ─── Tier 4: Substring Match ───────────────────────────────────────────
  const substringMatches = candidates.filter(e =>
    normalize(e.label).includes(normalizedEventName)
  );

  if (substringMatches.length === 1) {
    logger.info(
      `[selectEventIdForContest] Contest ${contest.id} | ` +
      `Selected event via substring match: ${substringMatches[0].id}`
    );
    return substringMatches[0].id;
  }

  // ─── Tier 5: Deterministic Tie-Breakers ───────────────────────────────
  // Prefer exact matches over substring matches: if we have any exact matches,
  // apply tie-breakers to them. Only use substring matches if no exact matches exist.
  const toBreak = exactMatches.length > 0 ? exactMatches : substringMatches;

  if (toBreak.length === 0) {
    // ─── Tier 6: Escalation ────────────────────────────────────────────
    logger.warn(
      `[selectEventIdForContest] Contest ${contest.id} | ` +
      `No events match "${contest.event_name}" in ${candidates.length} candidates`
    );
    return null;
  }

  // Sort deterministically with stable tie-breakers
  const contestStartMs = contest.start_date
    ? new Date(contest.start_date).getTime()
    : null;

  const sorted = toBreak.sort((a, b) => {
    const aStart = new Date(a.startDate).getTime();
    const bStart = new Date(b.startDate).getTime();

    // Rule 1: Closest to expected date (only if contest.start_date provided)
    if (contestStartMs !== null && !isNaN(contestStartMs)) {
      const aDiff = Math.abs(aStart - contestStartMs);
      const bDiff = Math.abs(bStart - contestStartMs);
      if (aDiff !== bDiff) return aDiff - bDiff;
    }

    // Rule 2: Earlier start date
    if (aStart !== bStart) return aStart - bStart;

    // Rule 3: Lowest numeric ID (final deterministic fallback)
    return Number(a.id) - Number(b.id);
  });

  const selected = sorted[0];

  logger.info(
    `[selectEventIdForContest] Contest ${contest.id} | ` +
    `Selected event via tie-break (${toBreak.length} candidates): ${selected.id}`
  );
  return selected.id;
}

/**
 * Poll ESPN for PGA data and trigger ingestion pipeline.
 *
 * One polling cycle: Load contest → fetch calendar → select event → fetch leaderboard →
 * validate → build work units → call ingestionService.run().
 *
 * This is a stateless "one cycle" function. No scheduling, no loops.
 * External cron job calls this once per cycle.
 *
 * @param {string} contestInstanceId - UUID of contest to ingest
 * @param {Object} pool - pg.Pool instance
 * @returns {Promise<Object>} {
 *   success: bool,
 *   eventId: string|null,
 *   summary: { processed, skipped, errors }
 * }
 */
async function pollAndIngest(contestInstanceId, pool) {
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

  // ─── 2. Fetch ESPN calendar ─────────────────────────────────────────────
  let espnCalendar;
  try {
    const espnApi = require('../espn/espnPgaApi');
    espnCalendar = await espnApi.fetchCalendar({
      leagueId: providerLeagueId,
      seasonYear: seasonYear,
      timeout: 5000
    });
  } catch (err) {
    logger.error(
      `[pgaEspnPollingOrchestrator] Failed to fetch ESPN calendar for ` +
      `contest ${contestInstanceId}: ${err.message}`
    );
    return {
      success: false,
      eventId: null,
      summary: {
        processed: 0,
        skipped: 0,
        errors: [`ESPN calendar fetch failed: ${err.message}`]
      }
    };
  }

  // ─── 3. Select providerEventId via deterministic selection ──────────────
  const selectedEventId = selectEventIdForContest(
    {
      id: contestInstanceId,
      provider_league_id: providerLeagueId,
      season_year: seasonYear,
      event_name: templateConfig.event_name,
      start_date: templateConfig.start_date,
      end_date: templateConfig.end_date,
      config: templateConfig.config || {}
    },
    espnCalendar
  );

  if (!selectedEventId) {
    logger.warn(
      `[pgaEspnPollingOrchestrator] Contest ${contestInstanceId}: ` +
      `No event selected from ESPN calendar`
    );
    return {
      success: false,
      eventId: null,
      summary: {
        processed: 0,
        skipped: 0,
        errors: ['No event selected from ESPN calendar']
      }
    };
  }

  logger.info(
    `[pgaEspnPollingOrchestrator] Contest ${contestInstanceId} | ` +
    `Selected event: ${selectedEventId}`
  );

  // ─── 4. Fetch ESPN event leaderboard ─────────────────────────────────────
  let espnLeaderboard;
  try {
    const espnApi = require('../espn/espnPgaApi');
    espnLeaderboard = await espnApi.fetchLeaderboard({
      eventId: selectedEventId,
      timeout: 5000
    });
  } catch (err) {
    logger.error(
      `[pgaEspnPollingOrchestrator] Failed to fetch leaderboard for ` +
      `event ${selectedEventId}: ${err.message}`
    );
    return {
      success: false,
      eventId: selectedEventId,
      summary: {
        processed: 0,
        skipped: 0,
        errors: [`ESPN leaderboard fetch failed: ${err.message}`]
      }
    };
  }

  // ─── 5. Validate ESPN payload shape ──────────────────────────────────────
  const validation = validateEspnLeaderboardShape(espnLeaderboard);
  if (!validation.valid) {
    logger.error(
      `[pgaEspnPollingOrchestrator] Malformed ESPN payload for event ${selectedEventId}: ` +
      `${validation.errors.join('; ')}`
    );
    return {
      success: false,
      eventId: selectedEventId,
      summary: {
        processed: 0,
        skipped: 0,
        errors: [`Malformed ESPN payload: ${validation.errors.join('; ')}`]
      }
    };
  }

  // ─── 6. Build opaque work units ──────────────────────────────────────────
  const workUnits = [
    {
      providerEventId: selectedEventId,
      providerData: espnLeaderboard
    }
  ];

  logger.info(
    `[pgaEspnPollingOrchestrator] Contest ${contestInstanceId} | ` +
    `Built ${workUnits.length} work unit(s), calling ingestionService.run()`
  );

  // ─── 7. Call ingestionService.run() with pre-built units ──────────────────
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
      eventId: selectedEventId,
      summary: {
        processed: 0,
        skipped: 0,
        errors: [`Ingestion failed: ${err.message}`]
      }
    };
  }

  logger.info(
    `[pgaEspnPollingOrchestrator] Contest ${contestInstanceId} | ` +
    `Poll complete | processed=${summary.processed}, skipped=${summary.skipped}, ` +
    `errors=${summary.errors.length}`
  );

  return {
    success: summary.errors.length === 0,
    eventId: selectedEventId,
    summary
  };
}

module.exports = {
  selectEventIdForContest,
  validateEspnLeaderboardShape,
  pollAndIngest
};
