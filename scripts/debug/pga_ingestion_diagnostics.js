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
  console.log('====================================');
  console.log(title);
  console.log('====================================');
  console.log('');
};

const run = async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    originalLog('====================================');
    originalLog('PGA INGESTION DIAGNOSTICS');
    originalLog(`Generated: ${new Date().toISOString()}`);
    originalLog('====================================');

    // SECTION 1 — Active PGA Events (via Templates)
    section('SECTION 1 — Active PGA Events (via Templates)');
    let result = await pool.query(`
      SELECT
        id,
        name,
        sport,
        status,
        created_at,
        updated_at
      FROM contest_templates
      WHERE sport = 'GOLF'
      ORDER BY updated_at DESC
      LIMIT 10
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 2 — Contest Templates
    section('SECTION 2 — Contest Templates');
    result = await pool.query(`
      SELECT
        id,
        provider_tournament_id,
        season_year,
        status,
        created_at
      FROM contest_templates
      WHERE sport = 'GOLF'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 3 — Contest Instances
    section('SECTION 3 — Contest Instances');
    result = await pool.query(`
      SELECT
        id,
        template_id,
        status,
        entry_fee_cents,
        created_at
      FROM contest_instances
      ORDER BY created_at DESC
      LIMIT 10
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 4 — Ingestion Events
    section('SECTION 4 — Ingestion Events');
    result = await pool.query(`
      SELECT
        event_type,
        provider,
        validation_status,
        created_at
      FROM ingestion_events
      ORDER BY created_at DESC
      LIMIT 25
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 5 — Snapshot Data
    section('SECTION 5 — Snapshot Data');
    result = await pool.query(`
      SELECT
        provider_event_id,
        snapshot_hash,
        ingested_at
      FROM event_data_snapshots
      ORDER BY ingested_at DESC
      LIMIT 20
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 6 — Golfer Scores
    section('SECTION 6 — Golfer Scores');
    result = await pool.query(`
      SELECT
        golfer_id,
        created_at
      FROM golfer_event_scores
      LIMIT 20
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 7 — Row Counts (Quick Health Check)
    section('SECTION 7 — Row Counts (Quick Health Check)');
    result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM ingestion_events) AS ingestion_events,
        (SELECT COUNT(*) FROM event_data_snapshots) AS snapshots,
        (SELECT COUNT(*) FROM golfer_event_scores) AS golfer_scores
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    section('DIAGNOSTICS COMPLETE');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
    logStream.end();
  }
};

run();
