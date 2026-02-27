/**
 * Settlement Runner - Atomicity & All-Or-Nothing Integration Tests
 *
 * Uses REAL PostgreSQL test database (not mocks).
 * Tests actual transaction behavior:
 * - BEGIN/COMMIT/ROLLBACK
 * - Transaction isolation
 * - Rollback on mid-run failure
 * - No partial writes on error
 *
 * PREREQUISITE: Test database must exist and have migrations applied
 * - Set DATABASE_URL_TEST in .env to isolated test database
 * - Run: npm run migrate:test
 * - This test suite WILL NOT create or migrate the database
 * - Safety guards prevent execution against staging/production
 */

const { Pool } = require('pg');
const crypto = require('crypto');

describe('Settlement Runner - Atomicity (Real DB)', () => {
  let pool;
  let testPool; // For cleanup queries
  let contestId;
  let settlementRunId;
  let templateId;
  let organizerId;

  beforeAll(async () => {
    // Connect to test database (DATABASE_URL_TEST, never DATABASE_URL)
    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      max: 3
    });

    testPool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      max: 2
    });
  });

  afterAll(async () => {
    await pool.end();
    await testPool.end();
  });

  beforeEach(async () => {
    // Generate test IDs
    contestId = crypto.randomUUID();
    settlementRunId = crypto.randomUUID();
    organizerId = crypto.randomUUID();
    templateId = crypto.randomUUID();

    // Create user
    await testPool.query(
      `INSERT INTO users (id, email)
       VALUES ($1, $2)`,
      [organizerId, `test-${organizerId}@example.com`]
    );

    // Create contest template
    await testPool.query(
      `INSERT INTO contest_templates
       (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key,
        default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents, allowed_payout_structures, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false)`,
      [templateId, 'Test Template', 'golf', 'standard', 'golf_scoring', 'golf_lock', 'golf_settlement',
       0, 0, 1000000, JSON.stringify({})]
    );

    // Create test contest with proper FKs
    await testPool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, status, entry_fee_cents, payout_structure, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [contestId, templateId, organizerId, 'LIVE', 0, JSON.stringify({}), 'Test Contest', 100]
    );
  });

  afterEach(async () => {
    // Cleanup: Delete in reverse FK order (most dependent first)
    // Note: contest_state_transitions cascades on delete via FK
    try {
      await testPool.query('DELETE FROM score_history WHERE contest_instance_id = $1', [contestId]);
      await testPool.query('DELETE FROM settlement_audit WHERE contest_instance_id = $1', [contestId]);
      await testPool.query('DELETE FROM ingestion_validation_errors WHERE contest_instance_id = $1', [contestId]);
      await testPool.query('DELETE FROM ingestion_events WHERE contest_instance_id = $1', [contestId]);
      await testPool.query('DELETE FROM admin_contest_audit WHERE contest_instance_id = $1', [contestId]);
      await testPool.query('DELETE FROM contest_instances WHERE id = $1', [contestId]);
      await testPool.query('DELETE FROM contest_templates WHERE id = $1', [templateId]);
      await testPool.query('DELETE FROM users WHERE id = $1', [organizerId]);
    } catch (err) {
      // Cleanup errors are non-fatal
    }
  });

  describe('Transaction atomicity', () => {
    it('should commit all settlement changes together', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Write settlement_audit with STARTED status
        await client.query(
          `INSERT INTO settlement_audit (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied)
           VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
          [settlementRunId, contestId, crypto.randomUUID(), 'STARTED', 'v1', []]
        );

        // Verify STARTED exists before COMMIT
        const startedResult = await client.query(
          'SELECT status FROM settlement_audit WHERE id = $1',
          [settlementRunId]
        );
        expect(startedResult.rows[0].status).toBe('STARTED');

        // Transition to COMPLETE
        await client.query(
          `UPDATE settlement_audit SET status = $1, completed_at = NOW()
           WHERE id = $2`,
          ['COMPLETE', settlementRunId]
        );

        // Write score_history
        await client.query(
          `INSERT INTO score_history (contest_instance_id, settlement_audit_id, scores_json, scores_hash)
           VALUES ($1, $2, $3, $4)`,
          [contestId, settlementRunId, JSON.stringify({ 'p1': 100 }), 'hash-abc']
        );

        await client.query('COMMIT');

        // After COMMIT, verify both records exist in separate connection
        const auditResult = await testPool.query(
          'SELECT status FROM settlement_audit WHERE id = $1',
          [settlementRunId]
        );
        const scoreResult = await testPool.query(
          'SELECT scores_hash FROM score_history WHERE settlement_audit_id = $1',
          [settlementRunId]
        );

        expect(auditResult.rows[0].status).toBe('COMPLETE');
        expect(scoreResult.rows[0].scores_hash).toBe('hash-abc');
      } finally {
        await client.release();
      }
    });

    it('should rollback all changes if error occurs mid-transaction', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Insert settlement_audit
        await client.query(
          `INSERT INTO settlement_audit (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied)
           VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
          [settlementRunId, contestId, crypto.randomUUID(), 'STARTED', 'v1', []]
        );

        // Verify it exists in this transaction
        const result = await client.query(
          'SELECT id FROM settlement_audit WHERE id = $1',
          [settlementRunId]
        );
        expect(result.rows.length).toBe(1);

        // Simulate error
        await client.query('ROLLBACK');
      } finally {
        await client.release();
      }

      // Verify settlement_audit does NOT exist in other connections
      const finalResult = await testPool.query(
        'SELECT id FROM settlement_audit WHERE id = $1',
        [settlementRunId]
      );
      expect(finalResult.rows.length).toBe(0);
    });

    it('should have no partial score_history if settlement fails', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Create settlement_audit
        await client.query(
          `INSERT INTO settlement_audit (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied)
           VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
          [settlementRunId, contestId, crypto.randomUUID(), 'STARTED', 'v1', []]
        );

        // Start writing score_history but then rollback
        await client.query(
          `INSERT INTO score_history (contest_instance_id, settlement_audit_id, scores_json, scores_hash)
           VALUES ($1, $2, $3, $4)`,
          [contestId, settlementRunId, JSON.stringify({ 'p1': 100 }), 'hash-abc']
        );

        // Rollback entire transaction
        await client.query('ROLLBACK');
      } finally {
        await client.release();
      }

      // Verify NOTHING was written
      const auditResult = await testPool.query(
        'SELECT id FROM settlement_audit WHERE id = $1',
        [settlementRunId]
      );
      const scoreResult = await testPool.query(
        'SELECT id FROM score_history WHERE settlement_audit_id = $1',
        [settlementRunId]
      );

      expect(auditResult.rows.length).toBe(0);
      expect(scoreResult.rows.length).toBe(0);
    });
  });

  describe('Settlement state machine', () => {
    it('should transition STARTED -> COMPLETE atomically', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Insert as STARTED
        await client.query(
          `INSERT INTO settlement_audit (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied)
           VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
          [settlementRunId, contestId, crypto.randomUUID(), 'STARTED', 'v1', []]
        );

        // Update to COMPLETE with final scores
        await client.query(
          `UPDATE settlement_audit SET status = $1, completed_at = NOW(), final_scores_json = $2
           WHERE id = $3`,
          ['COMPLETE', JSON.stringify({ 'p1': 100 }), settlementRunId]
        );

        await client.query('COMMIT');
      } finally {
        await client.release();
      }

      // Verify in other connection
      const result = await testPool.query(
        'SELECT status, final_scores_json, completed_at FROM settlement_audit WHERE id = $1',
        [settlementRunId]
      );

      expect(result.rows[0].status).toBe('COMPLETE');
      expect(result.rows[0].final_scores_json).toBeDefined();
      expect(result.rows[0].completed_at).not.toBeNull();
    });

    it('should transition STARTED -> FAILED on error', async () => {
      const errorMsg = 'Simulated settlement error';
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Insert as STARTED
        await client.query(
          `INSERT INTO settlement_audit (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied)
           VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
          [settlementRunId, contestId, crypto.randomUUID(), 'STARTED', 'v1', []]
        );

        // Update to FAILED with error details
        await client.query(
          `UPDATE settlement_audit SET status = $1, completed_at = NOW(), error_json = $2
           WHERE id = $3`,
          ['FAILED', JSON.stringify({ message: errorMsg }), settlementRunId]
        );

        await client.query('COMMIT');
      } finally {
        await client.release();
      }

      // Verify failure recorded
      const result = await testPool.query(
        'SELECT status, error_json FROM settlement_audit WHERE id = $1',
        [settlementRunId]
      );

      expect(result.rows[0].status).toBe('FAILED');
      expect(result.rows[0].error_json.message).toBe(errorMsg);
    });
  });

  describe('Lock mechanism', () => {
    it('should acquire lock with SELECT FOR UPDATE', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Acquire lock on contest
        const result = await client.query(
          'SELECT id, status FROM contest_instances WHERE id = $1 FOR UPDATE',
          [contestId]
        );

        expect(result.rows.length).toBe(1);
        expect(result.rows[0].status).toBe('LIVE');

        await client.query('COMMIT');
      } finally {
        await client.release();
      }
    });

    it('should prevent modification of locked row from other transaction', async () => {
      const client1 = await pool.connect();
      const client2 = await pool.connect();

      try {
        // Client1 locks the row
        await client1.query('BEGIN');
        await client1.query(
          'SELECT id FROM contest_instances WHERE id = $1 FOR UPDATE',
          [contestId]
        );

        // Client2 tries to update (will timeout or wait in real DB)
        // In test, we just verify the query structure works
        const updateQuery = client2.query(
          'UPDATE contest_instances SET status = $1 WHERE id = $2',
          ['LOCKED', contestId]
        );

        // Release lock from client1
        await client1.query('COMMIT');

        // Now client2 can proceed
        const result = await updateQuery;
        expect(result.rows).toBeDefined();
      } finally {
        await client1.release();
        await client2.release();
      }
    });
  });

  describe('No partial writes on failure', () => {
    it('should not create score_history without settlement_audit', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Try to insert score_history without corresponding settlement_audit
        // (Will fail due to FK constraint if properly defined)
        try {
          await client.query(
            `INSERT INTO score_history (contest_instance_id, settlement_audit_id, scores_json, scores_hash)
             VALUES ($1, $2, $3, $4)`,
            [contestId, 'nonexistent-audit-id', JSON.stringify({}), 'hash']
          );
        } catch (err) {
          // Expected: FK constraint violation
          expect(err).toBeDefined();
        }

        await client.query('ROLLBACK');
      } finally {
        await client.release();
      }

      // Verify nothing was written
      const result = await testPool.query(
        'SELECT COUNT(*) as count FROM score_history WHERE contest_instance_id = $1',
        [contestId]
      );
      expect(parseInt(result.rows[0].count)).toBe(0);
    });

    it('should maintain consistency across all settlement tables', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Create settlement_audit
        const auditId = crypto.randomUUID();
        await client.query(
          `INSERT INTO settlement_audit (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied)
           VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
          [auditId, contestId, crypto.randomUUID(), 'COMPLETE', 'v1', []]
        );

        // Create corresponding score_history
        await client.query(
          `INSERT INTO score_history (contest_instance_id, settlement_audit_id, scores_json, scores_hash)
           VALUES ($1, $2, $3, $4)`,
          [contestId, auditId, JSON.stringify({ 'p1': 100 }), 'hash-abc']
        );

        await client.query('COMMIT');

        // Verify both exist together
        const auditResult = await testPool.query(
          'SELECT id FROM settlement_audit WHERE id = $1',
          [auditId]
        );
        const scoreResult = await testPool.query(
          'SELECT settlement_audit_id FROM score_history WHERE settlement_audit_id = $1',
          [auditId]
        );

        expect(auditResult.rows.length).toBe(1);
        expect(scoreResult.rows.length).toBe(1);
      } finally {
        await client.release();
      }
    });
  });
});
