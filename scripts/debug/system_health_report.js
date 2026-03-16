#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const scriptName = path.basename(__filename, '.js');
const logFile = path.join(__dirname, `${scriptName}.log`);

const logStream = fs.createWriteStream(logFile, { flags: 'a' });
const originalLog = console.log;
console.log = (...args) => {
  originalLog(...args);
  logStream.write(args.join(' ') + '\n');
};

const section = (title) => {
  console.log('');
  console.log(title);
};

const run = async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    originalLog('====================================');
    originalLog(scriptName);
    originalLog(`Generated: ${new Date().toISOString()}`);
    originalLog('====================================');

    // CONTEST LIFECYCLE OVERVIEW
    section('CONTEST LIFECYCLE OVERVIEW');
    let result = await pool.query(`
      SELECT
        id,
        contest_name,
        status,
        provider_event_id,
        lock_time,
        tournament_start_time,
        created_at
      FROM contest_instances
      ORDER BY created_at DESC
      LIMIT 20
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // LATEST INGESTION SNAPSHOTS
    section('LATEST INGESTION SNAPSHOTS');
    result = await pool.query(`
      SELECT
        contest_instance_id,
        provider_event_id,
        provider_final_flag,
        ingested_at
      FROM event_data_snapshots
      ORDER BY ingested_at DESC
      LIMIT 20
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // STUCK LIVE CONTESTS (no finality)
    section('STUCK LIVE CONTESTS (no finality)');
    result = await pool.query(`
      SELECT
        ci.id,
        ci.contest_name,
        MAX(s.ingested_at) AS last_snapshot,
        BOOL_OR(s.provider_final_flag) AS final_seen
      FROM contest_instances ci
      JOIN event_data_snapshots s
        ON s.contest_instance_id = ci.id
      WHERE ci.status = 'LIVE'
      GROUP BY ci.id, ci.contest_name
      HAVING BOOL_OR(s.provider_final_flag) = false
      ORDER BY last_snapshot DESC
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // FINAL SNAPSHOTS WITHOUT COMPLETION
    section('FINAL SNAPSHOTS WITHOUT COMPLETION');
    result = await pool.query(`
      SELECT
        s.contest_instance_id,
        ci.contest_name,
        ci.status,
        MAX(s.ingested_at) AS final_snapshot_time
      FROM event_data_snapshots s
      JOIN contest_instances ci
        ON ci.id = s.contest_instance_id
      WHERE s.provider_final_flag = true
      AND ci.status != 'COMPLETE'
      GROUP BY s.contest_instance_id, ci.contest_name, ci.status
      ORDER BY final_snapshot_time DESC
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // RECENT SETTLEMENT RECORDS
    section('RECENT SETTLEMENT RECORDS');
    result = await pool.query(`
      SELECT
        contest_instance_id,
        participant_count,
        total_pool_cents,
        created_at
      FROM settlement_records
      ORDER BY created_at DESC
      LIMIT 20
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SNAPSHOT COUNTS PER CONTEST
    section('SNAPSHOT COUNTS PER CONTEST');
    result = await pool.query(`
      SELECT
        contest_instance_id,
        COUNT(*) AS snapshots,
        MAX(ingested_at) AS last_snapshot
      FROM event_data_snapshots
      GROUP BY contest_instance_id
      ORDER BY last_snapshot DESC
      LIMIT 20
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    console.log('');
    console.log('====================================');
    console.log('SYSTEM HEALTH REPORT COMPLETE');
    console.log('====================================');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
    logStream.end();
  }
};

run();
