#!/usr/bin/env node
/**
 * Settlement & Payout Debug Inspector
 *
 * Traces settlement and payout orchestration phases separately.
 * Requires explicit DATABASE_URL. No fallbacks.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node backend/debug/inspectSettlementInputs.js <contestInstanceId>
 *
 * Output:
 *   - Phase 1: Settlement execution (transitionLiveToComplete)
 *   - Phase 2: Payout orchestration (separate service)
 *   - Diagnosis matrix (root cause identification)
 */

const { Pool } = require('pg');

const contestInstanceId = process.argv[2];

// Step 1: Require explicit DATABASE_URL
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required.');
  console.error('Usage: DATABASE_URL=postgresql://... node backend/debug/inspectSettlementInputs.js <contestInstanceId>');
  process.exit(1);
}

if (!contestInstanceId) {
  console.error('ERROR: Contest instance ID is required.');
  console.error('Usage: DATABASE_URL=postgresql://... node backend/debug/inspectSettlementInputs.js <contestInstanceId>');
  process.exit(1);
}

async function inspectSettlement(contestId) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000
  });

  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`SETTLEMENT & PAYOUT DEBUG: ${contestId}`);
    console.log(`${'='.repeat(80)}\n`);

    // ==================================================================
    // PHASE 1: SETTLEMENT EXECUTION (transitionLiveToComplete)
    // ==================================================================
    console.log('PHASE 1: SETTLEMENT EXECUTION\n');

    // 1a. Contest state
    console.log('1a. Contest State');
    const contestResult = await pool.query(
      `SELECT id, status, entry_fee_cents, payout_structure,
              tournament_start_time, tournament_end_time, settle_time,
              template_id
       FROM contest_instances
       WHERE id = $1`,
      [contestId]
    );

    if (contestResult.rows.length === 0) {
      console.error(`ERROR: Contest ${contestId} not found in contest_instances`);
      process.exit(1);
    }

    const contest = contestResult.rows[0];
    console.log(`   ID: ${contest.id}`);
    console.log(`   Status: ${contest.status}`);
    console.log(`   Entry Fee: ${contest.entry_fee_cents} cents`);
    console.log(`   Payout Structure: ${JSON.stringify(contest.payout_structure)}`);
    console.log(`   Tournament End: ${contest.tournament_end_time}`);
    console.log(`   Settle Time: ${contest.settle_time || '(not set)'}`);
    console.log(`   Template ID: ${contest.template_id}`);

    // 1b. Final snapshot presence
    console.log('\n1b. Final Snapshot (event_data_snapshots with provider_final_flag=true)');
    const snapshotResult = await pool.query(
      `SELECT id, snapshot_hash, ingested_at
       FROM event_data_snapshots
       WHERE contest_instance_id = $1 AND provider_final_flag = true
       ORDER BY ingested_at DESC LIMIT 1`,
      [contestId]
    );

    const snapshotExists = snapshotResult.rows.length > 0;
    if (snapshotExists) {
      const snapshot = snapshotResult.rows[0];
      console.log(`   ✅ Found: ${snapshot.id}`);
      console.log(`      Hash: ${snapshot.snapshot_hash}`);
      console.log(`      Ingested: ${snapshot.ingested_at}`);
    } else {
      console.log(`   ❌ NOT FOUND`);
    }

    // 1c. Participant count
    console.log('\n1c. Participants (contest_participants)');
    const participantResult = await pool.query(
      `SELECT COUNT(*) as participant_count
       FROM contest_participants
       WHERE contest_instance_id = $1`,
      [contestId]
    );

    const participantCount = participantResult.rows[0].participant_count;
    console.log(`   Count: ${participantCount}`);

    // 1d. Entry rosters
    console.log('\n1d. Entry Rosters (entry_rosters.contest_instance_id)');
    const rosterResult = await pool.query(
      `SELECT COUNT(*) as roster_count
       FROM entry_rosters
       WHERE contest_instance_id = $1`,
      [contestId]
    );

    const rosterCount = rosterResult.rows[0].roster_count;
    console.log(`   Count: ${rosterCount}`);

    // 1e. Golfer scores
    console.log('\n1e. Golfer Scores (golfer_scores.contest_instance_id)');
    const scoringResult = await pool.query(
      `SELECT COUNT(*) as score_count,
              COUNT(DISTINCT user_id) as unique_users
       FROM golfer_scores
       WHERE contest_instance_id = $1`,
      [contestId]
    );

    const scoreCount = scoringResult.rows[0].score_count;
    const uniqueUsers = scoringResult.rows[0].unique_users;
    console.log(`   Rows: ${scoreCount}`);
    console.log(`   Unique Users: ${uniqueUsers}`);

    // 1f. Settlement record
    console.log('\n1f. Settlement Record (settlement_records.contest_instance_id)');
    const settlementResult = await pool.query(
      `SELECT id, participant_count, total_pool_cents, settled_at, settlement_version
       FROM settlement_records
       WHERE contest_instance_id = $1`,
      [contestId]
    );

    const settlementExists = settlementResult.rows.length > 0;
    if (settlementExists) {
      const settlement = settlementResult.rows[0];
      console.log(`   ✅ Found: ${settlement.id}`);
      console.log(`      Participants: ${settlement.participant_count}`);
      console.log(`      Total Pool: ${settlement.total_pool_cents} cents`);
      console.log(`      Settled At: ${settlement.settled_at}`);
      console.log(`      Version: ${settlement.settlement_version}`);
    } else {
      console.log(`   ❌ NOT FOUND`);
    }

    // 1g. PRIZE_PAYOUT ledger entries (check both contest_instance_id AND reference_id)
    console.log('\n1g. PRIZE_PAYOUT Ledger Entries');

    // Raw row sample first
    const rawRowsResult = await pool.query(
      `SELECT id, user_id, amount_cents, reference_type, reference_id, contest_instance_id
       FROM ledger
       WHERE entry_type = 'PRIZE_PAYOUT'
         AND (
           contest_instance_id = $1
           OR (reference_type = 'CONTEST' AND reference_id = $1)
         )
       ORDER BY created_at ASC
       LIMIT 10`,
      [contestId]
    );

    console.log('\n   RAW ROW SAMPLE (first 10 rows):');
    if (rawRowsResult.rows.length === 0) {
      console.log('   (no rows found)');
    } else {
      rawRowsResult.rows.forEach((row, idx) => {
        console.log(`   Row ${idx + 1}:`);
        console.log(`     id: ${row.id}`);
        console.log(`     user_id: ${row.user_id}`);
        console.log(`     amount_cents: ${row.amount_cents}`);
        console.log(`     reference_type: ${row.reference_type}`);
        console.log(`     reference_id: ${row.reference_id}`);
        console.log(`     contest_instance_id: ${row.contest_instance_id}`);
      });
    }

    // Count aggregation
    const payoutLedgerResult = await pool.query(
      `SELECT
         COUNT(*) as total_count,
         SUM(CASE WHEN contest_instance_id = $1 THEN 1 ELSE 0 END) as via_contest_instance_id,
         SUM(CASE WHEN reference_type = 'CONTEST' AND reference_id = $1 THEN 1 ELSE 0 END) as via_reference_id,
         COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents
                           WHEN direction = 'DEBIT' THEN -amount_cents
                           ELSE 0 END), 0) as total_credited
       FROM ledger
       WHERE entry_type = 'PRIZE_PAYOUT'
         AND (
           contest_instance_id = $1
           OR (reference_type = 'CONTEST' AND reference_id = $1)
         )`,
      [contestId]
    );

    const payoutLedgerTotal = payoutLedgerResult.rows[0].total_count || 0;
    const viaContestInstanceId = payoutLedgerResult.rows[0].via_contest_instance_id || 0;
    const viaReferenceId = payoutLedgerResult.rows[0].via_reference_id || 0;
    const totalCredited = payoutLedgerResult.rows[0].total_credited || 0;

    console.log('\n   COUNTS:');
    console.log(`   Total Entries: ${payoutLedgerTotal}`);
    console.log(`   Via contest_instance_id: ${viaContestInstanceId}`);
    console.log(`   Via reference_id (CONTEST): ${viaReferenceId}`);
    console.log(`   Total Credited: ${totalCredited} cents`);

    // 1h. State transition to COMPLETE
    console.log('\n1h. State Transition (LIVE → COMPLETE)');
    const transitionResult = await pool.query(
      `SELECT from_state, to_state, triggered_by, created_at
       FROM contest_state_transitions
       WHERE contest_instance_id = $1 AND from_state = 'LIVE' AND to_state = 'COMPLETE'
       ORDER BY created_at DESC LIMIT 1`,
      [contestId]
    );

    if (transitionResult.rows.length > 0) {
      const transition = transitionResult.rows[0];
      console.log(`   ✅ Found transition`);
      console.log(`      Triggered: ${transition.triggered_by}`);
      console.log(`      At: ${transition.created_at}`);
    } else {
      console.log(`   ❌ NOT FOUND`);
    }

    // ==================================================================
    // PHASE 2: PAYOUT ORCHESTRATION (separate service)
    // ==================================================================
    console.log('\n\n' + '='.repeat(80));
    console.log('PHASE 2: PAYOUT ORCHESTRATION\n');

    // 2a. Payout jobs (uses contest_id NOT contest_instance_id)
    console.log('2a. Payout Jobs (payout_jobs.contest_id)');
    const payoutJobsResult = await pool.query(
      `SELECT id, settlement_id, status, total_payouts, completed_count, failed_count,
              started_at, completed_at, created_at
       FROM payout_jobs
       WHERE contest_id = $1`,
      [contestId]
    );

    const jobCount = payoutJobsResult.rows.length;
    console.log(`   Jobs found: ${jobCount}`);
    if (jobCount > 0) {
      payoutJobsResult.rows.forEach((job, idx) => {
        console.log(`\n   Job ${idx + 1}:`);
        console.log(`      ID: ${job.id}`);
        console.log(`      Status: ${job.status}`);
        console.log(`      Total Payouts: ${job.total_payouts}`);
        console.log(`      Completed: ${job.completed_count}`);
        console.log(`      Failed: ${job.failed_count}`);
        console.log(`      Created: ${job.created_at}`);
      });
    }

    // 2b. Payout transfers (uses contest_id NOT contest_instance_id)
    console.log('\n2b. Payout Transfers (payout_transfers.contest_id)');
    const transfersResult = await pool.query(
      `SELECT COUNT(*) as transfer_count,
              COALESCE(SUM(amount_cents), 0) as total_amount,
              COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
              COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
              COUNT(CASE WHEN status = 'failed_terminal' THEN 1 END) as failed_count
       FROM payout_transfers
       WHERE contest_id = $1`,
      [contestId]
    );

    const transferCount = transfersResult.rows[0].transfer_count;
    const transferTotal = transfersResult.rows[0].total_amount;
    const completedCount = transfersResult.rows[0].completed_count;
    const pendingCount = transfersResult.rows[0].pending_count;
    const failedCount = transfersResult.rows[0].failed_count;

    console.log(`   Total Transfers: ${transferCount}`);
    console.log(`   Total Amount: ${transferTotal} cents`);
    console.log(`   Completed: ${completedCount}`);
    console.log(`   Pending: ${pendingCount}`);
    console.log(`   Failed: ${failedCount}`);

    // ==================================================================
    // DIAGNOSIS MATRIX
    // ==================================================================
    console.log('\n\n' + '='.repeat(80));
    console.log('DIAGNOSIS MATRIX\n');

    console.log('Condition Check:');

    // Check 1: Settlement executed?
    const settlementPhase = settlementExists ? '✅' : '❌';
    console.log(`${settlementPhase} Settlement executed (settlement_records exists)`);

    // Check 2: PRIZE_PAYOUT ledger written?
    const payoutLedgerPhase = payoutLedgerTotal > 0 ? '✅' : '❌';
    console.log(`${payoutLedgerPhase} PRIZE_PAYOUT ledger entries written (${payoutLedgerTotal} entries)`);
    if (payoutLedgerTotal > 0) {
      console.log(`   - Via contest_instance_id: ${viaContestInstanceId}`);
      console.log(`   - Via reference_id: ${viaReferenceId}`);
    }

    // Check 3: PRIZE_PAYOUT amounts non-zero?
    const payoutAmountsOk = totalCredited > 0 ? '✅' : '❌';
    console.log(`${payoutAmountsOk} PRIZE_PAYOUT amounts > 0 (${totalCredited} cents total)`);

    // Check 4: State transition executed?
    const stateTransitionOk = transitionResult.rows.length > 0 ? '✅' : '❌';
    console.log(`${stateTransitionOk} LIVE → COMPLETE state transition recorded`);

    // Check 5: Payout orchestration ran?
    const orchestrationRan = jobCount > 0 && transferCount > 0 ? '✅' : '❌';
    console.log(`${orchestrationRan} Payout orchestration executed (${jobCount} jobs, ${transferCount} transfers)`);

    // Check 6: Payout transfer amounts non-zero?
    const transferAmountsOk = transferTotal > 0 ? '✅' : '❌';
    console.log(`${transferAmountsOk} Payout transfer amounts > 0 (${transferTotal} cents total)`);

    console.log('\n\nRoot Cause Analysis:');

    if (!settlementExists) {
      console.log('❌ Settlement never executed (no settlement_records entry)');
      console.log('   Check:');
      console.log(`     - Snapshot exists: ${snapshotExists}`);
      console.log(`     - Status is LIVE: ${contest.status === 'LIVE'}`);
      console.log(`     - Tournament end time reached: ${contest.tournament_end_time}`);
    } else if (payoutLedgerTotal === 0) {
      console.log('❌ CRITICAL: Settlement executed but NO PRIZE_PAYOUT ledger entries');
      console.log('   State A: Rows written with amount_cents = 0?');
      console.log('            Check query results above for counts');
      console.log('   State B: No rows written at all?');
      console.log('            Possible: settlementPlan.payouts is empty');
      console.log('            OR payout_structure is empty/null');
      console.log(`   Current payout_structure: ${JSON.stringify(contest.payout_structure)}`);
    } else if (totalCredited > 0 && payoutLedgerTotal > 0) {
      console.log('✅ PRIZE_PAYOUT ledger entries exist with non-zero amounts');
      if (jobCount === 0) {
        console.log('⚠️  But payout orchestration NOT run yet');
        console.log('   Note: This is expected separation of concerns');
        console.log('   Action: PayoutOrchestrationService.schedulePayoutForSettlement() must be called');
      }
    } else if (jobCount === 0) {
      console.log('⚠️  Settlement complete but payout orchestration NOT run');
      console.log('   Note: This is expected separation of concerns');
      console.log('   Action: PayoutOrchestrationService.schedulePayoutForSettlement() must be called');
      console.log('          OR scheduled as separate background job after settlement');
    } else if (transferCount === 0) {
      console.log('❌ Payout jobs created but no payout_transfers expanded');
      console.log('   Likely: PayoutTransfersRepository.insertTransfers() failed');
    } else if (transferTotal === 0) {
      console.log('❌ Payout transfers exist but all amounts are zero');
      console.log('   Likely: Payout expansion copied zero amounts from settlement');
    } else {
      console.log('✅ All phases complete and healthy');
    }

    console.log('\n' + '='.repeat(80) + '\n');

  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

inspectSettlement(contestInstanceId);
