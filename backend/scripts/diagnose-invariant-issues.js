#!/usr/bin/env node

/**
 * System Invariant Diagnostic Script
 *
 * Purpose: Diagnose issues with System Invariant Monitor
 * - Worker heartbeat status (why discovery_worker is UNKNOWN)
 * - Lifecycle stuck contests (LIVE past tournament_end_time)
 * - Settlement records and state transitions
 *
 * Run from repo root:
 * DATABASE_URL="postgres://..." node backend/scripts/diagnose-invariant-issues.js
 *
 * Output: INVARIANT_DIAGNOSTIC_RESULTS.json
 */

const pg = require('pg');
const fs = require('fs');
const path = require('path');

async function runDiagnostics() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('✓ Connected to database');

    const results = {
      timestamp: new Date().toISOString(),
      database_url: process.env.DATABASE_URL ? 'SET' : 'NOT SET',
      diagnostics: {}
    };

    // 1. Worker Heartbeats Status
    console.log('\n[1/5] Checking worker heartbeats...');
    const heartbeatsResult = await client.query(`
      SELECT
        worker_name,
        worker_type,
        status,
        last_run_at,
        error_count,
        metadata,
        EXTRACT(EPOCH FROM (NOW() - last_run_at)) as seconds_since_last_run,
        CASE
          WHEN worker_name = 'lifecycle_reconciler' THEN 300
          WHEN worker_name = 'discovery_worker' THEN 300
          WHEN worker_name = 'ingestion_worker' THEN 60
          WHEN worker_name = 'payout_scheduler' THEN 300
          WHEN worker_name = 'financial_reconciler' THEN 86400
        END as expected_freshness_seconds
      FROM worker_heartbeats
      ORDER BY worker_name
    `);

    results.diagnostics.worker_heartbeats = heartbeatsResult.rows.map(row => ({
      ...row,
      is_fresh: row.seconds_since_last_run <= row.expected_freshness_seconds,
      freshness_window_seconds: row.expected_freshness_seconds
    }));

    const heartbeatSummary = results.diagnostics.worker_heartbeats.map(hb =>
      `${hb.worker_name}: ${hb.status} (${Math.round(hb.seconds_since_last_run)}s ago, fresh: ${hb.is_fresh})`
    ).join('\n  ');
    console.log(`  Found ${heartbeatsResult.rows.length} workers:\n  ${heartbeatSummary}`);

    // 2. Stuck LIVE Contests (past tournament_end_time)
    console.log('\n[2/5] Checking for stuck LIVE contests...');
    const stuckContestsResult = await client.query(`
      SELECT
        id,
        contest_name,
        status,
        tournament_end_time,
        NOW() as current_time,
        EXTRACT(EPOCH FROM (NOW() - tournament_end_time)) / 60 as minutes_overdue,
        lock_time,
        tournament_start_time
      FROM contest_instances
      WHERE status = 'LIVE'
        AND tournament_end_time IS NOT NULL
        AND tournament_end_time < NOW()
      ORDER BY tournament_end_time ASC
    `);

    results.diagnostics.stuck_live_contests = stuckContestsResult.rows;
    console.log(`  Found ${stuckContestsResult.rows.length} stuck LIVE contests`);
    if (stuckContestsResult.rows.length > 0) {
      stuckContestsResult.rows.forEach(contest => {
        console.log(`    - ${contest.contest_name} (${Math.round(contest.minutes_overdue)}min overdue)`);
      });
    }

    // 3. Lifecycle State Transitions for First Stuck Contest
    if (stuckContestsResult.rows.length > 0) {
      console.log('\n[3/5] Checking lifecycle transitions for stuck contest...');
      const firstStuckId = stuckContestsResult.rows[0].id;

      const transitionsResult = await client.query(`
        SELECT
          contest_instance_id,
          from_state,
          to_state,
          triggered_by,
          created_at
        FROM contest_state_transitions
        WHERE contest_instance_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      `, [firstStuckId]);

      results.diagnostics.state_transitions = transitionsResult.rows;
      console.log(`  Found ${transitionsResult.rows.length} transitions`);
      if (transitionsResult.rows.length > 0) {
        console.log(`    Latest: ${transitionsResult.rows[0].from_state} → ${transitionsResult.rows[0].to_state}`);
      }

      // 4. Settlement Audit for Stuck Contest
      console.log('\n[4/5] Checking settlement audit for stuck contest...');
      const settlementResult = await client.query(`
        SELECT
          id,
          contest_instance_id,
          status,
          created_at,
          completed_at,
          settlement_run_id,
          engine_version
        FROM settlement_audit
        WHERE contest_instance_id = $1
        ORDER BY created_at DESC
      `, [firstStuckId]);

      results.diagnostics.settlement_audit = settlementResult.rows;
      console.log(`  Found ${settlementResult.rows.length} settlement audit records`);
      if (settlementResult.rows.length > 0) {
        console.log(`    Status: ${settlementResult.rows[0].status}`);
      }
    } else {
      console.log('\n[3/5] Skipping transitions (no stuck contests)');
      console.log('\n[4/5] Skipping settlement audit (no stuck contests)');
      results.diagnostics.state_transitions = [];
      results.diagnostics.settlement_audit = [];
    }

    // 5. All Contests Summary
    console.log('\n[5/5] Checking contest distribution...');
    const contestsResult = await client.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM contest_instances
      GROUP BY status
      ORDER BY status
    `);

    results.diagnostics.contests_by_status = contestsResult.rows;
    const summary = contestsResult.rows.map(row => `${row.status}: ${row.count}`).join(', ');
    console.log(`  Contests: ${summary}`);

    // Write results to JSON file
    const outputPath = path.join(__dirname, 'INVARIANT_DIAGNOSTIC_RESULTS.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n✓ Diagnostics complete. Results saved to:\n  ${outputPath}`);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`\nWorker Heartbeats:`);
    results.diagnostics.worker_heartbeats.forEach(hb => {
      const status = hb.is_fresh ? '✓' : '✗';
      console.log(`  ${status} ${hb.worker_name.padEnd(25)} ${hb.status.padEnd(10)} (${Math.round(hb.seconds_since_last_run)}s ago)`);
    });

    if (results.diagnostics.stuck_live_contests.length > 0) {
      console.log(`\nStuck Contests: ${results.diagnostics.stuck_live_contests.length}`);
      results.diagnostics.stuck_live_contests.forEach(c => {
        console.log(`  ✗ ${c.contest_name} (${Math.round(c.minutes_overdue)}min overdue)`);
      });
    }

    await client.end();

  } catch (err) {
    console.error('ERROR:', err.message);
    await client.end();
    process.exit(1);
  }
}

runDiagnostics();
