#!/usr/bin/env node
/**
 * Identity Mismatch Details Dump
 *
 * Proves exactly why 4 selected IDs fail to map by dumping raw data side-by-side.
 * READ-ONLY diagnostic — no mutations.
 *
 * From prior audit:
 * Unmatched IDs: espn_10048, espn_1030, espn_1037, espn_10577
 * All 4 are identity mapping failures.
 *
 * Usage:
 *   TEST_DB_ALLOW_DBNAME=railway node backend/debug/dumpIdentityMismatchDetails.js > /tmp/mismatch.json
 */

const { Pool } = require('pg');

const CONTEST_ID = 'f6d203fc-bd90-4351-915f-6bb44c292480';
const UNMATCHED_IDS = ['espn_10048', 'espn_1030', 'espn_1037', 'espn_10577'];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5
  });

  const output = {
    unmatched_ids: UNMATCHED_IDS,
    entry_roster_source: [],
    field_selections_players: [],
    direct_lookup_checks: {},
    golfer_event_scores_presence: {}
  };

  try {
    // ════════════════════════════════════════════════════════════════════
    // 1. ENTRY_ROSTER_SOURCE
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

    output.entry_roster_source = rostersRes.rows.map(row => ({
      entry_id: row.id,
      contest_instance_id: row.contest_instance_id,
      user_id: row.user_id,
      raw_player_ids: row.player_ids,
      submitted_at: row.submitted_at,
      updated_at: row.updated_at
    }));

    // ════════════════════════════════════════════════════════════════════
    // 2. FIELD_SELECTIONS_PLAYERS
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching field selections...');
    const fieldRes = await pool.query(`
      SELECT
        id,
        contest_instance_id,
        tournament_config_id,
        selection_json,
        created_at
      FROM field_selections
      WHERE contest_instance_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [CONTEST_ID]);

    if (fieldRes.rows.length > 0) {
      const fieldRow = fieldRes.rows[0];
      if (fieldRow.selection_json && Array.isArray(fieldRow.selection_json.players)) {
        output.field_selections_players = fieldRow.selection_json.players.map(player => ({
          raw_object: player
        }));
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 3. DIRECT_LOOKUP_CHECKS
    // For each unmatched ID, scan ALL field players for matches
    // ════════════════════════════════════════════════════════════════════

    console.error('Scanning for direct matches...');
    for (const unmatchedId of UNMATCHED_IDS) {
      const checkResult = {
        exists_in_field_selections_by_player_id: false,
        exists_in_field_selections_by_id: false,
        exists_in_field_selections_by_espn_id: false,
        exists_in_field_selections_by_provider_player_id: false,
        matched_objects_by_player_id: [],
        matched_objects_by_id: [],
        matched_objects_by_espn_id: [],
        matched_objects_by_provider_player_id: [],
        all_matched_objects: []
      };

      // Scan all field players
      if (output.field_selections_players && Array.isArray(output.field_selections_players)) {
        for (const playerEntry of output.field_selections_players) {
          const player = playerEntry.raw_object;

          // ATTEMPT 1: Match by player_id field
          if (player.player_id === unmatchedId) {
            checkResult.exists_in_field_selections_by_player_id = true;
            checkResult.matched_objects_by_player_id.push(player);
            if (!checkResult.all_matched_objects.some(m => m === player)) {
              checkResult.all_matched_objects.push(player);
            }
          }

          // ATTEMPT 2: Match by id field
          if (player.id === unmatchedId) {
            checkResult.exists_in_field_selections_by_id = true;
            checkResult.matched_objects_by_id.push(player);
            if (!checkResult.all_matched_objects.some(m => m === player)) {
              checkResult.all_matched_objects.push(player);
            }
          }

          // ATTEMPT 3: Match by espn_id (with/without prefix)
          if (player.espn_id) {
            // Try exact match
            if (player.espn_id === unmatchedId) {
              checkResult.exists_in_field_selections_by_espn_id = true;
              checkResult.matched_objects_by_espn_id.push(player);
              if (!checkResult.all_matched_objects.some(m => m === player)) {
                checkResult.all_matched_objects.push(player);
              }
            }
            // Try with espn_ prefix
            if (`espn_${player.espn_id}` === unmatchedId) {
              checkResult.exists_in_field_selections_by_espn_id = true;
              checkResult.matched_objects_by_espn_id.push(player);
              if (!checkResult.all_matched_objects.some(m => m === player)) {
                checkResult.all_matched_objects.push(player);
              }
            }
          }

          // ATTEMPT 4: Match by provider_player_id (with/without prefix)
          if (player.provider_player_id) {
            // Try exact match
            if (player.provider_player_id === unmatchedId) {
              checkResult.exists_in_field_selections_by_provider_player_id = true;
              checkResult.matched_objects_by_provider_player_id.push(player);
              if (!checkResult.all_matched_objects.some(m => m === player)) {
                checkResult.all_matched_objects.push(player);
              }
            }
            // Try with espn_ prefix
            if (`espn_${player.provider_player_id}` === unmatchedId) {
              checkResult.exists_in_field_selections_by_provider_player_id = true;
              checkResult.matched_objects_by_provider_player_id.push(player);
              if (!checkResult.all_matched_objects.some(m => m === player)) {
                checkResult.all_matched_objects.push(player);
              }
            }
          }
        }
      }

      output.direct_lookup_checks[unmatchedId] = checkResult;
    }

    // ════════════════════════════════════════════════════════════════════
    // 4. GOLFER_EVENT_SCORES_PRESENCE
    // Query golfer_event_scores for each unmatched ID directly
    // ════════════════════════════════════════════════════════════════════

    console.error('Checking golfer_event_scores...');
    for (const unmatchedId of UNMATCHED_IDS) {
      const scoresRes = await pool.query(`
        SELECT
          id,
          golfer_id,
          round_number,
          hole_points,
          bonus_points,
          finish_bonus,
          total_points,
          created_at
        FROM golfer_event_scores
        WHERE contest_instance_id = $1 AND golfer_id = $2
        ORDER BY round_number ASC
      `, [CONTEST_ID, unmatchedId]);

      output.golfer_event_scores_presence[unmatchedId] = {
        exists: scoresRes.rows.length > 0,
        row_count: scoresRes.rows.length,
        rows: scoresRes.rows
      };
    }

  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }

  console.log(JSON.stringify(output, null, 2));
}

main();
