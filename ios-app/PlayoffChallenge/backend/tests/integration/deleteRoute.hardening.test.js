/**
 * DELETE Route Hardening - Integration Tests
 *
 * Validates that DELETE /api/custom-contests/:id complies with append-only governance:
 * - ONLY lifecycle update (status = CANCELLED, is_locked = true)
 * - NO cascade deletes
 * - NO mutations to child tables
 * - NO mutations to append-only tables (ingestion_events, ledger, settlement_audit, score_history)
 * - Response is valid JSON with full contest object structure
 *
 * PREREQUISITE: Test database must exist with migrations applied
 * - Set DATABASE_URL_TEST in .env to isolated test database
 * - Run: npm run migrate:test
 */

const crypto = require('crypto');
const request = require('supertest');
const { getIntegrationApp } = require('../mocks/testAppFactory');
const { ensureActiveTemplate } = require('../helpers/templateFactory');

describe('DELETE Route Hardening (Append-Only Governance)', () => {
  let pool;
  let app;
  let organizerId;
  let templateId;
  let contestId;

  beforeAll(async () => {
    // Initialize Express app with database pool from test factory
    const integration = getIntegrationApp();
    app = integration.app;
    pool = integration.pool;
  });

  // Pool is managed by test factory

  beforeEach(async () => {
    organizerId = crypto.randomUUID();
    contestId = crypto.randomUUID();

    // Create user
    await pool.query(
      `INSERT INTO users (id, email) VALUES ($1, $2)`,
      [organizerId, `org-${organizerId}@test.example`]
    );

    // Create template (deterministic, prevents accumulation)
    const template = await ensureActiveTemplate(pool, {
      sport: 'golf',
      templateType: 'playoff',
      name: 'Test Template',
      scoringKey: 'pga_standard_v1',
      lockKey: 'time_based_lock_v1',
      settlementKey: 'pga_standard_v1',
      allowedPayoutStructures: {},
      entryFeeCents: 0
    });
    templateId = template.id;

    // Create SCHEDULED contest (required status for deletion)
    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, status, entry_fee_cents, payout_structure, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [contestId, templateId, organizerId, 'SCHEDULED', 0, JSON.stringify({}), 'Test Contest', 20]
    );

    // Add organizer as participant (required for entry_count computation)
    await pool.query(
      `INSERT INTO contest_participants (contest_instance_id, user_id)
       VALUES ($1, $2)`,
      [contestId, organizerId]
    );
  });

  afterEach(async () => {
    // Cleanup in reverse FK order
    try {
      await pool.query('DELETE FROM score_history WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM settlement_audit WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM ingestion_validation_errors WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM ingestion_events WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM contest_participants WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM contest_instances WHERE id = $1', [contestId]);
      // Note: contest_templates no longer deleted; templateFactory handles deactivation
      await pool.query('DELETE FROM users WHERE id = $1', [organizerId]);
    } catch (err) {
      // Cleanup non-fatal
    }
  });

  describe('DELETE /api/custom-contests/:id compliance', () => {
    it('should transition status to CANCELLED, set is_locked=true, and return full contest object → 200', async () => {
      // Pre-check: contest is SCHEDULED
      let preCheck = await pool.query(
        'SELECT status FROM contest_instances WHERE id = $1',
        [contestId]
      );
      expect(preCheck.rows[0].status).toBe('SCHEDULED');

      // Call DELETE endpoint
      const response = await request(app)
        .delete(`/api/custom-contests/${contestId}`)
        .set('X-User-Id', organizerId);

      // Assert HTTP 200
      expect(response.status).toBe(200);

      // Assert response is valid JSON (not empty, not plain text)
      expect(response.body).toBeInstanceOf(Object);
      expect(Object.keys(response.body).length).toBeGreaterThan(0);

      // Assert status changed to CANCELLED
      expect(response.body.status).toBe('CANCELLED');

      // Assert is_locked is true (status !== 'SCHEDULED' means locked)
      expect(response.body.is_locked).toBe(true);

      // Assert full contest structure (same as GET /api/custom-contests/:id)
      expect(response.body).toHaveProperty('id', contestId);
      expect(response.body).toHaveProperty('template_id', templateId);
      expect(response.body).toHaveProperty('organizer_id', organizerId);
      expect(response.body).toHaveProperty('status', 'CANCELLED');
      expect(response.body).toHaveProperty('entry_count');
      expect(response.body).toHaveProperty('user_has_entered');
      expect(response.body).toHaveProperty('actions'); // Actions block as per requirements
      expect(response.body).toHaveProperty('leaderboard_state');
      expect(response.body).toHaveProperty('payout_table');
      expect(response.body).toHaveProperty('roster_config');

      // Post-check: DB reflects the change (is_locked is derived from status in API, not physical column)
      const postCheck = await pool.query(
        'SELECT status FROM contest_instances WHERE id = $1',
        [contestId]
      );
      expect(postCheck.rows[0].status).toBe('CANCELLED');
    });

    it('should NOT delete or modify ingestion_events', async () => {
      // Create test ingestion event
      const eventId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO ingestion_events
         (id, contest_instance_id, provider, event_type, provider_data_json, payload_hash, validation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [eventId, contestId, 'golf_provider', 'leaderboard', JSON.stringify({ test: true }), 'hash-abc', 'VALID']
      );

      // Count ingestion_events before DELETE
      const preCount = await pool.query(
        'SELECT COUNT(*) FROM ingestion_events WHERE contest_instance_id = $1',
        [contestId]
      );
      expect(parseInt(preCount.rows[0].count)).toBe(1);

      // Call DELETE endpoint
      const response = await request(app)
        .delete(`/api/custom-contests/${contestId}`)
        .set('X-User-Id', organizerId);

      expect(response.status).toBe(200);

      // Count ingestion_events after DELETE
      const postCount = await pool.query(
        'SELECT COUNT(*) FROM ingestion_events WHERE contest_instance_id = $1',
        [contestId]
      );
      expect(parseInt(postCount.rows[0].count)).toBe(1);

      // Verify the event still exists and is unchanged
      const eventCheck = await pool.query(
        'SELECT validation_status FROM ingestion_events WHERE id = $1',
        [eventId]
      );
      expect(eventCheck.rows[0].validation_status).toBe('VALID');
    });

    it('should NOT delete or modify settlement_audit records', async () => {
      // Create test settlement record
      const auditId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO settlement_audit
         (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
        [auditId, contestId, crypto.randomUUID(), 'COMPLETE', 'v1', []]
      );

      // Count before DELETE
      const preCount = await pool.query(
        'SELECT COUNT(*) FROM settlement_audit WHERE contest_instance_id = $1',
        [contestId]
      );
      expect(parseInt(preCount.rows[0].count)).toBe(1);

      // Call DELETE endpoint
      const response = await request(app)
        .delete(`/api/custom-contests/${contestId}`)
        .set('X-User-Id', organizerId);

      expect(response.status).toBe(200);

      // Count after DELETE
      const postCount = await pool.query(
        'SELECT COUNT(*) FROM settlement_audit WHERE contest_instance_id = $1',
        [contestId]
      );
      expect(parseInt(postCount.rows[0].count)).toBe(1);
    });

    it('should NOT delete or modify score_history records', async () => {
      // Create test settlement and score history
      const auditId = crypto.randomUUID();
      const scoreId = crypto.randomUUID();

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

      // Count before DELETE
      const preCount = await pool.query(
        'SELECT COUNT(*) FROM score_history WHERE contest_instance_id = $1',
        [contestId]
      );
      expect(parseInt(preCount.rows[0].count)).toBe(1);

      // Call DELETE endpoint
      const response = await request(app)
        .delete(`/api/custom-contests/${contestId}`)
        .set('X-User-Id', organizerId);

      expect(response.status).toBe(200);

      // Count after DELETE
      const postCount = await pool.query(
        'SELECT COUNT(*) FROM score_history WHERE contest_instance_id = $1',
        [contestId]
      );
      expect(parseInt(postCount.rows[0].count)).toBe(1);

      // Verify the record is unchanged
      const scoreCheck = await pool.query(
        'SELECT scores_json FROM score_history WHERE id = $1',
        [scoreId]
      );
      // scores_json is stored as JSONB, so it's already an object
      expect(scoreCheck.rows[0].scores_json).toEqual({ 'p1': 100 });
    });

    it('should gracefully reject non-organizer DELETE attempts with 403', async () => {
      const otherUserId = crypto.randomUUID();

      // Create other user
      await pool.query(
        `INSERT INTO users (id, email) VALUES ($1, $2)`,
        [otherUserId, `user-${otherUserId}@test.example`]
      );

      // Attempt DELETE as non-organizer
      const response = await request(app)
        .delete(`/api/custom-contests/${contestId}`)
        .set('X-User-Id', otherUserId);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error_code');
      expect(response.body).toHaveProperty('reason');

      // Verify contest is still SCHEDULED
      const check = await pool.query(
        'SELECT status FROM contest_instances WHERE id = $1',
        [contestId]
      );
      expect(check.rows[0].status).toBe('SCHEDULED');

      // Cleanup
      await pool.query('DELETE FROM users WHERE id = $1', [otherUserId]);
    });

    it('should return 404 for non-existent contest', async () => {
      const fakeContestId = crypto.randomUUID();

      const response = await request(app)
        .delete(`/api/custom-contests/${fakeContestId}`)
        .set('X-User-Id', organizerId);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error_code', 'CONTEST_NOT_FOUND');
      expect(response.body).toHaveProperty('reason');
    });

    it('should be idempotent: DELETE CANCELLED contest returns 200', async () => {
      // First DELETE to transition SCHEDULED -> CANCELLED
      let response = await request(app)
        .delete(`/api/custom-contests/${contestId}`)
        .set('X-User-Id', organizerId);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('CANCELLED');

      // Second DELETE on CANCELLED contest (idempotent)
      response = await request(app)
        .delete(`/api/custom-contests/${contestId}`)
        .set('X-User-Id', organizerId);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('CANCELLED');
    });

    it('should only allow deletion of SCHEDULED contests (not LOCKED, LIVE, COMPLETE)', async () => {
      // Create contests in different statuses
      const statusesToTest = ['LOCKED', 'LIVE', 'COMPLETE'];

      for (const status of statusesToTest) {
        const testContestId = crypto.randomUUID();

        await pool.query(
          `INSERT INTO contest_instances
           (id, template_id, organizer_id, status, entry_fee_cents, payout_structure, contest_name, max_entries)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [testContestId, templateId, organizerId, status, 0, JSON.stringify({}), `Test ${status}`, 20]
        );

        // Attempt DELETE on non-SCHEDULED contest
        const response = await request(app)
          .delete(`/api/custom-contests/${testContestId}`)
          .set('X-User-Id', organizerId);

        expect(response.status).toBe(403);
        expect(response.body.error_code).toBe('CONTEST_DELETE_NOT_ALLOWED');

        // Cleanup
        await pool.query('DELETE FROM contest_instances WHERE id = $1', [testContestId]);
      }
    });
  });
});
