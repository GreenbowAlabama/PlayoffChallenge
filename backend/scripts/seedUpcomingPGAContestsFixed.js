/**
 * seedUpcomingPGAContestsFixed.js
 *
 * Creates 4 new joinable platform PGA contests based on the next upcoming THE PLAYERS Championship.
 * Preserves the base contest and ensures join tokens and contest rules are set.
 */

const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PLATFORM_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000043';

async function seedUpcomingPGAContests() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('🔒 Transaction started');

    // STEP 1: Locate the upcoming base contest
    const baseResult = await client.query(
      `SELECT *
       FROM contest_instances
       WHERE is_platform_owned = true
         AND status = 'SCHEDULED'
         AND contest_name ILIKE '%THE PLAYERS Championship%'
       ORDER BY tournament_start_time ASC
       LIMIT 1`
    );

    if (!baseResult.rows.length) {
      throw new Error('No upcoming platform PGA contest found.');
    }

    const base = baseResult.rows[0];
    console.log(`📋 Upcoming base contest found: ${base.id} (${base.contest_name})`);

    // STEP 2: Define the new contests to create
    const entryFees = [1000, 2000, 2500, 10000]; // in cents
    const maxEntries = 100;
    const createdIds = [];

    for (const fee of entryFees) {
      // Skip if base contest already has this fee
      const existingFeeCheck = await client.query(
        `SELECT id FROM contest_instances
         WHERE is_platform_owned = true
           AND template_id = $1
           AND entry_fee_cents = $2`,
        [base.template_id, fee]
      );

      if (existingFeeCheck.rows.length) {
        console.log(`  ⊘ Skipping $${(fee/100).toFixed(2)} (already exists)`);
        continue;
      }

      const contestId = crypto.randomUUID();
      const contestName = `${base.contest_name.split('$')[0].trim()} $${(fee/100).toFixed(0)}`;

      // Insert the new contest
      await client.query(
        `INSERT INTO contest_instances (
           id, template_id, organizer_id, entry_fee_cents, payout_structure,
           status, contest_name, tournament_start_time, tournament_end_time,
           lock_time, provider_event_id, max_entries, is_platform_owned, is_system_generated,
           join_token, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())`,
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
          maxEntries,
          true,
          true,
          `stg_${crypto.randomBytes(16).toString('hex')}`
        ]
      );

      createdIds.push(contestId);
      console.log(`  ✓ Created: ${contestName} (ID: ${contestId})`);
    }

    // STEP 3: Optionally soft-cancel old platform contests (excluding base)
    await client.query(
      `UPDATE contest_instances
       SET status = 'CANCELLED', updated_at = NOW()
       WHERE is_platform_owned = true
         AND id != $1
         AND tournament_start_time < NOW()`,
      [base.id]
    );

    await client.query('COMMIT');
    console.log('✅ Transaction committed successfully');
    console.log('Created contest IDs:', createdIds);
    return createdIds;

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction rolled back due to error:');
    console.error(err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seedUpcomingPGAContests()
    .then(ids => console.log('🎯 Done.'))
    .catch(() => process.exit(1))
    .finally(() => process.exit());
}

module.exports = {
  seedUpcomingPGAContests
};