/**
 * Discovery Service
 *
 * Handles tournament discovery and auto-template creation.
 * - Idempotent: Reuses existing system templates via partial unique index
 * - Deterministic: No race conditions via DB constraints
 * - Transaction-safe: All-or-nothing semantics
 *
 * Core operations:
 * 1. Validate input (discoveryValidator)
 * 2. Check existing system template (via partial index)
 * 3. Create or update template (idempotent)
 * 4. Return template ID for contest creation
 */

const { validateDiscoveryInput, getErrorDetails } = require('./discoveryValidator');

/**
 * Discover tournament and create/update system template
 *
 * @param {Object} input - Discovery input
 * @param {Object} pool - Database pool
 * @param {Date} now - Current time (for determinism)
 *
 * @returns {Promise<Object>} {
 *   success: boolean,
 *   templateId: string|null,
 *   created: boolean,
 *   updated: boolean,
 *   error: string|null,
 *   errorCode: string|null,
 *   statusCode: number
 * }
 */
async function discoverTournament(input, pool, now) {
  // ===== VALIDATE INPUT =====
  const validation = validateDiscoveryInput(input, now);
  if (!validation.valid) {
    const errorDetails = getErrorDetails(validation.errorCode);
    return {
      success: false,
      templateId: null,
      created: false,
      updated: false,
      error: validation.error,
      errorCode: validation.errorCode,
      statusCode: errorDetails.statusCode
    };
  }

  const normalized = validation.normalizedInput;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ===== CHECK FOR EXISTING SYSTEM TEMPLATE =====
    // The partial unique index guarantees at most 1 system template per
    // (provider_tournament_id, season_year) combination.
    // If one exists, we may update it (if no LOCKED instances exist).
    const existingTemplate = await client.query(
      `SELECT id, name, status, created_at, updated_at FROM contest_templates
       WHERE provider_tournament_id = $1
       AND season_year = $2
       AND is_system_generated = true`,
      [normalized.provider_tournament_id, normalized.season_year]
    );

    if (existingTemplate.rows.length > 0) {
      // Template already exists
      const templateId = existingTemplate.rows[0].id;
      const currentName = existingTemplate.rows[0].name;

      // Diagnostic: Verify template status is persisted
      const templateStatus = await client.query(
        `SELECT status FROM contest_templates WHERE id = $1`,
        [templateId]
      );
      const persistedStatus = templateStatus.rows[0]?.status;
      if (!persistedStatus) {
        throw new Error(`[CRITICAL] Template status is NULL or missing. Migration or insert bug. templateId=${templateId}`);
      }

      // ===== HANDLE PROVIDER TOURNAMENT CANCELLATION FIRST =====
      // Cancellation can happen regardless of metadata freeze state.
      // Invariants:
      // - Template is authoritative. If already CANCELLED, no-op.
      // - Atomic: template update + instance cascade + transitions in same transaction.
      // - Idempotent: repeated CANCELLED calls produce no duplicate transitions.
      // - Deterministic: uses injected `now` for transition timestamps.
      let cancellationUpdated = false;

      if (normalized.status === 'CANCELLED') {
        // 1) Update template first (authoritative). If no row changes, we are already CANCELLED.
        const templateCancel = await client.query(
          `UPDATE contest_templates
           SET status = 'CANCELLED', updated_at = now()
           WHERE id = $1 AND status != 'CANCELLED'
           RETURNING id, status`,
          [templateId]
        );

        const templateRowChanged = templateCancel.rowCount === 1;

        if (templateRowChanged) {
          // 2) Cascade instances + insert transitions for exactly the rows that changed.
          // Lock the target rows to avoid drift between "pre" and "update".
          const cascade = await client.query(
            `WITH to_cancel AS (
               SELECT id, status
               FROM contest_instances
               WHERE template_id = $1
                 AND status NOT IN ('COMPLETE', 'CANCELLED')
               FOR UPDATE
             ),
             updated AS (
               UPDATE contest_instances ci
               SET status = 'CANCELLED', updated_at = now()
               FROM to_cancel tc
               WHERE ci.id = tc.id
               RETURNING ci.id, tc.status AS from_state
             ),
             inserted AS (
               INSERT INTO contest_state_transitions (
                 contest_instance_id,
                 from_state,
                 to_state,
                 triggered_by,
                 created_at
               )
               SELECT
                 u.id,
                 u.from_state,
                 'CANCELLED',
                 'PROVIDER_TOURNAMENT_CANCELLED',
                 $2
               FROM updated u
               RETURNING contest_instance_id
             )
             SELECT COUNT(*)::int AS changed_count
             FROM updated`,
            [templateId, now]
          );

          const changedCount = cascade.rows[0]?.changed_count || 0;
          cancellationUpdated = changedCount > 0;
        } else {
          // Template already CANCELLED → idempotent no-op, skip cascade entirely.
          cancellationUpdated = false;
        }
      }

      // Check if ANY instance of this template is LOCKED
      // If so, freeze metadata and only update timestamps (unless cascade occurred)
      const lockedInstances = await client.query(
        `SELECT COUNT(*) as count FROM contest_instances
         WHERE template_id = $1 AND status IN ('LOCKED', 'LIVE', 'COMPLETE')`,
        [templateId]
      );

      const hasLockedInstances = parseInt(lockedInstances.rows[0].count, 10) > 0;

      if (hasLockedInstances && !cancellationUpdated) {
        // Metadata frozen: return existing template (unless cascade occurred)
        await client.query('COMMIT');
        return {
          success: true,
          templateId,
          created: false,
          updated: false,
          error: null,
          errorCode: null,
          statusCode: 200
        };
      }

      // No locked instances OR cancellation occurred: safe to update metadata
      // Only update if name actually changed
      const nameChanged = currentName !== normalized.name;

      if (nameChanged) {
        // Update template name (tournament names may change slightly via provider)
        await client.query(
          `UPDATE contest_templates
           SET name = $1, updated_at = now()
           WHERE id = $2`,
          [normalized.name, templateId]
        );
      }

      await client.query('COMMIT');
      return {
        success: true,
        templateId,
        created: false,
        updated: nameChanged || cancellationUpdated,
        error: null,
        errorCode: null,
        statusCode: 200
      };
    }

    // ===== CREATE NEW SYSTEM TEMPLATE =====
    // This template is system-generated and will be unique by
    // (provider_tournament_id, season_year) constraint
    const result = await client.query(
      `INSERT INTO contest_templates (
        name,
        sport,
        template_type,
        scoring_strategy_key,
        lock_strategy_key,
        settlement_strategy_key,
        default_entry_fee_cents,
        allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents,
        allowed_payout_structures,
        is_active,
        provider_tournament_id,
        season_year,
        is_system_generated,
        status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )
      RETURNING id`,
      [
        normalized.name,
        'pga', // sport: hardcoded for now, from discovery service
        'daily', // template_type: hardcoded for PGA
        'stroke_play', // scoring_strategy_key: hardcoded for PGA
        'auto_discovery', // lock_strategy_key: indicates auto-discovered
        'pga_settlement', // settlement_strategy_key: hardcoded for PGA
        5000, // default_entry_fee_cents: $50
        1000, // allowed_entry_fee_min_cents: $10
        50000, // allowed_entry_fee_max_cents: $500
        JSON.stringify([
          { payout_percentages: [0.5, 0.3, 0.2], min_entries: 2 }
        ]),
        true, // is_active: true by default
        normalized.provider_tournament_id,
        normalized.season_year,
        true, // is_system_generated: true
        normalized.status // status: SCHEDULED or CANCELLED from provider
      ]
    );

    const templateId = result.rows[0].id;

    // ===== CREATE PRIMARY MARKETING CONTEST =====
    // When a new system template is created, automatically create exactly one
    // primary marketing contest for it.
    //
    // Atomicity:
    //   Contest creation is in the same transaction as template creation.
    //   If either fails, both rollback. No partial states.
    //
    // Idempotency:
    //   The unique partial index idx_contest_instances_primary_marketing_unique
    //   ensures at most 1 primary marketing contest per template.
    //   If a race condition attempts to create another, the unique constraint
    //   violation is caught by ON CONFLICT and silently ignored.
    //
    // Status:
    //   Marketing contest inherits status from template:
    //   - If template.status='SCHEDULED', marketing contest is 'SCHEDULED'
    //   - If template.status='CANCELLED', marketing contest is 'CANCELLED'
    //
    // Determinism:
    //   Uses injected `now` parameter, not internal Date creation.
    await client.query(
      `INSERT INTO contest_instances (
        template_id,
        organizer_id,
        entry_fee_cents,
        payout_structure,
        status,
        start_time,
        contest_name,
        max_entries,
        is_platform_owned,
        is_primary_marketing
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      )
      ON CONFLICT DO NOTHING`,
      [
        templateId,
        '00000000-0000-0000-0000-000000000043', // organizer_id: platform user (UUID)
        5000, // entry_fee_cents: $50
        JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2], min_entries: 2 }), // payout_structure
        normalized.status, // status: inherit from template (SCHEDULED or CANCELLED)
        now, // start_time: injected now
        `${normalized.name} - Marketing`, // contest_name
        100, // max_entries
        true, // is_platform_owned
        true // is_primary_marketing
      ]
    );

    await client.query('COMMIT');
    return {
      success: true,
      templateId,
      created: true,
      updated: false,
      error: null,
      errorCode: null,
      statusCode: 201
    };
  } catch (err) {
    await client.query('ROLLBACK');

    // Check for unique constraint violation
    if (err.code === '23505' && err.constraint === 'idx_contest_templates_provider_tournament_unique') {
      // Race condition: another request created the template
      // Try again to fetch it
      const raceTemplate = await pool.query(
        `SELECT id FROM contest_templates
         WHERE provider_tournament_id = $1
         AND season_year = $2
         AND is_system_generated = true`,
        [normalized.provider_tournament_id, normalized.season_year]
      );

      if (raceTemplate.rows.length > 0) {
        return {
          success: true,
          templateId: raceTemplate.rows[0].id,
          created: false,
          updated: false,
          error: null,
          errorCode: null,
          statusCode: 200
        };
      }
    }

    return {
      success: false,
      templateId: null,
      created: false,
      updated: false,
      error: `Database error: ${err.message}`,
      errorCode: 'DATABASE_ERROR',
      statusCode: 500
    };
  } finally {
    client.release();
  }
}

module.exports = {
  discoverTournament
};
