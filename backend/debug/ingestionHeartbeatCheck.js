/**
 * Ingestion Heartbeat Check
 *
 * Proves whether the ingestion worker is running and writing data.
 * Checks ALL potential data tables for the active LIVE contest.
 *
 * Usage:
 *   cd backend && node debug/ingestionHeartbeatCheck.js
 */

'use strict';

const { Pool } = require('pg');

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // ── 1. Find LIVE PGA contest ──────────────────────────────────────────
    const contestResult = await pool.query(
      `SELECT ci.id AS contest_id, ci.contest_name, ci.status, ci.provider_event_id,
              ci.tournament_start_time, ci.tournament_end_time
       FROM contest_instances ci
       JOIN contest_templates ct ON ct.id = ci.template_id
       WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
         AND ci.status = 'LIVE'
       ORDER BY ci.tournament_start_time DESC
       LIMIT 1`
    );

    if (contestResult.rows.length === 0) {
      console.log('NO LIVE PGA CONTEST FOUND');
      process.exit(1);
    }

    const contest = contestResult.rows[0];
    console.log('=== INGESTION HEARTBEAT CHECK ===\n');
    console.log(`Contest: ${contest.contest_name}`);
    console.log(`ID: ${contest.contest_id}`);
    console.log(`Status: ${contest.status}`);
    console.log(`Provider Event: ${contest.provider_event_id}`);
    console.log(`Tournament Start: ${contest.tournament_start_time}`);
    console.log(`Tournament End: ${contest.tournament_end_time}`);
    console.log('');

    // ── 2. Check ingestion_events (last 10) ───────────────────────────────
    console.log('--- TABLE: ingestion_events ---');
    const ingestionRows = await pool.query(
      `SELECT id, created_at, validated_at, provider, event_type, payload_hash,
              LENGTH(provider_data_json::text) AS payload_size
       FROM ingestion_events
       WHERE contest_instance_id = $1
       ORDER BY COALESCE(validated_at, created_at) DESC
       LIMIT 10`,
      [contest.contest_id]
    );
    console.log(`Rows found: ${ingestionRows.rows.length}`);
    ingestionRows.rows.forEach((r, i) => {
      console.log(`  [${i}] id=${r.id} created=${r.created_at} validated=${r.validated_at} provider=${r.provider} type=${r.event_type} hash=${r.payload_hash?.substring(0,12)}... size=${r.payload_size}bytes`);
    });
    console.log('');

    // ── 3. Check event_data_snapshots (last 10) ──────────────────────────
    console.log('--- TABLE: event_data_snapshots ---');
    const snapshots = await pool.query(
      `SELECT id, ingested_at, snapshot_hash, provider_event_id, provider_final_flag,
              LENGTH(payload::text) AS payload_size
       FROM event_data_snapshots
       WHERE contest_instance_id = $1
       ORDER BY ingested_at DESC
       LIMIT 10`,
      [contest.contest_id]
    );
    console.log(`Rows found: ${snapshots.rows.length}`);
    snapshots.rows.forEach((r, i) => {
      console.log(`  [${i}] id=${r.id} ingested=${r.ingested_at} hash=${r.snapshot_hash?.substring(0,12)}... event=${r.provider_event_id} final=${r.provider_final_flag} size=${r.payload_size}bytes`);
    });
    console.log('');

    // ── 4. Check golfer_event_scores ────────────────────────────────────
    console.log('--- TABLE: golfer_event_scores ---');
    const gesCount = await pool.query(
      `SELECT round_number, COUNT(*) AS golfer_count, MAX(created_at) AS latest_created
       FROM golfer_event_scores
       WHERE contest_instance_id = $1
       GROUP BY round_number
       ORDER BY round_number`,
      [contest.contest_id]
    );
    console.log(`Rounds found: ${gesCount.rows.length}`);
    gesCount.rows.forEach(r => {
      console.log(`  Round ${r.round_number}: ${r.golfer_count} golfers, latest=${r.latest_created}`);
    });
    console.log('');

    // ── 5. Check golfer_scores ──────────────────────────────────────────
    console.log('--- TABLE: golfer_scores ---');
    const gsCount = await pool.query(
      `SELECT COUNT(*) AS total, MAX(created_at) AS latest_created
       FROM golfer_scores
       WHERE contest_instance_id = $1`,
      [contest.contest_id]
    );
    console.log(`Rows: ${gsCount.rows[0].total}, Latest: ${gsCount.rows[0].latest_created}`);
    console.log('');

    // ── 6. Check worker_heartbeats ──────────────────────────────────────
    console.log('--- TABLE: worker_heartbeats ---');
    const heartbeats = await pool.query(
      `SELECT worker_name, status, last_heartbeat_at, metadata
       FROM worker_heartbeats
       ORDER BY last_heartbeat_at DESC`
    );
    console.log(`Workers found: ${heartbeats.rows.length}`);
    heartbeats.rows.forEach(r => {
      console.log(`  ${r.worker_name}: status=${r.status} last_beat=${r.last_heartbeat_at}`);
    });
    console.log('');

    // ── 7. Peek at latest snapshot payload structure ─────────────────────
    if (snapshots.rows.length > 0) {
      console.log('--- LATEST SNAPSHOT PAYLOAD STRUCTURE ---');
      const latestPayload = await pool.query(
        `SELECT payload FROM event_data_snapshots WHERE id = $1`,
        [snapshots.rows[0].id]
      );
      const payload = latestPayload.rows[0].payload;
      if (payload) {
        const topKeys = Object.keys(payload);
        console.log(`Top-level keys: ${topKeys.join(', ')}`);

        if (Array.isArray(payload.competitors)) {
          console.log(`competitors[]: ${payload.competitors.length} entries`);
          if (payload.competitors[0]) {
            const sample = payload.competitors[0];
            console.log(`  Sample competitor keys: ${Object.keys(sample).join(', ')}`);
            console.log(`  Has .score: ${sample.score !== undefined}`);
            console.log(`  Has .linescores: ${Array.isArray(sample.linescores)}`);
            if (Array.isArray(sample.linescores)) {
              console.log(`  Linescores count: ${sample.linescores.length}`);
            }
          }
        } else if (Array.isArray(payload.events)) {
          console.log(`events[]: ${payload.events.length} entries`);
          const event = payload.events[0];
          if (event?.competitions?.[0]?.competitors) {
            const competitors = event.competitions[0].competitors;
            console.log(`  competitors[]: ${competitors.length} entries`);
            if (competitors[0]) {
              console.log(`  Sample competitor keys: ${Object.keys(competitors[0]).join(', ')}`);
              console.log(`  Has .score: ${competitors[0].score !== undefined}`);
            }
          }
        } else {
          console.log('  WARNING: No competitors or events array found');
          console.log(`  Payload preview: ${JSON.stringify(payload).substring(0, 300)}`);
        }
      }
    }

    // ── 8. Peek at latest ingestion_events payload structure ──────────────
    if (ingestionRows.rows.length > 0) {
      console.log('\n--- LATEST INGESTION_EVENTS PAYLOAD STRUCTURE ---');
      const latestIngestion = await pool.query(
        `SELECT provider_data_json FROM ingestion_events WHERE id = $1`,
        [ingestionRows.rows[0].id]
      );
      const raw = latestIngestion.rows[0].provider_data_json;
      const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (payload) {
        const topKeys = Object.keys(payload);
        console.log(`Top-level keys: ${topKeys.join(', ')}`);

        if (Array.isArray(payload.competitors)) {
          console.log(`competitors[]: ${payload.competitors.length} entries`);
        } else if (Array.isArray(payload.events)) {
          console.log(`events[]: ${payload.events.length} entries`);
        } else {
          console.log(`WARNING: Unrecognized structure`);
          console.log(`Payload preview: ${JSON.stringify(payload).substring(0, 500)}`);
        }
      } else {
        console.log('Payload is null/empty');
      }
    }

    // ── 9. VERDICT ───────────────────────────────────────────────────────
    console.log('\n=== VERDICT ===\n');

    const snapshotCount = snapshots.rows.length;
    const ingestionCount = ingestionRows.rows.length;
    const gesRounds = gesCount.rows.length;

    if (snapshotCount > 1) {
      const times = snapshots.rows.map(r => new Date(r.ingested_at).getTime());
      const timeDiffs = [];
      for (let i = 0; i < times.length - 1; i++) {
        timeDiffs.push(times[i] - times[i + 1]);
      }
      const avgDiffSec = (timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000).toFixed(1);
      console.log(`INGESTION HEARTBEAT: RUNNING (${snapshotCount} snapshots, avg ${avgDiffSec}s apart)`);
    } else if (snapshotCount === 1) {
      console.log(`INGESTION HEARTBEAT: UNCERTAIN (only 1 snapshot found)`);
    } else {
      console.log('INGESTION HEARTBEAT: NOT RUNNING (0 snapshots)');
    }

    if (snapshotCount > 0 && snapshots.rows[0].payload_size > 100) {
      console.log('DATA QUALITY: VALID (snapshots have payload data)');
    } else if (ingestionCount > 0 && ingestionRows.rows[0].payload_size > 100) {
      console.log('DATA QUALITY: VALID (ingestion_events have payload data)');
    } else {
      console.log('DATA QUALITY: EMPTY OR BROKEN');
    }

    console.log(`\nREAL-TIME DATA SOURCE:`);
    console.log(`  event_data_snapshots: ${snapshotCount} rows (NORMALIZED — complete rounds only)`);
    console.log(`  ingestion_events: ${ingestionCount} rows (RAW — full ESPN payload)`);
    console.log(`  golfer_event_scores: ${gesRounds} rounds scored`);

  } finally {
    await pool.end();
  }
}

run().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
