#!/usr/bin/env node
/**
 * Field Selection Shape Dump
 *
 * Explores the exact structure of field_selections.selection_json without assumptions.
 * READ-ONLY diagnostic — no mutations.
 *
 * Usage:
 *   TEST_DB_ALLOW_DBNAME=railway node backend/debug/dumpFieldSelectionShape.js > /tmp/field_shape.json
 */

const { Pool } = require('pg');

const CONTEST_ID = 'f6d203fc-bd90-4351-915f-6bb44c292480';

function flattenPlayerObjects(obj, path = '') {
  const players = [];

  function traverse(current, currentPath) {
    if (current === null || current === undefined) return;

    if (typeof current === 'object') {
      if (Array.isArray(current)) {
        for (let i = 0; i < current.length; i++) {
          traverse(current[i], `${currentPath}[${i}]`);
        }
      } else {
        // Check if this looks like a player object
        const keys = Object.keys(current);
        const playerLikeKeys = ['player_id', 'id', 'espn_id', 'provider_player_id', 'golfer_id', 'name', 'full_name'];
        const hasPlayerLikeKey = keys.some(k => playerLikeKeys.includes(k));

        if (hasPlayerLikeKey || (keys.length > 0 && keys.length <= 15)) {
          // Likely a player object
          const playerRecord = {
            source_path: currentPath || 'root',
            raw_object: current,
            player_id: current.player_id || null,
            id: current.id || null,
            espn_id: current.espn_id || null,
            provider_player_id: current.provider_player_id || null,
            golfer_id: current.golfer_id || null,
            name: current.name || null,
            full_name: current.full_name || null
          };
          players.push(playerRecord);
        }

        for (const key of keys) {
          traverse(current[key], currentPath ? `${currentPath}.${key}` : key);
        }
      }
    }
  }

  traverse(obj, path);
  return players;
}

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
    field_selections_raw: null,
    selection_json_structure: {},
    discovered_players: [],
    entry_rosters_raw: [],
    identity_matching_attempts: {},
    golfer_event_scores_lookup: {},
    diagnostics: {}
  };

  try {
    // ════════════════════════════════════════════════════════════════════
    // 1. FETCH FIELD_SELECTIONS RAW ROW
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching field_selections...');
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

    if (fieldRes.rows.length === 0) {
      output.diagnostics.field_selections_exists = false;
      output.diagnostics.note = 'No field_selections row found for this contest';
    } else {
      const fieldRow = fieldRes.rows[0];
      output.field_selections_raw = {
        id: fieldRow.id,
        contest_instance_id: fieldRow.contest_instance_id,
        tournament_config_id: fieldRow.tournament_config_id,
        created_at: fieldRow.created_at,
        selection_json: fieldRow.selection_json
      };

      output.diagnostics.field_selections_exists = true;

      // ════════════════════════════════════════════════════════════════════
      // 2. ANALYZE SELECTION_JSON STRUCTURE
      // ════════════════════════════════════════════════════════════════════

      const selectionJson = fieldRow.selection_json;
      if (selectionJson && typeof selectionJson === 'object') {
        const topLevelKeys = Object.keys(selectionJson);
        output.selection_json_structure.top_level_keys = topLevelKeys;

        // Count array-valued keys
        const arrayKeys = {};
        for (const key of topLevelKeys) {
          const value = selectionJson[key];
          if (Array.isArray(value)) {
            arrayKeys[key] = value.length;
          }
        }
        output.selection_json_structure.array_valued_keys = arrayKeys;

        // Flatten and discover all player objects
        const discovered = flattenPlayerObjects(selectionJson);
        output.discovered_players = discovered;
        output.diagnostics.discovered_player_count = discovered.length;
      } else {
        output.diagnostics.selection_json_is_null_or_not_object = selectionJson === null || typeof selectionJson !== 'object';
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 3. FETCH ENTRY_ROSTERS
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching entry_rosters...');
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

    output.entry_rosters_raw = rostersRes.rows.map(row => ({
      entry_id: row.id,
      user_id: row.user_id,
      player_ids: row.player_ids
    }));

    // ════════════════════════════════════════════════════════════════════
    // 4. EXTRACT ALL ROSTER PLAYER IDS
    // ════════════════════════════════════════════════════════════════════

    const allRosterPlayerIds = new Set();
    for (const roster of output.entry_rosters_raw) {
      (roster.player_ids || []).forEach(id => allRosterPlayerIds.add(id));
    }
    const rosterPlayerIdsList = Array.from(allRosterPlayerIds);

    // ════════════════════════════════════════════════════════════════════
    // 5. IDENTITY MATCHING ATTEMPTS
    // For each roster player_id, try to match against discovered field players
    // ════════════════════════════════════════════════════════════════════

    console.error('Attempting identity matches...');
    for (const rosterId of rosterPlayerIdsList) {
      const attempt = {
        roster_id: rosterId,
        exact_matches: [],
        normalized_matches: [],
        prefix_stripped_matches: [],
        prefix_added_matches: []
      };

      // Build all possible variants of this ID
      const variants = [rosterId];  // exact
      if (rosterId.startsWith('espn_')) {
        variants.push(rosterId.substring(5));  // stripped prefix
      } else {
        variants.push(`espn_${rosterId}`);  // added prefix
      }

      // Try to match against discovered players
      for (const playerRecord of output.discovered_players) {
        const playerIdFields = [
          playerRecord.player_id,
          playerRecord.id,
          playerRecord.espn_id,
          playerRecord.provider_player_id,
          playerRecord.golfer_id
        ].filter(v => v !== null);

        for (const playerIdField of playerIdFields) {
          if (playerIdField === rosterId) {
            attempt.exact_matches.push({
              source_path: playerRecord.source_path,
              matched_field: Object.keys(playerRecord).find(k => playerRecord[k] === rosterId),
              matched_value: playerIdField,
              player_record: playerRecord
            });
          }

          // Try with/without espn_ prefix
          if (playerIdField.startsWith('espn_')) {
            const stripped = playerIdField.substring(5);
            if (stripped === rosterId) {
              attempt.prefix_stripped_matches.push({
                source_path: playerRecord.source_path,
                matched_value: playerIdField,
                stripped_match: stripped,
                player_record: playerRecord
              });
            }
          } else {
            const withPrefix = `espn_${playerIdField}`;
            if (withPrefix === rosterId) {
              attempt.prefix_added_matches.push({
                source_path: playerRecord.source_path,
                matched_value: playerIdField,
                with_prefix: withPrefix,
                player_record: playerRecord
              });
            }
          }
        }
      }

      output.identity_matching_attempts[rosterId] = attempt;
    }

    // ════════════════════════════════════════════════════════════════════
    // 6. GOLFER_EVENT_SCORES LOOKUP WITH VARIANTS
    // ════════════════════════════════════════════════════════════════════

    console.error('Checking golfer_event_scores...');
    for (const rosterId of rosterPlayerIdsList) {
      const scoreLookup = {
        roster_id: rosterId,
        exact_match_found: false,
        exact_match_rows: [],
        variant_matches: []
      };

      // Try exact
      const exactRes = await pool.query(`
        SELECT golfer_id, COUNT(*) as row_count
        FROM golfer_event_scores
        WHERE contest_instance_id = $1 AND golfer_id = $2
        GROUP BY golfer_id
      `, [CONTEST_ID, rosterId]);

      if (exactRes.rows.length > 0) {
        scoreLookup.exact_match_found = true;
        scoreLookup.exact_match_rows = exactRes.rows;
      }

      // Try variants (with/without espn_ prefix)
      const variants = [];
      if (rosterId.startsWith('espn_')) {
        variants.push(rosterId.substring(5));
      } else {
        variants.push(`espn_${rosterId}`);
      }

      for (const variant of variants) {
        const variantRes = await pool.query(`
          SELECT golfer_id, COUNT(*) as row_count
          FROM golfer_event_scores
          WHERE contest_instance_id = $1 AND golfer_id = $2
          GROUP BY golfer_id
        `, [CONTEST_ID, variant]);

        if (variantRes.rows.length > 0) {
          scoreLookup.variant_matches.push({
            variant,
            found: true,
            row_count: variantRes.rows[0].row_count
          });
        } else {
          scoreLookup.variant_matches.push({
            variant,
            found: false
          });
        }
      }

      output.golfer_event_scores_lookup[rosterId] = scoreLookup;
    }

    // ════════════════════════════════════════════════════════════════════
    // 7. DIAGNOSTIC SUMMARY
    // ════════════════════════════════════════════════════════════════════

    const fieldPlayersCount = output.discovered_players.length;
    const rosterIdsCount = rosterPlayerIdsList.length;
    const exactMatches = rosterPlayerIdsList.filter(id =>
      output.identity_matching_attempts[id].exact_matches.length > 0
    ).length;

    output.diagnostics.summary = {
      field_selections_row_exists: output.diagnostics.field_selections_exists,
      discovered_players_in_selection_json: fieldPlayersCount,
      roster_player_ids_count: rosterIdsCount,
      roster_ids_with_exact_field_match: exactMatches,
      roster_ids_with_no_field_match: rosterIdsCount - exactMatches,
      assessment: fieldPlayersCount === 0
        ? 'ASSUMPTION_FAILURE: selection_json exists but contains no discovered player objects'
        : exactMatches === rosterIdsCount
          ? 'IDENTITY_CHAIN_COMPLETE: All roster IDs found in field_selections'
          : `IDENTITY_MISMATCH: ${rosterIdsCount - exactMatches} roster IDs not found in field_selections`
    };

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
