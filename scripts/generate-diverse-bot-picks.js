#!/usr/bin/env node

/**
 * Generate diverse random picks for bot accounts
 * Each bot will get different players to create realistic leaderboard diversity
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const WEEK_TO_CREATE = 12;

// Position requirements
const POSITION_LIMITS = {
  'QB': 1,
  'RB': 2,
  'WR': 2,
  'TE': 1,
  'K': 1,
  'DEF': 1
};

// Shuffle array helper
function shuffle(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function generateDiverseBotPicks() {
  try {
    console.log('Generating diverse bot picks...\n');

    // Step 1: Delete existing bot picks for weeks 12 and 13
    console.log('Step 1: Deleting existing bot picks...');
    const deletePicks = await pool.query(`
      DELETE FROM picks
      WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test.com')
        AND week_number IN (12, 13)
    `);
    console.log(`  Deleted ${deletePicks.rowCount} existing picks\n`);

    // Step 2: Delete existing bot scores for weeks 12 and 13
    console.log('Step 2: Deleting existing bot scores...');
    const deleteScores = await pool.query(`
      DELETE FROM scores
      WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test.com')
        AND week_number IN (12, 13)
    `);
    console.log(`  Deleted ${deleteScores.rowCount} existing scores\n`);

    // Step 3: Get available players by position (only playoff teams for week 12)
    console.log('Step 3: Getting available players...');

    // Playoff teams for Week 12 (Wild Card round)
    const playoffTeams = [
      'BAL', 'BUF', 'DET', 'GB', 'HOU', 'KC', 'LAC', 'LAR',
      'MIN', 'PHI', 'PIT', 'TB', 'WAS'
    ];

    const playersByPosition = {};
    for (const position of Object.keys(POSITION_LIMITS)) {
      const playersResult = await pool.query(`
        SELECT id, full_name, team, position
        FROM players
        WHERE position = $1
          AND team = ANY($2)
        ORDER BY full_name
      `, [position, playoffTeams]);

      playersByPosition[position] = playersResult.rows;
      console.log(`  ${position}: ${playersResult.rows.length} available players`);
    }
    console.log('');

    // Step 4: Get all bot accounts
    const botsResult = await pool.query(`
      SELECT id, name
      FROM users
      WHERE email LIKE '%@test.com'
      ORDER BY name
    `);

    console.log(`Step 4: Found ${botsResult.rows.length} bot accounts\n`);

    // Step 5: Generate picks for each bot
    console.log('Step 5: Generating diverse picks...\n');

    let totalCreated = 0;

    for (const bot of botsResult.rows) {
      console.log(`Creating picks for ${bot.name}...`);

      // For each position, randomly select players
      for (const [position, limit] of Object.entries(POSITION_LIMITS)) {
        const availablePlayers = playersByPosition[position];

        if (availablePlayers.length < limit) {
          console.log(`  WARNING: Not enough ${position} players (need ${limit}, have ${availablePlayers.length})`);
          continue;
        }

        // Randomly select N players for this position
        const shuffledPlayers = shuffle(availablePlayers);
        const selectedPlayers = shuffledPlayers.slice(0, limit);

        for (const player of selectedPlayers) {
          await pool.query(`
            INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
            VALUES (gen_random_uuid(), $1, $2, $3, $4, 1.0, 1, false, NOW())
            ON CONFLICT (user_id, player_id, week_number) DO NOTHING
          `, [bot.id, player.id, WEEK_TO_CREATE, position]);

          totalCreated++;
        }
      }

      // Verify count
      const countResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM picks
        WHERE user_id = $1 AND week_number = $2
      `, [bot.id, WEEK_TO_CREATE]);

      console.log(`  Created ${countResult.rows[0].count} picks`);
    }

    console.log(`\n=== Summary ===`);
    console.log(`Successfully created ${totalCreated} diverse picks for ${botsResult.rows.length} bots!`);
    console.log(`Each bot now has unique random players from playoff teams`);
    console.log(`\nNext steps:`);
    console.log(`1. Run the admin "Update Live Stats" to populate scores for Week 12`);
    console.log(`2. Run the admin "Process Week Transition" to create Week 13 picks with 2x multipliers`);

  } catch (error) {
    console.error('Error generating bot picks:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

generateDiverseBotPicks();
