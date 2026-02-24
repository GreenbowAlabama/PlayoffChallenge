#!/usr/bin/env node
/**
 * Clear all Week 14 scores so they can be rebuilt from fresh live stats
 */
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function clearWeek14Scores() {
  try {
    console.log('Clearing all Week 14 scores...\n');

    // Count how many scores exist
    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM scores WHERE week_number = 14'
    );

    const count = parseInt(countResult.rows[0].count);
    console.log(`Found ${count} scores for Week 14`);

    if (count === 0) {
      console.log('No scores to delete');
      return;
    }

    // Delete all Week 14 scores
    const deleteResult = await pool.query(
      'DELETE FROM scores WHERE week_number = 14'
    );

    console.log(`✓ Deleted ${deleteResult.rowCount} scores from Week 14`);
    console.log('\nWeek 14 scores cleared. Run live stats update to rebuild them from current games.');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

clearWeek14Scores();
