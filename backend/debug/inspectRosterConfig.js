#!/usr/bin/env node

/**
 * Debug Script — Inspect Roster Config Mapping
 *
 * Fetches one contest and displays:
 * - tier_definition (from tournament_configs)
 * - roster_config (derived by mapping layer)
 * - sample available_players (first 5)
 *
 * Usage:
 *   node backend/debug/inspectRosterConfig.js [contest_id]
 *
 * If no contest_id provided, uses first PGA contest found.
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// Import entryRosterService to test the mapping layer
const entryRosterService = require('../services/entryRosterService');

async function main() {
  const client = await pool.connect();

  try {
    const contestIdArg = process.argv[2];

    // Find a contest to inspect
    let contestRow;

    if (contestIdArg) {
      // User provided specific contest ID
      const result = await client.query(
        `SELECT ci.id, ci.contest_name, ci.status, ci.lock_time,
                ct.scoring_strategy_key, ct.sport
         FROM contest_instances ci
         LEFT JOIN contest_templates ct ON ct.id = ci.template_id
         WHERE ci.id = $1`,
        [contestIdArg]
      );
      if (result.rows.length === 0) {
        console.error(`❌ Contest not found: ${contestIdArg}`);
        client.release();
        await pool.end();
        process.exit(1);
      }
      contestRow = result.rows[0];
    } else {
      // Find first PGA/GOLF contest with tier_definition
      const result = await client.query(
        `SELECT ci.id, ci.contest_name, ci.status, ci.lock_time,
                ct.scoring_strategy_key, ct.sport
         FROM contest_instances ci
         LEFT JOIN contest_templates ct ON ct.id = ci.template_id
         LEFT JOIN tournament_configs tc ON tc.contest_instance_id = ci.id
         WHERE ct.sport IN ('pga', 'golf', 'GOLF')
           AND tc.tier_definition IS NOT NULL
         ORDER BY ci.created_at DESC
         LIMIT 1`
      );
      if (result.rows.length === 0) {
        console.error('❌ No contests with tier_definition found');
        client.release();
        await pool.end();
        process.exit(1);
      }
      contestRow = result.rows[0];
    }

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║           ROSTER CONFIG MAPPING INSPECTION                 ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`📋 Contest: ${contestRow.id}`);
    console.log(`   Name: ${contestRow.contest_name}`);
    console.log(`   Status: ${contestRow.status}`);
    console.log(`   Strategy: ${contestRow.scoring_strategy_key}`);
    console.log(`   Sport: ${contestRow.sport}\n`);

    // ─────────────────────────────────────────────────────────────────────
    // FETCH TIER_DEFINITION
    // ─────────────────────────────────────────────────────────────────────
    const tierResult = await client.query(
      `SELECT tier_definition FROM tournament_configs
       WHERE contest_instance_id = $1 LIMIT 1`,
      [contestRow.id]
    );

    const tierDefinition = tierResult.rows.length > 0 ? tierResult.rows[0].tier_definition : null;

    console.log('📊 TIER_DEFINITION (from tournament_configs):');
    if (tierDefinition) {
      console.log(JSON.stringify(tierDefinition, null, 2));
    } else {
      console.log('   (null - not set)');
    }
    console.log();

    // ─────────────────────────────────────────────────────────────────────
    // DERIVE ROSTER_CONFIG (using the mapping layer)
    // ─────────────────────────────────────────────────────────────────────
    const rosterConfig = entryRosterService.deriveRosterConfigFromStrategy(
      contestRow.scoring_strategy_key,
      tierDefinition
    );

    console.log('⚙️  ROSTER_CONFIG (derived by mapping layer):');
    console.log(JSON.stringify(rosterConfig, null, 2));
    console.log();

    // ─────────────────────────────────────────────────────────────────────
    // FETCH AVAILABLE PLAYERS (sample)
    // ─────────────────────────────────────────────────────────────────────
    const fieldResult = await client.query(
      `SELECT selection_json FROM field_selections WHERE contest_instance_id = $1 LIMIT 1`,
      [contestRow.id]
    );

    let availablePlayers = [];

    if (fieldResult.rows.length > 0 && fieldResult.rows[0].selection_json) {
      const selectionJson = fieldResult.rows[0].selection_json;
      if (Array.isArray(selectionJson.primary)) {
        availablePlayers = selectionJson.primary.slice(0, 5);
      }
    } else {
      // Fallback to players table
      const playersResult = await client.query(
        `SELECT id, full_name, image_url
         FROM players
         WHERE sport = $1
         AND is_active = true
         ORDER BY full_name
         LIMIT 5`,
        [contestRow.sport ? contestRow.sport.toUpperCase() : null]
      );
      availablePlayers = playersResult.rows.map(p => ({
        player_id: p.id,
        name: p.full_name,
        image_url: p.image_url || null
      }));
    }

    console.log('🎯 AVAILABLE_PLAYERS (sample, first 5):');
    if (availablePlayers.length > 0) {
      console.log(JSON.stringify(availablePlayers, null, 2));
      console.log(`\n   Total available: (see full list in GET /api/custom-contests/${contestRow.id}/my-entry)`);
    } else {
      console.log('   (none)');
    }
    console.log();

    // ─────────────────────────────────────────────────────────────────────
    // VALIDATION SUMMARY
    // ─────────────────────────────────────────────────────────────────────
    console.log('✅ VALIDATION SUMMARY:');
    if (tierDefinition && Array.isArray(tierDefinition.tiers) && tierDefinition.tiers.length > 0) {
      console.log(`   ✓ tier_definition exists with ${tierDefinition.tiers.length} tiers`);
      console.log(`   ✓ entry_fields populated: ${Array.isArray(rosterConfig.entry_fields) ? rosterConfig.entry_fields.length : 0} fields`);

      // Verify entry_fields match tier structure
      const expectedFieldCount = tierDefinition.tiers.length;
      const actualFieldCount = Array.isArray(rosterConfig.entry_fields) ? rosterConfig.entry_fields.length : 0;
      if (actualFieldCount === expectedFieldCount) {
        console.log(`   ✓ entry_fields count matches tiers (${actualFieldCount})`);
      } else {
        console.log(`   ⚠️  entry_fields count mismatch: expected ${expectedFieldCount}, got ${actualFieldCount}`);
      }

      // Check if fields have tier metadata
      if (Array.isArray(rosterConfig.entry_fields) && rosterConfig.entry_fields[0]) {
        const firstField = rosterConfig.entry_fields[0];
        if (firstField.tier_id && firstField.tier_rank_min !== undefined) {
          console.log('   ✓ entry_fields have tier metadata (tier_id, rank_min, rank_max)');
        } else if (typeof firstField === 'string') {
          console.log('   ℹ️  entry_fields are strings (legacy format)');
        }
      }
    } else {
      console.log('   ℹ️  No tier_definition - entry_fields using default format');
      if (Array.isArray(rosterConfig.entry_fields) && rosterConfig.entry_fields[0] === 'player_ids') {
        console.log('   ✓ entry_fields default: ["player_ids"]');
      }
    }
    console.log();

  } catch (err) {
    console.error('❌ ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
