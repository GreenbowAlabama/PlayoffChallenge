#!/usr/bin/env node

/**
 * Fix Defense ESPN IDs Script
 *
 * Finds defenses with invalid ESPN IDs (non-numeric team abbreviations) and sets them to NULL.
 * This allows the backend to use name matching instead, which works correctly for defenses.
 *
 * Background:
 * - Defenses should have numeric ESPN IDs (e.g., '26' for Seahawks) or NULL
 * - Some defenses have team abbreviations (e.g., 'SEA') which breaks ESPN matching
 * - When ESPN ID is NULL, the backend falls back to name matching (first_name + last_name)
 * - Name matching works well for defenses since they have split names (e.g., "Seattle" "Seahawks")
 *
 * Usage:
 *   node scripts/fix-defense-espn-ids.js [--dry-run]
 *
 * Examples:
 *   node scripts/fix-defense-espn-ids.js --dry-run  # Preview changes without applying
 *   node scripts/fix-defense-espn-ids.js            # Fix invalid ESPN IDs
 *
 * Options:
 *   --dry-run   Show what would be fixed without making changes
 *   --help      Show this help message
 *
 * Requirements:
 *   Run `npm install` in scripts/ directory first
 *   Requires DATABASE_URL environment variable
 */

const { Pool } = require('pg');

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
Fix Defense ESPN IDs Script
============================

Finds defenses with invalid ESPN IDs (non-numeric team abbreviations) and sets them to NULL.
This allows the backend to use name matching instead, which works correctly for defenses.

Usage:
  node scripts/fix-defense-espn-ids.js [--dry-run]

Examples:
  node scripts/fix-defense-espn-ids.js --dry-run  # Preview changes
  node scripts/fix-defense-espn-ids.js            # Apply fixes

Options:
  --dry-run   Show what would be fixed without making changes
  --help      Show this help message

Environment:
  Requires DATABASE_URL environment variable to be set.
  `);
  process.exit(0);
}

const isDryRun = args.includes('--dry-run');

if (!process.env.DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable is not set.');
  console.error('   Set it with: export DATABASE_URL="your-connection-string"');
  process.exit(1);
}

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixDefenseESPNIds() {
  const client = await pool.connect();

  try {
    console.log(`\n${isDryRun ? '[DRY RUN] ' : ''}Fixing defense ESPN IDs...\n`);

    // 1. Find defenses with invalid ESPN IDs
    console.log('Step 1: Finding defenses with invalid ESPN IDs...');

    const invalidDefenses = await client.query(`
      SELECT
        p.id,
        p.full_name,
        p.team,
        p.espn_id,
        p.first_name,
        p.last_name,
        COUNT(s.id) as score_count,
        COALESCE(MAX(s.base_points), 0) as max_points
      FROM players p
      LEFT JOIN scores s ON p.id = s.player_id
      WHERE p.position = 'DEF'
        AND p.espn_id IS NOT NULL
        AND p.espn_id !~ '^[0-9]+$'  -- ESPN ID is not numeric
      GROUP BY p.id, p.full_name, p.team, p.espn_id, p.first_name, p.last_name
      ORDER BY p.team
    `);

    if (invalidDefenses.rows.length === 0) {
      console.log('   No defenses with invalid ESPN IDs found.');
      console.log('\nAll defenses have valid ESPN IDs or NULL!\n');
      return;
    }

    console.log(`   Found ${invalidDefenses.rows.length} defense(s) with invalid ESPN IDs:\n`);

    invalidDefenses.rows.forEach(def => {
      console.log(`   - ${def.full_name} (${def.team})`);
      console.log(`     Current ESPN ID: "${def.espn_id}"`);
      console.log(`     Name parts: "${def.first_name}" "${def.last_name}"`);
      console.log(`     Scores: ${def.score_count} entries, max points: ${def.max_points}`);
      console.log('');
    });

    // 2. Fix the ESPN IDs
    if (isDryRun) {
      console.log('[DRY RUN] Would set ESPN IDs to NULL for the above defenses.');
      console.log('\nRun without --dry-run to apply changes.\n');
      return;
    }

    console.log('Step 2: Setting invalid ESPN IDs to NULL...');

    const updateResult = await client.query(`
      UPDATE players
      SET espn_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE position = 'DEF'
        AND espn_id IS NOT NULL
        AND espn_id !~ '^[0-9]+$'
      RETURNING id, full_name, team
    `);

    console.log(`   Updated ${updateResult.rowCount} defense(s):\n`);

    updateResult.rows.forEach(def => {
      console.log(`   - ${def.full_name} (${def.team})`);
    });

    // 3. Verify the fix
    console.log('\nStep 3: Verifying changes...');

    const stillInvalid = await client.query(`
      SELECT COUNT(*) as count
      FROM players
      WHERE position = 'DEF'
        AND espn_id IS NOT NULL
        AND espn_id !~ '^[0-9]+$'
    `);

    if (parseInt(stillInvalid.rows[0].count) === 0) {
      console.log('   All defense ESPN IDs are now valid or NULL!');
    } else {
      console.log(`   Warning: ${stillInvalid.rows[0].count} defenses still have invalid ESPN IDs.`);
    }

    console.log('\nSuccess! Defense ESPN IDs have been fixed.');
    console.log('\nNext steps:');
    console.log('  1. Trigger a live stats update: POST /api/admin/update-live-stats');
    console.log('  2. Verify defenses are now scoring correctly in the admin panel\n');

  } catch (error) {
    console.error('\nError fixing defense ESPN IDs:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the script
fixDefenseESPNIds().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
