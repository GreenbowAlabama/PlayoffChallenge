#!/usr/bin/env node

/**
 * Debug Script — Trace Tier Definition Source
 *
 * Identifies EXACTLY how tier_definition is fetched by ingestion service.
 * Traces the join path: contest_instances → tournament_configs
 *
 * Usage:
 *   node backend/debug/findTierSource.js <contest_id>
 *
 * Confirms:
 * - Join key used by ingestionService.js
 * - tournament_configs row matched
 * - tier_definition from that row
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function main() {
  const contestId = process.argv[2];

  if (!contestId) {
    console.error('❌ Usage: node findTierSource.js <contest_id>');
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║          TIER DEFINITION SOURCE TRACE                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // ─────────────────────────────────────────────────────────────────────
    // STEP 1: Fetch contest_instance row
    // ─────────────────────────────────────────────────────────────────────
    console.log('📋 STEP 1: Fetch contest_instance row');
    console.log('   Query: SELECT * FROM contest_instances WHERE id = $1\n');

    const ciResult = await client.query(
      `SELECT id, template_id, contest_name, status, created_at
       FROM contest_instances
       WHERE id = $1`,
      [contestId]
    );

    if (ciResult.rows.length === 0) {
      console.error(`❌ Contest not found: ${contestId}`);
      client.release();
      await pool.end();
      process.exit(1);
    }

    const contestInstance = ciResult.rows[0];
    console.log('✓ Found contest_instance:');
    console.log(JSON.stringify(contestInstance, null, 2));
    console.log();

    // ─────────────────────────────────────────────────────────────────────
    // STEP 2: Show template info (for reference)
    // ─────────────────────────────────────────────────────────────────────
    console.log('📋 STEP 2: Fetch template info (for reference)');
    console.log('   Query: SELECT * FROM contest_templates WHERE id = $1\n');

    const templateResult = await client.query(
      `SELECT id, sport, name
       FROM contest_templates
       WHERE id = $1`,
      [contestInstance.template_id]
    );

    if (templateResult.rows.length > 0) {
      const template = templateResult.rows[0];
      console.log('✓ Found template:');
      console.log(JSON.stringify(template, null, 2));
    } else {
      console.log('ℹ️  No template found (template_id may be null)');
    }
    console.log();

    // ─────────────────────────────────────────────────────────────────────
    // STEP 3: Trace the EXACT join path used by ingestionService.js
    // ─────────────────────────────────────────────────────────────────────
    console.log('📋 STEP 3: Trace tournament_configs join (EXACT PATH FROM ingestionService.js)');
    console.log('   Join Key: contest_instance_id (NOT template_id, NOT provider_event_id)');
    console.log('   Query: SELECT * FROM tournament_configs WHERE contest_instance_id = $1\n');

    const tcResult = await client.query(
      `SELECT id, contest_instance_id, provider_event_id, field_source, tier_definition,
              created_at
       FROM tournament_configs
       WHERE contest_instance_id = $1`,
      [contestId]
    );

    if (tcResult.rows.length === 0) {
      console.log('⚠️  No tournament_config found for this contest_instance_id');
      console.log('    This means: tournament_configs NOT created for this contest\n');
    } else {
      const tourConfig = tcResult.rows[0];
      console.log('✓ Found tournament_config:');
      console.log(JSON.stringify(tourConfig, null, 2));
      console.log();

      // ─────────────────────────────────────────────────────────────────────
      // STEP 4: Analyze tier_definition
      // ─────────────────────────────────────────────────────────────────────
      console.log('📋 STEP 4: Analyze tier_definition from tournament_config');
      console.log(`   Raw type: ${typeof tourConfig.tier_definition}`);
      console.log(`   Raw value: ${JSON.stringify(tourConfig.tier_definition, null, 2)}\n`);

      if (tourConfig.tier_definition) {
        let tierDef = tourConfig.tier_definition;

        // Parse if string
        if (typeof tierDef === 'string') {
          try {
            tierDef = JSON.parse(tierDef);
            console.log('✓ Parsed from JSON string:');
          } catch (err) {
            console.log('❌ Failed to parse as JSON string');
          }
        } else {
          console.log('✓ Already parsed as object');
        }

        console.log(JSON.stringify(tierDef, null, 2));

        // Analyze structure
        if (tierDef && tierDef.tiers && Array.isArray(tierDef.tiers)) {
          console.log(`\n   Tier count: ${tierDef.tiers.length}`);
          console.log('   Tier structure:');
          tierDef.tiers.forEach((tier, idx) => {
            console.log(`     Tier ${idx + 1}: id="${tier.id}", rank_min=${tier.rank_min}, rank_max=${tier.rank_max}`);
          });
        }
      } else {
        console.log('ℹ️  tier_definition is null/empty');
      }
      console.log();
    }

    // ─────────────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────────────
    console.log('═'.repeat(62));
    console.log('\n📊 SUMMARY:\n');

    const joinPath = {
      'Join from': 'contest_instances (ci)',
      'Join to': 'tournament_configs (tc)',
      'Join key': 'contest_instance_id',
      'SQL': 'LEFT JOIN tournament_configs tc ON tc.contest_instance_id = ci.id',
      'Source file': 'backend/services/ingestionService.js',
      'Line': 265,
      'Function': 'performIngestion()'
    };

    console.log('🔗 Join Path:');
    Object.entries(joinPath).forEach(([k, v]) => {
      console.log(`   ${k}: ${v}`);
    });

    console.log('\n✅ Confirmed:');
    if (tcResult.rows.length > 0) {
      console.log('   ✓ tournament_config exists for contest_instance_id');
      if (tcResult.rows[0].tier_definition) {
        console.log('   ✓ tier_definition is present');
      } else {
        console.log('   ⚠️  tier_definition is null/empty');
      }
    } else {
      console.log('   ⚠️  tournament_config NOT created for this contest_instance_id');
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
