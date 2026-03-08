#!/usr/bin/env node

/**
 * Settlement Blocker Diagnostic
 *
 * Checks why LIVE → COMPLETE is not executing
 * Focus: Does FINAL snapshot exist?
 *
 * Run from repo root:
 * DATABASE_URL="postgres://..." node backend/scripts/check-settlement-blocker.js
 *
 * Output: SETTLEMENT_BLOCKER_RESULTS.json
 */

const pg = require('pg');
const fs = require('fs');
const path = require('path');

async function diagnose() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('✓ Connected to database\n');

    const results = {
      timestamp: new Date().toISOString(),
      stuck_contest_id: '43be32cf-a794-476b-9aa7-ce8a27de2901',
      diagnostics: {}
    };

    const STUCK_ID = results.stuck_contest_id;

    // 1. Check contest status
    console.log('[1] Checking contest status...');
    const contestResult = await client.query(`
      SELECT
        id,
        status,
        tournament_end_time,
        lock_time,
        tournament_start_time,
        entry_fee_cents,
        payout_structure
      FROM contest_instances
      WHERE id = $1
    `, [STUCK_ID]);

    if (contestResult.rows.length === 0) {
      console.log('  ✗ Contest not found');
      results.diagnostics.contest = null;
    } else {
      results.diagnostics.contest = contestResult.rows[0];
      const contest = contestResult.rows[0];
      console.log(`  ✓ Contest: ${contest.status}`);
      console.log(`    tournament_end_time: ${contest.tournament_end_time}`);
      console.log(`    NOW: ${new Date().toISOString()}`);
      console.log(`    Status: LIVE past end time by ${Math.round((Date.now() - new Date(contest.tournament_end_time).getTime()) / 60000)} minutes`);
    }

    // 2. Check ALL snapshots for this contest
    console.log('\n[2] Checking all snapshots for contest...');
    const allSnapshotsResult = await client.query(`
      SELECT
        id,
        provider_final_flag,
        ingested_at,
        snapshot_hash
      FROM event_data_snapshots
      WHERE contest_instance_id = $1
      ORDER BY ingested_at DESC
    `, [STUCK_ID]);

    results.diagnostics.all_snapshots = allSnapshotsResult.rows;
    console.log(`  Found ${allSnapshotsResult.rows.length} total snapshots`);
    if (allSnapshotsResult.rows.length > 0) {
      allSnapshotsResult.rows.forEach((s, i) => {
        console.log(`    [${i}] final=${s.provider_final_flag}, ingested=${s.ingested_at.toISOString()}`);
      });
    }

    // 3. Check FINAL snapshots specifically
    console.log('\n[3] Checking FINAL snapshots (provider_final_flag = true)...');
    const finalSnapshotResult = await client.query(`
      SELECT
        id,
        snapshot_hash,
        ingested_at
      FROM event_data_snapshots
      WHERE contest_instance_id = $1
        AND provider_final_flag = true
      ORDER BY ingested_at DESC, id DESC
      LIMIT 1
    `, [STUCK_ID]);

    results.diagnostics.final_snapshot = finalSnapshotResult.rows.length > 0 ? finalSnapshotResult.rows[0] : null;

    if (finalSnapshotResult.rows.length === 0) {
      console.log('  ✗ NO FINAL SNAPSHOT FOUND');
      console.log('    → This is why LIVE → COMPLETE is blocked');
      console.log('    → Contest cannot settle without final snapshot');
    } else {
      console.log(`  ✓ FINAL snapshot exists: ${finalSnapshotResult.rows[0].id}`);
      console.log(`    ingested_at: ${finalSnapshotResult.rows[0].ingested_at}`);
    }

    // 4. Check settlement_audit records
    console.log('\n[4] Checking settlement_audit records...');
    const settlementResult = await client.query(`
      SELECT
        id,
        status,
        created_at,
        completed_at
      FROM settlement_audit
      WHERE contest_instance_id = $1
      ORDER BY created_at DESC
    `, [STUCK_ID]);

    results.diagnostics.settlement_audit = settlementResult.rows;
    console.log(`  Found ${settlementResult.rows.length} settlement audit records`);
    if (settlementResult.rows.length > 0) {
      settlementResult.rows.forEach((s, i) => {
        console.log(`    [${i}] status=${s.status}, created=${s.created_at.toISOString()}`);
      });
    }

    // Write results
    const outputPath = path.join(__dirname, 'SETTLEMENT_BLOCKER_RESULTS.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n✓ Results saved to:\n  ${outputPath}`);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('ROOT CAUSE ANALYSIS');
    console.log('='.repeat(60));

    if (results.diagnostics.final_snapshot === null) {
      console.log('\n❌ ROOT CAUSE: MISSING FINAL SNAPSHOT\n');
      console.log('Details:');
      console.log('  - Contest is LIVE and past tournament_end_time');
      console.log('  - transitionLiveToComplete() queries for provider_final_flag = true');
      console.log('  - No snapshot with provider_final_flag = true exists');
      console.log('  - Settlement cannot proceed without final snapshot');
      console.log('  - Contest remains LIVE (silently skipped, no error logged)\n');
      console.log('Fix options:');
      console.log('  1. Ingest final snapshot from provider (discovery/ingestion)');
      console.log('  2. Manually mark existing snapshot as final (data correction)');
      console.log('  3. Manual admin settle endpoint (if available)');
    } else {
      console.log('\n✓ FINAL SNAPSHOT EXISTS\n');
      console.log('Root cause must be elsewhere (settlement execution failure)');
    }

    await client.end();

  } catch (err) {
    console.error('ERROR:', err.message);
    await client.end();
    process.exit(1);
  }
}

diagnose();
