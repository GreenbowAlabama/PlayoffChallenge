#!/usr/bin/env node

/**
 * PGA Data Audit — Leaderboard Dataset Verification
 *
 * Audits golfer_scores data to verify correct provider_event_id is being used.
 * Identifies if stale or mismatched scores are included in calculations.
 *
 * Usage: node debug/pgaDataAudit.js <contestInstanceId>
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function auditPgaData(contestInstanceId) {
  try {
    if (!contestInstanceId) {
      console.error('Usage: node debug/pgaDataAudit.js <contestInstanceId>');
      process.exit(1);
    }

    console.log('\n========================================');
    console.log('PGA DATA AUDIT');
    console.log('========================================\n');

    // Step 1: Fetch contest metadata
    const contestResult = await pool.query(
      `SELECT
        id,
        provider_event_id,
        contest_name,
        status,
        entry_fee_cents,
        created_at
      FROM contest_instances
      WHERE id = $1`,
      [contestInstanceId]
    );

    if (contestResult.rows.length === 0) {
      console.error(`[ERROR] Contest not found: ${contestInstanceId}`);
      process.exit(1);
    }

    const contest = contestResult.rows[0];
    console.log('[CONTEST EVENT]');
    console.log(`  contest_id: ${contest.id}`);
    console.log(`  provider_event_id: ${contest.provider_event_id}`);
    console.log(`  contest_name: ${contest.contest_name}`);
    console.log(`  status: ${contest.status}`);
    console.log();

    // Step 2: Fetch all golfer_scores for this contest (across ALL provider_event_ids)
    const scoresResult = await pool.query(
      `SELECT DISTINCT
        gs.golfer_id,
        gs.user_id,
        gs.round_number,
        gs.hole_points,
        gs.bonus_points,
        gs.finish_bonus,
        gs.total_points,
        gs.details,
        gs.created_at,
        gs.updated_at
      FROM golfer_scores gs
      WHERE gs.contest_instance_id = $1
      ORDER BY gs.golfer_id, gs.round_number`,
      [contestInstanceId]
    );

    console.log(`[SCORES FOUND] Total rows: ${scoresResult.rows.length}\n`);

    if (scoresResult.rows.length === 0) {
      console.log('[WARNING] No golfer_scores found for this contest');
      console.log();
      await pool.end();
      process.exit(0);
    }

    // Step 3: Check if details jsonb contains provider_event_id
    console.log('[CHECKING DETAILS COLUMN FOR provider_event_id]\n');
    const detailsCheck = new Set();
    const providerEventIds = new Set();

    scoresResult.rows.forEach(row => {
      if (row.details && row.details.provider_event_id) {
        detailsCheck.add(row.details.provider_event_id);
        providerEventIds.add(row.details.provider_event_id);
      }
    });

    if (detailsCheck.size > 0) {
      console.log('[EVENTS IN DETAILS]');
      Array.from(providerEventIds).forEach(eventId => {
        const count = scoresResult.rows.filter(
          r => r.details && r.details.provider_event_id === eventId
        ).length;
        console.log(`  ${eventId}: ${count} scores`);
      });
      console.log();
    } else {
      console.log('[INFO] No provider_event_id found in details column');
      console.log();
    }

    // Step 4: Fetch entry_rosters to find the 7 golfers for this contest
    const rostersResult = await pool.query(
      `SELECT
        er.id,
        er.user_id,
        er.player_ids,
        u.username
      FROM entry_rosters er
      JOIN users u ON er.user_id = u.id
      WHERE er.contest_instance_id = $1`,
      [contestInstanceId]
    );

    console.log(`[ENTRY ROSTERS] Found ${rostersResult.rows.length} entries\n`);

    if (rostersResult.rows.length === 0) {
      console.log('[WARNING] No entries found for this contest');
      await pool.end();
      process.exit(0);
    }

    // Collect all golfers
    const golfersByUser = new Map();
    rostersResult.rows.forEach(roster => {
      const playerIds = Array.isArray(roster.player_ids)
        ? roster.player_ids
        : roster.player_ids.split(',');
      golfersByUser.set(roster.user_id, {
        username: roster.username,
        golfers: playerIds,
      });
    });

    // Step 5: For each entry, get scores for all 7 golfers
    console.log('[7 GOLFERS RAW SCORES]\n');

    for (const [userId, userData] of golfersByUser) {
      console.log(`User: ${userData.username} (${userId})`);

      const scores = [];
      for (const golferId of userData.golfers) {
        const golferScores = scoresResult.rows.filter(
          r => r.user_id === userId && r.golfer_id === golferId
        );

        if (golferScores.length === 0) {
          scores.push({
            golfer_id: golferId,
            total_points: 0,
            details: null,
          });
        } else {
          // Sum across all rounds
          const totalPoints = golferScores.reduce(
            (sum, r) => sum + r.hole_points + r.bonus_points + r.finish_bonus,
            0
          );
          scores.push({
            golfer_id: golferId,
            total_points: totalPoints,
            details: golferScores[0].details,
            source_rows: golferScores.length,
          });
        }
      }

      // Sort by score ASC and take best 6
      scores.sort((a, b) => a.total_points - b.total_points);
      const best6 = scores.slice(0, 6);
      const totalScore = best6.reduce((sum, s) => sum + s.total_points, 0);

      console.log(`  Golfers:`);
      scores.forEach((s, idx) => {
        const isBest = idx < 6 ? ' ✓' : '';
        const eventId = s.details?.provider_event_id || 'UNKNOWN';
        console.log(
          `    ${idx + 1}. ${s.golfer_id.padEnd(20)} | ${String(s.total_points).padStart(3)} pts | ${eventId}${isBest}`
        );
      });
      console.log(`  Best 6 total: ${totalScore}\n`);
    }

    // Step 6: List all unique provider_event_ids found (if in details)
    console.log('[AUDIT SUMMARY]\n');
    console.log(`Expected provider_event_id (from contest): ${contest.provider_event_id}`);
    if (providerEventIds.size > 0) {
      console.log(`provider_event_ids found in scores: ${Array.from(providerEventIds).join(', ')}`);
      if (!providerEventIds.has(contest.provider_event_id)) {
        console.log(`[ALERT] Expected provider_event_id NOT found in scores!`);
      }
      if (providerEventIds.size > 1) {
        console.log(`[ALERT] Multiple provider_event_ids found — scores mixed from different tournaments!`);
      }
    } else {
      console.log('[INFO] No provider_event_id tracking in details column');
    }

    console.log('\n========================================\n');

    await pool.end();
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  }
}

// Run audit
const contestInstanceId = process.argv[2];
auditPgaData(contestInstanceId);
