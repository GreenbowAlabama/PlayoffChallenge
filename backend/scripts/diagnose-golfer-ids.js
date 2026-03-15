#!/usr/bin/env node

/**
 * Diagnostic script to verify golfer ID format consistency
 *
 * Checks:
 * 1. Player ID format (espn_<athleteId> vs raw <athleteId>)
 * 2. golfer_event_scores ID format
 * 3. Join compatibility between tables
 *
 * Usage:
 *   DATABASE_URL="postgres://..." node scripts/diagnose-golfer-ids.js
 */

'use strict';

const { Pool } = require('pg');

async function runDiagnostics() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🔍 PGA Golfer ID Format Diagnostic\n');
    console.log('=' .repeat(80));

    // Query 1: Check player ID format
    console.log('\n📋 Query 1: Player ID Format');
    console.log('-' .repeat(80));
    const playersResult = await pool.query(`
      SELECT id, espn_id
      FROM players
      LIMIT 10
    `);
    console.log(`Found ${playersResult.rows.length} players:`);
    playersResult.rows.forEach((row, idx) => {
      console.log(`  ${idx + 1}. id: "${row.id}" | espn_id: "${row.espn_id}"`);
    });

    // Query 2: Check golfer_event_scores format
    console.log('\n📋 Query 2: golfer_event_scores Format');
    console.log('-' .repeat(80));
    const scoresResult = await pool.query(`
      SELECT DISTINCT golfer_id
      FROM golfer_event_scores
      LIMIT 10
    `);
    console.log(`Found ${scoresResult.rows.length} unique golfer_ids:`);
    scoresResult.rows.forEach((row, idx) => {
      console.log(`  ${idx + 1}. golfer_id: "${row.golfer_id}"`);
    });

    // Query 3: Test join compatibility
    console.log('\n📋 Query 3: Join Compatibility (golfer_event_scores ← LEFT JOIN → players)');
    console.log('-' .repeat(80));
    const joinResult = await pool.query(`
      SELECT
        ges.golfer_id,
        p.id as player_id,
        p.espn_id,
        CASE WHEN p.id IS NOT NULL THEN '✅ MATCH' ELSE '❌ NO MATCH' END as join_status
      FROM golfer_event_scores ges
      LEFT JOIN players p ON p.id = ges.golfer_id
      LIMIT 10
    `);
    console.log(`Checking ${joinResult.rows.length} golfer_event_scores rows:`);
    joinResult.rows.forEach((row, idx) => {
      console.log(`  ${idx + 1}. golfer_id: "${row.golfer_id}" | player_id: "${row.player_id}" | espn_id: "${row.espn_id}" | ${row.join_status}`);
    });

    // Analysis
    console.log('\n' + '=' .repeat(80));
    console.log('📊 Analysis:');
    console.log('=' .repeat(80));

    if (playersResult.rows.length > 0) {
      const firstPlayerId = playersResult.rows[0].id;
      const hasEspnPrefix = firstPlayerId && firstPlayerId.startsWith('espn_');
      console.log(`\n✓ Player ID Format: ${hasEspnPrefix ? 'espn_<athleteId>' : 'Raw <athleteId> or other'}`);
      console.log(`  Example: "${firstPlayerId}"`);
    }

    if (scoresResult.rows.length > 0) {
      const firstScoreId = scoresResult.rows[0].golfer_id;
      const hasEspnPrefix = firstScoreId && firstScoreId.toString().startsWith('espn_');
      console.log(`\n✓ golfer_event_scores Format: ${hasEspnPrefix ? 'espn_<athleteId>' : 'Raw <athleteId>, UUID, or other'}`);
      console.log(`  Example: "${firstScoreId}"`);
    }

    const matchCount = joinResult.rows.filter(r => r.join_status === '✅ MATCH').length;
    const totalCount = joinResult.rows.length;
    console.log(`\n✓ Join Compatibility: ${matchCount}/${totalCount} rows match`);

    if (matchCount === 0 && totalCount > 0) {
      console.log('\n⚠️  WARNING: No golfer_event_scores rows joined with players table!');
      console.log('   This indicates an ID format mismatch.');
    } else if (matchCount < totalCount) {
      console.log(`\n⚠️  WARNING: Only ${matchCount}/${totalCount} rows joined. Possible ID format mismatch.`);
    } else {
      console.log('\n✅ All rows joined successfully. IDs are compatible.');
    }

    console.log('\n' + '=' .repeat(80));

  } catch (err) {
    console.error('❌ Error running diagnostics:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runDiagnostics();
