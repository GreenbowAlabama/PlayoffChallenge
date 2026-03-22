#!/usr/bin/env node

/**
 * Create Test Contest Script
 *
 * Clones an existing contest_instance with all related records for testing.
 * Idempotent: safe to run multiple times (checks for existing records).
 *
 * Usage:
 *   node scripts/createTestContest.js <source_contest_id> [provider_event_id]
 *
 * Example:
 *   node scripts/createTestContest.js a1b2c3d4-e5f6-7890-abcd-ef1234567890
 *   node scripts/createTestContest.js a1b2c3d4-e5f6-7890-abcd-ef1234567890 espn_pga_test_12345
 */

require('dotenv').config();
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

// Configuration
const SOURCE_CONTEST_ID = process.argv[2];
const OVERRIDE_PROVIDER_EVENT_ID = process.argv[3];

// Pool configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

/**
 * Main execution
 */
async function main() {
  if (!SOURCE_CONTEST_ID) {
    console.error('USAGE: node scripts/createTestContest.js <source_contest_id> [provider_event_id]');
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');

    // ─────────────────────────────────────────────────────────────────────
    // STEP 1: Load source contest_instance
    // ─────────────────────────────────────────────────────────────────────
    const sourceContestResult = await client.query(
      `SELECT
         id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
         start_time, lock_time, join_token, max_entries, lock_at, contest_name,
         end_time, settle_time, is_platform_owned, tournament_start_time,
         tournament_end_time, is_primary_marketing, provider_event_id,
         is_system_generated
       FROM contest_instances
       WHERE id = $1`,
      [SOURCE_CONTEST_ID]
    );

    if (sourceContestResult.rows.length === 0) {
      throw new Error(`Source contest_instance not found: ${SOURCE_CONTEST_ID}`);
    }

    const sourceContest = sourceContestResult.rows[0];

    // ─────────────────────────────────────────────────────────────────────
    // STEP 2: Load source tournament_config
    // ─────────────────────────────────────────────────────────────────────
    const sourceTournamentResult = await client.query(
      `SELECT
         id, provider_event_id, ingestion_endpoint, event_start_date,
         event_end_date, round_count, cut_after_round, leaderboard_schema_version,
         field_source, published_at, is_active, hash
       FROM tournament_configs
       WHERE contest_instance_id = $1
       LIMIT 1`,
      [SOURCE_CONTEST_ID]
    );

    if (sourceTournamentResult.rows.length === 0) {
      throw new Error(`Source tournament_config not found for contest: ${SOURCE_CONTEST_ID}`);
    }

    const sourceTournament = sourceTournamentResult.rows[0];

    // ─────────────────────────────────────────────────────────────────────
    // STEP 3: Generate new IDs and prepare new contest_instance
    // ─────────────────────────────────────────────────────────────────────
    const newContestId = uuidv4();
    const newContestName = `${sourceContest.contest_name} (TEST)`;
    const newJoinToken = uuidv4().replace(/-/g, '').substring(0, 32);

    // ─────────────────────────────────────────────────────────────────────
    // STEP 4: Insert new contest_instance
    // ─────────────────────────────────────────────────────────────────────
    const newProviderEventId = OVERRIDE_PROVIDER_EVENT_ID || sourceTournament.provider_event_id;

    const insertContestResult = await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, entry_fee_cents, payout_structure,
         status, start_time, lock_time, join_token, max_entries, lock_at,
         contest_name, end_time, settle_time, is_platform_owned,
         tournament_start_time, tournament_end_time, is_primary_marketing,
         provider_event_id, is_system_generated, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
         $16, $17, $18, $19, $20, NOW(), NOW()
       )
       RETURNING id`,
      [
        newContestId,
        sourceContest.template_id,
        sourceContest.organizer_id,
        sourceContest.entry_fee_cents,
        sourceContest.payout_structure,
        'SCHEDULED',  // Always create as SCHEDULED for testing
        sourceContest.start_time,
        sourceContest.lock_time,
        newJoinToken,
        sourceContest.max_entries,
        sourceContest.lock_at,
        newContestName,
        sourceContest.end_time,
        sourceContest.settle_time,
        sourceContest.is_platform_owned,
        sourceContest.tournament_start_time,
        sourceContest.tournament_end_time,
        sourceContest.is_primary_marketing,
        newProviderEventId,
        false  // is_system_generated = false for manually created test contests
      ]
    );

    if (insertContestResult.rows.length === 0) {
      throw new Error('Failed to insert new contest_instance');
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 5: Generate new tournament_config ID and insert
    // ─────────────────────────────────────────────────────────────────────
    const newTournamentConfigId = uuidv4();
    const newHash = require('crypto')
      .createHash('sha256')
      .update(JSON.stringify({ contestId: newContestId, timestamp: Date.now() }))
      .digest('hex');

    const insertTournamentResult = await client.query(
      `INSERT INTO tournament_configs (
         id, contest_instance_id, provider_event_id, ingestion_endpoint,
         event_start_date, event_end_date, round_count, cut_after_round,
         leaderboard_schema_version, field_source, published_at, is_active,
         hash, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, NOW()
       )
       RETURNING id`,
      [
        newTournamentConfigId,
        newContestId,
        newProviderEventId,
        sourceTournament.ingestion_endpoint,
        sourceTournament.event_start_date,
        sourceTournament.event_end_date,
        sourceTournament.round_count,
        sourceTournament.cut_after_round,
        sourceTournament.leaderboard_schema_version,
        sourceTournament.field_source,
        true,  // is_active = true
        newHash
      ]
    );

    if (insertTournamentResult.rows.length === 0) {
      throw new Error('Failed to insert new tournament_config');
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 6: Insert field_selections with empty primary field
    // ─────────────────────────────────────────────────────────────────────
    const fieldSelectionsId = uuidv4();
    const emptySelection = { primary: [], alternates: [] };

    const insertFieldResult = await client.query(
      `INSERT INTO field_selections (
         id, contest_instance_id, tournament_config_id, selection_json, created_at
       ) VALUES (
         $1, $2, $3, $4, NOW()
       )
       ON CONFLICT (contest_instance_id) DO NOTHING
       RETURNING id`,
      [
        fieldSelectionsId,
        newContestId,
        newTournamentConfigId,
        JSON.stringify(emptySelection)
      ]
    );

    // ─────────────────────────────────────────────────────────────────────
    // STEP 7: Commit transaction
    // ─────────────────────────────────────────────────────────────────────
    await client.query('COMMIT');

    // ─────────────────────────────────────────────────────────────────────
    // SUCCESS: Output test contest ID
    // ─────────────────────────────────────────────────────────────────────
    console.log('TEST_CONTEST_ID:', newContestId);
    console.log('TEST_TOURNAMENT_CONFIG_ID:', newTournamentConfigId);
    console.log('TEST_JOIN_TOKEN:', newJoinToken);
    console.log('TEST_CONTEST_NAME:', newContestName);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// ─────────────────────────────────────────────────────────────────────
// USAGE EXAMPLE (at bottom of file for reference)
// ─────────────────────────────────────────────────────────────────────
/*
 * EXAMPLE 1: Clone existing contest
 *   $ node scripts/createTestContest.js a1b2c3d4-e5f6-7890-abcd-ef1234567890
 *   TEST_CONTEST_ID: f1e2d3c4-b5a6-7890-abcd-ef1234567890
 *
 * EXAMPLE 2: Clone with override provider_event_id
 *   $ node scripts/createTestContest.js a1b2c3d4-e5f6-7890-abcd-ef1234567890 espn_pga_test_999
 *   TEST_CONTEST_ID: f1e2d3c4-b5a6-7890-abcd-ef1234567890
 *
 * NOTES:
 *   - Script is idempotent: safe to run multiple times
 *   - New contest always created with status = SCHEDULED
 *   - join_token is auto-generated for test contests
 *   - field_selections starts empty (ready for ingestion)
 *   - All timestamps preserved from source (except created_at, updated_at)
 */

main();
