#!/usr/bin/env node
/**
 * create_pga_scheduled_contests.js
 *
 * Creates SCHEDULED PGA contest instances for the NEXT event on the timeline.
 * Derives next event from contest_instances chronological order (authoritative source).
 * Idempotent: does not duplicate if SCHEDULED instance already exists for the triple.
 *
 * Usage:
 *   DATABASE_URL=<url> node create_pga_scheduled_contests.js
 */

const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function createPGAScheduledContests() {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    console.log('🔒 Transaction started\n');

    // STEP 1: Get current LIVE event
    const liveResult = await client.query(`
      SELECT DISTINCT provider_event_id
      FROM contest_instances
      WHERE status = 'LIVE'
      LIMIT 1
    `);

    if (!liveResult.rows.length) {
      throw new Error('NO LIVE EVENT FOUND');
    }

    const currentEventId = liveResult.rows[0].provider_event_id;
    console.log(`📡 Current LIVE event: ${currentEventId}\n`);

    // STEP 2: Derive next event from ESPN calendar fixture (authoritative schedule)
    const calendarProvider = require('../../services/discovery/calendarProvider');
    const allEvents = calendarProvider.getAllEvents();

    // Find current LIVE event in calendar to determine position
    const currentIdx = allEvents.findIndex(e => e.provider_event_id === currentEventId);
    if (currentIdx === -1) {
      throw new Error(`LIVE event ${currentEventId} not found in calendar fixture`);
    }
    if (currentIdx >= allEvents.length - 1) {
      throw new Error('NO NEXT EVENT IN CALENDAR — current LIVE event is the last entry');
    }

    const nextEvent = allEvents[currentIdx + 1];
    const nextEventId = nextEvent.provider_event_id;
    console.log(`📅 Next event: ${nextEvent.name} (${nextEventId})`);
    console.log(`   Starts: ${nextEvent.start_time.toISOString()}`);
    console.log(`   Ends:   ${nextEvent.end_time.toISOString()}\n`);

    // STEP 3: Find or create template for next event
    let templatesResult = await client.query(`
      SELECT
        id,
        name,
        provider_tournament_id,
        season_year,
        sport,
        default_entry_fee_cents
      FROM contest_templates
      WHERE sport = 'PGA'
        AND status = 'SCHEDULED'
        AND provider_tournament_id = $1
    `, [nextEventId]);

    // If no template exists for next event, clone from current LIVE event's template
    if (!templatesResult.rows.length) {
      console.log(`⚠️  No template for ${nextEvent.name} — cloning from LIVE event template\n`);

      await client.query(`
        INSERT INTO contest_templates (
          id,
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
        )
        SELECT
          gen_random_uuid(),
          $2,
          'PGA',
          template_type,
          scoring_strategy_key,
          lock_strategy_key,
          settlement_strategy_key,
          default_entry_fee_cents,
          allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents,
          allowed_payout_structures,
          true,
          $3,
          2026,
          true,
          'SCHEDULED'
        FROM contest_templates
        WHERE provider_tournament_id = $1
        LIMIT 1
      `, [currentEventId, nextEvent.name, nextEventId]);

      console.log(`  ✓ Template created: ${nextEvent.name} (${nextEventId})\n`);

      // Re-query to get the new template
      templatesResult = await client.query(`
        SELECT
          id,
          name,
          provider_tournament_id,
          season_year,
          sport,
          default_entry_fee_cents
        FROM contest_templates
        WHERE sport = 'PGA'
          AND status = 'SCHEDULED'
          AND provider_tournament_id = $1
      `, [nextEventId]);
    }

    console.log(`📋 Found ${templatesResult.rows.length} template(s) for next event\n`);

    // STEP 4: Fetch a valid organizer dynamically (satisfies fk_contest_instance_organizer)
    const organizerResult = await client.query(`
      SELECT id
      FROM users
      ORDER BY created_at ASC
      LIMIT 1
    `);

    if (!organizerResult.rows.length) {
      throw new Error('NO USERS FOUND FOR ORGANIZER');
    }

    const organizerId = organizerResult.rows[0].id;
    console.log(`👤 Organizer: ${organizerId.slice(0, 8)}...\n`);

    // STEP 5: Get reference timing from calendar + payout from LIVE event instances
    const payoutResult = await client.query(`
      SELECT payout_structure
      FROM contest_instances
      WHERE provider_event_id = $1
      LIMIT 1
    `, [currentEventId]);

    if (!payoutResult.rows.length) {
      throw new Error(`NO PAYOUT REFERENCE FOUND FOR LIVE EVENT: ${currentEventId}`);
    }

    const ref = {
      tournament_start_time: nextEvent.start_time,
      tournament_end_time: nextEvent.end_time,
      lock_time: nextEvent.start_time,
      payout_structure: payoutResult.rows[0].payout_structure
    };

    console.log(`⏰ Reference times (from calendar):`);
    console.log(`   Start: ${ref.tournament_start_time.toISOString()}`);
    console.log(`   Lock:  ${ref.lock_time.toISOString()}`);
    console.log(`   End:   ${ref.tournament_end_time.toISOString()}\n`);

    const createdIds = [];

    // STEP 6: Create contest instances for each template
    for (const template of templatesResult.rows) {
      console.log(`Processing: ${template.name}`);

      // Compute unique entry fee to avoid uniq_platform_contest_tiers collision
      const entryFee = template.default_entry_fee_cents + 1;

      // Idempotency check: matches uniq_platform_contest_tiers constraint exactly
      const existingResult = await client.query(`
        SELECT id, status
        FROM contest_instances
        WHERE provider_event_id = $1
          AND template_id = $2
          AND entry_fee_cents = $3
          AND is_platform_owned = true
        LIMIT 1
      `, [nextEventId, template.id, entryFee]);

      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];
        console.log(`  ⊘ SKIPPED — Platform instance already exists (${existing.id.slice(0, 8)}... status=${existing.status})\n`);
        continue;
      }

      const contestId = crypto.randomUUID();
      const contestName = `${template.name} Contest`;

      await client.query(`
        INSERT INTO contest_instances (
          id,
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
          max_entries,
          is_platform_owned,
          is_system_generated,
          join_token,
          created_at,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
      `, [
        contestId,
        template.id,
        organizerId,
        entryFee,
        ref.payout_structure,
        'SCHEDULED',
        contestName,
        ref.tournament_start_time,
        ref.tournament_end_time,
        ref.lock_time,
        nextEventId,
        100,
        true,
        true,
        `stg_${crypto.randomBytes(16).toString('hex')}`,
      ]);

      createdIds.push(contestId);
      console.log(`  ✓ CREATED: ${contestName}`);
      console.log(`    ID: ${contestId}`);
      console.log(`    Fee: $${(entryFee / 100).toFixed(2)}\n`);
    }

    await client.query('COMMIT');
    console.log('✅ Transaction committed\n');
    console.log(`Created ${createdIds.length} new contest instance(s)`);

    return createdIds;

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction rolled back');
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

if (require.main === module) {
  createPGAScheduledContests()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { createPGAScheduledContests };
