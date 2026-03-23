#!/usr/bin/env node

/**
 * Validate Payout Ledger Invariant
 *
 * Verifies that PRIZE_PAYOUT ledger credits equal completed payout_transfers,
 * per contest.
 *
 * Exit Code:
 * - 0: All contests valid (no drift)
 * - 1: Any contest has drift
 *
 * Safety:
 * - Read-only only
 * - No writes, deletes, or updates
 */

const { Pool } = require('pg');

// Require DATABASE_URL
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function validatePayoutInvariant() {
  let client;
  try {
    // STEP 4: Operator safety - show which database we're validating
    const dbHost = process.env.DATABASE_URL.split('@')[1] || 'unknown';
    console.log(`\nDatabase: ${dbHost}`);
    console.log('');

    client = await pool.connect();

    // Single query to get all contests with payout activity
    // and their ledger/transfer totals
    const result = await client.query(`
      WITH payout_contests AS (
        -- Find all contest IDs that have PRIZE_PAYOUT ledger entries
        SELECT DISTINCT reference_id as contest_id FROM ledger
        WHERE entry_type = 'PRIZE_PAYOUT'
          AND reference_type = 'CONTEST'

        UNION

        -- Find all contest IDs that have payout_transfers
        SELECT DISTINCT contest_id FROM payout_transfers
      ),
      ledger_totals AS (
        SELECT
          reference_id as contest_id,
          COALESCE(SUM(
            CASE
              WHEN direction = 'CREDIT' THEN amount_cents
              WHEN direction = 'DEBIT' THEN -amount_cents
              ELSE 0
            END
          ), 0) as total_cents
        FROM ledger
        WHERE entry_type IN ('PRIZE_PAYOUT', 'PRIZE_PAYOUT_REVERSAL')
          AND reference_type = 'CONTEST'
          AND reference_id IN (SELECT contest_id FROM payout_contests)
        GROUP BY reference_id
      ),
      transfer_totals AS (
        SELECT
          contest_id,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN amount_cents ELSE 0 END), 0) as completed_cents,
          COALESCE(SUM(CASE WHEN status IN ('pending', 'processing') THEN amount_cents ELSE 0 END), 0) as pending_cents,
          COALESCE(SUM(CASE WHEN status = 'failed_terminal' THEN amount_cents ELSE 0 END), 0) as failed_cents
        FROM payout_transfers
        WHERE contest_id IN (SELECT contest_id FROM payout_contests)
        GROUP BY contest_id
      )
      SELECT
        pc.contest_id,
        COALESCE(lt.total_cents, 0) as ledger_payout_cents,
        COALESCE(tt.completed_cents, 0) as completed_cents,
        COALESCE(tt.pending_cents, 0) as pending_cents,
        COALESCE(tt.failed_cents, 0) as failed_cents,
        COALESCE(lt.total_cents, 0) - COALESCE(tt.completed_cents, 0) as drift_cents
      FROM payout_contests pc
      LEFT JOIN ledger_totals lt ON pc.contest_id = lt.contest_id
      LEFT JOIN transfer_totals tt ON pc.contest_id = tt.contest_id
      ORDER BY pc.contest_id
    `);

    const contests = result.rows;

    if (contests.length === 0) {
      console.log('No contests with payout activity found.\n');
      console.log('Summary:');
      console.log('  contests_checked: 0');
      console.log('  contests_ok: 0');
      console.log('  contests_with_drift: 0');
      console.log('  total_ledger_payout_cents: 0');
      console.log('  total_completed_transfer_cents: 0');
      console.log('  total_drift_cents: 0');
      console.log('\nStatus: OK\n');
      process.exit(0);
    }

    // Print header
    console.log('');
    console.log('Payout Ledger Invariant Validation');
    console.log('===================================\n');
    console.log(
      'contest_id                           ' +
      'ledger    completed  pending    failed     drift      status'
    );
    console.log('-'.repeat(100));

    // Process each contest
    let contestsOk = 0;
    let contestsWithDrift = 0;
    let totalLedgerPayouts = 0;
    let totalCompletedTransfers = 0;
    let totalDrift = 0;
    let totalPendingCents = 0;
    let totalFailedCents = 0;

    for (const contest of contests) {
      const {
        contest_id,
        ledger_payout_cents,
        completed_cents,
        pending_cents,
        failed_cents,
        drift_cents
      } = contest;

      // STEP 2: Distinguish failure modes
      const ledger = Number(ledger_payout_cents);
      const completed = Number(completed_cents);
      const drift = ledger - completed;

      let status = 'OK';

      if (drift !== 0) {
        if (ledger > completed) {
          status = 'OVERPAY';
        } else {
          status = 'UNDERPAY';
        }
      }

      if (drift === 0) {
        contestsOk += 1;
      } else {
        contestsWithDrift += 1;
      }

      totalLedgerPayouts += ledger;
      totalCompletedTransfers += completed;
      totalDrift += drift;
      totalPendingCents += pending_cents;
      totalFailedCents += failed_cents;

      // Format as: UUID (8 chars) + amounts (right-aligned, 10 chars each)
      const shortId = contest_id.substring(0, 8);
      const line = `${shortId}...                             ${
        String(ledger_payout_cents).padStart(9, ' ')
      } ${
        String(completed_cents).padStart(9, ' ')
      } ${
        String(pending_cents).padStart(9, ' ')
      } ${
        String(failed_cents).padStart(9, ' ')
      } ${
        String(drift_cents).padStart(9, ' ')
      }  ${status}`;

      console.log(line);
    }

    console.log('-'.repeat(100));
    console.log('');
    console.log('Summary:');
    console.log(`  contests_checked: ${contests.length}`);
    console.log(`  contests_ok: ${contestsOk}`);
    console.log(`  contests_with_drift: ${contestsWithDrift}`);
    console.log(`  total_ledger_payout_cents: ${totalLedgerPayouts}`);
    console.log(`  total_completed_transfer_cents: ${totalCompletedTransfers}`);
    console.log(`  total_drift_cents: ${totalDrift}`);
    console.log(`  active_transfers_present: ${totalPendingCents > 0 || totalFailedCents > 0}`);
    console.log('');

    // STEP 3: Hard fail on OVERPAY (financial breach)
    const hasOverpay = contests.some(c => c.ledger_payout_cents > c.completed_cents);

    if (hasOverpay) {
      console.error('CRITICAL: OVERPAY DETECTED');
      console.error('Users credited without completed transfers.');
      console.error('Exit code: 2 (Financial breach)\n');
      process.exit(2);
    }

    if (contestsWithDrift === 0) {
      console.log('Status: OK\n');
      process.exit(0);
    } else {
      console.log(`Status: DRIFT DETECTED (${contestsWithDrift} contest(s))\n`);
      process.exit(1);
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

validatePayoutInvariant();
