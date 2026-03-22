#!/usr/bin/env node

/**
 * Audit Script — Tier Definition Completeness
 *
 * Inspects all contest_instances and their tournament_configs to identify:
 * - Missing tournament_config records
 * - Missing tier_definition in tournament_configs
 * - Invalid tier_definition JSON or schema
 *
 * Output:
 * - Console summary
 * - /tmp/tier_definition_audit.json (detailed results)
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();

  try {
    console.log('[Audit] Starting tier_definition audit...\n');

    const result = await client.query(`
      SELECT
        ci.id AS contest_instance_id,
        ci.contest_name,
        ci.created_at,
        tc.id AS tournament_config_id,
        tc.tier_definition
      FROM contest_instances ci
      LEFT JOIN tournament_configs tc
        ON tc.contest_instance_id = ci.id
      ORDER BY ci.created_at DESC
      LIMIT 50
    `);

    const rows = result.rows;
    const audit = {
      total_checked: rows.length,
      missing_configs: [],
      missing_tier_definition: [],
      invalid_tier_definition: [],
      valid: []
    };

    console.log(`[Audit] Checking ${rows.length} contests...\n`);

    for (const row of rows) {
      const contestId = row.contest_instance_id;
      const configId = row.tournament_config_id;
      const tierDef = row.tier_definition;

      // Check 1: Missing tournament_config
      if (!configId) {
        audit.missing_configs.push({
          contest_instance_id: contestId,
          contest_name: row.contest_name,
          created_at: row.created_at
        });
        continue;
      }

      // Check 2: Missing tier_definition
      if (!tierDef) {
        audit.missing_tier_definition.push({
          contest_instance_id: contestId,
          contest_name: row.contest_name,
          tournament_config_id: configId,
          created_at: row.created_at
        });
        continue;
      }

      // Check 3: Invalid tier_definition JSON or schema
      let parsed;
      try {
        parsed = typeof tierDef === 'string' ? JSON.parse(tierDef) : tierDef;
      } catch (err) {
        audit.invalid_tier_definition.push({
          contest_instance_id: contestId,
          contest_name: row.contest_name,
          tournament_config_id: configId,
          reason: 'JSON_PARSE_ERROR',
          error: err.message,
          raw_value: tierDef
        });
        continue;
      }

      // Validate schema
      const schemaIssues = [];

      if (!parsed.tiers || !Array.isArray(parsed.tiers)) {
        schemaIssues.push('missing or non-array tiers field');
      } else if (parsed.tiers.length === 0) {
        schemaIssues.push('empty tiers array');
      } else {
        // Validate each tier
        for (const tier of parsed.tiers) {
          if (!tier.id || typeof tier.rank_min !== 'number' || typeof tier.rank_max !== 'number') {
            schemaIssues.push(`invalid tier structure: ${JSON.stringify(tier)}`);
          }
        }
      }

      if (schemaIssues.length > 0) {
        audit.invalid_tier_definition.push({
          contest_instance_id: contestId,
          contest_name: row.contest_name,
          tournament_config_id: configId,
          reason: 'SCHEMA_VALIDATION_FAILED',
          issues: schemaIssues,
          tier_definition: parsed
        });
        continue;
      }

      // Valid tier_definition
      audit.valid.push({
        contest_instance_id: contestId,
        contest_name: row.contest_name,
        tournament_config_id: configId,
        tier_count: parsed.tiers.length,
        tier_ids: parsed.tiers.map(t => t.id),
        max_rank_covered: Math.max(...parsed.tiers.map(t => t.rank_max || 0))
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // CONSOLE SUMMARY
    // ─────────────────────────────────────────────────────────────────────
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║          TIER_DEFINITION AUDIT RESULTS                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`Total contests checked:       ${audit.total_checked}`);
    console.log(`Missing tournament_config:    ${audit.missing_configs.length}`);
    console.log(`Missing tier_definition:      ${audit.missing_tier_definition.length}`);
    console.log(`Invalid tier_definition:      ${audit.invalid_tier_definition.length}`);
    console.log(`Valid tier_definition:        ${audit.valid.length}\n`);

    if (audit.missing_configs.length > 0) {
      console.log('❌ MISSING TOURNAMENT_CONFIG:');
      audit.missing_configs.slice(0, 5).forEach(item => {
        console.log(`   - ${item.contest_instance_id} (${item.contest_name})`);
      });
      if (audit.missing_configs.length > 5) {
        console.log(`   ... and ${audit.missing_configs.length - 5} more`);
      }
      console.log();
    }

    if (audit.missing_tier_definition.length > 0) {
      console.log('⚠️  MISSING TIER_DEFINITION:');
      audit.missing_tier_definition.slice(0, 5).forEach(item => {
        console.log(`   - ${item.contest_instance_id} (${item.contest_name})`);
      });
      if (audit.missing_tier_definition.length > 5) {
        console.log(`   ... and ${audit.missing_tier_definition.length - 5} more`);
      }
      console.log();
    }

    if (audit.invalid_tier_definition.length > 0) {
      console.log('❌ INVALID TIER_DEFINITION:');
      audit.invalid_tier_definition.slice(0, 5).forEach(item => {
        console.log(`   - ${item.contest_instance_id} (${item.contest_name})`);
        console.log(`     Reason: ${item.reason}`);
      });
      if (audit.invalid_tier_definition.length > 5) {
        console.log(`   ... and ${audit.invalid_tier_definition.length - 5} more`);
      }
      console.log();
    }

    console.log(`✅ VALID TIER_DEFINITION: ${audit.valid.length} contests\n`);

    // ─────────────────────────────────────────────────────────────────────
    // WRITE TO FILE
    // ─────────────────────────────────────────────────────────────────────
    const outputPath = '/tmp/tier_definition_audit.json';
    fs.writeFileSync(outputPath, JSON.stringify(audit, null, 2));
    console.log(`📄 Detailed results written to: ${outputPath}\n`);

  } catch (err) {
    console.error('[Audit] ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
