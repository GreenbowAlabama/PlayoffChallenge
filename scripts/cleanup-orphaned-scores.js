#!/usr/bin/env node

/**
 * Clean up orphaned scores (scores without corresponding picks)
 * This happens when picks are deleted but their scores remain
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const WEEKS_TO_CLEAN = [12, 13];

async function cleanupOrphanedScores() {
  try {
    console.log('Cleaning up orphaned scores...\n');

    let totalDeleted = 0;

    for (const weekNumber of WEEKS_TO_CLEAN) {
      console.log(`\n=== Cleaning Week ${weekNumber} ===\n`);

      // Find scores that don't have corresponding picks
      const orphanedScoresResult = await pool.query(`
        SELECT s.id, s.user_id, s.player_id, s.week_number, s.final_points, u.name
        FROM scores s
        JOIN users u ON s.user_id = u.id
        LEFT JOIN picks p ON s.user_id = p.user_id
          AND s.player_id = p.player_id
          AND s.week_number = p.week_number
        WHERE s.week_number = $1
          AND p.id IS NULL
          AND u.email LIKE '%@test.com'
        ORDER BY u.name, s.final_points DESC
      `, [weekNumber]);

      console.log(`Found ${orphanedScoresResult.rows.length} orphaned scores for Week ${weekNumber}`);

      if (orphanedScoresResult.rows.length > 0) {
        // Group by user for better reporting
        const scoresByUser = {};
        orphanedScoresResult.rows.forEach(score => {
          if (!scoresByUser[score.name]) {
            scoresByUser[score.name] = [];
          }
          scoresByUser[score.name].push(score);
        });

        for (const [userName, scores] of Object.entries(scoresByUser)) {
          console.log(`\n  ${userName}:`);
          let userTotal = 0;
          scores.forEach(score => {
            console.log(`    Player ID ${score.player_id}: ${score.final_points} points`);
            userTotal += parseFloat(score.final_points);
          });
          console.log(`    Subtotal to be removed: ${userTotal.toFixed(2)} points`);
        }

        // Delete orphaned scores
        const deleteResult = await pool.query(`
          DELETE FROM scores
          WHERE id IN (
            SELECT s.id
            FROM scores s
            LEFT JOIN picks p ON s.user_id = p.user_id
              AND s.player_id = p.player_id
              AND s.week_number = p.week_number
            WHERE s.week_number = $1
              AND p.id IS NULL
              AND s.user_id IN (
                SELECT id FROM users WHERE email LIKE '%@test.com'
              )
          )
        `, [weekNumber]);

        totalDeleted += deleteResult.rowCount;
        console.log(`\n  Deleted ${deleteResult.rowCount} orphaned scores for Week ${weekNumber}`);
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Successfully deleted ${totalDeleted} orphaned scores!`);
    console.log(`Scores table now matches picks table for bot accounts`);

  } catch (error) {
    console.error('Error cleaning up orphaned scores:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

cleanupOrphanedScores();
