#!/usr/bin/env node
/**
 * Verify Roster Against Field Definition
 *
 * Proves whether entry_rosters.player_ids ⊆ field_selections.primary
 * READ-ONLY diagnostic — no mutations.
 *
 * Usage:
 *   TEST_DB_ALLOW_DBNAME=railway node backend/debug/verifyRosterAgainstField.js > /tmp/roster_field.json
 */

const { Pool } = require('pg');

const CONTEST_ID = 'f6d203fc-bd90-4351-915f-6bb44c292480';

function normalizeId(rawId) {
  return {
    raw: rawId,
    stripped: rawId.startsWith('espn_') ? rawId.substring(5) : rawId,
    canonical: rawId.startsWith('espn_') ? rawId : `espn_${rawId}`
  };
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
    field_selections_primary: [],
    entry_rosters_ids: [],
    normalized_field_primary: [],
    normalized_roster_ids: [],
    roster_vs_field: [],
    field_in_golfer_event_scores: {},
    roster_in_golfer_event_scores: {},
    summary: {},
    invariant_check: {},
    root_cause_classification: null
  };

  try {
    // ════════════════════════════════════════════════════════════════════
    // 1. FETCH FIELD_SELECTIONS
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching field_selections...');
    const fieldRes = await pool.query(`
      SELECT selection_json
      FROM field_selections
      WHERE contest_instance_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [CONTEST_ID]);

    if (fieldRes.rows.length > 0) {
      const selectionJson = fieldRes.rows[0].selection_json;
      if (selectionJson && Array.isArray(selectionJson.primary)) {
        output.field_selections_primary = selectionJson.primary;
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 2. FETCH ENTRY_ROSTERS
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching entry_rosters...');
    const rostersRes = await pool.query(`
      SELECT player_ids
      FROM entry_rosters
      WHERE contest_instance_id = $1
      ORDER BY user_id
    `, [CONTEST_ID]);

    const allRosterIds = new Set();
    for (const row of rostersRes.rows) {
      if (Array.isArray(row.player_ids)) {
        for (const id of row.player_ids) {
          allRosterIds.add(id);
        }
      }
    }
    output.entry_rosters_ids = Array.from(allRosterIds);

    // ════════════════════════════════════════════════════════════════════
    // 3. NORMALIZE BOTH SIDES
    // ════════════════════════════════════════════════════════════════════

    output.normalized_field_primary = output.field_selections_primary.map(id => normalizeId(id));
    output.normalized_roster_ids = output.entry_rosters_ids.map(id => normalizeId(id));

    // Build lookup for field IDs (all three forms)
    const fieldLookup = {
      raw: new Set(output.field_selections_primary),
      stripped: new Set(output.normalized_field_primary.map(n => n.stripped)),
      canonical: new Set(output.normalized_field_primary.map(n => n.canonical))
    };

    // ════════════════════════════════════════════════════════════════════
    // 4. BUILD ROSTER vs FIELD COMPARISON MATRIX
    // ════════════════════════════════════════════════════════════════════

    for (const rosterId of output.entry_rosters_ids) {
      const normalized = normalizeId(rosterId);
      const matchingFieldValues = [];

      // Check all three matching strategies
      const exactMatch = fieldLookup.raw.has(normalized.raw);
      const strippedMatch = fieldLookup.stripped.has(normalized.stripped);
      const canonicalMatch = fieldLookup.canonical.has(normalized.canonical);

      // Find which actual field values matched
      for (const fieldId of output.field_selections_primary) {
        const fieldNormalized = normalizeId(fieldId);
        if (
          fieldNormalized.raw === normalized.raw ||
          fieldNormalized.stripped === normalized.stripped ||
          fieldNormalized.canonical === normalized.canonical
        ) {
          matchingFieldValues.push(fieldId);
        }
      }

      output.roster_vs_field.push({
        roster_id: rosterId,
        exists_exact_in_field: exactMatch,
        exists_stripped_match: strippedMatch,
        exists_canonical_match: canonicalMatch,
        matching_field_values: matchingFieldValues
      });
    }

    // ════════════════════════════════════════════════════════════════════
    // 5. CHECK GOLFER_EVENT_SCORES PRESENCE
    // ════════════════════════════════════════════════════════════════════

    console.error('Checking golfer_event_scores for field IDs...');
    for (const fieldId of output.field_selections_primary) {
      const scoresRes = await pool.query(`
        SELECT COUNT(*) as count
        FROM golfer_event_scores
        WHERE contest_instance_id = $1 AND golfer_id = $2
      `, [CONTEST_ID, fieldId]);

      output.field_in_golfer_event_scores[fieldId] = parseInt(scoresRes.rows[0].count) > 0;
    }

    console.error('Checking golfer_event_scores for roster IDs...');
    for (const rosterId of output.entry_rosters_ids) {
      const scoresRes = await pool.query(`
        SELECT COUNT(*) as count
        FROM golfer_event_scores
        WHERE contest_instance_id = $1 AND golfer_id = $2
      `, [CONTEST_ID, rosterId]);

      output.roster_in_golfer_event_scores[rosterId] = parseInt(scoresRes.rows[0].count) > 0;
    }

    // ════════════════════════════════════════════════════════════════════
    // 6. COMPUTE SUMMARY
    // ════════════════════════════════════════════════════════════════════

    const rosterComparisons = output.roster_vs_field;
    const validIds = rosterComparisons.filter(r => r.exists_exact_in_field || r.exists_canonical_match).length;
    const invalidIds = rosterComparisons.filter(r => !r.exists_exact_in_field && !r.exists_canonical_match);

    output.summary = {
      total_roster_ids: output.entry_rosters_ids.length,
      total_field_primary_ids: output.field_selections_primary.length,
      valid_ids: validIds,
      invalid_ids: invalidIds.length,
      invalid_list: invalidIds.map(r => r.roster_id),
      field_ids_with_scores: output.field_selections_primary.filter(id => output.field_in_golfer_event_scores[id]).length,
      roster_ids_with_scores: output.entry_rosters_ids.filter(id => output.roster_in_golfer_event_scores[id]).length
    };

    // ════════════════════════════════════════════════════════════════════
    // 7. INVARIANT CHECK
    // ════════════════════════════════════════════════════════════════════

    const invariantHolds = invalidIds.length === 0;

    output.invariant_check = {
      rule: 'entry_rosters.player_ids ⊆ field_selections.primary',
      holds: invariantHolds,
      violations: invalidIds.map(r => ({
        roster_id: r.roster_id,
        reason: 'ID not found in field_selections.primary (exact, stripped, or canonical match)'
      }))
    };

    // ════════════════════════════════════════════════════════════════════
    // 8. ROOT CAUSE CLASSIFICATION
    // ════════════════════════════════════════════════════════════════════

    if (invariantHolds) {
      output.root_cause_classification = 'no_violation';
    } else {
      // Analyze why invariant failed
      const allInvalidHaveScores = invalidIds.every(r => output.roster_in_golfer_event_scores[r.roster_id]);
      const allInvalidHaveNoScores = invalidIds.every(r => !output.roster_in_golfer_event_scores[r.roster_id]);

      if (allInvalidHaveNoScores) {
        output.root_cause_classification = 'invalid_roster_selection';
      } else if (allInvalidHaveScores) {
        output.root_cause_classification = 'field_definition_mismatch';
      } else {
        output.root_cause_classification = 'mixed_invalid_with_and_without_scores';
      }
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
