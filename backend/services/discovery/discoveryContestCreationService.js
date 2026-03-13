/**
 * Discovery Contest Creation Service
 *
 * Batch 2: Auto-create contest_instances for upcoming PGA events.
 *
 * Architecture:
 * 1. Resolve base PGA_BASE template (non-system-generated)
 * 2. For each upcoming event:
 *    a. Clone tournament-level template (system-generated, PGA_TOURNAMENT type)
 *    b. Fetch ESPN summary data to derive accurate lock_time
 *    c. Insert exactly one contest instance per tournament with derived lock_time
 *
 * Core rules:
 * - Insert-only semantics (never update existing rows)
 * - Tournament template idempotent: ON CONFLICT (provider_tournament_id, season_year)
 * - Contest instance idempotent: ON CONFLICT (provider_event_id)
 * - lock_time derived during creation (immutable thereafter)
 * - Never transitions status
 * - Never modifies lifecycle or settlement logic
 * - Audit logging is non-blocking (failures do not fail transaction)
 * - ESPN data fetch is non-blocking (falls back to fixture startDate)
 *
 * Determinism:
 * - Injected `now` parameter for all time comparisons
 * - No implicit Date() calls
 * - Season year extracted from event.start_time
 */

const { getNextUpcomingEvent, getAllEvents } = require('./calendarProvider');
const { fetchEspnSummary, extractEspnEventId } = require('./espnDataFetcher');
const { discoverTournament } = require('./discoveryService');
const pgaEspnIngestion = require('../ingestion/strategies/pgaEspnIngestion');
const { initializeTournamentField } = require('../ingestionService');
const customContestService = require('../customContestService');

// Discovery window: 14 days in milliseconds
// All events with start_time within this window will be discovered
const DISCOVERY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Derive lock_time for a PGA contest during creation.
 *
 * Fallback order:
 * 1. Earliest competitor teeTime from ESPN scoreboard (if available)
 * 2. Fixture startDate (broadcast/tournament boundary)
 *
 * ESPN fetch is non-blocking: failures gracefully fall back to fixture time.
 * All timestamps preserved in UTC.
 *
 * @param {string} providerEventId - Full provider event ID (e.g., "espn_pga_401811941")
 * @param {Date} fixtureStartDate - Fallback time from calendar fixture
 * @returns {Promise<Object>} { lockTime: Date, source: string }
 */
async function deriveLockTimeForCreation(providerEventId, fixtureStartDate) {
  // Extract ESPN event ID
  const espnEventId = extractEspnEventId(providerEventId);

  if (!espnEventId) {
    console.log(
      `[Discovery] Could not extract ESPN event ID from ${providerEventId}, using fixture time`
    );
    return {
      lockTime: fixtureStartDate,
      source: 'fixture_fallback (invalid_provider_id)'
    };
  }

  // Fetch ESPN data (non-blocking)
  const espnData = await fetchEspnSummary(espnEventId);

  if (!espnData) {
    console.log(
      `[Discovery] ESPN data unavailable for event ${espnEventId}, using fixture time`
    );
    return {
      lockTime: fixtureStartDate,
      source: 'fixture_fallback (fetch_failed)'
    };
  }

  // Derive lock_time from ESPN data
  const derivation = pgaEspnIngestion.deriveLockTimeFromProviderData(
    espnData,
    fixtureStartDate
  );

  console.log(
    `[Discovery] Derived lock_time for event ${espnEventId}: ${derivation.source} = ${derivation.lockTime.toISOString()}`
  );

  return derivation;
}

/**
 * Run discovery cycle:
 * 1. Get ALL upcoming events within discovery window (14 days)
 * 2. For EACH event in the window (sorted by start_time):
 *    a. Check if template already exists (skip if it does)
 *    b. Create tournament template if it doesn't exist
 *    c. Create contest instances for that tournament
 * 3. Log outcome for each event (evaluated, created, skipped)
 *
 * CRITICAL FIX: This function now processes ALL events in the discovery window
 * in a single cycle, preventing events from being missed due to sequential processing.
 * Previously, only the next upcoming event was processed per cycle run.
 *
 * Return contract maintained for backward compatibility with worker and tests.
 *
 * @param {Object} pool - Database connection pool
 * @param {Date} now - Current time (for determinism)
 * @param {string} organizerId - UUID of platform organizer user
 *
 * @returns {Promise<Object>} {
 *   success: boolean,
 *   event_id: string|null (last event processed, or null if none),
 *   template_created: boolean (true if any template was created in cycle),
 *   instance_created: boolean (true if any instance was created in cycle),
 *   errors: string[],
 *   message: string,
 *   created: number (total instances created, for compatibility)
 * }
 */
