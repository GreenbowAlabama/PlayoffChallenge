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

const section = (title, description = '') => {
  console.log('');
  console.log('====================================');
  console.log(title);
  console.log('====================================');
  if (description) console.log(`Query: ${description}`);
  console.log('');
};

const run = async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    originalLog('====================================');
    originalLog('PGA LEADERBOARD PIPELINE DIAGNOSTICS');
    originalLog(`Generated: ${new Date().toISOString()}`);
    originalLog('====================================');

    // SECTION 1
    section('SECTION 1 — Identify Active PGA Contest', 'Find most recent LIVE/COMPLETE PGA contest');
    let result = await pool.query(`
      SELECT
        ci.id as contest_instance_id,
        ci.status,
        ci.tournament_start_time,
        ci.tournament_end_time,
        ci.template_id,
        ct.sport as template_sport
      FROM contest_instances ci
      JOIN contest_templates ct ON ct.id = ci.template_id
      WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
        AND ci.status IN ('LIVE', 'COMPLETE')
      ORDER BY ci.tournament_start_time DESC
      LIMIT 1
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 2
    section('SECTION 2 — Verify Snapshots Exist for Active Contest', 'Count event_data_snapshots per contest_instance_id');
    result = await pool.query(`
      SELECT
        contest_instance_id,
        COUNT(*) as snapshot_count,
        MAX(ingested_at) as latest_snapshot_time,
        MIN(ingested_at) as earliest_snapshot_time
      FROM event_data_snapshots
      GROUP BY contest_instance_id
      ORDER BY MAX(ingested_at) DESC
      LIMIT 10
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 3
    section('SECTION 3 — Inspect Snapshot Payload Structure', "Sample snapshot payloads and their structure");
    result = await pool.query(`
      SELECT
        id,
        contest_instance_id,
        provider_event_id,
        ingested_at,
        snapshot_hash
      FROM event_data_snapshots
      ORDER BY ingested_at DESC
      LIMIT 5
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 3b
    section('SECTION 3b — Sample Payload Structure (First Snapshot)', 'Extract first snapshot to inspect competitors array structure');
    result = await pool.query(`
      SELECT
        id,
        contest_instance_id,
        provider_event_id,
        payload -> 'competitors' as competitors_array_sample,
        jsonb_array_length(payload -> 'competitors') as competitor_count
      FROM event_data_snapshots
      ORDER BY ingested_at DESC
      LIMIT 1
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 4
    section('SECTION 4 — Count Golfer Scores by Contest', 'Verify golfer_event_scores table has data linked to contests');
    result = await pool.query(`
      SELECT
        contest_instance_id,
        COUNT(*) as golfer_score_count,
        COUNT(DISTINCT golfer_id) as unique_golfer_count,
        MAX(created_at) as latest_score_time
      FROM golfer_event_scores
      GROUP BY contest_instance_id
      ORDER BY MAX(created_at) DESC
      LIMIT 10
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 5
    section('SECTION 5 — Verify Golfer ID Matching Between Snapshot & Scores', 'Extract competitor_ids from snapshot payloads and compare with golfer_event_scores');
    result = await pool.query(`
      WITH snapshot_competitors AS (
        SELECT
          eds.contest_instance_id,
          eds.id as snapshot_id,
          (jsonb_array_elements(eds.payload -> 'competitors') -> 'id')::text as competitor_id_from_snapshot
        FROM event_data_snapshots eds
      ),
      snapshot_distinct_competitors AS (
        SELECT
          contest_instance_id,
          COUNT(DISTINCT competitor_id_from_snapshot) as competitors_in_snapshots,
          jsonb_agg(DISTINCT competitor_id_from_snapshot) as snapshot_competitor_ids
        FROM snapshot_competitors
        GROUP BY contest_instance_id
      ),
      score_golfers AS (
        SELECT
          contest_instance_id,
          COUNT(DISTINCT golfer_id) as golfers_in_scores,
          jsonb_agg(DISTINCT golfer_id::text) as score_golfer_ids
        FROM golfer_event_scores
        GROUP BY contest_instance_id
      )
      SELECT
        COALESCE(sdc.contest_instance_id, sg.contest_instance_id) as contest_instance_id,
        COALESCE(sdc.competitors_in_snapshots, 0) as competitors_in_snapshots,
        COALESCE(sg.golfers_in_scores, 0) as golfers_in_scores,
        CASE
          WHEN sdc.competitors_in_snapshots = sg.golfers_in_scores THEN 'MATCH ✓'
          WHEN sdc.competitors_in_snapshots = 0 THEN 'NO_SNAPSHOTS'
          WHEN sg.golfers_in_scores = 0 THEN 'NO_SCORES'
          ELSE 'MISMATCH'
        END as alignment_status
      FROM snapshot_distinct_competitors sdc
      FULL OUTER JOIN score_golfers sg
        ON sdc.contest_instance_id = sg.contest_instance_id
      ORDER BY COALESCE(sdc.contest_instance_id, sg.contest_instance_id)
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 5b
    section('SECTION 5b — Competitor IDs in Snapshots (Active Contest)', 'List all competitor_ids extracted from snapshot payloads');
    result = await pool.query(`
      WITH active_contest AS (
        SELECT ci.id
        FROM contest_instances ci
        JOIN contest_templates ct ON ct.id = ci.template_id
        WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
          AND ci.status IN ('LIVE', 'COMPLETE')
        ORDER BY ci.tournament_start_time DESC
        LIMIT 1
      ),
      snapshot_competitors AS (
        SELECT
          DISTINCT (jsonb_array_elements(eds.payload -> 'competitors') -> 'id')::text as competitor_id
        FROM event_data_snapshots eds
        WHERE eds.contest_instance_id = (SELECT id FROM active_contest)
      )
      SELECT
        COUNT(*) as competitor_count,
        string_agg(competitor_id, ', ' ORDER BY competitor_id) as competitor_ids
      FROM snapshot_competitors
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 5c
    section('SECTION 5c — Golfer IDs in golfer_event_scores (Active Contest)', 'List all unique golfer_ids in golfer_event_scores');
    result = await pool.query(`
      WITH active_contest AS (
        SELECT ci.id
        FROM contest_instances ci
        JOIN contest_templates ct ON ct.id = ci.template_id
        WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
          AND ci.status IN ('LIVE', 'COMPLETE')
        ORDER BY ci.tournament_start_time DESC
        LIMIT 1
      )
      SELECT
        COUNT(DISTINCT golfer_id) as unique_golfer_count,
        string_agg(DISTINCT golfer_id, ', ' ORDER BY golfer_id) as golfer_ids
      FROM golfer_event_scores
      WHERE contest_instance_id = (SELECT id FROM active_contest)
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 6
    section('SECTION 6 — Inspect Ingestion Pipeline Execution', 'Ingestion event types and validation status (shows pipeline phases)');
    result = await pool.query(`
      SELECT
        event_type,
        validation_status,
        COUNT(*) as count,
        MAX(validated_at) as latest_execution
      FROM ingestion_events
      GROUP BY event_type, validation_status
      ORDER BY MAX(validated_at) DESC
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 6b
    section('SECTION 6b — Ingestion Events for Active Contest', 'Pipeline phases executed for the most recent PGA contest');
    result = await pool.query(`
      WITH active_contest AS (
        SELECT ci.id
        FROM contest_instances ci
        JOIN contest_templates ct ON ct.id = ci.template_id
        WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
          AND ci.status IN ('LIVE', 'COMPLETE')
        ORDER BY ci.tournament_start_time DESC
        LIMIT 1
      )
      SELECT
        event_type,
        validation_status,
        COUNT(*) as count,
        MAX(created_at) as latest_execution,
        MIN(created_at) as earliest_execution
      FROM ingestion_events
      WHERE contest_instance_id = (SELECT id FROM active_contest)
      GROUP BY event_type, validation_status
      ORDER BY MAX(created_at) DESC
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    // SECTION 7
    section('SECTION 7 — Pipeline Health Summary', 'Quick row count check across critical tables');
    result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM contest_instances WHERE status IN ('LIVE', 'COMPLETE')) as active_contests,
        (SELECT COUNT(*) FROM contest_templates WHERE sport IN ('PGA', 'pga', 'GOLF', 'golf')) as pga_templates,
        (SELECT COUNT(*) FROM event_data_snapshots) as total_snapshots,
        (SELECT COUNT(*) FROM golfer_event_scores) as total_golfer_scores,
        (SELECT COUNT(*) FROM ingestion_events) as total_ingestion_events,
        (SELECT COUNT(*) FROM ingestion_events WHERE validation_status = 'VALID') as valid_ingestion_events
    `);
    console.log(JSON.stringify(result.rows, null, 2));

    section('DIAGNOSTICS COMPLETE');
    console.log('Analysis Steps:');
    console.log('1. Check SECTION 1 — Does an active PGA contest exist?');
    console.log('2. Check SECTION 2 — Does that contest have snapshots?');
    console.log('3. Check SECTION 3 — Are snapshots properly structured with "competitors" key?');
    console.log('4. Check SECTION 4 — Are golfer_event_scores populated?');
    console.log('5. Check SECTION 5 — Do competitor IDs in snapshots match golfer_event_scores?');
    console.log('6. Check SECTION 6 — Which ingestion phases executed?');
    console.log('');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
    logStream.end();
  }
};

run();
