/**
 * Repair Script: Fix Contests Incorrectly Marked LIVE Due to start_time Bug
 *
 * Purpose:
 * Reset contests incorrectly marked as LIVE when their tournament_start_time is in the future.
 * This occurs when start_time is set during discovery creation and the advanceContestLifecycleIfNeeded
 * logic incorrectly uses start_time instead of tournament_start_time for state transitions.
 *
 * Issue:
 * - Discovery creates contests with status = SCHEDULED
 * - Lifecycle engine should use tournament_start_time to transition SCHEDULED→LOCKED→LIVE
 * - Bug: advanceContestLifecycleIfNeeded was checking start_time instead of tournament_start_time
 * - Result: Any contest with start_time <= now would incorrectly transition to LIVE immediately
 *
 * Fix:
 * This script identifies and repairs contests in LIVE state whose tournament_start_time is in the future.
 * These contests should have remained in SCHEDULED or LOCKED state.
 *
 * Usage:
 * node backend/scripts/repairIncorrectContestStartTimes.js [--dryrun]
 *
 * --dryrun: Show what would be repaired without making changes
 *
 * This is a manual operational tool. It is not automatically executed.
 */

const pg = require('pg');

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL
  });

  const dryRun = process.argv.includes('--dryrun');

  if (dryRun) {
    console.log('[DRY RUN] Simulation mode - no changes will be made\n');
  }

  try {
    // Find all contests incorrectly in LIVE state with future tournament_start_time
    const findResult = await pool.query(
      `SELECT id, status, tournament_start_time, lock_time, start_time, contest_name
       FROM contest_instances
       WHERE status = 'LIVE'
         AND tournament_start_time IS NOT NULL
         AND tournament_start_time > NOW()
       ORDER BY tournament_start_time ASC`
    );

    if (findResult.rows.length === 0) {
      console.log('✓ No contests need repair (no LIVE contests with future tournament_start_time)');
      await pool.end();
      return;
    }

    console.log(`Found ${findResult.rows.length} contest(s) needing repair:\n`);

    findResult.rows.forEach((contest, idx) => {
      console.log(`${idx + 1}. ${contest.contest_name}`);
      console.log(`   Contest ID: ${contest.id}`);
      console.log(`   Current Status: ${contest.status}`);
      console.log(`   Tournament Start: ${contest.tournament_start_time}`);
      console.log(`   Lock Time: ${contest.lock_time}`);
      console.log(`   Start Time: ${contest.start_time}`);
      console.log('');
    });

    if (dryRun) {
      console.log(`[DRY RUN] Would repair ${findResult.rows.length} contest(s)`);
      console.log('Run without --dryrun flag to execute repairs\n');
      await pool.end();
      return;
    }

    // Execute repair for each contest
    let repaired = 0;
    let failed = 0;

    for (const contest of findResult.rows) {
      try {
        const client = await pool.connect();

        try {
          await client.query('BEGIN');

          // Determine correct state based on timestamps
          const now = new Date();
          let correctStatus = 'SCHEDULED';

          // If lock_time has passed, should be at least LOCKED
          if (contest.lock_time && contest.lock_time <= now) {
            correctStatus = 'LOCKED';
          }

          // Reset contest to correct state
          const updateResult = await client.query(
            `UPDATE contest_instances
             SET status = $1,
                 start_time = NULL,
                 updated_at = NOW()
             WHERE id = $2
             RETURNING id, status`,
            [correctStatus, contest.id]
          );

          if (updateResult.rows.length === 0) {
            throw new Error('Contest not found during update');
          }

          // Record repair in audit trail
          await client.query(
            `INSERT INTO admin_contest_audit (
              contest_instance_id, admin_user_id, action, reason,
              from_status, to_status, payload
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              contest.id,
              SYSTEM_USER_ID,
              'REPAIR_INCORRECT_LIVE_STATE',
              'Repaired contest incorrectly marked LIVE due to start_time bug',
              'LIVE',
              correctStatus,
              JSON.stringify({
                reason: 'Tournament start time in future; reset to correct state',
                tournament_start_time: contest.tournament_start_time,
                lock_time: contest.lock_time,
                repaired_at: new Date().toISOString()
              })
            ]
          );

          await client.query('COMMIT');

          console.log(`✓ Repaired: ${contest.contest_name} → ${correctStatus}`);
          repaired++;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      } catch (err) {
        console.error(`✗ Failed to repair ${contest.id}: ${err.message}`);
        failed++;
      }
    }

    console.log(`\nRepair complete: ${repaired} repaired, ${failed} failed`);
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
