/**
 * Discovery Contest Creation Service
 *
 * Batch 1: Auto-create contest_instances for upcoming PGA events.
 *
 * Core rules:
 * - Only creates contests for system-generated templates
 * - Uses idempotent insert (ON CONFLICT DO NOTHING)
 * - Never updates existing rows
 * - Never transitions status
 * - Never modifies times
 * - Audit logging is non-blocking (failures do not fail the transaction)
 *
 * Determinism:
 * - Injected `now` parameter for all time comparisons
 * - No implicit Date() calls
 * - Deterministic ordering (ORDER BY start_time ASC)
 */

const { getNextUpcomingEvent } = require('./calendarProvider');

/**
 * Run discovery cycle:
 * 1. Get next upcoming event (7-day window)
 * 2. For each system-generated template, create contest_instance (idempotent)
 * 3. Log creations in admin_contest_audit
 *
 * @param {Object} pool - Database connection pool
 * @param {Date} now - Current time (for determinism)
 * @param {string} organizerId - UUID of platform organizer user
 *
 * @returns {Promise<Object>} {
 *   success: boolean,
 *   event_id: string|null,
 *   created: number,
 *   skipped: number,
 *   errors: string[]
 * }
 */
async function runDiscoveryCycle(pool, now = new Date(), organizerId) {
  if (!organizerId) {
    return {
      success: false,
      event_id: null,
      created: 0,
      skipped: 0,
      errors: ['organizerId parameter is required'],
      message: 'Discovery cycle failed: missing organizerId'
    };
  }

  try {
    // Step 1: Get next upcoming event
    const event = await Promise.resolve(getNextUpcomingEvent(now));

    if (!event) {
      return {
        success: true,
        event_id: null,
        created: 0,
        skipped: 0,
        errors: [],
        message: 'No upcoming events within 7-day window'
      };
    }

    // Step 2: Create contests for this event
    const result = await createContestsForEvent(pool, event, now, organizerId);

    return {
      success: result.success,
      event_id: event.provider_event_id,
      created: result.created,
      skipped: result.skipped,
      errors: result.errors,
      message: `Event: ${event.name}, Created: ${result.created}, Skipped: ${result.skipped}`
    };
  } catch (err) {
    return {
      success: false,
      event_id: null,
      created: 0,
      skipped: 0,
      errors: [err.message],
      message: `Discovery cycle failed: ${err.message}`
    };
  }
}

/**
 * Create contest_instances for an event across all system-generated templates
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} event - Event { provider_event_id, name, start_time, end_time }
 * @param {Date} now - Current time (for determinism)
 * @param {string} organizerId - UUID of platform organizer user
 *
 * @returns {Promise<Object>} {
 *   success: boolean,
 *   created: number,
 *   skipped: number,
 *   errors: string[]
 * }
 */
async function createContestsForEvent(pool, event, now = new Date(), organizerId) {
  const client = await pool.connect();
  const errors = [];
  let created = 0;
  let skipped = 0;

  try {
    await client.query('BEGIN');

    // Find all system-generated, active templates
    const templatesResult = await client.query(
      `SELECT id, name, default_entry_fee_cents, allowed_payout_structures
       FROM contest_templates
       WHERE is_system_generated = true
       AND is_active = true
       ORDER BY id`
    );

    const templates = templatesResult.rows;

    // Create contest for each system-generated template
    for (const template of templates) {
      try {
        // Build contest name: template.name + event.name
        const contestName = `${template.name} - ${event.name}`;

        // Extract payout structure (first in allowed list, already JSONB)
        const payoutStructure = template.allowed_payout_structures[0];

        // Idempotent insert: ON CONFLICT DO NOTHING
        // IMPORTANT: Only insert, never update. If row exists, silently skip.
        const insertResult = await client.query(
          `INSERT INTO contest_instances (
            template_id,
            organizer_id,
            entry_fee_cents,
            payout_structure,
            status,
            contest_name,
            tournament_start_time,
            tournament_end_time,
            lock_time,
            provider_event_id,
            is_platform_owned
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
          )
          ON CONFLICT (provider_event_id, template_id)
          WHERE provider_event_id IS NOT NULL
          DO NOTHING
          RETURNING id`,
          [
            template.id,
            organizerId,
            template.default_entry_fee_cents,
            payoutStructure,
            'SCHEDULED',
            contestName,
            event.start_time,
            event.end_time,
            event.start_time, // lock_time = tournament_start_time
            event.provider_event_id,
            true // is_platform_owned
          ]
        );

        if (insertResult.rows.length > 0) {
          // New contest created, log it in admin_contest_audit
          const contestInstanceId = insertResult.rows[0].id;
          created++;

          // Audit logging (non-blocking: failures do not fail the transaction)
          try {
            await client.query(
              `INSERT INTO admin_contest_audit (
                contest_instance_id,
                admin_user_id,
                action,
                reason,
                from_status,
                to_status,
                payload
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                contestInstanceId,
                organizerId,
                'AUTO_CREATE',
                'Auto-created by discovery service for upcoming event',
                'NONE',
                'SCHEDULED',
                JSON.stringify({
                  provider_event_id: event.provider_event_id,
                  template_id: template.id,
                  event_name: event.name
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
          // Contest already exists for this (event, template) pair
          skipped++;
        }
      } catch (templateErr) {
        errors.push(`Template ${template.id}: ${templateErr.message}`);
      }
    }

    await client.query('COMMIT');
    return { success: true, created, skipped, errors };
  } catch (err) {
    await client.query('ROLLBACK');
    errors.push(`Transaction error: ${err.message}`);
    return { success: false, created: 0, skipped: 0, errors };
  } finally {
    client.release();
  }
}

module.exports = {
  runDiscoveryCycle,
  createContestsForEvent
};
