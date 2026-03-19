#!/usr/bin/env node

const { Client } = require('pg');

async function runDiagnostics() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();

    console.log('====================================');
    console.log('PGA SCORING DIAGNOSTICS');
    console.log('====================================\n');

    // SECTION 1 — ACTIVE PGA CONTESTS
    console.log('====================================');
    console.log('SECTION 1 — ACTIVE PGA CONTESTS');
    console.log('====================================\n');

    const contestsResult = await client.query(`
      SELECT ci.id, ci.status, ct.sport, ci.tournament_start_time, ci.tournament_end_time
      FROM contest_instances ci
      JOIN contest_templates ct ON ct.id = ci.template_id
      WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
      ORDER BY ci.tournament_start_time DESC
      LIMIT 5
    `);
    console.table(contestsResult.rows);
    console.log('');

    // SECTION 2 — LATEST EVENT DATA SNAPSHOT
    console.log('====================================');
    console.log('SECTION 2 — LATEST EVENT DATA SNAPSHOT');
    console.log('====================================\n');

    const snapshotResult = await client.query(`
      SELECT eds.id, eds.contest_instance_id, eds.ingested_at,
             jsonb_array_length(eds.payload->'competitors') as competitor_count
      FROM event_data_snapshots eds
      WHERE eds.contest_instance_id IN (
        SELECT ci.id FROM contest_instances ci
        JOIN contest_templates ct ON ct.id = ci.template_id
        WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
      )
      ORDER BY eds.ingested_at DESC
      LIMIT 10
    `);
    console.table(snapshotResult.rows);
    console.log('');

    // SECTION 3 — GOLFER EVENT SCORES
    console.log('====================================');
    console.log('SECTION 3 — GOLFER EVENT SCORES');
    console.log('====================================\n');

    const golferEventScoresResult = await client.query(`
      SELECT ges.golfer_id, ges.contest_instance_id,
             SUM(COALESCE(ges.hole_points, 0)) as hole_points_sum,
             SUM(COALESCE(ges.bonus_points, 0)) as bonus_points_sum,
             SUM(COALESCE(ges.finish_bonus, 0)) as finish_bonus_sum,
             COUNT(*) as round_count
      FROM golfer_event_scores ges
      WHERE ges.contest_instance_id IN (
        SELECT ci.id FROM contest_instances ci
        JOIN contest_templates ct ON ct.id = ci.template_id
        WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
      )
      GROUP BY ges.golfer_id, ges.contest_instance_id
      ORDER BY hole_points_sum DESC
      LIMIT 20
    `);
    console.table(golferEventScoresResult.rows);
    console.log('');

    // SECTION 4 — GOLFER SCORES (FANTASY SCORES)
    console.log('====================================');
    console.log('SECTION 4 — GOLFER SCORES (FANTASY SCORES)');
    console.log('====================================\n');

    const golferScoresResult = await client.query(`
      SELECT gs.golfer_id, gs.contest_instance_id, gs.total_score, gs.updated_at
      FROM golfer_scores gs
      WHERE gs.contest_instance_id IN (
        SELECT ci.id FROM contest_instances ci
        JOIN contest_templates ct ON ct.id = ci.template_id
        WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
      )
      ORDER BY gs.updated_at DESC
      LIMIT 20
    `);
    console.table(golferScoresResult.rows);
    console.log('');

    // SECTION 5 — ENTRY ROSTERS (CONTEST ENTRIES)
    console.log('====================================');
    console.log('SECTION 5 — ENTRY ROSTERS (CONTEST ENTRIES)');
    console.log('====================================\n');

    const entryRostersResult = await client.query(`
      SELECT er.id, er.contest_instance_id, er.user_id,
             COUNT(er.id) OVER (PARTITION BY er.contest_instance_id) as total_entries
      FROM entry_rosters er
      WHERE er.contest_instance_id IN (
        SELECT ci.id FROM contest_instances ci
        JOIN contest_templates ct ON ct.id = ci.template_id
        WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
      )
      ORDER BY er.created_at DESC
      LIMIT 20
    `);
    console.table(entryRostersResult.rows);
    console.log('');

    // SECTION 6 — ZERO SCORE ENTRIES
    console.log('====================================');
    console.log('SECTION 6 — ZERO SCORE ENTRIES');
    console.log('====================================\n');

    const zeroScoresResult = await client.query(`
      SELECT er.id, er.user_id, er.contest_instance_id,
             COALESCE(gs.total_score, 0) as total_score,
             COUNT(er.id) as entry_count
      FROM entry_rosters er
      LEFT JOIN golfer_scores gs ON gs.contest_instance_id = er.contest_instance_id
        AND gs.golfer_id = er.roster_data->>'player_ids'::text
      WHERE er.contest_instance_id IN (
        SELECT ci.id FROM contest_instances ci
        JOIN contest_templates ct ON ct.id = ci.template_id
        WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
      )
      GROUP BY er.id, er.user_id, er.contest_instance_id, gs.total_score
      HAVING COALESCE(gs.total_score, 0) = 0
      LIMIT 20
    `);
    console.table(zeroScoresResult.rows);
    console.log('');

    console.log('====================================');
    console.log('DIAGNOSTICS COMPLETE');
    console.log('====================================');

    await client.end();
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

runDiagnostics();
