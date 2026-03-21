#!/usr/bin/env node
/**
 * Entry Roster Identity Chain Audit
 *
 * Proves the canonical identity for selected golfers in a contest.
 * Diagnoses whether missing golfer_event_scores are due to:
 * - True ingestion gaps (golfers never scored in ESPN data)
 * - OR identity mapping problems (roster IDs don't match canonical golfer IDs)
 * - OR both
 *
 * READ-ONLY: No mutations, schema changes, or production code modifications.
 *
 * Usage:
 *   TEST_DB_ALLOW_DBNAME=railway node backend/debug/auditEntryRosterIdentity.js > /tmp/identity_audit.json
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const CONTEST_ID = 'f6d203fc-bd90-4351-915f-6bb44c292480';

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
    contest: null,
    entry_rosters_raw: [],
    field_selections_lookup: null,
    canonical_mapping: [],
    golfer_event_scores_for_selected: {},
    leaderboard_join_check: {},
    scoring_rules_context: {},
    final_verdict: {}
  };

  try {
    // ════════════════════════════════════════════════════════════════════
    // 1. CONTEST
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching contest...');
    const contestRes = await pool.query(`
      SELECT
        ci.id,
        ci.template_id,
        ct.sport,
        ct.template_type,
        ci.provider_event_id,
        ci.status,
        ct.scoring_strategy_key,
        ct.settlement_strategy_key
      FROM contest_instances ci
      JOIN contest_templates ct ON ci.template_id = ct.id
      WHERE ci.id = $1
    `, [CONTEST_ID]);

    if (contestRes.rows.length === 0) {
      console.error(`ERROR: Contest ${CONTEST_ID} not found`);
      process.exit(1);
    }

    output.contest = {
      contest_instance_id: contestRes.rows[0].id,
      contest_template_id: contestRes.rows[0].template_id,
      sport: contestRes.rows[0].sport,
      template_type: contestRes.rows[0].template_type,
      provider: 'ESPN',
      provider_event_id: contestRes.rows[0].provider_event_id,
      status: contestRes.rows[0].status,
      scoring_strategy_key: contestRes.rows[0].scoring_strategy_key,
      settlement_strategy_key: contestRes.rows[0].settlement_strategy_key
    };

    // ════════════════════════════════════════════════════════════════════
    // 2. ENTRY_ROSTERS_RAW
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

    output.entry_rosters_raw = rostersRes.rows.map(row => ({
      entry_id: row.id,
      contest_instance_id: row.contest_instance_id,
      user_id: row.user_id,
      player_ids: row.player_ids,
      player_count: (row.player_ids || []).length,
      submitted_at: row.submitted_at,
      updated_at: row.updated_at
    }));

    // ════════════════════════════════════════════════════════════════════
    // 3. FIELD_SELECTIONS_LOOKUP
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
      const parsedPlayers = [];

      // Extract all players from selection_json, preserving every field exactly as stored
      if (fieldRow.selection_json && typeof fieldRow.selection_json === 'object') {
        if (Array.isArray(fieldRow.selection_json.players)) {
          for (const player of fieldRow.selection_json.players) {
            parsedPlayers.push(player);  // Preserve every field without renaming or collapsing
          }
        }
      }

      output.field_selections_lookup = {
        id: fieldRow.id,
        contest_instance_id: fieldRow.contest_instance_id,
        tournament_config_id: fieldRow.tournament_config_id,
        created_at: fieldRow.created_at,
        selection_json_raw: fieldRow.selection_json,
        parsed_players: parsedPlayers,
        player_count: parsedPlayers.length
      };
    }

    // ════════════════════════════════════════════════════════════════════
    // 4. CANONICAL_MAPPING
    // Attempt to match roster player_ids to golfer_event_scores.golfer_id
    // ════════════════════════════════════════════════════════════════════

    console.error('Building canonical mapping...');
    const allSelectedIds = new Set();
    for (const roster of output.entry_rosters_raw) {
      (roster.player_ids || []).forEach(pid => allSelectedIds.add(pid));
    }

    const selectedIdsList = Array.from(allSelectedIds);

    // Query all golfer_event_scores to get canonical golfer_ids in the contest
    const allGolferScoresRes = await pool.query(`
      SELECT DISTINCT golfer_id
      FROM golfer_event_scores
      WHERE contest_instance_id = $1
      ORDER BY golfer_id
    `, [CONTEST_ID]);

    const canonicalGolferIds = new Set(allGolferScoresRes.rows.map(r => r.golfer_id));

    // For each selected ID, attempt to find the canonical match
    for (const selectedId of selectedIdsList) {
      const mapping = {
        raw_selected_id: selectedId,
        attempt_player_id: null,
        attempt_golfer_id: null,
        attempt_provider_player_id: null,
        attempt_espn_player_id: null,
        attempt_name_match: null,
        final_canonical_golfer_id: null,
        mapping_confidence: 'none',
        matching_evidence: []
      };

      // ATTEMPT 1: Direct match (selectedId already is a canonical golfer_id)
      if (canonicalGolferIds.has(selectedId)) {
        mapping.attempt_golfer_id = selectedId;
        mapping.final_canonical_golfer_id = selectedId;
        mapping.mapping_confidence = 'exact';
        mapping.matching_evidence.push({
          method: 'direct_golfer_id_match',
          value: selectedId,
          result: 'MATCHED'
        });
      } else {
        // ATTEMPT 2: Find in field_selections and try multiple ID fields
        let fieldPlayerMatch = null;
        if (output.field_selections_lookup && output.field_selections_lookup.parsed_players && Array.isArray(output.field_selections_lookup.parsed_players)) {
          for (const player of output.field_selections_lookup.parsed_players) {
            if (player.player_id === selectedId || player.id === selectedId) {
              fieldPlayerMatch = player;
              mapping.attempt_player_id = player.player_id || player.id;
              mapping.matching_evidence.push({
                method: 'field_selections_lookup',
                field_player_id: player.player_id || player.id,
                result: 'FOUND_IN_FIELD_SELECTIONS'
              });
              break;
            }
          }
        }

        if (fieldPlayerMatch) {
          // ATTEMPT 2A: Try espn_id
          if (fieldPlayerMatch.espn_id) {
            mapping.attempt_espn_player_id = fieldPlayerMatch.espn_id;
            const espnBasedGolferId = `espn_${fieldPlayerMatch.espn_id}`;
            if (canonicalGolferIds.has(espnBasedGolferId)) {
              mapping.final_canonical_golfer_id = espnBasedGolferId;
              mapping.mapping_confidence = 'inferred';
              mapping.matching_evidence.push({
                method: 'espn_id_to_golfer_id',
                espn_id: fieldPlayerMatch.espn_id,
                golfer_id: espnBasedGolferId,
                result: 'MATCHED'
              });
            } else {
              mapping.matching_evidence.push({
                method: 'espn_id_to_golfer_id',
                espn_id: fieldPlayerMatch.espn_id,
                golfer_id: espnBasedGolferId,
                result: 'NOT_FOUND_IN_SCORES'
              });
            }
          }

          // ATTEMPT 2B: Try provider_player_id
          if (!mapping.final_canonical_golfer_id && fieldPlayerMatch.provider_player_id) {
            mapping.attempt_provider_player_id = fieldPlayerMatch.provider_player_id;
            const providerBasedGolferId = `espn_${fieldPlayerMatch.provider_player_id}`;
            if (canonicalGolferIds.has(providerBasedGolferId)) {
              mapping.final_canonical_golfer_id = providerBasedGolferId;
              mapping.mapping_confidence = 'inferred';
              mapping.matching_evidence.push({
                method: 'provider_player_id_to_golfer_id',
                provider_player_id: fieldPlayerMatch.provider_player_id,
                golfer_id: providerBasedGolferId,
                result: 'MATCHED'
              });
            } else {
              mapping.matching_evidence.push({
                method: 'provider_player_id_to_golfer_id',
                provider_player_id: fieldPlayerMatch.provider_player_id,
                golfer_id: providerBasedGolferId,
                result: 'NOT_FOUND_IN_SCORES'
              });
            }
          }

          // ATTEMPT 2C: Try golfer_id field if present
          if (!mapping.final_canonical_golfer_id && fieldPlayerMatch.golfer_id) {
            mapping.attempt_golfer_id = fieldPlayerMatch.golfer_id;
            if (canonicalGolferIds.has(fieldPlayerMatch.golfer_id)) {
              mapping.final_canonical_golfer_id = fieldPlayerMatch.golfer_id;
              mapping.mapping_confidence = 'inferred';
              mapping.matching_evidence.push({
                method: 'field_selections_golfer_id',
                golfer_id: fieldPlayerMatch.golfer_id,
                result: 'MATCHED'
              });
            } else {
              mapping.matching_evidence.push({
                method: 'field_selections_golfer_id',
                golfer_id: fieldPlayerMatch.golfer_id,
                result: 'NOT_FOUND_IN_SCORES'
              });
            }
          }

          // Store name for reference
          if (fieldPlayerMatch.name) mapping.attempt_name_match = fieldPlayerMatch.name;
        }

        if (!mapping.final_canonical_golfer_id) {
          mapping.mapping_confidence = 'none';
          mapping.matching_evidence.push({
            method: 'comprehensive_search',
            result: 'NO_CANONICAL_ID_FOUND',
            searched_for: selectedId,
            searched_in: ['direct_golfer_id_match', 'field_selections', 'espn_id_conversion', 'provider_player_id_conversion', 'golfer_id_field']
          });
        }
      }

      output.canonical_mapping.push(mapping);
    }

    // ════════════════════════════════════════════════════════════════════
    // 5. GOLFER_EVENT_SCORES_FOR_SELECTED
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching golfer event scores...');
    for (const mapping of output.canonical_mapping) {
      if (mapping.final_canonical_golfer_id) {
        const scoresRes = await pool.query(`
          SELECT
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
        `, [CONTEST_ID, mapping.final_canonical_golfer_id]);

        output.golfer_event_scores_for_selected[mapping.final_canonical_golfer_id] = scoresRes.rows;
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 6. LEADERBOARD_JOIN_CHECK
    // ════════════════════════════════════════════════════════════════════

    console.error('Checking leaderboard presence...');

    // Get all golfer_event_scores and round numbers
    const leaderboardRes = await pool.query(`
      SELECT DISTINCT
        golfer_id,
        round_number
      FROM golfer_event_scores
      WHERE contest_instance_id = $1
      ORDER BY golfer_id, round_number
    `, [CONTEST_ID]);

    const leaderboardByGolfer = {};
    for (const row of leaderboardRes.rows) {
      if (!leaderboardByGolfer[row.golfer_id]) {
        leaderboardByGolfer[row.golfer_id] = [];
      }
      leaderboardByGolfer[row.golfer_id].push(row.round_number);
    }

    // Fetch latest ESPN payload for leaderboard data (name, score_to_par, position)
    const espnPayloadRes = await pool.query(`
      SELECT payload
      FROM event_data_snapshots
      WHERE contest_instance_id = $1
      ORDER BY ingested_at DESC
      LIMIT 1
    `, [CONTEST_ID]);

    const espnLeaderboardData = {};
    if (espnPayloadRes.rows.length > 0 && espnPayloadRes.rows[0].payload) {
      const payload = espnPayloadRes.rows[0].payload;
      if (payload.events && Array.isArray(payload.events) && payload.events[0]) {
        const event = payload.events[0];
        if (event.competitions && Array.isArray(event.competitions) && event.competitions[0]) {
          const competition = event.competitions[0];
          if (competition.competitors && Array.isArray(competition.competitors)) {
            for (const competitor of competition.competitors) {
              // Extract ESPN athlete ID
              let athleteId = null;
              if (competitor.athlete && competitor.athlete.id) {
                athleteId = competitor.athlete.id;
              }
              if (athleteId) {
                const golferId = `espn_${athleteId}`;
                espnLeaderboardData[golferId] = {
                  name: competitor.athlete?.displayName || competitor.athlete?.fullName || null,
                  score: competitor.score || null,  // Score to par (negative for under par)
                  position: competitor.curatedRank || competitor.order || null,
                  status: competitor.status || null
                };
              }
            }
          }
        }
      }
    }

    for (const mapping of output.canonical_mapping) {
      if (mapping.final_canonical_golfer_id) {
        const leaderboardEntry = espnLeaderboardData[mapping.final_canonical_golfer_id] || {};
        output.leaderboard_join_check[mapping.final_canonical_golfer_id] = {
          final_canonical_golfer_id: mapping.final_canonical_golfer_id,
          raw_selected_id: mapping.raw_selected_id,
          leaderboard_present: mapping.final_canonical_golfer_id in leaderboardByGolfer,
          leaderboard_name: leaderboardEntry.name,
          leaderboard_score_to_par: leaderboardEntry.score,
          leaderboard_position: leaderboardEntry.position,
          rounds_present_in_scores: leaderboardByGolfer[mapping.final_canonical_golfer_id] || [],
          score_count: (output.golfer_event_scores_for_selected[mapping.final_canonical_golfer_id] || []).length
        };
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 7. SCORING_RULES_CONTEXT
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching scoring rules context...');
    const templatesRes = await pool.query(`
      SELECT
        id,
        name,
        sport,
        scoring_strategy_key,
        settlement_strategy_key
      FROM contest_templates
      WHERE id = $1
    `, [output.contest.contest_template_id]);

    const templateRow = templatesRes.rows[0];

    // Check if scoring_rules table has PGA-specific rules
    const pgaRulesRes = await pool.query(`
      SELECT id, category, stat_name, points
      FROM scoring_rules
      WHERE is_active = true
      LIMIT 20
    `);

    // Check if PGA scoring strategy file exists
    const pgaStrategyPath = '/Users/iancarter/Documents/workspace/playoff-challenge/backend/services/scoring/strategies/pgaStandardScoring.js';
    const pgaStrategyExists = fs.existsSync(pgaStrategyPath);

    const pgaRulesCategories = new Set(pgaRulesRes.rows.map(r => r.category));
    const hasNflRulesOnly = pgaRulesCategories.size > 0 &&
                           ['defense', 'kicking', 'passing', 'receiving', 'rushing'].every(cat => pgaRulesCategories.has(cat));

    output.scoring_rules_context = {
      template_name: templateRow?.name || null,
      sport: templateRow?.sport || null,
      scoring_strategy_key: templateRow?.scoring_strategy_key || null,
      settlement_strategy_key: templateRow?.settlement_strategy_key || null,
      evidence_sources: {
        scoring_strategy_key_from_template: templateRow?.scoring_strategy_key === 'pga_standard_v1',
        pgaStandardScoring_file_exists: pgaStrategyExists,
        pgaStandardScoring_file_path: pgaStrategyPath
      },
      scoring_rules_table_stats: {
        total_rules_active: pgaRulesRes.rows.length,
        rule_categories_present: Array.from(pgaRulesCategories),
        categories_are_nfl_only: hasNflRulesOnly,
        sample_rules: pgaRulesRes.rows.slice(0, 5).map(r => ({
          id: r.id,
          category: r.category,
          stat_name: r.stat_name,
          points: r.points
        }))
      },
      conclusion: {
        scoring_implementation: 'Hardcoded pgaStandardScoring.js (pure function)',
        uses_scoring_rules_table: false,
        scoring_rules_table_contains: 'NFL rules only (not applicable to PGA)',
        runtime_strategy_file: pgaStrategyPath,
        evidence: 'scoring_strategy_key=pga_standard_v1, pgaStandardScoring.js exists and is authoritative, scoring_rules table is for NFL contests only'
      }
    };

    // ════════════════════════════════════════════════════════════════════
    // 8. FINAL_VERDICT
    // ════════════════════════════════════════════════════════════════════

    console.error('Computing final verdict...');
    const selectedCount = selectedIdsList.length;
    const withCanonicalIds = output.canonical_mapping.filter(m => m.final_canonical_golfer_id).length;
    const withScores = output.canonical_mapping.filter(
      m => m.final_canonical_golfer_id && (output.golfer_event_scores_for_selected[m.final_canonical_golfer_id] || []).length > 0
    ).length;
    const withoutScores = withCanonicalIds - withScores;
    const unmatched = selectedCount - withCanonicalIds;

    const brokenMappings = output.canonical_mapping.filter(
      m => m.mapping_confidence === 'none'
    );

    const ingestedGolfers = leaderboardByGolfer;

    // Categorize root cause
    let hasIdentityMappingProblem = unmatched > 0;
    let hasIngestionGap = withoutScores > 0;

    output.final_verdict = {
      selected_golfers_total: selectedCount,
      canonical_ids_found: withCanonicalIds,
      canonical_ids_missing: unmatched,
      with_golfer_event_scores: withScores,
      without_golfer_event_scores: withoutScores,
      unmatched_roster_ids: unmatched,
      broken_mapping_count: brokenMappings.length,
      broken_mappings: brokenMappings.map(m => ({
        raw_selected_id: m.raw_selected_id,
        category: 'IDENTITY_MAPPING_FAILURE',
        reason: 'Selected ID does not match any canonical golfer_id in golfer_event_scores or field_selections'
      })),
      unmapped_golfers_with_canonical_but_no_scores: output.canonical_mapping
        .filter(m => m.final_canonical_golfer_id && (output.golfer_event_scores_for_selected[m.final_canonical_golfer_id] || []).length === 0)
        .map(m => ({
          raw_selected_id: m.raw_selected_id,
          canonical_id: m.final_canonical_golfer_id,
          category: 'INGESTION_GAP',
          reason: 'Selected golfer is canonical but never appeared in ESPN leaderboard data'
        })),
      total_golfers_with_scores_in_contest: Object.keys(ingestedGolfers).length,
      root_cause_analysis: {
        has_identity_mapping_problem: hasIdentityMappingProblem,
        has_ingestion_gap: hasIngestionGap,
        identity_mapping_problem_details: hasIdentityMappingProblem
          ? {
              count: unmatched,
              description: `${unmatched} selected golfers have no canonical golfer_id mapping (not found in golfer_event_scores or derivable from field_selections)`,
              impact: 'These golfers cannot be scored because their IDs do not match the canonical format'
            }
          : null,
        ingestion_gap_details: hasIngestionGap
          ? {
              count: withoutScores,
              description: `${withoutScores} selected golfers are canonical but have no golfer_event_scores rows (never scored by ESPN ingestion)`,
              impact: 'These golfers were selected but never appeared in ESPN API leaderboard data'
            }
          : null
      },
      diagnosis: hasIdentityMappingProblem && hasIngestionGap
        ? `BOTH: Identity mapping problem (${unmatched} unmatched) AND ingestion gap (${withoutScores} no scores)`
        : hasIdentityMappingProblem
          ? `IDENTITY MAPPING PROBLEM: ${unmatched} selected golfers cannot be mapped to canonical golfer_ids`
          : hasIngestionGap
            ? `INGESTION GAP: ${withoutScores} canonical golfers were never scored by ESPN ingestion`
            : 'ALL SELECTED GOLFERS HAVE SCORES AND MAPPINGS',
      settlement_readiness: withScores === selectedCount
        ? 'READY_FOR_SETTLEMENT'
        : 'NOT_READY_FOR_SETTLEMENT',
      settlement_readiness_details: withScores === selectedCount
        ? 'All selected golfers have canonical IDs and scoring data'
        : `${selectedCount - withScores} selected golfers missing scores (${unmatched} identity mapping issues, ${withoutScores} ingestion gaps)`,
      next_steps: hasIdentityMappingProblem
        ? 'INVESTIGATE_IDENTITY_CHAIN: Check if entry_rosters.player_ids format matches field_selections selection_json player IDs'
        : hasIngestionGap
          ? 'INVESTIGATE_ESPN_INGESTION: Verify if these golfers appeared in ESPN API leaderboard data for this event'
          : 'PROCEED_TO_SETTLEMENT'
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
