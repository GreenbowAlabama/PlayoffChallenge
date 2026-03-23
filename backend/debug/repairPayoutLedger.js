#!/usr/bin/env node

/**
 * Repair Payout Ledger
 *
 * GOAL:
 * - Remove all PRIZE_PAYOUT ledger entries
 * - Reinsert ONLY for payout_transfers with status='completed'
 *
 * SAFETY:
 * - Dry-run by default (no mutations)
 * - Requires explicit --confirm flag
 * - Wrapped in transaction (rollback on error)
 * - Idempotent via idempotency_key = payout:${transfer_id}
 *
 * Exit Codes:
 * - 0: Success
 * - 1: Error or dry-run
 * - 2: Missing --confirm flag
 */

const { Pool } = require('pg');

// Require DATABASE_URL
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

// Parse flags
const args = process.argv.slice(2);
const isDryRun = !args.includes('--confirm');
const confirm = args.includes('--confirm');

if (isDryRun) {
  console.log('\n⚠️  DRY RUN MODE (no changes will be made)');
  console.log('Use --confirm flag to apply repairs\n');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function repairPayoutLedger() {
  let client;
  try {
    // Show database target
    const dbHost = process.env.DATABASE_URL.split('@')[1] || 'unknown';
    console.log(`Database: ${dbHost}`);
    console.log('');

    client = await pool.connect();

    if (isDryRun) {
      // DRY RUN: Count what would be deleted/inserted
      console.log('--- DRY RUN ANALYSIS ---\n');

      // Count existing PRIZE_PAYOUT entries
      const existingResult = await client.query(
        `SELECT COUNT(*) as count
         FROM ledger
         WHERE entry_type = 'PRIZE_PAYOUT'
           AND reference_type = 'CONTEST'`
      );

      const existingCount = parseInt(existingResult.rows[0].count);
      console.log(`PRIZE_PAYOUT entries to delete: ${existingCount}`);

      // Count completed transfers
      const completedResult = await client.query(
        `SELECT
           COUNT(*) as count,
           COALESCE(SUM(amount_cents), 0) as total_cents
         FROM payout_transfers
         WHERE status = 'completed'`
      );

      const completedCount = parseInt(completedResult.rows[0].count);
      const completedCents = parseInt(completedResult.rows[0].total_cents);

      console.log(`PRIZE_PAYOUT entries to insert: ${completedCount}`);
      console.log(`Total cents to reinsert: ${completedCents}\n`);

      console.log('To apply repairs, run with --confirm flag:\n');
      console.log(`  node backend/debug/repairPayoutLedger.js --confirm\n`);

      process.exit(1);
    }

    // ACTUAL REPAIR (with --confirm)
    console.log('--- APPLYING REPAIRS ---\n');

    await client.query('BEGIN');

    try {
      // Step 1: Delete all PRIZE_PAYOUT entries
      const deleteResult = await client.query(
        `DELETE FROM ledger
         WHERE entry_type = 'PRIZE_PAYOUT'
           AND reference_type = 'CONTEST'`
      );

      const deletedCount = deleteResult.rowCount;
      console.log(`✓ Deleted ${deletedCount} PRIZE_PAYOUT entries`);

      // Step 2: Query all completed transfers
      const transfersResult = await client.query(
        `SELECT id, contest_id, user_id, amount_cents
         FROM payout_transfers
         WHERE status = 'completed'
         ORDER BY created_at ASC`
      );

      const transfers = transfersResult.rows;
      let insertedCount = 0;
      let totalCents = 0;

      // Step 3: Reinsert PRIZE_PAYOUT for completed transfers
      for (const transfer of transfers) {
        const idempotencyKey = `payout:${transfer.id}`;

        const insertResult = await client.query(
          `INSERT INTO ledger (
             user_id,
             entry_type,
             direction,
             amount_cents,
             reference_type,
             reference_id,
             idempotency_key,
             created_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            transfer.user_id,
            'PRIZE_PAYOUT',
            'CREDIT',
            transfer.amount_cents,
            'CONTEST',
            transfer.contest_id,
            idempotencyKey
          ]
        );

        if (insertResult.rowCount > 0) {
          insertedCount += 1;
          totalCents += transfer.amount_cents;
        }
      }

      console.log(`✓ Inserted ${insertedCount} PRIZE_PAYOUT entries`);
      console.log(`✓ Total cents repaired: ${totalCents}\n`);

      await client.query('COMMIT');

      console.log('--- SUMMARY ---');
      console.log(`Deleted rows:   ${deletedCount}`);
      console.log(`Inserted rows:  ${insertedCount}`);
      console.log(`Total cents:    ${totalCents}\n`);

      console.log('✓ Repair complete\n');
      process.exit(0);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

repairPayoutLedger();
