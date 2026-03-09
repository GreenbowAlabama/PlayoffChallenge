require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function writeOutput(filename, serverTime, metrics) {
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, filename);
  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        server_time: serverTime,
        source: 'database',
        metrics
      },
      null,
      2
    )
  );

  console.log('Validation complete.');
  console.log(`Output written to: ${outputFile}`);
}

async function main() {
  const client = await pool.connect();
  try {
    // 0. Server time (for timezone and lag detection)
    const serverTimeResult = await client.query('SELECT NOW() as server_time');
    const serverTime = serverTimeResult.rows[0].server_time;

    // 1. Contest status distribution
    const statusResult = await client.query(`
      SELECT status, COUNT(*) as count
      FROM contest_instances
      GROUP BY status
      ORDER BY status
    `);

    const contests_by_status = {
      SCHEDULED: 0,
      LOCKED: 0,
      LIVE: 0,
      COMPLETE: 0,
      CANCELLED: 0,
      ERROR: 0
    };
    statusResult.rows.forEach(row => {
      if (contests_by_status.hasOwnProperty(row.status)) {
        contests_by_status[row.status] = parseInt(row.count, 10);
      }
    });

    // 2. All contests with key fields (includes entry_fee_cents and lock_time for tower UI display)
    const contestsResult = await client.query(`
      SELECT id, contest_name, status, max_entries, current_entries, entry_fee_cents, lock_time
      FROM contest_instances
      ORDER BY created_at DESC
    `);

    const contests = contestsResult.rows.map(row => ({
      id: row.id,
      contest_name: row.contest_name,
      status: row.status,
      max_entries: row.max_entries ? parseInt(row.max_entries, 10) : null,
      current_entries: parseInt(row.current_entries, 10),
      entry_fee_cents: parseInt(row.entry_fee_cents, 10),
      lock_time: row.lock_time
    }));

    // 3. Contests without field_selections
    const noFieldSelectionsResult = await client.query(`
      SELECT COUNT(*) as count
      FROM contest_instances ci
      WHERE ci.id NOT IN (
        SELECT DISTINCT contest_instance_id FROM field_selections
      )
    `);
    const contests_without_field_selections = parseInt(
      noFieldSelectionsResult.rows[0].count,
      10
    );

    // 4. Contests without entries
    const noEntriesResult = await client.query(`
      SELECT COUNT(*) as count
      FROM contest_instances ci
      WHERE NOT EXISTS (
        SELECT 1 FROM contest_participants
        WHERE contest_instance_id = ci.id
      )
    `);
    const contests_without_entries = parseInt(
      noEntriesResult.rows[0].count,
      10
    );

    const metrics = {
      contests_by_status,
      contests,
      contests_without_field_selections,
      contests_without_entries
    };

    await writeOutput('contest-ops.expected.json', serverTime, metrics);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Validation failed:', err);
  process.exit(1);
});
