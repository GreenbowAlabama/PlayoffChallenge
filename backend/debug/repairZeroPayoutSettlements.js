#!/usr/bin/env node

/**
 * REPAIR SCRIPT: Zero-Payout Settlement Bug Fix
 *
 * Purpose:
 * Repairs settled contests where all PRIZE_PAYOUT ledger entries are 0.
 *
 * CRITICAL: Recomputes payouts from scratch using settlementStrategy.
 * Does NOT use corrupted settlement_records.results.payouts.
 *
 * Flow:
 * 1. Load contest + template (payout_structure, settlement_strategy_key)
 * 2. Load scoring inputs (golfer_scores, entry_rosters, etc.)
 * 3. Call settlement strategy function to compute scores
 * 4. Call settlementStrategy.computeSettlement() to recompute payouts
 * 5. Verify recomputed payouts > 0 (safety check)
 * 6. Compare to existing PRIZE_PAYOUT ledger entries
 * 7. Insert compensating entries for positive deltas only
 * 8. Create payout_job + payout_transfers (idempotent)
 * 9. Write audit trail
 *
 * Safety Model:
 * - Operator-run only (explicit DATABASE_URL required)
 * - Hardcoded allowlist of 5 contest IDs (Valspar Championship)
 * - Dry-run mode by default (no mutations)
 * - Applies only with explicit --apply flag
 * - STOP if recomputed payouts === 0
 * - STOP if any delta < 0
 * - Idempotent: safe to run multiple times
 *
 * Write Paths Used (Append-Only Only):
 * - ledger: INSERT compensating PRIZE_PAYOUT entries
 * - payout_jobs: INSERT new payout job (idempotent via settlement_id UNIQUE)
 * - payout_transfers: INSERT new payout transfers (idempotent via contest_id, user_id UNIQUE)
 * - admin_contest_audit: INSERT repair audit trail
 */

const { Pool } = require('pg');
const crypto = require('crypto');

// Import settlement computation
const settlementStrategy = require('../services/settlementStrategy');
const settlementRegistry = require('../services/settlementRegistry');

// ============================================================================
// CONFIGURATION
// ============================================================================

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const REPAIR_OPERATOR_ID = '00000000-0000-0000-0000-000000000001';

// Hardcoded allowlist: EXACTLY these 5 contest IDs from Valspar Championship
const ALLOWED_CONTEST_IDS = new Set([
  '1b37d129-b502-4af6-873e-5f1706937a36', // $10
  '507237b9-c7aa-4650-8aae-1e8a48d20dee', // $20
  'f6d203fc-bd90-4351-915f-6bb44c292480', // $5
  'c2f8d970-aff0-4175-aa45-3c40f5b8103c', // $100
  '271b0207-3c85-4cf6-b86e-7f1ae724f439', // $50
]);

// Expected event family (ESPN PGA event)
const EXPECTED_EVENT_FAMILY = 'espn_pga_401811938';

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  let mode = 'dry-run';
  let contestIds = [];
  let useAllAllowed = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--apply') {
      mode = 'apply';
    } else if (arg === '--dry-run') {
      mode = 'dry-run';
    } else if (arg === '--contest') {
      if (i + 1 < args.length) {
        contestIds.push(args[++i]);
      }
    } else if (arg === '--all-allowed') {
      useAllAllowed = true;
    }
  }

  // If no contest IDs provided, use allowlist in dry-run mode only
  if (contestIds.length === 0) {
    if (mode === 'apply' && !useAllAllowed) {
      console.error(
        'ERROR: --apply requires explicit contest IDs or --all-allowed flag'
      );
      process.exit(1);
    }
    if (useAllAllowed) {
      contestIds = Array.from(ALLOWED_CONTEST_IDS);
    }
  }

  return { mode, contestIds, useAllAllowed };
}

// ============================================================================
// VALIDATION
// ============================================================================

