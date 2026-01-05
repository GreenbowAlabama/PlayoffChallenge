#!/usr/bin/env node

/**
 * Reset Week Script
 *
 * Resets the current playoff week and optionally clears picks/scores for future weeks.
 *
 * Usage:
 *   node scripts/reset-week.js <week_number> [--activate] [--delete-future] [--wipe-all-picks]
 *
 * Examples:
 *   node scripts/reset-week.js 12 --activate --delete-future
 *   node scripts/reset-week.js 1 --activate
 *   node scripts/reset-week.js 13
 *   node scripts/reset-week.js 1 --activate --wipe-all-picks   # PLAYOFF RESET: clears ALL picks
 *
 * Options:
 *   --activate        Set is_week_active to true (enable picking)
 *   --delete-future   Delete all picks/scores for weeks > specified week
 *   --wipe-all-picks  DELETE ALL picks, scores, pick_multipliers, player_swaps (ALL weeks)
 *   --help           Show this help message
 *
 * Requirements:
 *   Run `npm install` in scripts/ directory first
 */

const { Pool } = require('pg');

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.length === 0) {
  console.log(`
Reset Week Script
=================

Resets the current playoff week and optionally clears picks/scores for future weeks.

Usage:
  node scripts/reset-week.js <week_number> [--activate] [--delete-future] [--wipe-all-picks]

Examples:
  node scripts/reset-week.js 12 --activate --delete-future
  node scripts/reset-week.js 1 --activate
  node scripts/reset-week.js 13
  node scripts/reset-week.js 1 --activate --wipe-all-picks   # PLAYOFF RESET: clears ALL picks

Options:
  --activate        Set is_week_active to true (enable picking)
  --delete-future   Delete all picks/scores for weeks > specified week
  --wipe-all-picks  DELETE ALL picks, scores, pick_multipliers, player_swaps (ALL weeks)
  --help           Show this help message

Environment:
  Requires DATABASE_URL environment variable to be set.
  `);
  process.exit(0);
}

const weekNumber = parseInt(args[0]);
const shouldActivate = args.includes('--activate');
const shouldDeleteFuture = args.includes('--delete-future');
const wipeAllPicks = args.includes('--wipe-all-picks');