async function runDiscoveryCycle(pool, now = new Date(), organizerId) {
  if (!organizerId) {
    return {
      success: false,
      event_id: null,
      template_created: false,
      instance_created: false,
      created: 0,
      errors: ['organizerId parameter is required'],
      message: 'Discovery cycle failed: missing organizerId'
    };
  }

  const cycleStart = Date.now();

  try {
    // Step 1: Get ALL events from the calendar
    const allEvents = getAllEvents();

    if (!allEvents || allEvents.length === 0) {
      return {
        success: true,
        event_id: null,
        template_created: false,
        instance_created: false,
        created: 0,
        errors: [],
        message: 'No events in calendar'
      };
    }

    // Step 2: Filter events within discovery window (14 days)
    // Use same window as getNextUpcomingEvent() for consistency
    const windowEnd = new Date(now.getTime() + DISCOVERY_WINDOW_MS);
    const candidateEvents = allEvents.filter(event => {
      // Defensive parsing: handle both start_time and startDate
      const startTime = new Date(event.start_time || event.startDate);
      return startTime >= now && startTime <= windowEnd;
    });

    if (candidateEvents.length === 0) {
      return {
        success: true,
        event_id: null,
        template_created: false,
        instance_created: false,
        created: 0,
        errors: [],
        message: `No upcoming events within ${DISCOVERY_WINDOW_MS / (24 * 60 * 60 * 1000)}-day window`
      };
    }

    // Step 3: Sort candidate events by start_time (deterministic ordering)
    candidateEvents.sort((a, b) => {
      const aStart = new Date(a.start_time || a.startDate);
      const bStart = new Date(b.start_time || b.startDate);
      return aStart - bStart;
    });

    console.log(
      `[Discovery Calendar] Checking window: ${now.toISOString()} to ${windowEnd.toISOString()} (${allEvents.length} total events, ${candidateEvents.length} candidates)`
    );

    // Step 4: Process each candidate event
    let lastEventId = null;
    let templatesCreatedInCycle = false;
    let instancesCreatedInCycle = false;
    let totalInstancesCreated = 0;
    const errors = [];

    for (const event of candidateEvents) {
      try {
        const startTime = new Date(event.start_time || event.startDate);
        console.log(
          `[Discovery Calendar] Evaluating event ${event.provider_event_id} start=${startTime.toISOString()}`
        );

        // Step 4a: Check if template already exists
        const templateCheckResult = await pool.query(
          `SELECT id FROM contest_templates
           WHERE provider_tournament_id = $1
           AND season_year = $2
           AND is_system_generated = true
           LIMIT 1`,
          [event.provider_event_id, startTime.getFullYear()]
        );

        if (templateCheckResult.rows.length > 0) {
          console.log(
            `[Discovery Calendar] Skipped event ${event.provider_event_id} reason=template_exists`
          );
          continue;
        }

        // Step 4b: Template doesn't exist, create it
        console.log(
          `[Discovery Calendar] Creating system template for event ${event.provider_event_id}`
        );

        const discoverResult = await discoverTournament(
          {
            provider_tournament_id: event.provider_event_id,
            season_year: startTime.getFullYear(),
            name: event.name,
            start_time: event.start_time,
            end_time: event.end_time,
            status: 'SCHEDULED'
          },
          pool,
          now,
          organizerId
        );

        if (!discoverResult.success) {
          const errorMsg = `Failed to create template for ${event.provider_event_id}: ${discoverResult.error}`;
          console.error(`[Discovery Calendar] ${errorMsg}`);
          errors.push(errorMsg);
          continue;
        }

        if (discoverResult.created) {
          templatesCreatedInCycle = true;
          console.log(
            `[Discovery] ✓ Created system template: event=${event.provider_event_id}, template_id=${discoverResult.templateId}`
          );
        }

        // Step 4c: Create contest instances for this event
        const contestResult = await createContestsForEvent(pool, event, now, organizerId);

        if (contestResult.success && contestResult.created > 0) {
          instancesCreatedInCycle = true;
          totalInstancesCreated += contestResult.created;
        } else if (!contestResult.success) {
          errors.push(...contestResult.errors);
        }

        lastEventId = event.provider_event_id;

        console.log(
          `[Discovery Calendar] Completed event ${event.provider_event_id}: templates_created=${discoverResult.created ? 1 : 0}, instances_created=${contestResult.created}`
        );
      } catch (eventErr) {
        const errorMsg = `Error processing event ${event.provider_event_id}: ${eventErr.message}`;
        console.error(`[Discovery Calendar] ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    const cycleDuration = Date.now() - cycleStart;
    console.log(`[Discovery Calendar] cycle_duration_ms=${cycleDuration}`);

    return {
      success: errors.length === 0,
      event_id: lastEventId,
      template_created: templatesCreatedInCycle,
      instance_created: instancesCreatedInCycle,
      created: totalInstancesCreated,
      errors,
      message: `Processed ${candidateEvents.length} candidates: templates_created=${templatesCreatedInCycle}, instances_created=${instancesCreatedInCycle}, total_instances=${totalInstancesCreated}`
    };
  } catch (err) {
    const cycleDuration = Date.now() - cycleStart;
    console.log(`[Discovery Calendar] cycle_duration_ms=${cycleDuration}`);

    return {
      success: false,
      event_id: null,
      template_created: false,
      instance_created: false,
      created: 0,
      errors: [err.message],
      message: `Discovery cycle failed: ${err.message}`
    };
  }
}

/**
 * Process a single event: clone tournament template and create contest instance
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} event - Normalized event {provider_event_id, name, start_time, end_time}
 * @param {Date} now - Current time (for determinism)
 * @param {string} organizerId - UUID of platform organizer user
 *
 * @returns {Promise<Object>} {
 *   success: boolean,
 *   template_created: boolean,
 *   instance_created: boolean,
 *   errors: string[],
 *   message: string
 * }
 */
async function processEventDiscovery(pool, event, now = new Date(), organizerId) {
  const client = await pool.connect();
  let template_created = false;
  let instance_created = false;
  const errors = [];

  try {
    await client.query('BEGIN');

    // Step 1: Resolve base PGA_BASE template
    const baseResult = await client.query(
      `SELECT id, sport, template_type, scoring_strategy_key, lock_strategy_key,
              settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
              allowed_entry_fee_max_cents, allowed_payout_structures
       FROM contest_templates
       WHERE template_type = 'PGA_BASE'
       AND sport = 'GOLF'
       AND is_system_generated = false
       AND is_active = true
       LIMIT 1`
    );

    if (baseResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        template_created: false,
        instance_created: false,
        errors: ['PGA_BASE template not found'],
        message: 'Discovery failed: PGA_BASE template not found'
      };
    }

    const baseTemplate = baseResult.rows[0];
    // NOTE: provider_tournament_id stores the provider EVENT identifier
    // (e.g., espn_pga_401811935).
    // Despite the column name, this value represents the canonical event
    // identity used throughout the ingestion pipeline.
    // The sport prefix (pga_) is critical for strategy resolution.
    // This identifier must remain stable across:
    // Discovery → Contest Templates → Contest Instances → Ingestion → Scoring.
    // Do not change this value format without updating the ingestion
    // strategy resolver and tournament discovery logic.
    const providerTournamentId = event.provider_event_id;
    const seasonYear = event.start_time.getFullYear();
    const tournamentName = `PGA — ${event.name} ${seasonYear}`;

    console.log(`[Discovery] Processing: ${providerTournamentId} (${event.name}) season=${seasonYear}`);

    // Step 2: Insert tournament template (clone from base, idempotent)
    const templateInsertResult = await client.query(
      `INSERT INTO contest_templates (
        name, sport, template_type, scoring_strategy_key, lock_strategy_key,
        settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents, allowed_payout_structures,
        provider_tournament_id, season_year, is_system_generated, is_active, status
      ) SELECT
        $1, sport, 'PGA_TOURNAMENT', scoring_strategy_key, lock_strategy_key,
        settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents, allowed_payout_structures,
        $2, $3, true, true, 'SCHEDULED'
      FROM contest_templates
      WHERE id = $4
      ON CONFLICT (provider_tournament_id, season_year)
      DO NOTHING
      RETURNING id`,
      [tournamentName, providerTournamentId, seasonYear, baseTemplate.id]
    );

    let tournamentTemplateId = null;

    if (templateInsertResult.rows.length > 0) {
      tournamentTemplateId = templateInsertResult.rows[0].id;
      template_created = true;
    } else {
      const existingTemplate = await client.query(
        `SELECT id FROM contest_templates
         WHERE provider_tournament_id = $1
         AND season_year = $2
         AND is_system_generated = true
         LIMIT 1`,
        [providerTournamentId, seasonYear]
      );

      if (existingTemplate.rows.length > 0) {
        tournamentTemplateId = existingTemplate.rows[0].id;
      } else {
        console.warn(`[Discovery] Template not found: ${providerTournamentId}/${seasonYear}`);
        await client.query('ROLLBACK');
        return {
          success: false,
          template_created: false,
          instance_created: false,
          errors: ['Failed to resolve or create tournament template'],
          message: `Failed to resolve tournament template for ${event.provider_event_id}`
        };
      }
    }

    // Step 3: Derive lock_time from ESPN data (immutable after creation)
    // Uses earliest competitor tee time if available, falls back to fixture startDate
    const lockTimeDerivation = await deriveLockTimeForCreation(
      event.provider_event_id,
      event.start_time
    );
    const derivedLockTime = lockTimeDerivation.lockTime;

    // Step 4: Insert contest instance (idempotent)
    const payoutStructure = Array.isArray(baseTemplate.allowed_payout_structures)
      ? baseTemplate.allowed_payout_structures[0]
      : baseTemplate.allowed_payout_structures;

    // Enforce non-null template_id before instance creation (invariant violation check)
    if (!tournamentTemplateId || typeof tournamentTemplateId !== 'string' || tournamentTemplateId.trim() === '') {
      await client.query('ROLLBACK');
      throw new Error('[Invariant Violation] template_id required before contest instance creation');
    }

    const instanceInsertResult = await client.query(
      `INSERT INTO contest_instances (
        template_id, organizer_id, entry_fee_cents, payout_structure,
        status, contest_name, tournament_start_time, tournament_end_time,
        lock_time, provider_event_id
        -- is_platform_owned deliberately omitted: defaults to false (schema authoritative)
        -- Reason: PGA_BASE contests must be visible to iOS users
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      )
      ON CONFLICT (provider_event_id, template_id, entry_fee_cents)
      DO NOTHING
      RETURNING id, is_platform_owned`,
      [
        tournamentTemplateId,
        organizerId,
        baseTemplate.default_entry_fee_cents,
        JSON.stringify(payoutStructure),
        'SCHEDULED',
        `${tournamentName} Contest`,
        event.start_time,
        event.end_time,
        derivedLockTime, // lock_time derived from ESPN data (with fallback)
        event.provider_event_id
      ]
    );

    let createdContestId = null;
    let isPlatformOwned = false;

    if (instanceInsertResult.rows.length > 0) {
      createdContestId = instanceInsertResult.rows[0].id;
      isPlatformOwned = instanceInsertResult.rows[0].is_platform_owned;
      instance_created = true;

      console.log(
        `  ✓ Created: ${tournamentName} Contest (${baseTemplate.default_entry_fee_cents / 100})`
      );

      if (isPlatformOwned === true) {
        console.warn(
          `[Discovery] ⚠️  GOVERNANCE ALERT: Contest ${createdContestId} has is_platform_owned=true. Expected false for iOS visibility.`
        );
      }

      // Audit logging (non-blocking: failures do not fail transaction)
      try {
        await client.query(
          `INSERT INTO admin_contest_audit (
            contest_instance_id, admin_user_id, action, reason,
            from_status, to_status, payload
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            createdContestId,
            organizerId,
            'AUTO_CREATE',
            'Auto-created by discovery service for upcoming PGA event',
            'NONE',
            'SCHEDULED',
            JSON.stringify({
              provider_event_id: event.provider_event_id,
              provider_tournament_id: providerTournamentId,
              season_year: seasonYear,
              template_id: tournamentTemplateId,
              event_name: event.name,
              is_platform_owned: isPlatformOwned
            })
          ]
        );
      } catch (auditErr) {
        // Audit logging failure is non-blocking
        console.warn(
          `[Discovery] Audit log failed for contest ${createdContestId}: ${auditErr.message}`
        );
      }
    } else {
      console.log(
        `  ⊘ Skipping ${baseTemplate.default_entry_fee_cents / 100} (already exists)`
      );
    }

    await client.query('COMMIT');

    // CRITICAL: Initialize tournament field AFTER transaction commit.
    // This ensures the contest_instances row is visible to the initialization query.
    // If a contest was created, initialize it now with a fresh pool connection.
    if (createdContestId) {
      try {
        await initializeTournamentField(pool, createdContestId);
      } catch (err) {
        console.warn(
          `[Discovery] Tournament field initialization failed for ${createdContestId}: ${err.message}`
        );
      }
    }

    return {
      success: true,
      template_created,
      instance_created,
      errors,
      message: `Event: ${event.provider_event_id}, template_created=${template_created}, instance_created=${instance_created}`
    };
  } catch (err) {
    await client.query('ROLLBACK');
    errors.push(err.message);
    return {
      success: false,
      template_created: false,
      instance_created: false,
      errors,
      message: `Discovery failed for event ${event.provider_event_id}: ${err.message}`
    };
  } finally {
    client.release();
  }
}

