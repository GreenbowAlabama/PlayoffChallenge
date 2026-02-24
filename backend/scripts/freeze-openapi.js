#!/usr/bin/env node

/**
 * Freeze OpenAPI Contract Snapshot
 *
 * Creates an auditable snapshot of the current OpenAPI spec.
 * This is the ONLY way to update the frozen contract.
 *
 * Usage:
 *   npm run freeze:openapi
 *
 * What it does:
 * 1. Generates canonical OpenAPI spec from app routes
 * 2. Computes SHA256 hash of the spec JSON
 * 3. Inserts new row into api_contract_snapshots (APPEND-ONLY)
 * 4. Respects append-only invariant: never deletes old rows
 * 5. Creates audit trail of all API changes
 *
 * Why append-only?
 * - Each change is permanent and auditable
 * - You can see when and how the API evolved
 * - You cannot accidentally erase a snapshot
 * - Git history + database history = full accountability
 *
 * Safety:
 * - Requires DATABASE_URL (must be real database, not test DB)
 * - Only writes to api_contract_snapshots
 * - Fails fast if table or database unavailable
 */

const crypto = require('crypto');
const { Pool } = require('pg');
const { generateOpenAPISpec } = require('./generate-openapi');

async function freezeOpenAPI() {
  // Validate environment
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL environment variable not set');
    console.error('This command must write to your production/staging database.');
    console.error('Set DATABASE_URL and try again.');
    process.exit(1);
  }

  // Create connection to real database
  const pool = new Pool({
    connectionString: dbUrl
  });

  try {
    // Step 1: Generate canonical OpenAPI spec
    console.log('📋 Generating canonical OpenAPI spec...');
    const spec = generateOpenAPISpec();

    // Step 2: Validate spec structure
    if (!spec || typeof spec !== 'object' || spec.openapi !== '3.0.0') {
      throw new Error('Generated spec is invalid or missing required fields');
    }

    // Step 3: Serialize and hash
    console.log('🔐 Computing SHA256 hash...');
    const specJson = JSON.stringify(spec, null, 2);
    const sha256Hash = crypto
      .createHash('sha256')
      .update(specJson)
      .digest('hex');

    console.log(`   Hash: ${sha256Hash}`);

    // Step 4: Insert snapshot (APPEND-ONLY, never delete)
    console.log('💾 Inserting snapshot into api_contract_snapshots...');
    const result = await pool.query(
      `INSERT INTO api_contract_snapshots (contract_name, version, sha256, spec_json)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      ['public-api', 'v1', sha256Hash, specJson]
    );

    const { id, created_at } = result.rows[0];

    console.log('\n✅ OpenAPI contract frozen!');
    console.log(`   Snapshot ID: ${id}`);
    console.log(`   Contract:   public-api`);
    console.log(`   Hash:       ${sha256Hash}`);
    console.log(`   Created:    ${created_at.toISOString()}`);
    console.log('\n📝 Next steps:');
    console.log('   1. Review the changes: git diff');
    console.log('   2. Commit the snapshot: git add -A && git commit -m "freeze: update OpenAPI contract"');
    console.log('   3. Document why in your PR');
    console.log('\n🔒 This snapshot is immutable and auditable.');
    console.log('   Your API change is now permanently recorded.\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Failed to freeze OpenAPI contract:');
    console.error(`   ${error.message}`);
    console.error('\nDebugging:');
    console.error(`   DATABASE_URL: ${dbUrl.substring(0, 20)}...`);
    console.error('   Check that:');
    console.error('   - DATABASE_URL is valid and reachable');
    console.error('   - api_contract_snapshots table exists');
    console.error('   - You have write permissions on the table');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the script
freezeOpenAPI();
