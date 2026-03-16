#!/usr/bin/env node

// Load .env manually (dotenv may not be available)
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '../../backend/.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
    }
  });
}

const { Pool } = require('pg');

const scriptName = path.basename(__filename, '.js');
const logFile = path.join(__dirname, `${scriptName}.log`);

const logStream = fs.createWriteStream(logFile, { flags: 'a' });
const originalLog = console.log;
console.log = (...args) => {
  originalLog(...args);
  logStream.write(args.join(' ') + '\n');
};

const run = async () => {
  if (!process.argv[2]) {
    console.error('Usage: node event_snapshots_by_provider.js <provider_event_id>');
    console.error('Example: node event_snapshots_by_provider.js espn_pga_401811937');
    process.exit(1);
  }

  const providerEventId = process.argv[2];
  const connectionString = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
  const pool = new Pool({ connectionString });
  try {
    originalLog('====================================');
    originalLog(`${scriptName}: ${providerEventId}`);
    originalLog(`Generated: ${new Date().toISOString()}`);
    originalLog('====================================');
    originalLog('');

    const result = await pool.query(
      `
      SELECT
        contest_instance_id,
        provider_event_id,
        provider_final_flag,
        snapshot_hash,
        ingested_at
      FROM event_data_snapshots
      WHERE provider_event_id = $1
      ORDER BY ingested_at DESC
      LIMIT 20
      `,
      [providerEventId]
    );

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
