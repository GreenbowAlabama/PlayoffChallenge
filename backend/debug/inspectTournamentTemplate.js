#!/usr/bin/env node

/**
 * DEBUG SCRIPT: Tournament Template + Scoring Config Audit
 *
 * OBJECTIVE:
 * Inspect tournament_configs, contest_templates, and golfer_event_scores
 * Using ONLY verified schema fields
 *
 * READ-ONLY: No mutations, schema-compliant, safe table probes
 */

const { Pool } = require('pg');

async function inspectTournamentTemplate() {
  const contestInstanceId = process.argv[2];

  if (!contestInstanceId) {
    console.error('Usage: node inspectTournamentTemplate.js <contest_instance_id>');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
    statement_timeout: 30000,
  });

  try {
    console.log(`\n========================================`);
    console.log(`TOURNAMENT TEMPLATE + SCORING CONFIG AUDIT`);
    console.log(`Contest Instance: ${contestInstanceId}`);
    console.log(`========================================\n`);

    // STEP 1: Fetch contest_instances + tournament_configs
    console.log(`[STEP 1] Fetching contest_instances + tournament_configs...\n`);

    const configResult = await pool.query(
      `
      SELECT
        ci.id,
        ci.template_id,
        ci.entry_fee_cents,
        ci.status,
        ci.start_time,
        ci.lock_time,
        ci.end_time,
        ci.settle_time,
        ci.tournament_start_time,
        ci.tournament_end_time,
        ci.contest_name,
        ci.created_at,
        ci.updated_at,
        tc.id as tournament_config_id,
        tc.provider_event_id,
        tc.event_start_date,
        tc.event_end_date,
        tc.round_count,
        tc.cut_after_round,
        tc.leaderboard_schema_version,
        tc.field_source,
        tc.is_active,
        tc.created_at as tc_created_at
      FROM contest_instances ci
      LEFT JOIN tournament_configs tc ON tc.contest_instance_id = ci.id
      WHERE ci.id = $1
      `,
      [contestInstanceId]
    );

    if (configResult.rows.length === 0) {
      console.log(`ERROR: Contest instance not found.\n`);
      process.exit(1);
    }

    const contestRow = configResult.rows[0];

    console.log(`=== CONTEST INSTANCE + TOURNAMENT CONFIG ===\n`);
    console.log(JSON.stringify(contestRow, null, 2));
    console.log();

    // STEP 2: Fetch full tournament_configs row
    if (contestRow.tournament_config_id) {
      console.log(`[STEP 2] Fetching FULL tournament_configs row...\n`);
      console.log(`=== FULL TOURNAMENT_CONFIG ROW ===\n`);
      const fullConfigResult = await pool.query(
        `SELECT * FROM tournament_configs WHERE id = $1`,
        [contestRow.tournament_config_id]
      );
      if (fullConfigResult.rows.length > 0) {
        console.log(JSON.stringify(fullConfigResult.rows[0], null, 2));
      }
      console.log();
    }

    // STEP 3: Round distribution in golfer_event_scores
    console.log(`[STEP 3] Fetching round distribution...\n`);
    console.log(`=== ROUND DISTRIBUTION ===\n`);

    const roundsResult = await pool.query(
      `
      SELECT
        round_number,
        COUNT(*) as row_count,
        SUM(total_points) as total_points_sum
      FROM golfer_event_scores
      WHERE contest_instance_id = $1
      GROUP BY round_number
      ORDER BY round_number
      `,
      [contestInstanceId]
    );

    if (roundsResult.rows.length === 0) {
      console.log(`No golfer_event_scores found for this contest.\n`);
    } else {
      console.log(JSON.stringify(roundsResult.rows, null, 2));
    }
    console.log();

    // STEP 4: Sample raw scores from golfer_event_scores
    console.log(`[STEP 4] Fetching sample raw scores...\n`);
    console.log(`=== SAMPLE RAW SCORES (golfer_event_scores) ===\n`);

    const sampleScoresResult = await pool.query(
      `
      SELECT
        golfer_id,
        round_number,
        hole_points,
        bonus_points,
        finish_bonus,
        total_points,
        created_at
      FROM golfer_event_scores
      WHERE contest_instance_id = $1
      ORDER BY golfer_id, round_number
      LIMIT 50
      `,
      [contestInstanceId]
    );

    if (sampleScoresResult.rows.length === 0) {
      console.log(`No golfer_event_scores found.\n`);
    } else {
      console.log(JSON.stringify(sampleScoresResult.rows, null, 2));
    }
    console.log();

    // STEP 5: Optional table probes
    console.log(`[STEP 5] Probing optional tables...\n`);

    const optionalTables = [
      'golfer_scores',
      'entry_rosters',
      'contest_templates',
    ];

    for (const tableName of optionalTables) {
      try {
        // Check if table exists
        const checkResult = await pool.query(
          `SELECT to_regclass('public.${tableName}')`
        );

        if (checkResult.rows[0].to_regclass === null) {
          console.log(`=== TABLE: ${tableName} ===`);
          console.log(`❌ Table does not exist\n`);
          continue;
        }

        // Table exists, fetch sample data
        const tableResult = await pool.query(
          `SELECT * FROM ${tableName} LIMIT 20`
        );

        console.log(`=== TABLE: ${tableName} ===`);
        console.log(`(${tableResult.rows.length} rows shown)\n`);
        console.log(JSON.stringify(tableResult.rows, null, 2));
        console.log();

      } catch (err) {
        console.log(`=== TABLE: ${tableName} ===`);
        console.log(`❌ Query error: ${err.message}\n`);
      }
    }

    console.log(`========================================\n`);

  } catch (err) {
    console.error('Error during inspection:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

inspectTournamentTemplate();
