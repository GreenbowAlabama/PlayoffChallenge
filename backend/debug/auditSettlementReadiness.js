#!/usr/bin/env node
/**
 * Settlement Readiness Audit Script
 *
 * READ-ONLY diagnostic — no mutations.
 * Checks staging DB for contests expected to settle and reports blockers.
 *
 * Usage:
 *   DATABASE_URL=<staging_url> node backend/debug/auditSettlementReadiness.js
 *
 * Environment:
 *   DATABASE_URL — Required. Points to staging or test DB.
 *   AUDIT_WINDOW_HOURS — Optional. Default: 48. Look-ahead window for tournament_end_time.
 */

const { Pool } = require('pg');

const AUDIT_WINDOW_HOURS = parseInt(process.env.AUDIT_WINDOW_HOURS || '48', 10);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('FAIL: DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  try {
    console.log('='.repeat(70));
    console.log('SETTLEMENT READINESS AUDIT');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Audit window: next ${AUDIT_WINDOW_HOURS} hours`);
    console.log('='.repeat(70));
    console.log();

    // ── Section 1: LIVE contests with tournament_end_time in audit window ──
    const liveResult = await pool.query(`
      SELECT
        ci.id,
        ci.contest_name,
        ci.status,
        ci.entry_fee_cents,
        ci.tournament_start_time,
        ci.tournament_end_time,
        ci.lock_time,
        ci.settle_time,
        ci.template_id,
        ct.settlement_strategy_key,
        ct.sport
      FROM contest_instances ci
      LEFT JOIN contest_templates ct ON ct.id = ci.template_id
      WHERE ci.status = 'LIVE'
      ORDER BY ci.tournament_end_time ASC NULLS LAST
    `);

    console.log(`── LIVE CONTESTS (${liveResult.rows.length} total) ──`);
    if (liveResult.rows.length === 0) {
      console.log('  (none)');
    }

    const now = new Date();
    const windowEnd = new Date(now.getTime() + AUDIT_WINDOW_HOURS * 3600000);

    for (const row of liveResult.rows) {
      const endTime = row.tournament_end_time ? new Date(row.tournament_end_time) : null;
      const inWindow = endTime && endTime <= windowEnd;
      const pastEnd = endTime && endTime <= now;

      console.log();
      console.log(`  Contest: ${row.id}`);
      console.log(`    Name: ${row.contest_name}`);
      console.log(`    Sport: ${row.sport || 'unknown'}`);
      console.log(`    Strategy: ${row.settlement_strategy_key || 'MISSING'}`);
      console.log(`    Entry fee: ${row.entry_fee_cents} cents`);
      console.log(`    Tournament end: ${endTime ? endTime.toISOString() : 'NULL'}`);
      console.log(`    In audit window: ${inWindow ? 'YES' : 'NO'}`);
      console.log(`    Past end time: ${pastEnd ? 'YES' : 'NO'}`);
      console.log(`    Settle time: ${row.settle_time || 'NULL'}`);

      if (!endTime) {
        console.log(`    ⚠️  WARN: tournament_end_time is NULL — will never auto-complete`);
        continue;
      }

      if (!row.settlement_strategy_key) {
        console.log(`    🔴 FAIL: No settlement_strategy_key on template`);
        continue;
      }

      if (!inWindow) {
        console.log(`    ℹ️  Outside audit window (ends ${endTime.toISOString()})`);
        continue;
      }

      // ── Check FINAL snapshot ──
      const snapshotResult = await pool.query(`
        SELECT id, snapshot_hash, provider_final_flag, ingested_at
        FROM event_data_snapshots
        WHERE contest_instance_id = $1
          AND provider_final_flag = true
        ORDER BY ingested_at DESC
        LIMIT 1
      `, [row.id]);

      if (snapshotResult.rows.length === 0) {
        console.log(`    🔴 BLOCKER: No FINAL snapshot (provider_final_flag=true)`);
      } else {
        const snap = snapshotResult.rows[0];
        console.log(`    ✅ FINAL snapshot: ${snap.id} (ingested ${snap.ingested_at})`);
      }

      // ── Check participants ──
      const participantResult = await pool.query(`
        SELECT COUNT(*)::int AS cnt
        FROM contest_participants
        WHERE contest_instance_id = $1
      `, [row.id]);

      const pCount = participantResult.rows[0].cnt;
      console.log(`    Participants: ${pCount}`);
      if (pCount === 0) {
        console.log(`    ⚠️  WARN: 0 participants — settlement will produce empty payouts`);
      }

      // ── Check payout structure ──
      const payoutResult = await pool.query(`
        SELECT payout_structure FROM contest_instances WHERE id = $1
      `, [row.id]);
      const ps = payoutResult.rows[0]?.payout_structure;
      if (!ps || (typeof ps === 'object' && Object.keys(ps).length === 0)) {
        console.log(`    ⚠️  WARN: payout_structure is empty or null`);
      } else {
        console.log(`    Payout structure: ${JSON.stringify(ps)}`);
      }

      // ── Check existing settlement_records ──
      const settlementResult = await pool.query(`
        SELECT id, settled_at, results_sha256
        FROM settlement_records
        WHERE contest_instance_id = $1
      `, [row.id]);

      if (settlementResult.rows.length > 0) {
        const sr = settlementResult.rows[0];
        console.log(`    ⚠️  WARN: Settlement already exists (id=${sr.id}, settled_at=${sr.settled_at})`);
      } else {
        console.log(`    ✅ No prior settlement_records`);
      }

      // ── Check existing PRIZE_PAYOUT ledger entries ──
      const payoutLedgerResult = await pool.query(`
        SELECT COUNT(*)::int AS cnt
        FROM ledger
        WHERE reference_id = $1
          AND entry_type = 'PRIZE_PAYOUT'
      `, [row.id]);

      const payoutCount = payoutLedgerResult.rows[0].cnt;
      if (payoutCount > 0) {
        console.log(`    ⚠️  WARN: ${payoutCount} PRIZE_PAYOUT ledger entries already exist`);
      } else {
        console.log(`    ✅ No prior PRIZE_PAYOUT ledger entries`);
      }

      // ── Check golfer_scores exist (for PGA) ──
      if (row.sport && row.sport.toLowerCase().includes('pga')) {
        const scoresResult = await pool.query(`
          SELECT COUNT(*)::int AS cnt
          FROM golfer_scores
          WHERE contest_instance_id = $1
        `, [row.id]);

        const scoreCount = scoresResult.rows[0].cnt;
        if (scoreCount === 0 && pCount > 0) {
          console.log(`    ⚠️  WARN: 0 golfer_scores but ${pCount} participants — scores may not be ingested`);
        } else {
          console.log(`    Golfer scores: ${scoreCount}`);
        }
      }

      // ── Timestamp sanity ──
      if (row.lock_time && row.tournament_start_time) {
        const lockMs = new Date(row.lock_time).getTime();
        const startMs = new Date(row.tournament_start_time).getTime();
        const endMs = endTime.getTime();

        if (lockMs > startMs) {
          console.log(`    🔴 FAIL: lock_time > tournament_start_time (invalid ordering)`);
        }
        if (startMs > endMs) {
          console.log(`    🔴 FAIL: tournament_start_time > tournament_end_time (invalid ordering)`);
        }
      }
    }

    console.log();

    // ── Section 2: Contests that should have completed but didn't ──
    const stuckResult = await pool.query(`
      SELECT
        ci.id,
        ci.contest_name,
        ci.status,
        ci.tournament_end_time,
        ci.settle_time
      FROM contest_instances ci
      WHERE ci.status = 'LIVE'
        AND ci.tournament_end_time IS NOT NULL
        AND ci.tournament_end_time < NOW()
      ORDER BY ci.tournament_end_time ASC
    `);

    console.log(`── POTENTIALLY STUCK CONTESTS (LIVE + past tournament_end_time): ${stuckResult.rows.length} ──`);
    for (const row of stuckResult.rows) {
      console.log(`  ${row.id} | ${row.contest_name} | end=${row.tournament_end_time}`);

      // Check if snapshot is blocking
      const snapCheck = await pool.query(`
        SELECT COUNT(*)::int AS cnt FROM event_data_snapshots
        WHERE contest_instance_id = $1 AND provider_final_flag = true
      `, [row.id]);

      if (snapCheck.rows[0].cnt === 0) {
        console.log(`    → Missing FINAL snapshot (blocking settlement)`);
      } else {
        console.log(`    → Has FINAL snapshot — should settle on next reconciler tick`);
      }
    }

    console.log();

    // ── Section 3: Lifecycle reconciler health ──
    const heartbeatResult = await pool.query(`
      SELECT worker_name, status, last_run_at, error_count, metadata
      FROM worker_heartbeats
      WHERE worker_name = 'lifecycle_reconciler'
    `);

    console.log('── LIFECYCLE RECONCILER STATUS ──');
    if (heartbeatResult.rows.length === 0) {
      console.log('  🔴 FAIL: No heartbeat found — reconciler may not be running');
    } else {
      const hb = heartbeatResult.rows[0];
      const lastRun = new Date(hb.last_run_at);
      const ageMs = now.getTime() - lastRun.getTime();
      const ageMin = Math.round(ageMs / 60000);

      console.log(`  Status: ${hb.status}`);
      console.log(`  Last run: ${lastRun.toISOString()} (${ageMin} minutes ago)`);
      console.log(`  Error count: ${hb.error_count}`);

      if (ageMin > 5) {
        console.log(`  🔴 FAIL: Heartbeat stale (>5 min ago) — reconciler may be stopped`);
      } else if (hb.status === 'ERROR') {
        console.log(`  🔴 FAIL: Reconciler in ERROR state`);
      } else {
        console.log(`  ✅ PASS: Reconciler healthy`);
      }
    }

    console.log();
    console.log('='.repeat(70));
    console.log('AUDIT COMPLETE');
    console.log('='.repeat(70));

  } catch (err) {
    console.error('AUDIT ERROR:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
