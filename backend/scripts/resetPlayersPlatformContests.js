/**
 * Reset Players Platform Contests
 *
 * - Soft-cancels old platform PGA contests
 * - Seeds 4 new joinable platform contests for the upcoming PGA event
 *
 * Run with:
 *   node -e "require('./backend/scripts/resetPlayersPlatformContests')()"
 */

const crypto = require('crypto');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const pool = new Pool({ connectionString: DATABASE_URL });

// Platform system user ID
const PLATFORM_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000043';

async function resetPlayersPlatformContests() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('🔒 Transaction started');

    // STEP 1: Soft-cancel old platform PGA contests
    const oldContests = await client.query(`
      SELECT id, contest_name
      FROM contest_instances
      WHERE is_platform_owned = true
        AND contest_name ILIKE '%THE PLAYERS Championship%'
    `);

    for (const contest of oldContests.rows) {
      await client.query(
        `UPDATE contest_instances
         SET status = 'CANCELLED', updated_at = NOW()
         WHERE id = $1`,
        [contest.id]
      );
      console.log(`🚫 Soft-cancelled: ${contest.contest_name}`);
    }

    // STEP 2: Identify upcoming base PGA contest
    const baseContestResult = await client.query(`
      SELECT *
      FROM contest_instances
      WHERE is_platform_owned = true
        AND status = 'SCHEDULED'
        AND contest_name ILIKE '%THE PLAYERS Championship%'
      ORDER BY tournament_start_time ASC
      LIMIT 1
    `);

    if (baseContestResult.rows.length === 0) {
      throw new Error('No upcoming platform PGA contest found.');
    }

    const baseContest = baseContestResult.rows[0];
    console.log(`📋 Upcoming base contest: ${baseContest.id} (${baseContest.contest_name})`);

    // STEP 3: Seed 4 new contests with varying entry fees
    const entryFees = [1000, 2000, 2500, 10000]; // in cents
    const feeNameMap = { 1000: '$10', 2000: '$20', 2500: '$25', 10000: '$100' };
    const createdContestIds = [];

    for (const fee of entryFees) {
      const contestName = `THE PLAYERS Championship ${feeNameMap[fee]}`;
      const newContestId = crypto.randomUUID();
      const joinToken = `stg_${crypto.randomUUID().replace(/-/g, '')}`;

      await client.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, tournament_start_time, tournament_end_time,
          lock_time, provider_event_id, max_entries, is_platform_owned,
          is_system_generated, join_token, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())`,
        [
          newContestId,
          baseContest.template_id,
          PLATFORM_SYSTEM_USER_ID,
          fee,
          baseContest.payout_structure,
          'SCHEDULED',
          contestName,
          baseContest.tournament_start_time,
          baseContest.tournament_end_time,
          baseContest.lock_time,
          baseContest.provider_event_id,
          100, // max_entries
          true, // is_platform_owned
          true, // is_system_generated
          joinToken
        ]
      );
      createdContestIds.push({ id: newContestId, name: contestName, joinToken });
      console.log(`✅ Created: ${contestName} (fee: ${fee}) joinToken: ${joinToken}`);
    }

    await client.query('COMMIT');
    console.log('✅ Transaction committed successfully');
    console.log('Created contest IDs:', createdContestIds);
    return createdContestIds;

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction rolled back due to error:');
    console.error(err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Allow running directly with node
if (require.main === module) {
  resetPlayersPlatformContests()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = resetPlayersPlatformContests;