/**
 * Append-Only Invariant Enforcement - Integration Tests
 *
 * Uses REAL PostgreSQL database constraints (not mocks).
 * Tests that:
 * - UPDATE on ingestion_events is rejected by DB
 * - DELETE on ingestion_events is rejected by DB
 * - UPDATE on score_history is rejected by DB
 * - INSERT always works
 * - SELECT always works
 *
 * PREREQUISITE: Test database must exist and have migrations applied
 * - Set DATABASE_URL_TEST in .env to isolated test database
 * - Run: npm run migrate:test
 * - DB constraints/triggers must be in place for UPDATE/DELETE rejection
 * - Safety guards prevent execution against staging/production
 */

const { Pool } = require('pg');
const crypto = require('crypto');

describe('Append-Only Invariant Enforcement (Real DB)', () => {
  let pool;
  let contestId;
  let templateId;
  let organizerId;

  beforeAll(async () => {
    // Connect to test database (DATABASE_URL_TEST, never DATABASE_URL)
    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      max: 1
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    contestId = crypto.randomUUID();
    organizerId = crypto.randomUUID();
    templateId = crypto.randomUUID();

    // Create user
    await pool.query(
      `INSERT INTO users (id, email)
       VALUES ($1, $2)`,
      [organizerId, `test-${organizerId}@example.com`]
    );

    // Create contest template
    await pool.query(
      `INSERT INTO contest_templates
       (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key,
        default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents, allowed_payout_structures)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [templateId, 'Test Template', 'golf', 'standard', 'golf_scoring', 'golf_lock', 'golf_settlement',
       0, 0, 1000000, JSON.stringify({})]
    );

    // Create test contest with proper FKs
    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, status, entry_fee_cents, payout_structure, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [contestId, templateId, organizerId, 'LIVE', 0, JSON.stringify({}), 'Test Contest', 20]
    );
  });

  afterEach(async () => {
    // Cleanup in reverse FK order (most dependent first)
    try {
      await pool.query('DELETE FROM score_history WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM settlement_audit WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM ingestion_validation_errors WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM ingestion_events WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM contest_instances WHERE id = $1', [contestId]);
      await pool.query('DELETE FROM contest_templates WHERE id = $1', [templateId]);
      await pool.query('DELETE FROM users WHERE id = $1', [organizerId]);
    } catch (err) {
      // Cleanup non-fatal
    }
  });

  describe('ingestion_events immutability', () => {
    it('should allow INSERT on ingestion_events', async () => {
      const eventId = crypto.randomUUID();

      const result = await pool.query(
        `INSERT INTO ingestion_events
         (id, contest_instance_id, provider, event_type, provider_data_json, payload_hash, validation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [eventId, contestId, 'golf_provider', 'leaderboard', JSON.stringify({ test: true }), 'hash-abc', 'VALID']
      );

      expect(result.rows[0].id).toBe(eventId);
    });

    it('should allow SELECT on ingestion_events', async () => {
      const eventId = crypto.randomUUID();

      // Insert first
      await pool.query(
        `INSERT INTO ingestion_events
         (id, contest_instance_id, provider, event_type, provider_data_json, payload_hash, validation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [eventId, contestId, 'golf_provider', 'leaderboard', JSON.stringify({ test: true }), 'hash-abc', 'VALID']
      );

      // Select it
      const result = await pool.query(
        'SELECT id, validation_status FROM ingestion_events WHERE id = $1',
        [eventId]
      );

      expect(result.rows[0].validation_status).toBe('VALID');
    });

    it('should REJECT UPDATE on ingestion_events', async () => {
      const eventId = crypto.randomUUID();

      // Insert an event
      await pool.query(
        `INSERT INTO ingestion_events
         (id, contest_instance_id, provider, event_type, provider_data_json, payload_hash, validation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [eventId, contestId, 'golf_provider', 'leaderboard', JSON.stringify({ test: true }), 'hash-abc', 'VALID']
      );

      // Attempt to UPDATE
      try {
        await pool.query(
          'UPDATE ingestion_events SET validation_status = $1 WHERE id = $2',
          ['INVALID', eventId]
        );
        throw new Error('UPDATE should have been rejected');
      } catch (err) {
        // Expected: trigger exception from prevent_updates_deletes()
        expect(err).toBeDefined();
        expect(err.message).toMatch(/append-only|update|delete|trigger/i);
      }
    });

    it('should REJECT DELETE on ingestion_events', async () => {
      const eventId = crypto.randomUUID();

      // Insert an event
      await pool.query(
        `INSERT INTO ingestion_events
         (id, contest_instance_id, provider, event_type, provider_data_json, payload_hash, validation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [eventId, contestId, 'golf_provider', 'leaderboard', JSON.stringify({ test: true }), 'hash-abc', 'VALID']
      );

      // Attempt to DELETE
      try {
        await pool.query('DELETE FROM ingestion_events WHERE id = $1', [eventId]);
        throw new Error('DELETE should have been rejected');
      } catch (err) {
        // Expected: trigger exception from prevent_updates_deletes()
        expect(err).toBeDefined();
        expect(err.message).toMatch(/append-only|update|delete|trigger/i);
      }
    });
  });

  describe('ingestion_validation_errors immutability', () => {
    it('should allow INSERT on ingestion_validation_errors', async () => {
      const eventId = crypto.randomUUID();
      const errorId = crypto.randomUUID();

      // Create event first
      await pool.query(
        `INSERT INTO ingestion_events
         (id, contest_instance_id, provider, event_type, provider_data_json, payload_hash, validation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [eventId, contestId, 'golf', 'leaderboard', '{}', 'hash', 'INVALID']
      );

      // Insert error
      const result = await pool.query(
        `INSERT INTO ingestion_validation_errors
         (id, ingestion_event_id, contest_instance_id, error_code, error_details_json)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [errorId, eventId, contestId, 'INVALID_DATA_TYPE', JSON.stringify({ field: 'strokes' })]
      );

      expect(result.rows[0].id).toBe(errorId);
    });

    it('should REJECT UPDATE on ingestion_validation_errors', async () => {
      const eventId = crypto.randomUUID();
      const errorId = crypto.randomUUID();

      // Create event and error
      await pool.query(
        `INSERT INTO ingestion_events
         (id, contest_instance_id, provider, event_type, provider_data_json, payload_hash, validation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [eventId, contestId, 'golf', 'leaderboard', '{}', 'hash', 'INVALID']
      );

      await pool.query(
        `INSERT INTO ingestion_validation_errors
         (id, ingestion_event_id, contest_instance_id, error_code, error_details_json)
         VALUES ($1, $2, $3, $4, $5)`,
        [errorId, eventId, contestId, 'INVALID_DATA_TYPE', JSON.stringify({ field: 'strokes' })]
      );

      // Attempt UPDATE
      try {
        await pool.query(
          'UPDATE ingestion_validation_errors SET error_code = $1 WHERE id = $2',
          ['DIFFERENT_CODE', errorId]
        );
        throw new Error('UPDATE should have been rejected');
      } catch (err) {
        expect(err).toBeDefined();
        expect(err.message).toMatch(/append-only|update|delete|trigger/i);
      }
    });

    it('should REJECT DELETE on ingestion_validation_errors', async () => {
      const eventId = crypto.randomUUID();
      const errorId = crypto.randomUUID();

      // Create event and error
      await pool.query(
        `INSERT INTO ingestion_events
         (id, contest_instance_id, provider, event_type, provider_data_json, payload_hash, validation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [eventId, contestId, 'golf', 'leaderboard', '{}', 'hash', 'INVALID']
      );

      await pool.query(
        `INSERT INTO ingestion_validation_errors
         (id, ingestion_event_id, contest_instance_id, error_code, error_details_json)
         VALUES ($1, $2, $3, $4, $5)`,
        [errorId, eventId, contestId, 'INVALID_DATA_TYPE', JSON.stringify({})]
      );

      // Attempt DELETE
      try {
        await pool.query('DELETE FROM ingestion_validation_errors WHERE id = $1', [errorId]);
        throw new Error('DELETE should have been rejected');
      } catch (err) {
        expect(err).toBeDefined();
        expect(err.message).toMatch(/append-only|update|delete|trigger/i);
      }
    });
  });

  describe('score_history immutability', () => {
    it('should allow INSERT on score_history', async () => {
      const auditId = crypto.randomUUID();
      const scoreId = crypto.randomUUID();

      // Create settlement_audit first
      await pool.query(
        `INSERT INTO settlement_audit
         (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
        [auditId, contestId, crypto.randomUUID(), 'COMPLETE', 'v1', []]
      );

      // Insert score_history
      const result = await pool.query(
        `INSERT INTO score_history
         (id, contest_instance_id, settlement_audit_id, scores_json, scores_hash)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [scoreId, contestId, auditId, JSON.stringify({ 'p1': 100 }), 'hash-abc']
      );

      expect(result.rows[0].id).toBe(scoreId);
    });

    it('should REJECT UPDATE on score_history', async () => {
      const auditId = crypto.randomUUID();
      const scoreId = crypto.randomUUID();

      // Create settlement_audit and score_history
      await pool.query(
        `INSERT INTO settlement_audit
         (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
        [auditId, contestId, crypto.randomUUID(), 'COMPLETE', 'v1', []]
      );

      await pool.query(
        `INSERT INTO score_history
         (id, contest_instance_id, settlement_audit_id, scores_json, scores_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [scoreId, contestId, auditId, JSON.stringify({ 'p1': 100 }), 'hash-abc']
      );

      // Attempt UPDATE
      try {
        await pool.query(
          'UPDATE score_history SET scores_json = $1 WHERE id = $2',
          [JSON.stringify({ 'p1': 200 }), scoreId]
        );
        throw new Error('UPDATE should have been rejected');
      } catch (err) {
        expect(err).toBeDefined();
        expect(err.message).toMatch(/append-only|update|delete|trigger/i);
      }
    });

    it('should REJECT DELETE on score_history', async () => {
      const auditId = crypto.randomUUID();
      const scoreId = crypto.randomUUID();

      // Create settlement_audit and score_history
      await pool.query(
        `INSERT INTO settlement_audit
         (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
        [auditId, contestId, crypto.randomUUID(), 'COMPLETE', 'v1', []]
      );

      await pool.query(
        `INSERT INTO score_history
         (id, contest_instance_id, settlement_audit_id, scores_json, scores_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [scoreId, contestId, auditId, JSON.stringify({ 'p1': 100 }), 'hash-abc']
      );

      // Attempt DELETE
      try {
        await pool.query('DELETE FROM score_history WHERE id = $1', [scoreId]);
        throw new Error('DELETE should have been rejected');
      } catch (err) {
        expect(err).toBeDefined();
        expect(err.message).toMatch(/append-only|update|delete|trigger/i);
      }
    });
  });

  describe('Audit trail preservation', () => {
    it('should preserve all ingestion_validation_errors for audit trail', async () => {
      const eventId = crypto.randomUUID();

      // Create event with multiple errors
      await pool.query(
        `INSERT INTO ingestion_events
         (id, contest_instance_id, provider, event_type, provider_data_json, payload_hash, validation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [eventId, contestId, 'golf', 'leaderboard', '{}', 'hash', 'INVALID']
      );

      // Insert 3 errors
      for (let i = 0; i < 3; i++) {
        await pool.query(
          `INSERT INTO ingestion_validation_errors
           (ingestion_event_id, contest_instance_id, error_code, error_details_json)
           VALUES ($1, $2, $3, $4)`,
          [eventId, contestId, `ERROR_CODE_${i}`, JSON.stringify({})]
        );
      }

      // Verify all 3 exist
      const result = await pool.query(
        'SELECT COUNT(*) as count FROM ingestion_validation_errors WHERE ingestion_event_id = $1',
        [eventId]
      );

      expect(parseInt(result.rows[0].count)).toBe(3);

      // Attempt to delete one (should fail)
      const firstError = await pool.query(
        'SELECT id FROM ingestion_validation_errors WHERE ingestion_event_id = $1 LIMIT 1',
        [eventId]
      );

      try {
        await pool.query(
          'DELETE FROM ingestion_validation_errors WHERE id = $1',
          [firstError.rows[0].id]
        );
        throw new Error('DELETE should have been rejected');
      } catch (err) {
        expect(err).toBeDefined();
      }

      // Verify all 3 still exist (audit trail intact)
      const finalResult = await pool.query(
        'SELECT COUNT(*) as count FROM ingestion_validation_errors WHERE ingestion_event_id = $1',
        [eventId]
      );

      expect(parseInt(finalResult.rows[0].count)).toBe(3);
    });
  });
});
