#!/usr/bin/env node
/**
 * Final Snapshot Readiness Audit Script
 *
 * READ-ONLY diagnostic — no mutations.
 * Checks staging DB for FINAL snapshot readiness per contest.
 *
 * Usage:
 *   DATABASE_URL=<staging_url> node backend/debug/auditFinalSnapshotReadiness.js
 *
 * Environment:
 *   DATABASE_URL — Required. Points to staging or test DB.
 */

const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('FAIL: DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  try {
    const now = new Date();
    console.log('='.repeat(70));
    console.log('FINAL SNAPSHOT READINESS AUDIT');
    console.log(`Timestamp: ${now.toISOString()}`);
    console.log('='.repeat(70));
    console.log();

    // ── Section 1: LIVE contests and their snapshot state ──
    const liveResult = await pool.query(`
      SELECT
        ci.id,
        ci.contest_name,
        ci.tournament_end_time,
        ci.provider_event_id,
        tc.provider_event_id AS tc_provider_event_id,
        ct.settlement_strategy_key,
        ct.sport
      FROM contest_instances ci
      LEFT JOIN contest_templates ct ON ct.id = ci.template_id
      LEFT JOIN tournament_configs tc ON tc.contest_instance_id = ci.id
      WHERE ci.status = 'LIVE'
      ORDER BY ci.tournament_end_time ASC NULLS LAST
    `);

    console.log(`── LIVE CONTESTS (${liveResult.rows.length} total) ──`);

    for (const row of liveResult.rows) {
      const providerEventId = row.provider_event_id || row.tc_provider_event_id;
      const endTime = row.tournament_end_time ? new Date(row.tournament_end_time) : null;
      const pastEnd = endTime && endTime <= now;

      console.log();
      console.log(`  Contest: ${row.id}`);
      console.log(`    Name: ${row.contest_name}`);
      console.log(`    Sport: ${row.sport || 'unknown'}`);
      console.log(`    Provider Event ID: ${providerEventId || 'NONE'}`);
      console.log(`    Tournament end: ${endTime ? endTime.toISOString() : 'NULL'}`);
      console.log(`    Past end time: ${pastEnd ? 'YES' : 'NO'}`);

      // ── All snapshots for this contest ──
      const snapshotsResult = await pool.query(`
        SELECT
          id,
          snapshot_hash,
          provider_event_id,
          provider_final_flag,
          ingested_at
        FROM event_data_snapshots
        WHERE contest_instance_id = $1
        ORDER BY ingested_at DESC
        LIMIT 10
      `, [row.id]);

      console.log(`    Snapshots (total): ${snapshotsResult.rows.length}`);

      if (snapshotsResult.rows.length === 0) {
        console.log(`    🔴 NO SNAPSHOTS AT ALL — ingestion may not be running for this contest`);
      } else {
        const latest = snapshotsResult.rows[0];
        const latestAge = Math.round((now.getTime() - new Date(latest.ingested_at).getTime()) / 60000);
        console.log(`    Latest snapshot: ${latest.id}`);
        console.log(`      ingested_at: ${latest.ingested_at} (${latestAge} min ago)`);
        console.log(`      provider_final_flag: ${latest.provider_final_flag}`);
        console.log(`      snapshot_hash: ${latest.snapshot_hash.substring(0, 16)}...`);

        const finalSnaps = snapshotsResult.rows.filter(s => s.provider_final_flag === true);
        if (finalSnaps.length > 0) {
          console.log(`    ✅ FINAL snapshot EXISTS: ${finalSnaps[0].id} (ingested ${finalSnaps[0].ingested_at})`);
        } else {
          console.log(`    ⚠️  No FINAL snapshot yet (provider_final_flag=true not found)`);
          console.log(`    → This is EXPECTED if tournament is still in progress`);
        }

        // ── Snapshot freshness (is ingestion still running?) ──
        if (latestAge > 10) {
          console.log(`    🔴 STALE: Last snapshot is ${latestAge} min old — ingestion may be stopped`);
        } else if (latestAge > 2) {
          console.log(`    ⚠️  Last snapshot is ${latestAge} min old`);
        } else {
          console.log(`    ✅ Ingestion is fresh (${latestAge} min ago)`);
        }
      }

      // ── Distinct snapshot hashes (score change detection) ──
      const hashCountResult = await pool.query(`
        SELECT COUNT(DISTINCT snapshot_hash)::int AS cnt
        FROM event_data_snapshots
        WHERE contest_instance_id = $1
      `, [row.id]);
      console.log(`    Distinct snapshot hashes: ${hashCountResult.rows[0].cnt}`);

      // ── Golfer scores freshness ──
      const scoresResult = await pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(DISTINCT round_number)::int AS rounds,
          MAX(created_at) AS last_created
        FROM golfer_event_scores
        WHERE contest_instance_id = $1
      `, [row.id]);

      const scores = scoresResult.rows[0];
      if (scores.total > 0) {
        const scoreAge = scores.last_created
          ? Math.round((now.getTime() - new Date(scores.last_created).getTime()) / 60000)
          : null;
        console.log(`    Golfer scores: ${scores.total} (${scores.rounds} rounds)`);
        if (scoreAge !== null) {
          console.log(`    Last score created: ${scoreAge} min ago`);
        }
      } else {
        console.log(`    Golfer scores: 0 (tournament may not have started)`);
      }
    }

    console.log();

    // ── Section 2: Ingestion worker health ──
    console.log('── INGESTION WORKER STATUS ──');
    const ingestionHb = await pool.query(`
      SELECT worker_name, status, last_run_at, error_count, metadata
      FROM worker_heartbeats
      WHERE worker_name = 'ingestion_worker'
    `);

    if (ingestionHb.rows.length === 0) {
      console.log('  🔴 No heartbeat found — ingestion worker may not be running');
    } else {
      const hb = ingestionHb.rows[0];
      const lastRun = new Date(hb.last_run_at);
      const ageMin = Math.round((now.getTime() - lastRun.getTime()) / 60000);
      console.log(`  Status: ${hb.status}`);
      console.log(`  Last run: ${lastRun.toISOString()} (${ageMin} min ago)`);
      console.log(`  Error count: ${hb.error_count}`);
      if (hb.metadata) {
        console.log(`  Metadata: ${JSON.stringify(hb.metadata)}`);
      }
      if (ageMin > 5) {
        console.log(`  🔴 Heartbeat stale (>5 min)  — ingestion worker may be stopped`);
      } else if (hb.status === 'ERROR') {
        console.log(`  🔴 Ingestion worker in ERROR state`);
      } else {
        console.log(`  ✅ Ingestion worker healthy`);
      }
    }

    console.log();

    // ── Section 3: FINAL flag production timeline ──
    console.log('── FINAL FLAG PRODUCTION ANALYSIS ──');
    console.log('  provider_final_flag is set when ESPN event API returns:');
    console.log('    status.type.completed === true  OR');
    console.log('    status.type.name === "STATUS_FINAL"');
    console.log();
    console.log('  This is EVENT-BASED (not time-based):');
    console.log('    → ESPN marks the event complete AFTER the final round ends');
    console.log('    → For PGA events: typically Sunday evening (after final putt)');
    console.log('    → Ingestion worker picks up the flag within 5 seconds (LIVE polling)');
    console.log('    → Lifecycle reconciler settles within 30 seconds of FINAL snapshot');
    console.log();

    for (const row of liveResult.rows) {
      const endTime = row.tournament_end_time ? new Date(row.tournament_end_time) : null;
      if (endTime) {
        console.log(`  ${row.contest_name}:`);
        console.log(`    tournament_end_time: ${endTime.toISOString()}`);
        if (endTime > now) {
          const hoursUntil = Math.round((endTime.getTime() - now.getTime()) / 3600000 * 10) / 10;
          console.log(`    Time until end: ${hoursUntil} hours`);
          console.log(`    Settlement will trigger: AFTER ESPN marks event complete (post-tournament_end_time)`);
        } else {
          console.log(`    ⚠️  Past tournament_end_time — waiting for ESPN FINAL signal`);
        }
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
