// backend/scripts/seedUpcomingPGAContestsStandalone.js
/**
 * Standalone PGA Contest Seeder
 *
 * Creates joinable platform PGA contests for upcoming tournaments.
 * Requires only DATABASE_URL environment variable.
 *
 * Usage:
 *   DATABASE_URL=postgres://user:pass@host:port/db node backend/scripts/seedUpcomingPGAContestsStandalone.js
 */

const { Pool } = require('pg');
const crypto = require('crypto');

const PLATFORM_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000043';
const ENTRY_FEES = [1000, 2000, 2500, 10000]; // cents
const MAX_ENTRIES = 100;

async function seedUpcomingPGAContests() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('🔒 Transaction started');

    // STEP 1: Find upcoming platform PGA contest to use as template
    const baseContestRes = await client.query(`
      SELECT ci.id, ci.template_id, ci.provider_event_id, ci.lock_time, ci.tournament_start_time,
             ci.tournament_end_time, ci.payout_structure, ct.name as template_name
      FROM contest_instances ci
      JOIN contest_templates ct ON ci.template_id = ct.id
      WHERE ci.is_platform_owned = true
        AND ct.template_type = 'PGA_TOURNAMENT'
      ORDER BY ci.tournament_start_time ASC
      LIMIT 1
    `);

    if (baseContestRes.rows.length === 0) {
      throw new Error('No upcoming platform PGA contest found to use as template');
    }

    const base = baseContestRes.rows[0];
    console.log(`📋 Base contest found: ${base.id} (${base.template_name})`);

    // STEP 2: Insert new contests for each entry fee
    const createdContests = [];
    for (const fee of ENTRY_FEES) {
      const contestId = crypto.randomUUID();
      const contestName = `${base.template_name} $${(fee/100).toFixed(0)}`;

      await client.query(
        `
        INSERT INTO contest_instances (
          id, template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, tournament_start_time, tournament_end_time, lock_time,
          provider_event_id, max_entries, is_platform_owned, is_system_generated,
          created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
        ON CONFLICT DO NOTHING
        `,
        [
          contestId,
          base.template_id,
          PLATFORM_SYSTEM_USER_ID,
          fee,
          base.payout_structure,
          'SCHEDULED',
          contestName,
          base.tournament_start_time,
          base.tournament_end_time,
          base.lock_time,
          base.provider_event_id,
          MAX_ENTRIES,
          true,  // is_platform_owned
          true   // is_system_generated
        ]
      );

      createdContests.push({ contestId, contestName, entryFee: fee });
      console.log(`  ✓ Created: ${contestName} (${fee} cents, ID: ${contestId})`);
    }

    await client.query('COMMIT');
    console.log('✅ Transaction committed successfully');
    console.log('Created contests:', createdContests);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction rolled back due to error:');
    console.error(err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seedUpcomingPGAContests()
  .then(() => console.log('🎉 PGA contest seeding completed'))
  .catch(() => process.exit(1));