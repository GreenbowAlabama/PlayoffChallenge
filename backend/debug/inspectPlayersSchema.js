#!/usr/bin/env node

/**
 * Debug Script — Inspect Players Table Schema
 *
 * Queries information_schema to find all columns in public.players table.
 * Used to identify the rank/ranking column before modifying available_players response.
 *
 * Usage:
 *   node backend/debug/inspectPlayersSchema.js
 *
 * Output:
 *   Lists all columns with data types, in table order
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();

  try {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║          PLAYERS TABLE SCHEMA INSPECTION                   ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const res = await client.query(`
      SELECT column_name, data_type, is_nullable, ordinal_position
      FROM information_schema.columns
      WHERE table_name = 'players'
      AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    if (res.rows.length === 0) {
      console.log('❌ No columns found in public.players table');
      client.release();
      await pool.end();
      process.exit(1);
    }

    console.log('📋 All columns in public.players:\n');

    res.rows.forEach((col, idx) => {
      const nullable = col.is_nullable === 'YES' ? ' (nullable)' : '';
      console.log(`  ${idx + 1}. ${col.column_name.padEnd(25)} ${col.data_type.padEnd(20)}${nullable}`);
    });

    console.log('\n' + '═'.repeat(62));

    // Highlight rank-related columns
    const rankCols = res.rows.filter(col =>
      col.column_name.toLowerCase().includes('rank') ||
      col.column_name.toLowerCase().includes('ranking')
    );

    if (rankCols.length > 0) {
      console.log('\n🎯 RANK-RELATED COLUMNS FOUND:\n');
      rankCols.forEach(col => {
        console.log(`  ✓ ${col.column_name} (${col.data_type})`);
      });
    } else {
      console.log('\n⚠️  NO RANK-RELATED COLUMNS FOUND');
      console.log('\nLook for columns like:');
      console.log('  - rank (integer)');
      console.log('  - owgr_rank (integer)');
      console.log('  - world_ranking (integer)');
      console.log('  - owgr (integer)');
      console.log('  - ranking (integer)');
    }

    console.log('\n✅ Copy the full output above and paste it back\n');

  } catch (err) {
    console.error('❌ ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
