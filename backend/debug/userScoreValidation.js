const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function validateUserScore(contestInstanceId, userId) {
  try {
    console.log('=== USER SCORE VALIDATION ===\n');

    const rosterResult = await pool.query(
      `SELECT id, player_ids FROM entry_rosters WHERE contest_instance_id = $1 AND user_id = $2`,
      [contestInstanceId, userId]
    );

    if (rosterResult.rows.length === 0) {
      console.log('ENTRY:\n- No entry found\n');
      process.exit(0);
    }

    const entryId = rosterResult.rows[0].id;
    const playerIds = rosterResult.rows[0].player_ids || [];

    console.log('ENTRY:');
    console.log(`- ${entryId}\n`);

    console.log('ROSTER:');
    playerIds.forEach(id => console.log(`- ${id}`));
    console.log();

    const perGolferResult = await pool.query(
      `SELECT golfer_id,
              SUM(hole_points + bonus_points + finish_bonus) as total_score
       FROM golfer_event_scores
       WHERE contest_instance_id = $1 AND golfer_id = ANY($2)
       GROUP BY golfer_id
       ORDER BY golfer_id`,
      [contestInstanceId, playerIds]
    );

    console.log('PER GOLFER SCORES:');
    let totalScore = 0;
    perGolferResult.rows.forEach(row => {
      const val = Number(row.total_score) || 0;
      console.log(`- ${row.golfer_id}: ${val}`);
      totalScore += val;
    });
    console.log();

    console.log('TOTAL (GROUND TRUTH):');
    console.log(`- ${totalScore}\n`);

    const apiResult = await pool.query(
      `SELECT
         SUM(ges.hole_points + ges.bonus_points + ges.finish_bonus) as api_total
       FROM golfer_event_scores ges
       WHERE ges.contest_instance_id = $1 AND ges.golfer_id = ANY($2)`,
      [contestInstanceId, playerIds]
    );

    console.log('API STYLE TOTAL (SIMULATION):');
    console.log(`- ${Number(apiResult.rows[0]?.api_total) || 0}\n`);

    const dupCheckResult = await pool.query(
      `SELECT golfer_id, COUNT(*) as row_count
       FROM golfer_event_scores
       WHERE contest_instance_id = $1 AND golfer_id = ANY($2)
       GROUP BY golfer_id
       ORDER BY golfer_id`,
      [contestInstanceId, playerIds]
    );

    console.log('ROW COUNTS (DUP CHECK):');
    dupCheckResult.rows.forEach(row => {
      console.log(`- ${row.golfer_id}: ${row.row_count}`);
    });

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('ERROR:', error.message);
    await pool.end();
    process.exit(1);
  }
}

const contestId = process.argv[2];
const userId = process.argv[3];

if (!contestId || !userId) {
  console.error('Usage: node backend/debug/userScoreValidation.js <contest_id> <user_id>');
  process.exit(1);
}

validateUserScore(contestId, userId);
