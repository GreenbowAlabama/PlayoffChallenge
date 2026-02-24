#!/usr/bin/env node
/**
 * Clear all Week 13 scores so they can be rebuilt from fresh live stats
 */
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:GBPNaovBYIBALLlVpZhoOXDtGYrYABNP@trolley.proxy.rlwy.net:41640/railway',
  ssl: { rejectUnauthorized: false }
});

async function clearWeek13Scores() {
  try {
    console.log('Clearing all Week 13 scores...\n');

    // Count how many scores exist
    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM scores WHERE week_number = 13'
    );

    const count = parseInt(countResult.rows[0].count);
    console.log(`Found ${count} scores for Week 13`);

    if (count === 0) {
      console.log('No scores to delete');
      return;
    }

    // Delete all Week 13 scores
    const deleteResult = await pool.query(
      'DELETE FROM scores WHERE week_number = 13'
    );

    console.log(`✓ Deleted ${deleteResult.rowCount} scores from Week 13`);
    console.log('\nWeek 13 scores cleared. Run live stats update to rebuild them from current games.');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

clearWeek13Scores();
