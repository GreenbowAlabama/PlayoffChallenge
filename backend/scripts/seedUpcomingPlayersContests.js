/**
 * One-off script: Seed Upcoming THE PLAYERS Championship Contests
 *
 * Deletes old Arnold Palmer Invitational contests and seeds 4 new platform contests
 * for THE PLAYERS Championship with joinable tokens and full rules.
 */

const crypto = require('crypto');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL must be set');

const pool = new Pool({ connectionString: DATABASE_URL });

const PLATFORM_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000043';
const ENTRY_FEES = [1000, 2000, 2500, 10000]; // cents
const MAX_ENTRIES = 100;

async function seedUpcomingPlayersContests() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('🔒 Transaction started');

    // STEP 1: Delete incorrectly seeded Arnold Palmer contests
    const delResult = await client.query(`
      DELETE FROM contest_instances
      WHERE is_platform_owned = true
        AND contest_name ILIKE 'PGA — Arnold Palmer Invitational%'
      RETURNING id, contest_name
    `);
    console.log(`🗑️ Deleted ${delResult.rowCount} old Arnold Palmer contests`);

    // STEP 2: Locate upcoming THE PLAYERS Championship contest
    const baseRes = await client.query(`
      SELECT *
      FROM contest_instances
      WHERE is_platform_owned = true
        AND contest_name ILIKE '%THE PLAYERS Championship%'
      ORDER BY tournament_start_time ASC
      LIMIT 1
    `);

    if (baseRes.rows.length === 0) {
      throw new Error('No upcoming platform PGA contest found for THE PLAYERS Championship');
    }

    const baseContest = baseRes.rows[0];
    console.log(`📋 Base contest found: ${baseContest.id} (${baseContest.contest_name})`);

    // STEP 3: Seed 4 new platform contests
    const createdContestIds = [];
    for (const fee of ENTRY_FEES) {
      // Skip if a contest already exists with this fee for this template
      const existRes = await client.query(
        `SELECT id FROM contest_instances WHERE entry_fee_cents = $1 AND template_id = $2`,
        [fee, baseContest.template_id]
      );
      if (existRes.rows.length > 0) {
        console.log(`  ⊘ Skipping $${(fee/100).toFixed(2)} contest (already exists)`);
        continue;
      }

      const newContestId = crypto.randomUUID();
      const joinToken = 'stg_' + crypto.randomBytes(16).toString('hex');

      await client.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, tournament_start_time, tournament_end_time,
          lock_time, provider_event_id, max_entries, is_platform_owned, is_system_generated,
          join_token, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())`,
        [
          newContestId,
          baseContest.template_id,
          PLATFORM_SYSTEM_USER_ID,
          fee,
          baseContest.payout_structure,
          'SCHEDULED',
          `${baseContest.contest_name} $${(fee/100).toFixed(0)}`,
          baseContest.tournament_start_time,
          baseContest.tournament_end_time,
          baseContest.lock_time,
          baseContest.provider_event_id,
          MAX_ENTRIES,
          true,
          false,
          joinToken
        ]
      );
      console.log(`  ✓ Created: ${baseContest.contest_name} $${(fee/100).toFixed(0)} (ID: ${newContestId})`);
      createdContestIds.push(newContestId);
    }

    await client.query('COMMIT');
    console.log(`✅ Transaction committed successfully`);
    console.log('Created contest IDs:', createdContestIds);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction rolled back due to error:');
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the script
seedUpcomingPlayersContests();