if (isNaN(weekNumber) || weekNumber < 0) {
  console.error('❌ Error: Invalid week number. Must be a positive integer.');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL environment variable is not set.');
  console.error('   Set it with: export DATABASE_URL="your-connection-string"');
  process.exit(1);
}

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function resetWeek() {
  const client = await pool.connect();

  try {
    console.log(`\n🔄 Starting week reset process...\n`);

    // 1. Check current state
    console.log('📊 Current state:');
    const currentState = await client.query('SELECT current_playoff_week, is_week_active FROM game_settings');
    console.log(`   Current week: ${currentState.rows[0].current_playoff_week}`);
    console.log(`   Week active: ${currentState.rows[0].is_week_active}`);

    const pickCount = await client.query('SELECT week_number, COUNT(*) as count FROM picks GROUP BY week_number ORDER BY week_number');
    console.log(`   Picks by week:`, pickCount.rows.length > 0 ? pickCount.rows : 'None');

    const scoreCount = await client.query('SELECT week_number, COUNT(*) as count FROM scores GROUP BY week_number ORDER BY week_number');
    console.log(`   Scores by week:`, scoreCount.rows.length > 0 ? scoreCount.rows : 'None');

    // 2. WIPE ALL PICKS MODE (takes precedence over --delete-future)
    if (wipeAllPicks) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`⚠️  WIPE ALL PICKS MODE ENABLED`);
      console.log(`⚠️  THIS WILL DELETE ALL PICKS FOR ALL USERS`);
      console.log(`⚠️  THIS CANNOT BE UNDONE`);
      console.log(`${'='.repeat(60)}\n`);

      if (process.env.NODE_ENV === 'production') {
        console.log(`🔴 Proceeding with WIPE ALL PICKS in PRODUCTION\n`);
      }

      try {
        await client.query('BEGIN');

        console.log(`🗑️  Deleting ALL pick-related data...`);

        // Delete in order due to FK constraints: pick_multipliers -> scores -> picks -> player_swaps
        const deletedMultipliers = await client.query('DELETE FROM pick_multipliers');
        console.log(`   ✓ Deleted ${deletedMultipliers.rowCount} pick_multipliers`);

        const deletedScores = await client.query('DELETE FROM scores');
        console.log(`   ✓ Deleted ${deletedScores.rowCount} scores`);

        const deletedPicks = await client.query('DELETE FROM picks');
        console.log(`   ✓ Deleted ${deletedPicks.rowCount} picks`);

        const deletedSwaps = await client.query('DELETE FROM player_swaps');
        console.log(`   ✓ Deleted ${deletedSwaps.rowCount} player_swaps`);

        await client.query('COMMIT');
        console.log(`\n✅ Transaction committed successfully`);

        // Verification queries
        console.log(`\n📋 Verification (all should be 0):`);
        const verifyPicks = await client.query('SELECT COUNT(*) as count FROM picks');
        const verifyScores = await client.query('SELECT COUNT(*) as count FROM scores');
        const verifyMultipliers = await client.query('SELECT COUNT(*) as count FROM pick_multipliers');
        const verifySwaps = await client.query('SELECT COUNT(*) as count FROM player_swaps');
        console.log(`   picks: ${verifyPicks.rows[0].count}`);
        console.log(`   scores: ${verifyScores.rows[0].count}`);
        console.log(`   pick_multipliers: ${verifyMultipliers.rows[0].count}`);
        console.log(`   player_swaps: ${verifySwaps.rows[0].count}`);

      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`\n❌ Transaction rolled back due to error:`, error.message);
        throw error;
      }
    }
    // 3. Delete future data if requested (skipped if wipeAllPicks was used)
    else if (shouldDeleteFuture) {
      console.log(`\n🗑️  Deleting picks/scores for weeks > ${weekNumber}...`);

      const deletedPicks = await client.query('DELETE FROM picks WHERE week_number > $1', [weekNumber]);
      console.log(`   ✓ Deleted ${deletedPicks.rowCount} picks`);

      const deletedScores = await client.query('DELETE FROM scores WHERE week_number > $1', [weekNumber]);
      console.log(`   ✓ Deleted ${deletedScores.rowCount} scores`);

      const deletedMultipliers = await client.query('DELETE FROM pick_multipliers WHERE week_number > $1', [weekNumber]);
      console.log(`   ✓ Deleted ${deletedMultipliers.rowCount} pick multipliers`);
    }

    // 3. Update game settings
    console.log(`\n⚙️  Updating game settings...`);
    await client.query(
      `UPDATE game_settings
       SET current_playoff_week = $1,
           is_week_active = $2,
           updated_at = CURRENT_TIMESTAMP`,
      [weekNumber, shouldActivate]
    );
    console.log(`   ✓ Set current_playoff_week to ${weekNumber}`);
    console.log(`   ✓ Set is_week_active to ${shouldActivate}`);

    // 4. Verify changes
    console.log(`\n✅ New state:`);
    const newState = await client.query('SELECT current_playoff_week, is_week_active FROM game_settings');
    console.log(`   Current week: ${newState.rows[0].current_playoff_week}`);
    console.log(`   Week active: ${newState.rows[0].is_week_active}`);

    const newPickCount = await client.query('SELECT week_number, COUNT(*) as count FROM picks GROUP BY week_number ORDER BY week_number');
    console.log(`   Picks by week:`, newPickCount.rows.length > 0 ? newPickCount.rows : 'None');

    const newScoreCount = await client.query('SELECT week_number, COUNT(*) as count FROM scores GROUP BY week_number ORDER BY week_number');
    console.log(`   Scores by week:`, newScoreCount.rows.length > 0 ? newScoreCount.rows : 'None');

    console.log(`\n✨ Week reset complete!\n`);

  } catch (error) {
    console.error('\n❌ Error during reset:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the script
resetWeek().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
