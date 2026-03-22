#!/usr/bin/env node

/**
 * Fix Script — Generate Tier Definition Updates
 *
 * Generates SQL UPDATE statements for tournament_configs records missing tier_definition.
 *
 * IMPORTANT:
 * - This script GENERATES SQL but does NOT execute it
 * - All generated statements are printed to console and written to file
 * - Manual review and approval required before running generated SQL
 *
 * Output:
 * - Console: SQL statements
 * - /tmp/tier_definition_fixes.sql: All generated updates
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// Complete tier definition that covers all expected field sizes
const COMPLETE_TIER_DEFINITION = {
  version: 1,
  selection_mode: 'TIERED',
  required_per_tier: 1,
  tiers: [
    { id: 't1', rank_min: 1, rank_max: 10 },
    { id: 't2', rank_min: 11, rank_max: 30 },
    { id: 't3', rank_min: 31, rank_max: 60 },
    { id: 't4', rank_min: 61, rank_max: 100 }
  ]
};

async function main() {
  const client = await pool.connect();

  try {
    console.log('[Fix] Generating tier_definition updates...\n');

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
      WHERE tc.id IS NOT NULL
        AND tc.tier_definition IS NULL
      ORDER BY ci.created_at DESC
      LIMIT 50
    `);

    const rowsToFix = result.rows;

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     TIER_DEFINITION FIX SCRIPT (READ-ONLY GENERATION)      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`Found ${rowsToFix.length} tournament_configs with missing tier_definition\n`);

    if (rowsToFix.length === 0) {
      console.log('✅ No fixes needed!\n');
      client.release();
      await pool.end();
      return;
    }

    const sqlStatements = [];

    console.log('⚠️  GENERATED SQL STATEMENTS (NOT EXECUTED):\n');
    console.log('─'.repeat(70));

    for (const row of rowsToFix) {
      const configId = row.tournament_config_id;
      const tierDefJson = JSON.stringify(COMPLETE_TIER_DEFINITION);

      const sql = `UPDATE tournament_configs
SET tier_definition = '${tierDefJson.replace(/'/g, "''")}'::jsonb
WHERE id = '${configId}';`;

      sqlStatements.push(sql);

      console.log(`\n-- Contest: ${row.contest_name} (${row.contest_instance_id})`);
      console.log(`-- Config ID: ${configId}`);
      console.log(`-- Created: ${row.created_at}`);
      console.log(sql);
    }

    console.log('\n' + '─'.repeat(70));

    // ─────────────────────────────────────────────────────────────────────
    // WRITE ALL STATEMENTS TO FILE
    // ─────────────────────────────────────────────────────────────────────
    const sqlOutputPath = '/tmp/tier_definition_fixes.sql';
    const sqlContent = sqlStatements.join('\n\n');
    fs.writeFileSync(sqlOutputPath, sqlContent);

    console.log(`\n📄 All SQL statements written to: ${sqlOutputPath}`);
    console.log(`\n⚡ NEXT STEPS:`);
    console.log(`   1. Review all generated SQL statements above`);
    console.log(`   2. Test in a staging environment`);
    console.log(`   3. When ready, execute the SQL file:`);
    console.log(`      psql -d <database> -f ${sqlOutputPath}`);
    console.log(`\n✋ DO NOT execute automatically. Manual review required.\n`);

  } catch (err) {
    console.error('[Fix] ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
