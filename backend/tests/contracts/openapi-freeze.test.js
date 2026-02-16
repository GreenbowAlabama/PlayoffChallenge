/**
 * OpenAPI Contract Freeze Test
 *
 * Validates that the current OpenAPI spec matches the frozen contract snapshot.
 *
 * Test flow:
 * 1. Generate canonical OpenAPI spec from app routes
 * 2. Hash the spec JSON with SHA256
 * 3. Query database for latest api_contract_snapshots row (contract_name = 'public-api')
 * 4. Assert generated hash matches stored sha256
 *
 * Read-only enforcement: No writes to database. Only SELECT queries.
 *
 * If this test fails: Generated API differs from frozen contract.
 * This blocks CI/CD merge → prevents silent API changes.
 */

const crypto = require('crypto');
const { Pool } = require('pg');
const { generateOpenAPISpec } = require('../../scripts/generate-openapi');

describe('OpenAPI Contract Freeze', () => {
  let pool;

  beforeAll(() => {
    // Use test database via DATABASE_URL (mapped by setup.js)
    pool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('should have generated spec match frozen contract snapshot', async () => {
    // Step 1: Generate canonical OpenAPI spec
    const spec = generateOpenAPISpec();

    // Guard: spec must be an object
    expect(spec).toBeDefined();
    expect(typeof spec).toBe('object');
    expect(spec.openapi).toBe('3.0.0');

    // Step 2: Serialize and hash the spec
    const specJson = JSON.stringify(spec, null, 2);
    const generatedHash = crypto
      .createHash('sha256')
      .update(specJson)
      .digest('hex');

    // Step 3: Query database for latest snapshot
    const result = await pool.query(
      `SELECT id, contract_name, sha256, spec_json, created_at
       FROM api_contract_snapshots
       WHERE contract_name = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      ['public-api']
    );

    // Step 4: Validate snapshot exists
    expect(result.rows.length).toBe(1);
    const snapshot = result.rows[0];

    expect(snapshot).toBeDefined();
    expect(snapshot.contract_name).toBe('public-api');
    expect(snapshot.sha256).toBeDefined();
    expect(typeof snapshot.sha256).toBe('string');
    expect(snapshot.sha256.length).toBe(64); // SHA256 is 64 hex characters

    // Step 5: Assert hashes match
    expect(generatedHash).toBe(snapshot.sha256);
  });

  it('should have consistent OpenAPI spec generation', () => {
    // Generate spec twice - should be identical (deterministic)
    const spec1 = generateOpenAPISpec();
    const spec2 = generateOpenAPISpec();

    const json1 = JSON.stringify(spec1, null, 2);
    const json2 = JSON.stringify(spec2, null, 2);

    expect(json1).toBe(json2);
  });

  it('should have valid OpenAPI structure', () => {
    const spec = generateOpenAPISpec();

    // Validate top-level structure
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.info).toBeDefined();
    expect(spec.info.title).toBe('67 Enterprises API');
    expect(spec.info.version).toBe('v1');
    expect(spec.paths).toBeDefined();
    expect(typeof spec.paths).toBe('object');

    // Validate all paths are valid
    for (const [path, methods] of Object.entries(spec.paths)) {
      // Path must be a string
      expect(typeof path).toBe('string');
      expect(path.length).toBeGreaterThan(0);

      // Methods must be an object
      expect(typeof methods).toBe('object');
      for (const [method, spec] of Object.entries(methods)) {
        // Method must be lowercase HTTP method
        expect(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']).toContain(method);

        // Each method must have responses
        expect(spec.responses).toBeDefined();
        expect(typeof spec.responses).toBe('object');
        expect(spec.responses['200']).toBeDefined();
        expect(spec.responses['200'].description).toBeDefined();
      }
    }
  });

  it('should have no extra properties in spec', () => {
    const spec = generateOpenAPISpec();

    // Only these top-level keys are allowed
    const allowedKeys = ['openapi', 'info', 'paths'];
    const actualKeys = Object.keys(spec).sort();

    expect(actualKeys).toEqual(allowedKeys.sort());
  });
});
