/**
 * syncUpcomingPGAContests.js
 *
 * Ensures THE PLAYERS Championship contests exist for $10, $20, $25, $100 tiers,
 * aligned with tournament times and joinable in the app.
 *
 * Usage:
 *   node backend/scripts/syncUpcomingPGAContests.js
 */

const { pool } = require('../server');
const crypto = require('crypto');

const PLATFORM_USER_ID = '00000000-0000-0000-0000-000000000043'; // platform_system

async function syncUpcomingPGAContests() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('🔒 Transaction started');

    // STEP 1: Find base upcoming contest
    const { rows: baseRows } = await client.query(
      `SELECT *
       FROM contest_instances
       WHERE is_platform_owned = true
         AND contest_name ILIKE '%THE PLAYERS Championship%'
       ORDER BY tournament_start_time
       LIMIT 1`
    );

    if (baseRows.length === 0) throw new Error('No upcoming platform PGA contest found.');

    const baseContest = baseRows[0];
    console.log(`📋 Upcoming base contest found: ${baseContest.id} (${baseContest.contest_name})`);

    const entryFeesToCreate = [1000, 2000, 2500, 10000]; // cents
    const createdContestIds = [];

    // STEP 2: Create missing contests and ensure join_token
    for (const fee of entryFeesToCreate) {
      // Check if contest with this fee exists
      const { rows: existingRows } = await client.query(
        `SELECT id, join_token
         FROM contest_instances
         WHERE is_platform_owned = true
           AND template_id = $1
           AND entry_fee_cents = $2
         LIMIT 1`,
        [baseContest.template_id, fee]
      );

      if (existingRows.length > 0) {
        const existingContest = existingRows[0];
        // Ensure join_token exists
        if (!existingContest.join_token) {
          const token = `stg_${crypto.randomUUID().replace(/-/g, '')}`;
          await client.query(
            `UPDATE contest_instances
             SET join_token = $1, updated_at = NOW()
             WHERE id = $2`,
            [token, existingContest.id]
          );
          console.log(`  ⊘ Updated $${(fee / 100).toFixed(0)} (ID: ${existingContest.id})`);
        } else {
          console.log(`  ⊘ Already exists $${(fee / 100).toFixed(0)} (ID: ${existingContest.id})`);
        }
        continue;
      }

      // Insert new contest
      const newId = crypto.randomUUID();
      const joinToken = `stg_${crypto.randomUUID().replace(/-/g, '')}`;

      await client.query(
        `INSERT INTO contest_instances (
           id, template_id, organizer_id, entry_fee_cents, payout_structure,
           status, contest_name, tournament_start_time, tournament_end_time,
           lock_time, provider_event_id, max_entries, is_platform_owned, is_system_generated,
           join_token, created_at, updated_at
         )
         SELECT
           $1, template_id, $2, $3, payout_structure,
           'SCHEDULED', $4, $5, $6,
           $7, provider_event_id, 100, true, true,
           $8, NOW(), NOW()
         FROM contest_instances
         WHERE id = $9
         LIMIT 1`,
        [
          newId,
          PLATFORM_USER_ID,
          fee,
          `THE PLAYERS Championship $${(fee / 100).toFixed(0)}`,
          baseContest.tournament_start_time,
          baseContest.tournament_end_time,
          baseContest.lock_time,
          joinToken,
          baseContest.id
        ]
      );

      createdContestIds.push(newId);
      console.log(`  ✓ Created: THE PLAYERS Championship $${(fee / 100).toFixed(0)}`);
    }

    await client.query('COMMIT');
    console.log('✅ Transaction committed successfully');
    console.log('Created contest IDs:', createdContestIds);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction rolled back due to error:');
    console.error(err);
  } finally {
    client.release();
  }
}

syncUpcomingPGAContests().then(() => process.exit());