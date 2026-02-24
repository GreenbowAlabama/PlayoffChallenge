#!/usr/bin/env node
/**
 * Add missing DEF picks to bot accounts in Week 13
 * Bots currently have 7 picks but need 8 (missing DEF position)
 */
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addMissingDefPicks() {
  try {
    console.log('Adding missing DEF picks to bot accounts in Week 13...\n');

    // Get all bot accounts
    const botsResult = await pool.query(`
      SELECT id, name, email
      FROM users
      WHERE email LIKE '%@test.com'
      ORDER BY name
    `);

    console.log(`Found ${botsResult.rows.length} bot accounts\n`);

    // Get all available DEF players from playoff teams
    const defPlayersResult = await pool.query(`
      SELECT id, first_name, last_name, team, position
      FROM players
      WHERE position = 'DEF'
        AND team IN ('KC', 'BUF', 'BAL', 'HOU', 'LAC', 'PIT', 'DEN',
                     'PHI', 'DET', 'TB', 'LAR', 'MIN', 'WAS', 'GB')
      ORDER BY RANDOM()
    `);

    console.log(`Found ${defPlayersResult.rows.length} available DEF players\n`);

    if (defPlayersResult.rows.length === 0) {
      console.log('ERROR: No DEF players found! Cannot proceed.');
      process.exit(1);
    }

    let addedCount = 0;

    // For each bot, check if they have a DEF pick for Week 13
    for (const bot of botsResult.rows) {
      // Check if bot already has a DEF pick for Week 13
      const existingDefResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM picks
        WHERE user_id = $1 AND week_number = 13 AND position = 'DEF'
      `, [bot.id]);

      const hasDefPick = parseInt(existingDefResult.rows[0].count) > 0;

      if (hasDefPick) {
        console.log(`${bot.name}: Already has DEF pick, skipping`);
        continue;
      }

      // Get a random DEF player that this bot doesn't already have
      const botPicksResult = await pool.query(`
        SELECT player_id
        FROM picks
        WHERE user_id = $1 AND week_number = 13
      `, [bot.id]);

      const existingPlayerIds = botPicksResult.rows.map(r => r.player_id);

      // Find a DEF player not already picked by this bot
      let defPlayer = null;
      for (const player of defPlayersResult.rows) {
        if (!existingPlayerIds.includes(player.id)) {
          defPlayer = player;
          break;
        }
      }

      if (!defPlayer) {
        // If all DEF players are taken (unlikely), just use the first one
        defPlayer = defPlayersResult.rows[0];
      }

      // Add the DEF pick with 2x multiplier (Week 13 should have multipliers)
      await pool.query(`
        INSERT INTO picks (user_id, player_id, week_number, position, multiplier)
        VALUES ($1, $2, 13, 'DEF', 2)
        ON CONFLICT (user_id, player_id, week_number) DO NOTHING
      `, [bot.id, defPlayer.id]);

      console.log(`${bot.name}: Added ${defPlayer.first_name} ${defPlayer.last_name} (${defPlayer.team}) - 2x multiplier`);
      addedCount++;
    }

    console.log(`\n=== Summary ===`);
    console.log(`Successfully added ${addedCount} DEF picks to bot accounts`);
    console.log(`All bots should now have 8 picks each for Week 13`);

    // Verify final counts
    console.log('\n=== Verification ===');
    for (const bot of botsResult.rows) {
      const countResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM picks
        WHERE user_id = $1 AND week_number = 13
      `, [bot.id]);

      const pickCount = parseInt(countResult.rows[0].count);
      const status = pickCount === 8 ? '✓' : '✗';
      console.log(`${status} ${bot.name}: ${pickCount} picks`);
    }

  } catch (error) {
    console.error('Error adding DEF picks:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

addMissingDefPicks();
