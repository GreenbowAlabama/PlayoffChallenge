#!/usr/bin/env node

/**
 * CLEANUP INVALID ROUNDS
 *
 * Purpose:
 * Remove historical corrupted round data (partial field coverage).
 * Rounds that don't match baseline golfer count are deleted entirely.
 *
 * Usage:
 *   node cleanupInvalidRounds.js <contest_instance_id>           (DRY_RUN, no deletes)
 *   node cleanupInvalidRounds.js <contest_instance_id> --execute (EXECUTE deletes)
 *
 * READ-WRITE: Mutations only when --execute flag present
 */

'use strict';

const { Pool } = require('pg');

async function cleanupInvalidRounds() {
  const contestInstanceId = process.argv[2];
  const executeFlag = process.argv[3];
  const dryRun = executeFlag !== '--execute';

  if (!contestInstanceId) {
    console.error('Usage: node cleanupInvalidRounds.js <contest_instance_id> [--execute]');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
    statement_timeout: 30000,
  });

  try {
    console.log(`\n========================================`);
    console.log(`CLEANUP INVALID ROUNDS`);
    console.log(`Contest Instance: ${contestInstanceId}`);
    console.log(`Mode: ${dryRun ? 'DRY_RUN (no deletes)' : 'EXECUTE (deletes enabled)'}`);
    console.log(`========================================\n`);

    // STEP 1: Fetch baseline from field_selections
    console.log(`[STEP 1] Fetching baseline from field_selections...`);

    const baselineResult = await pool.query(
      `
      SELECT jsonb_array_length(selection_json->'primary') as baseline
      FROM field_selections
      WHERE contest_instance_id = $1
      `,
      [contestInstanceId]
    );

    let baseline = null;

    if (baselineResult.rows.length === 0) {
      console.log(`⚠️  field_selections not found for this contest\n`);
      baseline = null;
    } else if (baselineResult.rows[0].baseline === null) {
      console.log(`⚠️  field_selections exists but primary array is null/empty\n`);
      baseline = null;
    } else {
      baseline = baselineResult.rows[0].baseline;
      console.log(`✓ Baseline: ${baseline} golfers\n`);
    }

    if (baseline === null) {
      console.log(`⛔ Cannot proceed without baseline. Exiting.\n`);
      console.log(`========================================\n`);
      process.exit(1);
    }

    // STEP 2: Fetch round distribution from golfer_event_scores
    console.log(`[STEP 2] Scanning golfer_event_scores for invalid rounds...\n`);

    const roundsResult = await pool.query(
      `
      SELECT
        round_number,
        COUNT(DISTINCT golfer_id) as golfer_count
      FROM golfer_event_scores
      WHERE contest_instance_id = $1
      GROUP BY round_number
      ORDER BY round_number
      `,
      [contestInstanceId]
    );

    const rounds = roundsResult.rows.map(row => ({
      round_number: row.round_number,
      golfer_count: parseInt(row.golfer_count),
      matches_baseline: parseInt(row.golfer_count) === baseline,
    }));

    console.log(`[STEP 3] Rounds found:\n`);
    console.log(JSON.stringify(rounds, null, 2));
    console.log();

    // STEP 3: Identify invalid rounds
    const invalidRounds = rounds.filter(r => !r.matches_baseline);

    if (invalidRounds.length === 0) {
      console.log(`✅ No invalid rounds found. All rounds match baseline ${baseline}.\n`);
      console.log(`========================================\n`);
      process.exit(0);
    }

    // STEP 4: Report invalid rounds
    console.log(`[STEP 4] Invalid Rounds (will be deleted):\n`);
    invalidRounds.forEach(round => {
      console.log(
        `❌ Round ${round.round_number}: ${round.golfer_count} golfers (baseline ${baseline})`
      );
    });
    console.log();

    // STEP 5: Count rows per invalid round
    console.log(`[STEP 5] Row counts per invalid round:\n`);

    const rowCountsPerRound = {};
    let totalRowsToDelete = 0;

    for (const invalidRound of invalidRounds) {
      const roundNum = invalidRound.round_number;

      const countResult = await pool.query(
        `
        SELECT COUNT(*) as row_count
        FROM golfer_event_scores
        WHERE contest_instance_id = $1
        AND round_number = $2
        `,
        [contestInstanceId, roundNum]
      );

      const rowCount = parseInt(countResult.rows[0].row_count);
      rowCountsPerRound[roundNum] = rowCount;
      totalRowsToDelete += rowCount;

      console.log(`  Round ${roundNum}: ${rowCount} rows`);
    }

    console.log(`  Total: ${totalRowsToDelete} rows\n`);

    // STEP 6: Execute or dry-run deletes
    console.log(`[STEP 6] Cleanup Action:\n`);

    let totalRowsDeleted = 0;
    const roundsDeleted = [];

    if (dryRun) {
      console.log(`[DRY_RUN] Would delete ${totalRowsToDelete} rows from ${invalidRounds.length} invalid rounds:`);
      invalidRounds.forEach(round => {
        console.log(`  Round ${round.round_number}: ${rowCountsPerRound[round.round_number]} rows`);
      });
      console.log();
    } else {
      console.log(`[EXECUTE] Deleting rows...\n`);

      for (const invalidRound of invalidRounds) {
        const roundNum = invalidRound.round_number;

        const deleteResult = await pool.query(
          `
          DELETE FROM golfer_event_scores
          WHERE contest_instance_id = $1
          AND round_number = $2
          `,
          [contestInstanceId, roundNum]
        );

        totalRowsDeleted += deleteResult.rowCount;
        roundsDeleted.push(roundNum);

        console.log(`✓ Deleted ${deleteResult.rowCount} rows for round ${roundNum}`);
      }

      console.log();
    }

    // STEP 7: Summary
    console.log(`[STEP 7] Summary:\n`);

    const output = {
      mode: dryRun ? 'DRY_RUN' : 'EXECUTE',
      baseline,
      invalid_rounds: invalidRounds.map(r => r.round_number),
      rows_deleted: dryRun ? totalRowsToDelete : totalRowsDeleted,
      rounds_scanned: rounds.length,
    };

    console.log(JSON.stringify(output, null, 2));
    console.log();

    if (dryRun) {
      console.log(`💡 DRY_RUN mode: No deletes executed.`);
      console.log(`   To execute: node cleanupInvalidRounds.js ${contestInstanceId} --execute\n`);
    } else {
      console.log(`✅ CLEANUP COMPLETE: ${totalRowsDeleted} rows deleted.\n`);
    }

    console.log(`========================================\n`);

    process.exit(0);
  } catch (err) {
    console.error('Error during cleanup:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

cleanupInvalidRounds();
