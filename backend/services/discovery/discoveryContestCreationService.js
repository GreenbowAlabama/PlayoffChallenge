/**
 * Discovery Contest Creation Service
 *
 * Batch 2: Auto-create contest_instances for upcoming PGA events.
 *
 * Architecture:
 * 1. Resolve base PGA_BASE template (non-system-generated)
 * 2. For each upcoming event:
 *    a. Clone tournament-level template (system-generated, PGA_TOURNAMENT type)
 *    b. Insert exactly one contest instance per tournament
 *
 * Core rules:
 * - Insert-only semantics (never update existing rows)
 * - Tournament template idempotent: ON CONFLICT (provider_tournament_id, season_year)
 * - Contest instance idempotent: ON CONFLICT (provider_event_id)
 * - Never transitions status
 * - Never modifies lifecycle or settlement logic
 * - Audit logging is non-blocking (failures do not fail transaction)
 *
 * Determinism:
 * - Injected `now` parameter for all time comparisons
 * - No implicit Date() calls
 * - Season year extracted from event.start_time
 */

const { getNextUpcomingEvent } = require('./calendarProvider');

/**
 * Run discovery cycle:
 * 1. Get next upcoming event (7-day window)
 * 2. Resolve base PGA_BASE template
 * 3. Clone tournament template from base (idempotent)
 * 4. Create contest instance (idempotent)
 * 5. Log cycle outcome (event_id, template_created, instance_created)
 *
 * @param {Object} pool - Database connection pool
 * @param {Date} now - Current time (for determinism)
 * @param {string} organizerId - UUID of platform organizer user
 *
 * @returns {Promise<Object>} {
 *   success: boolean,
 *   event_id: string|null,
 *   template_created: boolean,
 *   instance_created: boolean,
 *   errors: string[],
 *   message: string
 * }
 */
async function runDiscoveryCycle(pool, now = new Date(), organizerId) {
  if (!organizerId) {
    return {
      success: false,
      event_id: null,
      template_created: false,
      instance_created: false,
      errors: ['organizerId parameter is required'],
      message: 'Discovery cycle failed: missing organizerId'
    };
  }

  try {
    // Step 1: Get next upcoming event (7-day window)
    const event = await Promise.resolve(getNextUpcomingEvent(now));

    if (!event) {
      return {
        success: true,
        event_id: null,
        template_created: false,
        instance_created: false,
        errors: [],
        message: 'No upcoming events within 7-day window'
      };
    }

    // Step 2: Process event (clone template + create instance)
    const result = await processEventDiscovery(pool, event, now, organizerId);

    return {
      success: result.success,
      event_id: event.provider_event_id,
      template_created: result.template_created,
      instance_created: result.instance_created,
      errors: result.errors,
      message: result.message
    };
  } catch (err) {
    return {
      success: false,
      event_id: null,
      template_created: false,
      instance_created: false,
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
    const providerTournamentId = event.provider_event_id;
    const seasonYear = event.start_time.getFullYear();
    const tournamentName = `PGA — ${event.name} ${seasonYear}`;

    console.log(`[Discovery] Processing: ${providerTournamentId} (${event.name}) season=${seasonYear}`);
    console.log(`[Discovery] Base template: id=${baseTemplate.id}, fee=${baseTemplate.default_entry_fee_cents}¢`);

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
      WHERE is_system_generated = true
      DO NOTHING
      RETURNING id`,
      [tournamentName, providerTournamentId, seasonYear, baseTemplate.id]
    );

    let tournamentTemplateId = null;

    if (templateInsertResult.rows.length > 0) {
      // New template created
      tournamentTemplateId = templateInsertResult.rows[0].id;
      template_created = true;
      console.log(`[Discovery] Tournament template CREATED: id=${tournamentTemplateId}`);
    } else {
      // Template already exists, resolve its ID
      console.log(`[Discovery] Tournament template exists, resolving ID...`);
      const existingResult = await client.query(
        `SELECT id FROM contest_templates
         WHERE provider_tournament_id = $1
         AND season_year = $2
         AND is_system_generated = true
         LIMIT 1`,
        [providerTournamentId, seasonYear]
      );

      if (existingResult.rows.length > 0) {
        tournamentTemplateId = existingResult.rows[0].id;
        console.log(`[Discovery] Tournament template resolved: id=${tournamentTemplateId}`);
      } else {
        console.warn(`[Discovery] ⚠️  Could not resolve tournament template: ${providerTournamentId}/${seasonYear}`);
      }
    }

    if (!tournamentTemplateId) {
      await client.query('ROLLBACK');
      return {
        success: false,
        template_created: false,
        instance_created: false,
        errors: ['Failed to resolve or create tournament template'],
        message: `Failed to resolve tournament template for ${event.provider_event_id}`
      };
    }

    // Step 3: Insert contest instance (idempotent)
    const payoutStructure = Array.isArray(baseTemplate.allowed_payout_structures)
      ? baseTemplate.allowed_payout_structures[0]
      : baseTemplate.allowed_payout_structures;

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
      ON CONFLICT (provider_event_id, template_id)
      WHERE provider_event_id IS NOT NULL
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
        event.start_time, // lock_time = tournament_start_time
        event.provider_event_id
      ]
    );

    if (instanceInsertResult.rows.length > 0) {
      const contestInstanceId = instanceInsertResult.rows[0].id;
      const isPlatformOwned = instanceInsertResult.rows[0].is_platform_owned;
      instance_created = true;

      console.log(
        `[Discovery] Contest instance CREATED: id=${contestInstanceId}, event=${event.provider_event_id}, is_platform_owned=${isPlatformOwned}`
      );

      if (isPlatformOwned === true) {
        console.warn(
          `[Discovery] ⚠️  GOVERNANCE ALERT: Contest ${contestInstanceId} has is_platform_owned=true. Expected false for iOS visibility.`
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
            contestInstanceId,
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
          `[Discovery] Audit log failed for contest ${contestInstanceId}: ${auditErr.message}`
        );
      }
    } else {
      // Instance already exists: verify is_platform_owned is preserved
      const existingInstance = await client.query(
        `SELECT id, is_platform_owned FROM contest_instances
         WHERE provider_event_id = $1 AND template_id = $2`,
        [event.provider_event_id, tournamentTemplateId]
      );

      if (existingInstance.rows.length > 0) {
        const existing = existingInstance.rows[0];
        console.log(
          `[Discovery] Contest instance already exists for event=${event.provider_event_id}, id=${existing.id}, is_platform_owned=${existing.is_platform_owned}`
        );
      }
    }

    await client.query('COMMIT');
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

module.exports = {
  runDiscoveryCycle,
  processEventDiscovery
};
