#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const scriptName = path.basename(__filename, '.js');
const logFile = path.join(__dirname, `${scriptName}.log`);

const logStream = fs.createWriteStream(logFile, { flags: 'a' });
const originalLog = console.log;
console.log = (...args) => {
  originalLog(...args);
  logStream.write(args.join(' ') + '\n');
};

const run = async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    originalLog('====================================');
    originalLog(scriptName);
    originalLog(`Generated: ${new Date().toISOString()}`);
    originalLog('====================================');
    originalLog('');

    const result = await pool.query(`
      SELECT
        s.contest_instance_id,
        ci.contest_name,
        ci.status,
        MAX(s.ingested_at) AS final_snapshot_time
      FROM event_data_snapshots s
      JOIN contest_instances ci
        ON ci.id = s.contest_instance_id
      WHERE s.provider_final_flag = true
      AND ci.status != 'COMPLETE'
      GROUP BY s.contest_instance_id, ci.contest_name, ci.status
      ORDER BY final_snapshot_time DESC
    `);

    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
    logStream.end();
  }
};

run();
