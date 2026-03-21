#!/usr/bin/env node
/**
 * Scoring Rules Dump — Full Audit
 *
 * Extracts every piece of data that influences scoring for a single contest.
 * READ-ONLY diagnostic — no mutations.
 *
 * Usage:
 *   TEST_DB_ALLOW_DBNAME=railway node backend/debug/dumpScoringRules.js > /tmp/scoring_dump.json
 *
 * Output: Complete JSON snapshot of scoring pipeline inputs
 *   - contest config & template
 *   - scoring rules
 *   - golfer scores (raw ingestion)
 *   - entry rosters (user picks)
 *   - derived scoring data
 *   - summary statistics
 */

const { Pool } = require('pg');

// ═══════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

const CONTEST_ID = 'f6d203fc-bd90-4351-915f-6bb44c292480';

// ═══════════════════════════════════════════════════════════════════════
// DATABASE CONNECTION
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  const output = {
    metadata: {
      contest_id: CONTEST_ID,
      exported_at: new Date().toISOString(),
      queries_executed: []
    },
    contest: null,
    template: null,
    scoring_rules: [],
    golfer_scores: [],
    entry_rosters: [],
    contest_participants: [],
    scoring_audit_samples: [],
    summary: {
      total_golfers: 0,
      rounds_present: [],
      total_score_rows: 0,
      distinct_rounds_detected: 0,
      total_entries: 0,
      total_participants: 0
    }
  };

  try {
    // ════════════════════════════════════════════════════════════════════
    // A) CONTEST + TEMPLATE
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching contest instance...');
    const contestRes = await pool.query(`
      SELECT
        ci.id,
        ci.template_id,
        ci.organizer_id,
        ci.contest_name,
        ci.entry_fee_cents,
        ci.payout_structure,
        ci.status,
        ci.start_time,
        ci.lock_time,
        ci.tournament_start_time,
        ci.tournament_end_time,
        ci.max_entries,
        ci.created_at,
        ci.updated_at
      FROM contest_instances ci
      WHERE ci.id = $1
    `, [CONTEST_ID]);

    if (contestRes.rows.length === 0) {
      console.error(`ERROR: Contest ${CONTEST_ID} not found`);
      process.exit(1);
    }

    output.contest = contestRes.rows[0];
    output.metadata.queries_executed.push('contest_instances');

    console.error('Fetching contest template...');
    const templateRes = await pool.query(`
      SELECT
        id,
        name,
        sport,
        template_type,
        scoring_strategy_key,
        lock_strategy_key,
        settlement_strategy_key,
        default_entry_fee_cents,
        allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents,
        allowed_payout_structures,
        lineup_size,
        scoring_count,
        drop_lowest,
        scoring_format,
        provider_tournament_id,
        season_year,
        created_at,
        updated_at
      FROM contest_templates
      WHERE id = $1
    `, [output.contest.template_id]);

    if (templateRes.rows.length > 0) {
      output.template = templateRes.rows[0];
      output.metadata.queries_executed.push('contest_templates');
    }

    // ════════════════════════════════════════════════════════════════════
    // B) SCORING RULES CONFIG
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching scoring rules...');
    const rulesRes = await pool.query(`
      SELECT
        id,
        category,
        stat_name,
        points,
        description,
        is_active,
        display_order,
        created_at,
        updated_at
      FROM scoring_rules
      ORDER BY category, display_order, id
    `);

    output.scoring_rules = rulesRes.rows;
    output.metadata.queries_executed.push('scoring_rules');

    // ════════════════════════════════════════════════════════════════════
    // C) GOLFER SCORES (RAW INGESTION OUTPUT)
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching golfer event scores...');
    const golferScoresRes = await pool.query(`
      SELECT
        id,
        contest_instance_id,
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
    `, [CONTEST_ID]);

    output.golfer_scores = golferScoresRes.rows;
    output.metadata.queries_executed.push('golfer_event_scores');

    // Extract summary data
    const roundsSet = new Set();
    const golfersSet = new Set();
    golferScoresRes.rows.forEach(row => {
      roundsSet.add(row.round_number);
      golfersSet.add(row.golfer_id);
    });

    output.summary.total_golfers = golfersSet.size;
    output.summary.rounds_present = Array.from(roundsSet).sort((a, b) => a - b);
    output.summary.total_score_rows = golferScoresRes.rows.length;
    output.summary.distinct_rounds_detected = roundsSet.size;

    // ════════════════════════════════════════════════════════════════════
    // D) ENTRY ROSTERS (USER PICKS)
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching entry rosters...');
    const rostersRes = await pool.query(`
      SELECT
        id,
        contest_instance_id,
        user_id,
        player_ids,
        submitted_at,
        updated_at
      FROM entry_rosters
      WHERE contest_instance_id = $1
      ORDER BY user_id
    `, [CONTEST_ID]);

    output.entry_rosters = rostersRes.rows;
    output.metadata.queries_executed.push('entry_rosters');

    // ════════════════════════════════════════════════════════════════════
    // E) CONTEST PARTICIPANTS
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching contest participants...');
    const participantsRes = await pool.query(`
      SELECT
        id,
        contest_instance_id,
        user_id,
        joined_at
      FROM contest_participants
      WHERE contest_instance_id = $1
      ORDER BY user_id
    `, [CONTEST_ID]);

    output.contest_participants = participantsRes.rows;
    output.metadata.queries_executed.push('contest_participants');
    output.summary.total_participants = participantsRes.rows.length;
    output.summary.total_entries = rostersRes.rows.length;

    // ════════════════════════════════════════════════════════════════════
    // F) SCORING AUDIT SAMPLES (IF AVAILABLE)
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching scoring audit samples...');
    const auditRes = await pool.query(`
      SELECT
        id,
        contest_instance_id,
        tournament_config_id,
        provider_payload_hash,
        scoring_output_hash,
        scoring_json,
        created_at
      FROM scoring_audit
      WHERE contest_instance_id = $1
      ORDER BY created_at DESC
      LIMIT 5
    `, [CONTEST_ID]);

    output.scoring_audit_samples = auditRes.rows;
    output.metadata.queries_executed.push('scoring_audit');

    // ════════════════════════════════════════════════════════════════════
    // OUTPUT
    // ════════════════════════════════════════════════════════════════════

    console.log(JSON.stringify(output, null, 2));

    // ════════════════════════════════════════════════════════════════════
    // SUMMARY (TO STDERR)
    // ════════════════════════════════════════════════════════════════════

    console.error('\n' + '='.repeat(70));
    console.error('SCORING DUMP SUMMARY');
    console.error('='.repeat(70));
    console.error(`Contest: ${output.contest.contest_name} (${CONTEST_ID})`);
    console.error(`Status: ${output.contest.status}`);
    console.error(`Template: ${output.template?.name || 'N/A'}`);
    console.error(`Total Golfers: ${output.summary.total_golfers}`);
    console.error(`Rounds Present: ${output.summary.rounds_present.join(', ')}`);
    console.error(`Total Score Rows: ${output.summary.total_score_rows}`);
    console.error(`Total Entries: ${output.summary.total_entries}`);
    console.error(`Total Participants: ${output.summary.total_participants}`);
    console.error(`Scoring Rules Configured: ${output.scoring_rules.length}`);
    console.error(`Scoring Audit Samples: ${output.scoring_audit_samples.length}`);
    console.error(`Queries Executed: ${output.metadata.queries_executed.join(', ')}`);
    console.error('='.repeat(70));

  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