function validateContestIds(contestIds) {
  for (const id of contestIds) {
    if (!ALLOWED_CONTEST_IDS.has(id)) {
      console.error(
        `ERROR: Contest ID ${id} is not in the hardcoded allowlist`
      );
      console.error('Allowed IDs:', Array.from(ALLOWED_CONTEST_IDS).join('\n  '));
      process.exit(1);
    }
  }
}

async function validateEventFamily(pool, contestId) {
  const result = await pool.query(
    `
    SELECT ci.provider_event_id
    FROM contest_instances ci
    WHERE ci.id = $1
    `,
    [contestId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Contest not found: ${contestId}`);
  }

  const providerEventId = result.rows[0].provider_event_id;
  if (!providerEventId || !providerEventId.startsWith(EXPECTED_EVENT_FAMILY)) {
    throw new Error(
      `Contest ${contestId} provider_event_id (${providerEventId}) does not match expected family (${EXPECTED_EVENT_FAMILY})`
    );
  }
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadContestData(pool, contestId) {
  // Load contest + settlement (do NOT use settlement_results.payouts - they're corrupted!)
  const contestResult = await pool.query(
    `
    SELECT
      ci.id,
      ci.status,
      ci.entry_fee_cents,
      ci.payout_structure,
      ct.settlement_strategy_key,
      sr.id as settlement_id,
      sr.snapshot_id,
      sr.snapshot_hash,
      sr.total_pool_cents
    FROM contest_instances ci
    JOIN contest_templates ct ON ct.id = ci.template_id
    LEFT JOIN settlement_records sr ON sr.contest_instance_id = ci.id
    WHERE ci.id = $1
    `,
    [contestId]
  );

  if (contestResult.rows.length === 0) {
    throw new Error(`Contest not found: ${contestId}`);
  }

  const contest = contestResult.rows[0];

  // Validate status is COMPLETE
  if (contest.status !== 'COMPLETE') {
    throw new Error(
      `Contest ${contestId} status is ${contest.status}, expected COMPLETE`
    );
  }

  // Validate settlement exists
  if (!contest.settlement_id) {
    throw new Error(`No settlement record found for contest ${contestId}`);
  }

  // Load existing PRIZE_PAYOUT ledger rows
  const existingPayoutsResult = await pool.query(
    `
    SELECT
      user_id,
      SUM(amount_cents)::bigint as total_amount_cents
    FROM ledger
    WHERE contest_instance_id = $1
      AND entry_type = 'PRIZE_PAYOUT'
    GROUP BY user_id
    `,
    [contestId]
  );

  const existingPayoutsMap = {};
  existingPayoutsResult.rows.forEach((row) => {
    existingPayoutsMap[row.user_id] = parseInt(row.total_amount_cents, 10);
  });

  // Parse payout_structure (may be object or JSON string)
  let payoutStructure = {};
  if (contest.payout_structure) {
    if (typeof contest.payout_structure === 'string') {
      payoutStructure = JSON.parse(contest.payout_structure);
    } else if (typeof contest.payout_structure === 'object') {
      payoutStructure = contest.payout_structure;
    }
  }

  return {
    contestId,
    status: contest.status,
    entryFeeCents: contest.entry_fee_cents,
    payoutStructure,
    settlementStrategyKey: contest.settlement_strategy_key,
    settlementId: contest.settlement_id,
    snapshotId: contest.snapshot_id,
    snapshotHash: contest.snapshot_hash,
    totalPoolCents: contest.total_pool_cents,
    existingPayoutsMap,
  };
}

// ============================================================================
// RECOMPUTATION: Load Scores and Compute Settlement
// ============================================================================

async function recomputePayouts(pool, contestData) {
  const {
    contestId,
    settlementStrategyKey,
    entryFeeCents,
    payoutStructure,
    snapshotId,
    snapshotHash,
  } = contestData;

  // Get settlement strategy function
  const strategyFn = settlementRegistry.getSettlementStrategy(
    settlementStrategyKey
  );

  const client = await pool.connect();
  try {
    // Load scores using the strategy function
    // This function returns: Array<{ user_id, total_score }>
    const scoreRows = await strategyFn(contestId, client);

    console.log(`  Loaded ${scoreRows.length} score rows`);

    // Prepare contest object for computeSettlement
    const contestForCompute = {
      id: contestId,
      entry_fee_cents: entryFeeCents,
      payout_structure: payoutStructure,
    };

    // Call computeSettlement to get rankings and payouts
    const settlementPlan = settlementStrategy.computeSettlement(
      settlementStrategyKey,
      contestForCompute,
      scoreRows,
      snapshotId,
      snapshotHash
    );

    console.log(`  Computed ${settlementPlan.payouts.length} payouts`);
    console.log(`  Total payout: ${settlementPlan.payouts.reduce((s, p) => s + p.amount_cents, 0)} cents`);

    return settlementPlan;
  } catch (err) {
    console.error(`  ERROR in recomputePayouts: ${err.message}`);
    console.error(`  Stack: ${err.stack}`);
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// REPAIR COMPUTATION
// ============================================================================

function computeRepair(contestData, settlementPlan) {
  const { contestId, existingPayoutsMap } = contestData;
  const expectedPayouts = settlementPlan.payouts;

  // SAFETY CHECK 1: Recomputed payouts must be > 0
  const totalExpectedPayouts = expectedPayouts.reduce(
    (sum, p) => sum + p.amount_cents,
    0
  );

  if (totalExpectedPayouts === 0) {
    throw new Error(
      `FATAL: Contest ${contestId} recomputed payouts still = 0. This indicates the payout structure or scoring is broken. Do not repair.`
    );
  }

  const deltas = {};
  let totalDelta = 0;
  let hasNegativeDelta = false;

  for (const payout of expectedPayouts) {
    const userId = payout.user_id;
    const expectedAmount = parseInt(payout.amount_cents, 10);
    const existingAmount = existingPayoutsMap[userId] || 0;
    const delta = expectedAmount - existingAmount;

    deltas[userId] = {
      expected: expectedAmount,
      existing: existingAmount,
      delta,
    };

    totalDelta += delta;

    if (delta < 0) {
      hasNegativeDelta = true;
    }
  }

  // SAFETY CHECK 2: No negative deltas
  if (hasNegativeDelta) {
    throw new Error(
      `FATAL: Contest ${contestId} has negative delta (existing > expected). This is corruption. Do not repair automatically.`
    );
  }

  // Check if already repaired
  const allZeroDelta = Object.values(deltas).every((d) => d.delta === 0);
  if (allZeroDelta) {
    return {
      status: 'already_repaired',
      deltas,
      totalDelta: 0,
      compensation_entries: [],
      payout_jobs_needed: 0,
      payout_transfers_needed: [],
    };
  }

  // Build compensation entries for positive deltas only
  const compensation_entries = [];
  const payout_transfers_needed = [];

  for (const userId of Object.keys(deltas)) {
    const delta = deltas[userId].delta;
    if (delta > 0) {
      compensation_entries.push({
        user_id: userId,
        amount_cents: delta,
      });
      payout_transfers_needed.push({
        user_id: userId,
        amount_cents: delta,
      });
    }
  }

  return {
    status: 'needs_repair',
    deltas,
    totalDelta,
    compensation_entries,
    payout_jobs_needed: compensation_entries.length > 0 ? 1 : 0,
    payout_transfers_needed,
  };
}

// ============================================================================
// REPAIR EXECUTION
// ============================================================================

async function executeRepair(pool, contestData, repairPlan) {
  if (repairPlan.status === 'already_repaired') {
    return {
      status: 'already_repaired',
      message: 'No repair needed (already balanced)',
      deltas: repairPlan.deltas,
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Step 1: Insert compensating PRIZE_PAYOUT ledger entries
    for (const entry of repairPlan.compensation_entries) {
      const idempotencyKey = `repair:${contestData.contestId}:${entry.user_id}:${entry.amount_cents}:${contestData.snapshotHash}`;

      await client.query(
        `
        INSERT INTO ledger (
          user_id,
          entry_type,
          direction,
          amount_cents,
          reference_type,
          reference_id,
          idempotency_key,
          snapshot_id,
          snapshot_hash,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (idempotency_key) DO NOTHING
        `,
        [
          entry.user_id,
          'PRIZE_PAYOUT',
          'CREDIT',
          entry.amount_cents,
          'CONTEST',
          contestData.contestId,
          idempotencyKey,
          contestData.snapshotId,
          contestData.snapshotHash,
        ]
      );
    }

    // Step 2: Create payout_job if needed (idempotent via settlement_id UNIQUE)
    let payoutJobId = null;
    if (repairPlan.payout_jobs_needed > 0) {
      const jobResult = await client.query(
        `
        INSERT INTO payout_jobs (settlement_id, contest_id, status, total_payouts)
        VALUES ($1, $2, 'pending', $3)
        ON CONFLICT (settlement_id) DO UPDATE SET status = 'pending'
        RETURNING id
        `,
        [
          contestData.settlementId,
          contestData.contestId,
          repairPlan.payout_transfers_needed.length,
        ]
      );
      payoutJobId = jobResult.rows[0].id;
    }

    // Step 3: Create payout_transfers (idempotent via contest_id, user_id UNIQUE)
    if (payoutJobId && repairPlan.payout_transfers_needed.length > 0) {
      const values = [];
      const params = [];
      let paramIndex = 1;

      for (const transfer of repairPlan.payout_transfers_needed) {
        const idempotencyKey = `payout:${transfer.user_id}:${contestData.contestId}`;
        values.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
        );
        params.push(
          payoutJobId,
          contestData.contestId,
          transfer.user_id,
          transfer.amount_cents,
          idempotencyKey,
          'pending'
        );
      }

      await client.query(
        `
        INSERT INTO payout_transfers (payout_job_id, contest_id, user_id, amount_cents, idempotency_key, status)
        VALUES ${values.join(',')}
        ON CONFLICT (contest_id, user_id) DO NOTHING
        `,
        params
      );
    }

    // Step 4: Insert admin audit record
    const auditPayload = {
      repair_type: 'SETTLEMENT_REPAIR_ZERO_PAYOUT_BUG',
      recomputation_method: 'settlementStrategy.computeSettlement()',
      compensation_count: repairPlan.compensation_entries.length,
      total_delta_cents: repairPlan.totalDelta,
      deltas: repairPlan.deltas,
      snapshot_id: contestData.snapshotId,
      snapshot_hash: contestData.snapshotHash,
    };

    await client.query(
      `
      INSERT INTO admin_contest_audit (
        contest_instance_id,
        admin_user_id,
        action,
        reason,
        from_status,
        to_status,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        contestData.contestId,
        REPAIR_OPERATOR_ID,
        'settlement_repair_execute',
        'Repair zero-payout settlement bug (recomputed via settlementStrategy, append-only compensation entries)',
        contestData.status,
        contestData.status,
        JSON.stringify(auditPayload),
      ]
    );

    await client.query('COMMIT');

    return {
      status: 'repaired',
      contestId: contestData.contestId,
      compensationEntries: repairPlan.compensation_entries,
      deltas: repairPlan.deltas,
      payoutJobId,
      auditPayload,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// DRY-RUN OUTPUT
// ============================================================================

function printRepairPlan(contestData, repairPlan) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Contest: ${contestData.contestId}`);
  console.log(`${'='.repeat(80)}`);

  console.log(`Status: ${repairPlan.status}`);

  if (repairPlan.status === 'already_repaired') {
    console.log('✓ No repair needed (already balanced)');
    return;
  }

  console.log(
    `Total Delta (recomputed - existing): ${repairPlan.totalDelta} cents`
  );
  console.log(`Compensation Entries: ${repairPlan.compensation_entries.length}`);
  console.log(`Payout Job Needed: ${repairPlan.payout_jobs_needed > 0 ? 'YES' : 'NO'}`);
  console.log(`Payout Transfers Needed: ${repairPlan.payout_transfers_needed.length}`);

  console.log('\nDelta by User:');
  const sortedUsers = Object.keys(repairPlan.deltas).sort();
  for (const userId of sortedUsers) {
    const delta = repairPlan.deltas[userId];
    console.log(
      `  ${userId}: recomputed=${delta.expected}, existing=${delta.existing}, delta=${delta.delta}`
    );
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  // Parse CLI args
  const { mode, contestIds, useAllAllowed } = parseArgs();

  // Require DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error(
      'ERROR: DATABASE_URL environment variable is required'
    );
    process.exit(1);
  }

  // Validate contest IDs
  if (contestIds.length === 0) {
    console.error('ERROR: No contest IDs provided');
    console.error('Usage:');
    console.error('  DATABASE_URL=... node backend/debug/repairZeroPayoutSettlements.js --contest <id>');
    console.error('  DATABASE_URL=... node backend/debug/repairZeroPayoutSettlements.js --all-allowed --apply');
    process.exit(1);
  }

  validateContestIds(contestIds);

  // Connect to database
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log(`\nREPAIR MODE: ${mode}`);
    console.log(`Contests to process: ${contestIds.length}`);
    console.log(
      `\nNOTE: Payouts are recomputed using settlementStrategy.computeSettlement()`
    );
    console.log(`  (NOT using corrupted settlement_records.results.payouts)`);

    // Process each contest
    const results = [];
    const errors = [];

    for (const contestId of contestIds) {
      try {
        // Validate event family
        await validateEventFamily(pool, contestId);

        // Load contest data
        const contestData = await loadContestData(pool, contestId);

        console.log(`\nLoaded contest data for ${contestId}`);
        console.log(`  Entry fee: ${contestData.entryFeeCents} cents`);
        console.log(`  Strategy: ${contestData.settlementStrategyKey}`);
        console.log(`  Payout structure type: ${typeof contestData.payoutStructure}`);

        // Recompute payouts from scratch
        const settlementPlan = await recomputePayouts(pool, contestData);

        // Compute repair plan
        const repairPlan = computeRepair(contestData, settlementPlan);

        // Print plan
        printRepairPlan(contestData, repairPlan);

        // Execute if --apply
        if (mode === 'apply') {
          const repairResult = await executeRepair(pool, contestData, repairPlan);
          console.log(`\n✓ REPAIRED`);
          results.push(repairResult);
        } else {
          console.log(`\n(DRY-RUN: no mutations applied)`);
          results.push({
            status: 'dry_run',
            contestId: contestData.contestId,
            plan: repairPlan,
          });
        }
      } catch (error) {
        console.error(`\n✗ ERROR: ${error.message}`);
        errors.push({
          contestId,
          error: error.message,
        });
      }
    }

    // Summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('SUMMARY');
    console.log(`${'='.repeat(80)}`);
    console.log(`Processed: ${results.length}`);
    console.log(`Errors: ${errors.length}`);

    if (mode === 'apply') {
      const repaired = results.filter((r) => r.status === 'repaired');
      const noRepair = results.filter((r) => r.status === 'already_repaired');
      console.log(`Repaired: ${repaired.length}`);
      console.log(`Already Balanced: ${noRepair.length}`);
    }

    if (errors.length > 0) {
      console.log('\nErrors:');
      errors.forEach((e) => {
        console.log(`  ${e.contestId}: ${e.error}`);
      });
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error('FATAL ERROR:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
