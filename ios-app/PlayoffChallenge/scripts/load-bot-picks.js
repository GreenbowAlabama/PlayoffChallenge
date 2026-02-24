#!/usr/bin/env node

/**
 * Load picks for bot accounts by copying Ian's Week 12 picks
 * This creates Week 12 picks for all 22 bot accounts
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const IAN_USER_ID = '160797bf-7fc6-430c-b8d4-903c69ddad5c';
const WEEK_TO_COPY = 12;

async function loadBotPicks() {
  try {
    console.log('Loading bot picks...\n');

    // Get Ian's Week 12 picks
    const iansPicksResult = await pool.query(`
      SELECT player_id, position, multiplier, consecutive_weeks
      FROM picks
      WHERE user_id = $1 AND week_number = $2
      ORDER BY position
    `, [IAN_USER_ID, WEEK_TO_COPY]);

    console.log(`Found ${iansPicksResult.rows.length} picks from Ian for Week ${WEEK_TO_COPY}`);

    if (iansPicksResult.rows.length === 0) {
      console.log('No picks found for Ian in Week 12. Exiting.');
      process.exit(1);
    }

    // Get all bot accounts
    const botsResult = await pool.query(`
      SELECT id, name
      FROM users
      WHERE email LIKE '%@test.com'
      ORDER BY name
    `);

    console.log(`Found ${botsResult.rows.length} bot accounts\n`);

    let totalPicksCreated = 0;

    // For each bot, copy Ian's picks
    for (const bot of botsResult.rows) {
      console.log(`Creating picks for ${bot.name}...`);

      for (const pick of iansPicksResult.rows) {
        await pool.query(`
          INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, false, NOW())
          ON CONFLICT (user_id, player_id, week_number) DO NOTHING
        `, [
          bot.id,
          pick.player_id,
          WEEK_TO_COPY,
          pick.position,
          pick.multiplier,
          pick.consecutive_weeks
        ]);

        totalPicksCreated++;
      }
    }

    console.log(`\nSuccessfully created ${totalPicksCreated} picks for ${botsResult.rows.length} bot accounts!`);
    console.log(`Each bot now has ${iansPicksResult.rows.length} picks for Week ${WEEK_TO_COPY}`);

  } catch (error) {
    console.error('Error loading bot picks:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

loadBotPicks();
