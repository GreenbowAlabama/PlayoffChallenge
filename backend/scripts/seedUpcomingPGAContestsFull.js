/**
 * Seed Upcoming PGA Contests (Full)
 *
 * Creates 4 platform contests for the next PGA tournament with:
 * - Join URLs
 * - Max entries = 100
 * - Entry fees: 10, 20, 25, 100
 * - Full rules copied from base contest
 * - Preserves existing base contest
 */

const { pool } = require('../server');
const crypto = require('crypto');

const PLATFORM_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

async function seedUpcomingPGAContestsFull() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🔒 Transaction started');

    // Find the upcoming base contest
    const baseRes = await client.query(
      `SELECT *
       FROM contest_instances
       WHERE is_platform_owned = true
       AND contest_name ILIKE '%THE PLAYERS Championship%'
       ORDER BY tournament_start_time
       LIMIT 1`
    );
    if (baseRes.rows.length === 0) {
      throw new Error('No upcoming platform PGA contest found.');
    }
    const base = baseRes.rows[0];
    console.log(`📋 Upcoming base contest found: ${base.id} (${base.contest_name})`);

    const entryFees = [1000, 2000, 2500, 10000]; // cents
    const feeNameMap = { 1000: '$10', 2000: '$20', 2500: '$25', 10000: '$100' };
    const createdContestIds = [];

    for (const fee of entryFees) {
      const contestId = crypto.randomUUID();
      const contestName = `THE PLAYERS Championship ${feeNameMap[fee]}`;
      await client.query(
        `INSERT INTO contest_instances (
           id, template_id, organizer_id, entry_fee_cents, payout_structure,
           status, contest_name, tournament_start_time, tournament_end_time,
           lock_time, provider_event_id, max_entries, is_platform_owned, is_system_generated
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
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
          100,
          true,
          false
        ]
      );
      createdContestIds.push(contestId);
      console.log(`  ✓ Created: ${contestName} (ID: ${contestId})`);
    }

    await client.query('COMMIT');
    console.log('✅ Transaction committed successfully');
    console.log('Created contest IDs:', createdContestIds);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction rolled back due to error:', err);
    throw err;
  } finally {
    client.release();
  }
}

seedUpcomingPGAContestsFull()
  .then(() => process.exit())
  .catch(() => process.exit(1));

