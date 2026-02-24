#!/usr/bin/env node
/**
 * Delete picks that have NULL position in Week 13
 */
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function cleanNullPositionPicks() {
  try {
    console.log('Deleting picks with NULL position in Week 13...\n');

    // Get count first
    const countResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM picks
      WHERE week_number = 13 AND position IS NULL
    `);

    console.log(`Found ${countResult.rows[0].count} picks with NULL position`);

    if (parseInt(countResult.rows[0].count) === 0) {
      console.log('Nothing to delete!');
      return;
    }

    // Delete them
    const deleteResult = await pool.query(`
      DELETE FROM picks
      WHERE week_number = 13 AND position IS NULL
      RETURNING id
    `);

    console.log(`Deleted ${deleteResult.rowCount} picks with NULL position`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

cleanNullPositionPicks();
