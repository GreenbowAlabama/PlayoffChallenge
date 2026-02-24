#!/usr/bin/env node

/**
 * Restore missing bot picks by copying from Ian's Week 12 picks
 * This fixes the issue where bots only have 1 RB and 1 WR instead of 2 each
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const IAN_USER_ID = '160797bf-7fc6-430c-b8d4-903c69ddad5c';
const WEEKS_TO_FIX = [12, 13];

// Position requirements
const POSITION_LIMITS = {
  'QB': 1,
  'RB': 2,
  'WR': 2,
  'TE': 1,
  'K': 1,
  'DEF': 1
};

async function restoreBotPicks() {
  try {
    console.log('Restoring missing bot picks from Ian...\n');

    // Get Ian's Week 12 picks (source of truth)
    const iansPicksResult = await pool.query(`
      SELECT player_id, position, multiplier, consecutive_weeks
      FROM picks
      WHERE user_id = $1 AND week_number = 12
      ORDER BY position, created_at
    `, [IAN_USER_ID]);

    console.log(`Ian has ${iansPicksResult.rows.length} picks in Week 12\n`);

    // Group Ian's picks by position
    const iansByPosition = {};
    iansPicksResult.rows.forEach(pick => {
      if (!iansByPosition[pick.position]) {
        iansByPosition[pick.position] = [];
      }
      iansByPosition[pick.position].push(pick);
    });

    console.log('Ian\'s picks by position:');
    for (const [pos, picks] of Object.entries(iansByPosition)) {
      console.log(`  ${pos}: ${picks.length} picks`);
    }
    console.log('');

    // Get all bot accounts
    const botsResult = await pool.query(`
      SELECT id, name
      FROM users
      WHERE email LIKE '%@test.com'
      ORDER BY name
    `);

    console.log(`Found ${botsResult.rows.length} bot accounts\n`);

    let totalAdded = 0;

    for (const weekNumber of WEEKS_TO_FIX) {
      console.log(`\n=== Fixing Week ${weekNumber} ===\n`);

      for (const bot of botsResult.rows) {
        console.log(`Checking ${bot.name}...`);

        // Get current picks by position
        const currentPicksResult = await pool.query(`
          SELECT position, COUNT(*) as count
          FROM picks
          WHERE user_id = $1 AND week_number = $2
          GROUP BY position
          ORDER BY position
        `, [bot.id, weekNumber]);

        const currentCounts = {};
        currentPicksResult.rows.forEach(row => {
          currentCounts[row.position] = parseInt(row.count);
        });

        // For each position, check if we need to add picks
        for (const [position, limit] of Object.entries(POSITION_LIMITS)) {
          const currentCount = currentCounts[position] || 0;
          const needed = limit - currentCount;

          if (needed > 0) {
            console.log(`  ${position}: has ${currentCount}, needs ${limit} (adding ${needed})`);

            const iansPicksForPos = iansByPosition[position] || [];
            if (iansPicksForPos.length < limit) {
              console.log(`    WARNING: Ian only has ${iansPicksForPos.length} ${position} picks, cannot fill`);
              continue;
            }

            // Add the missing picks from Ian
            for (let i = currentCount; i < limit && i < iansPicksForPos.length; i++) {
              const ianPick = iansPicksForPos[i];

              // For Week 13, use multiplier 2.0, for Week 12 use 1.0
              const multiplier = weekNumber === 13 ? 2.0 : 1.0;
              const consecutiveWeeks = weekNumber === 13 ? 2 : 1;

              await pool.query(`
                INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
                VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, false, NOW())
                ON CONFLICT (user_id, player_id, week_number) DO NOTHING
              `, [
                bot.id,
                ianPick.player_id,
                weekNumber,
                position,
                multiplier,
                consecutiveWeeks
              ]);

              totalAdded++;
              console.log(`    Added pick ${i + 1} for ${position}`);
            }
          } else if (currentCount === limit) {
            console.log(`  ${position}: OK (${currentCount}/${limit})`);
          } else {
            console.log(`  ${position}: WARNING - has ${currentCount}, expected ${limit}`);
          }
        }

        // Verify final count
        const finalCount = await pool.query(`
          SELECT COUNT(*) as count
          FROM picks
          WHERE user_id = $1 AND week_number = $2
        `, [bot.id, weekNumber]);

        console.log(`  Final total: ${finalCount.rows[0].count} picks\n`);
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Successfully added ${totalAdded} missing picks!`);

  } catch (error) {
    console.error('Error restoring bot picks:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

restoreBotPicks();