/**
 * Create contest instances for a specific event, using all active system-generated templates.
 *
 * Each active system-generated template produces exactly one contest instance per event.
 * Idempotent: ON CONFLICT (provider_event_id, template_id) DO NOTHING.
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} event - Normalized event {provider_event_id, name, start_time, end_time}
 * @param {Date} now - Current time (for determinism, unused here but kept for signature parity)
 * @param {string} organizerId - UUID of platform organizer user
 *
 * @returns {Promise<Object>} { success, created, skipped, errors }
 */
async function createContestsForEvent(pool, event, now = new Date(), organizerId) {
  const client = await pool.connect();
  let created = 0;
  let skipped = 0;
  const errors = [];
  const createdContestIds = []; // Collect IDs for post-commit initialization

  try {
    await client.query('BEGIN');

    // GUARD 1: Prevent contest creation for events that have already started
    const nowUtc = new Date(now);
    const eventStartTime = new Date(event.start_time);

    if (eventStartTime <= nowUtc) {
      await client.query('ROLLBACK');
      console.info('[Discovery] Skipping event that has already started', {
        provider_event_id: event.provider_event_id,
        event_name: event.name,
        start_time: event.start_time,
        now: nowUtc
      });

      return {
        success: true,
        created: 0,
        skipped: 1,
        errors: [],
        reason: 'event_already_started',
        message: `Event ${event.provider_event_id} has already started. Skipping contest creation.`
      };
    }

    // Derive lock_time once for all contests from this event (immutable after creation)
    const lockTimeDerivation = await deriveLockTimeForCreation(
      event.provider_event_id,
      event.start_time
    );
    const derivedLockTime = lockTimeDerivation.lockTime;

    // GUARD 2: Prevent contest creation if lock time has already passed
    if (derivedLockTime <= nowUtc) {
      await client.query('ROLLBACK');
      console.info('[Discovery] Skipping contest creation because lock time has passed', {
        provider_event_id: event.provider_event_id,
        lock_time: derivedLockTime,
        now: nowUtc
      });

      return {
        success: true,
        created: 0,
        skipped: 1,
        errors: [],
        reason: 'lock_time_passed',
        message: `Lock time has already passed for event ${event.provider_event_id}. Skipping contest creation.`
      };
    }

    // Find all active system-generated templates for this specific tournament
    // Tournament scope: provider_tournament_id + season_year (matches event)
    const seasonYear = event.start_time.getFullYear();
    const templatesResult = await client.query(
      `SELECT id, name, default_entry_fee_cents, allowed_payout_structures, is_system_generated
       FROM contest_templates
       WHERE provider_tournament_id = $1
       AND season_year = $2
       AND is_system_generated = true
       AND is_active = true`,
      [event.provider_event_id, seasonYear]
    );

    // Entry fee tiers (in cents): $5, $10, $20, $50, $100
    const entryFeeTiers = [500, 1000, 2000, 5000, 10000];

    for (const template of templatesResult.rows) {
      const payoutStructure = Array.isArray(template.allowed_payout_structures)
        ? template.allowed_payout_structures[0]
        : template.allowed_payout_structures;

      // Contests are platform-owned if the template is system-generated
      const isPlatformOwned = template.is_system_generated;

      // Generate contests for each entry fee tier
      for (const entryFeeCents of entryFeeTiers) {
        const entryFeeDollars = entryFeeCents / 100;
        const contestName = `${event.name} — $${entryFeeDollars}`;

        // System-generated discovery contests are published immediately with a generated join_token
        const joinToken = customContestService.generateJoinToken();

        const insertResult = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, max_entries, payout_structure,
            status, contest_name, tournament_start_time, tournament_end_time,
            lock_time, provider_event_id, is_platform_owned, join_token
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (provider_event_id, template_id, entry_fee_cents)
          WHERE is_platform_owned = true
          DO NOTHING
          RETURNING id`,
          [
            template.id,
            organizerId,
            entryFeeCents,
            100,  // max_entries default
            JSON.stringify(payoutStructure),
            'SCHEDULED',
            contestName,
            event.start_time,
            event.end_time,
            derivedLockTime, // lock_time derived from ESPN data (with fallback)
            event.provider_event_id,
            isPlatformOwned,
            joinToken
          ]
        );

        if (insertResult.rows.length > 0) {
          created++;
          const contestInstanceId = insertResult.rows[0].id;
          createdContestIds.push(contestInstanceId); // Collect for post-commit initialization

          console.log(`  ✓ Created: ${contestName}`);

          // Audit logging (non-blocking)
          try {
            await client.query(
              `INSERT INTO admin_contest_audit (
                contest_instance_id, admin_user_id, action, reason,
                from_status, to_status, payload
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                contestInstanceId,
                organizerId,
                'AUTO_CREATE',
                'Auto-created by discovery service for upcoming PGA event',
                'NONE',
                'SCHEDULED',
                JSON.stringify({
                  provider_event_id: event.provider_event_id,
                  template_id: template.id,
                  event_name: event.name,
                  entry_fee_cents: entryFeeCents
                })
              ]
            );
          } catch (auditErr) {
            console.warn(`[Discovery] Audit log failed: ${auditErr.message}`);
          }
        } else {
          skipped++;
          console.log(`  ⊘ Skipping ${contestName} (already exists)`);
        }
      }
    }

    await client.query('COMMIT');

    // CRITICAL: Initialize tournament field AFTER transaction commit.
    // This ensures contest_instances rows are visible to the initialization query.
    // Each call gets a fresh connection from the pool and reads committed data.
    for (const contestInstanceId of createdContestIds) {
      try {
        await initializeTournamentField(pool, contestInstanceId);
      } catch (err) {
        console.warn(
          `[Discovery] Tournament field initialization failed for ${contestInstanceId}: ${err.message}`
        );
      }
    }

    return { success: true, created, skipped, errors };
  } catch (err) {
    await client.query('ROLLBACK');
    errors.push(err.message);
    return { success: false, created: 0, skipped: 0, errors };
  } finally {
    client.release();
  }
}

module.exports = {
  runDiscoveryCycle,
  processEventDiscovery,
  createContestsForEvent
};
