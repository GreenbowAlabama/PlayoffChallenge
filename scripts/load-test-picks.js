#!/usr/bin/env node

/**
 * Load Test Picks Script
 *
 * Automatically creates picks for test bot accounts (users with @test.com email addresses).
 * Randomly selects players for each position to create complete rosters.
 *
 * Usage:
 *   node scripts/load-test-picks.js <week_number> [--delete-existing]
 *
 * Examples:
 *   node scripts/load-test-picks.js 12
 *   node scripts/load-test-picks.js 1 --delete-existing
 *
 * Options:
 *   --delete-existing   Delete existing picks for test accounts before creating new ones
 *   --help             Show this help message
 *
 * Requirements:
 *   Run `npm install` in scripts/ directory first
 *   Requires DATABASE_URL environment variable
 */

const { Pool } = require('pg');

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.length === 0) {
  console.log(`
Load Test Picks Script
======================

Automatically creates picks for test bot accounts (users with @test.com email addresses).
Randomly selects players for each position to create complete rosters.

Usage:
  node scripts/load-test-picks.js <week_number> [--delete-existing]

Examples:
  node scripts/load-test-picks.js 12
  node scripts/load-test-picks.js 1 --delete-existing

Options:
  --delete-existing   Delete existing picks for test accounts before creating new ones
  --help             Show this help message

Environment:
  Requires DATABASE_URL environment variable to be set.
  `);
  process.exit(0);
}

const weekNumber = parseInt(args[0]);
const shouldDeleteExisting = args.includes('--delete-existing');

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

// Position requirements (matches the position_requirements table)
const POSITION_REQUIREMENTS = {
  'QB': 1,
  'RB': 2,
  'WR': 2,
  'TE': 1,
  'FLEX': 1,  // Can be RB, WR, or TE
  'K': 1,
  'DEF': 1
};

function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

async function loadTestPicks() {
  const client = await pool.connect();

  try {
    console.log(`\n🤖 Loading test picks for week ${weekNumber}...\n`);

    // 1. Find test accounts
    console.log('📊 Finding test accounts...');
    const testAccounts = await client.query(
      `SELECT id, email, name FROM users WHERE email LIKE '%@test.com' ORDER BY email`
    );

    if (testAccounts.rows.length === 0) {
      console.log('   ⚠️  No test accounts found (looking for emails ending in @test.com)');
      return;
    }

    console.log(`   ✓ Found ${testAccounts.rows.length} test accounts`);
    testAccounts.rows.forEach(user => {
      console.log(`     - ${user.email} (${user.name || 'No name'})`);
    });

    // 2. Fetch available players by position
    console.log(`\n🏈 Fetching available players...`);
    const playersByPosition = {};

    for (const position of Object.keys(POSITION_REQUIREMENTS)) {
      if (position === 'FLEX') continue; // FLEX is handled separately

      const positionFilter = position === 'DEF' ? 'DEF' : position;
      const players = await client.query(
        `SELECT id, full_name, position, team
         FROM players
         WHERE position = $1 AND is_active = true
         ORDER BY full_name`,
        [positionFilter]
      );

      playersByPosition[position] = players.rows;
      console.log(`   ✓ ${position}: ${players.rows.length} players available`);
    }

    // FLEX can be RB, WR, or TE
    const flexPlayers = await client.query(
      `SELECT id, full_name, position, team
       FROM players
       WHERE position IN ('RB', 'WR', 'TE') AND is_active = true
       ORDER BY full_name`
    );
    playersByPosition['FLEX'] = flexPlayers.rows;
    console.log(`   ✓ FLEX: ${flexPlayers.rows.length} players available`);

    // 3. Delete existing picks if requested
    if (shouldDeleteExisting) {
      console.log(`\n🗑️  Deleting existing picks for test accounts...`);
      const deleteResult = await client.query(
        `DELETE FROM picks
         WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test.com')
         AND week_number = $1`,
        [weekNumber]
      );
      console.log(`   ✓ Deleted ${deleteResult.rowCount} existing picks`);
    }

    // 4. Create picks for each test account
    console.log(`\n✨ Creating picks for week ${weekNumber}...`);
    let totalPicksCreated = 0;

    for (const user of testAccounts.rows) {
      console.log(`\n   📝 ${user.email}:`);
      const usedPlayerIds = new Set();
      let userPicksCreated = 0;

      for (const [position, count] of Object.entries(POSITION_REQUIREMENTS)) {
        const availablePlayers = playersByPosition[position].filter(
          p => !usedPlayerIds.has(p.id)
        );

        if (availablePlayers.length < count) {
          console.log(`      ⚠️  Not enough ${position} players available (need ${count}, have ${availablePlayers.length})`);
          continue;
        }

        for (let i = 0; i < count; i++) {
          const player = getRandomElement(availablePlayers.filter(p => !usedPlayerIds.has(p.id)));
          usedPlayerIds.add(player.id);

          // Insert pick
          await client.query(
            `INSERT INTO picks (user_id, player_id, week_number, position, locked)
             VALUES ($1, $2, $3, $4, false)
             ON CONFLICT (user_id, week_number, position)
             DO UPDATE SET player_id = EXCLUDED.player_id`,
            [user.id, player.id, weekNumber, position]
          );

          console.log(`      ✓ ${position}: ${player.full_name} (${player.team})`);
          userPicksCreated++;
          totalPicksCreated++;
        }
      }

      console.log(`      Total: ${userPicksCreated} picks`);
    }

    // 5. Verify picks were created
    console.log(`\n✅ Summary:`);
    const pickCounts = await client.query(
      `SELECT u.email, COUNT(p.id) as pick_count
       FROM users u
       LEFT JOIN picks p ON u.id = p.user_id AND p.week_number = $1
       WHERE u.email LIKE '%@test.com'
       GROUP BY u.email
       ORDER BY u.email`,
      [weekNumber]
    );

    pickCounts.rows.forEach(row => {
      console.log(`   ${row.email}: ${row.pick_count} picks`);
    });

    console.log(`\n   Total picks created: ${totalPicksCreated}`);
    console.log(`\n✨ Test picks loaded successfully!\n`);

  } catch (error) {
    console.error('\n❌ Error loading test picks:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the script
loadTestPicks().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
