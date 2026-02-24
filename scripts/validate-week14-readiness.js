#!/usr/bin/env node
/**
 * Validate Week 14 data readiness before deployment
 */
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function validateWeek14() {
  try {
    console.log('=== Week 14 Readiness Validation ===\n');

    let issues = 0;

    // 1. Check for null positions in Week 14 picks
    const nullPositions = await pool.query(
      'SELECT COUNT(*) as count FROM picks WHERE week_number = 14 AND position IS NULL'
    );
    const nullCount = parseInt(nullPositions.rows[0].count);
    if (nullCount > 0) {
      console.log(`❌ Found ${nullCount} picks with NULL position in Week 14`);
      issues++;
    } else {
      console.log('✓ All Week 14 picks have valid positions');
    }

    // 2. Check for stale scores in Week 14
    const staleScores = await pool.query(
      'SELECT COUNT(*) as count FROM scores WHERE week_number = 14 AND final_points > 0'
    );
    const staleCount = parseInt(staleScores.rows[0].count);
    if (staleCount > 0) {
      console.log(`⚠️  Found ${staleCount} non-zero scores in Week 14 (may be stale from previous week)`);
      console.log('   Consider running: DELETE FROM scores WHERE week_number = 14;');
      issues++;
    } else {
      console.log('✓ Week 14 scores are clean (0 or empty)');
    }

    // 3. Check for players with missing ESPN IDs
    const missingEspnIds = await pool.query(`
      SELECT DISTINCT p.id, p.full_name, p.team, p.position
      FROM players p
      JOIN picks pk ON p.id = pk.player_id
      WHERE pk.week_number = 14
        AND p.espn_id IS NULL
      LIMIT 10
    `);
    if (missingEspnIds.rows.length > 0) {
      console.log(`⚠️  Found ${missingEspnIds.rows.length}+ players without ESPN IDs in Week 14 picks:`);
      missingEspnIds.rows.forEach(p => {
        console.log(`   - ${p.full_name} (${p.team} ${p.position})`);
      });
      issues++;
    } else {
      console.log('✓ All Week 14 players have ESPN IDs');
    }

    // 4. Check pick counts per user
    const pickCounts = await pool.query(`
      SELECT u.name, u.email, COUNT(pk.id) as pick_count
      FROM users u
      LEFT JOIN picks pk ON u.id = pk.user_id AND pk.week_number = 14
      WHERE u.paid = true
      GROUP BY u.id, u.name, u.email
      HAVING COUNT(pk.id) != 8
      ORDER BY COUNT(pk.id)
      LIMIT 10
    `);
    if (pickCounts.rows.length > 0) {
      console.log(`⚠️  Found ${pickCounts.rows.length} users with incomplete rosters for Week 14:`);
      pickCounts.rows.forEach(u => {
        console.log(`   - ${u.name || u.email}: ${u.pick_count} picks (expected 8)`);
      });
      console.log('   Note: This may be expected if players were eliminated');
    } else {
      console.log('✓ All users have complete rosters (8 picks each)');
    }

    // 5. Check multipliers
    const multiplierCheck = await pool.query(`
      SELECT multiplier, COUNT(*) as count
      FROM picks
      WHERE week_number = 14
      GROUP BY multiplier
      ORDER BY multiplier
    `);
    console.log('\n📊 Week 14 multiplier distribution:');
    multiplierCheck.rows.forEach(row => {
      console.log(`   ${row.multiplier}x: ${row.count} picks`);
    });

    // Summary
    console.log('\n=== Summary ===');
    if (issues === 0) {
      console.log('✅ Week 14 is ready for deployment!');
    } else {
      console.log(`⚠️  Found ${issues} potential issue(s) - review above`);
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

validateWeek14();
