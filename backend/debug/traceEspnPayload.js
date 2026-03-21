#!/usr/bin/env node

/**
 * Trace ESPN Payload → golfer_event_scores Write
 *
 * Inspect ingestion_events to find the raw ESPN data used for scoring,
 * then compare to what's stored in golfer_event_scores.
 *
 * Usage: node debug/traceEspnPayload.js <contestInstanceId>
 */

const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

function extractGolferScoresFromPayload(payload) {
  // Extract golfer scores from ESPN payload structure
  const scores = [];

  if (!payload.competitors) {
    return scores;
  }

  for (const competitor of payload.competitors) {
    const golferId = `espn_${competitor.id}`;
    const leaderboardScore = competitor.score;

    // Extract linescores (rounds)
    const linescores = competitor.linescores || [];

    linescores.forEach((round, roundIdx) => {
      const roundNumber = roundIdx + 1;
      const roundHoles = round.linescores || [];

      // Count valid holes
      const validHoles = roundHoles.filter(
        h =>
          h &&
          ((h.scoreType && h.scoreType.displayValue !== undefined) ||
            (typeof h.value === 'number' && isFinite(h.value)))
      );

      scores.push({
        golfer_id: golferId,
        round_number: roundNumber,
        hole_count: validHoles.length,
        leaderboard_score: leaderboardScore,
        sample_hole_1: roundHoles[0] ? `value=${roundHoles[0].value}, par=${roundHoles[0].par}` : 'N/A',
      });
    });
  }

  return scores;
}

async function tracePayload(contestInstanceId) {
  try {
    if (!contestInstanceId) {
      console.error('Usage: node debug/traceEspnPayload.js <contestInstanceId>');
      process.exit(1);
    }

    console.log('\n========================================');
    console.log('TRACE ESPN PAYLOAD → STORED SCORES');
    console.log('========================================\n');

    // Fetch contest metadata
    const contestResult = await pool.query(
      `SELECT id, provider_event_id, contest_name FROM contest_instances WHERE id = $1`,
      [contestInstanceId]
    );

    if (contestResult.rows.length === 0) {
      console.error(`[ERROR] Contest not found: ${contestInstanceId}`);
      process.exit(1);
    }

    const contest = contestResult.rows[0];
    console.log('[CONTEST]');
    console.log(`  id: ${contest.id}`);
    console.log(`  provider_event_id: ${contest.provider_event_id}\n`);

    // Fetch latest ingestion event with SCORING phase
    const ingestionResult = await pool.query(
      `SELECT
        id,
        provider_data_json,
        payload_hash,
        created_at,
        received_at
      FROM ingestion_events
      WHERE contest_instance_id = $1
      AND event_type = 'SCORING'
      ORDER BY created_at DESC
      LIMIT 1`,
      [contestInstanceId]
    );

    if (ingestionResult.rows.length === 0) {
      console.log('[INFO] No SCORING ingestion events found');
      console.log('       (Contest may not have live data yet)\n');
      await pool.end();
      process.exit(0);
    }

    const latestEvent = ingestionResult.rows[0];
    console.log('[LATEST SCORING INGESTION]');
    console.log(`  event_id: ${latestEvent.id}`);
    console.log(`  received_at: ${latestEvent.received_at}`);
    console.log(`  payload_hash: ${latestEvent.payload_hash}`);

    const payload = latestEvent.provider_data_json || {};
    const payloadScores = extractGolferScoresFromPayload(payload);

    console.log(`  competitors in payload: ${payload.competitors?.length || 0}\n`);

    // Show sample competitor data
    if (payload.competitors && payload.competitors.length > 0) {
      const sample = payload.competitors[0];
      console.log('[SAMPLE COMPETITOR FROM ESPN]');
      console.log(`  id: ${sample.id}`);
      console.log(`  score (leaderboard): ${sample.score}`);
      console.log(`  linescores (rounds): ${sample.linescores?.length || 0}`);
      if (sample.linescores && sample.linescores[0]) {
        const round1 = sample.linescores[0];
        console.log(`  round 1 holes: ${round1.linescores?.length || 0}`);
        if (round1.linescores && round1.linescores[0]) {
          const hole1 = round1.linescores[0];
          console.log(`    hole 1: value=${hole1.value}, par=${hole1.par}, scoreType=${hole1.scoreType?.displayValue}`);
        }
      }
      console.log();
    }

    // Fetch what's stored in golfer_event_scores
    const storedResult = await pool.query(
      `SELECT
        golfer_id,
        round_number,
        hole_points,
        bonus_points,
        finish_bonus,
        total_points
      FROM golfer_event_scores
      WHERE contest_instance_id = $1
      ORDER BY golfer_id, round_number`,
      [contestInstanceId]
    );

    console.log('[STORED IN GOLFER_EVENT_SCORES]');
    console.log(`  Total rows: ${storedResult.rows.length}\n`);

    const storedByGolfer = new Map();
    storedResult.rows.forEach(row => {
      if (!storedByGolfer.has(row.golfer_id)) {
        storedByGolfer.set(row.golfer_id, []);
      }
      storedByGolfer.get(row.golfer_id).push({
        round: row.round_number,
        hole: row.hole_points,
        bonus: row.bonus_points,
        finish: row.finish_bonus,
        total: row.total_points,
      });
    });

    // Show stored data for sample golfers
    let count = 0;
    for (const [golferId, rounds] of storedByGolfer.entries()) {
      console.log(`  ${golferId}:`);
      rounds.forEach(r => {
        console.log(`    R${r.round}: hole=${r.hole} bonus=${r.bonus} finish=${r.finish} total=${r.total}`);
      });
      count++;
      if (count >= 3) {
        console.log(`  ... and ${storedByGolfer.size - 3} more golfers`);
        break;
      }
    }

    console.log('\n========================================\n');

    await pool.end();
  } catch (err) {
    console.error('[ERROR]', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

const contestInstanceId = process.argv[2];
tracePayload(contestInstanceId);
