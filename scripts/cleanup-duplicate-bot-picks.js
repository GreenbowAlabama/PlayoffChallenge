#!/usr/bin/env node

/**
 * Clean up duplicate Week 12 picks for bot accounts
 * Keeps only one pick per position per user (the most recent one)
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const WEEKS_TO_CLEAN = [12, 13];

// Position requirements: how many picks allowed per position
const POSITION_LIMITS = {
  'QB': 1,
  'RB': 2,
  'WR': 2,
  'TE': 1,
  'K': 1,
  'DEF': 1
};

async function cleanupDuplicatePicks() {
  try {
    console.log('Cleaning up duplicate picks for bot accounts...\n');

    // Get all bot accounts
    const botsResult = await pool.query(`
      SELECT id, name
      FROM users
      WHERE email LIKE '%@test.com'
      ORDER BY name
    `);

    console.log(`Found ${botsResult.rows.length} bot accounts\n`);

    let totalDeleted = 0;

    // For each week
    for (const weekNumber of WEEKS_TO_CLEAN) {
      console.log(`\n=== Cleaning Week ${weekNumber} ===\n`);

      // For each bot, find and remove duplicate picks
      for (const bot of botsResult.rows) {
        console.log(`Checking ${bot.name} (Week ${weekNumber})...`);

        // Find picks by position count
        const duplicatesResult = await pool.query(`
          SELECT position, COUNT(*) as count
          FROM picks
          WHERE user_id = $1 AND week_number = $2
          GROUP BY position
          ORDER BY position
        `, [bot.id, weekNumber]);

        if (duplicatesResult.rows.length === 0) {
          console.log(`  No picks found`);
          continue;
        }

        let hasIssues = false;
        for (const dup of duplicatesResult.rows) {
          const expectedCount = POSITION_LIMITS[dup.position] || 1;
          const actualCount = parseInt(dup.count);

          if (actualCount > expectedCount) {
            hasIssues = true;
            console.log(`  Position ${dup.position}: ${actualCount} picks (expected ${expectedCount})`);

            // Delete extras, keeping only the most recent N picks
            const deleteResult = await pool.query(`
              DELETE FROM picks
              WHERE id IN (
                SELECT id
                FROM picks
                WHERE user_id = $1
                  AND week_number = $2
                  AND position = $3
                ORDER BY created_at DESC
                OFFSET $4
              )
            `, [bot.id, weekNumber, dup.position, expectedCount]);

            const deletedCount = deleteResult.rowCount;
            totalDeleted += deletedCount;
            console.log(`    Deleted ${deletedCount} extra picks for ${dup.position}`);
          } else if (actualCount < expectedCount) {
            console.log(`  WARNING: Position ${dup.position}: only ${actualCount} picks (expected ${expectedCount})`);
          }
        }

        if (!hasIssues) {
          console.log(`  All positions have correct counts`);
        }

        // Verify final count
        const finalCount = await pool.query(`
          SELECT COUNT(*) as count
          FROM picks
          WHERE user_id = $1 AND week_number = $2
        `, [bot.id, weekNumber]);

        console.log(`  Final pick count for ${bot.name}: ${finalCount.rows[0].count}\n`);
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Successfully deleted ${totalDeleted} duplicate picks!`);
    console.log(`All bot accounts should now have 7 picks each for Weeks ${WEEKS_TO_CLEAN.join(', ')}`);

  } catch (error) {
    console.error('Error cleaning up duplicate picks:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

cleanupDuplicatePicks();
