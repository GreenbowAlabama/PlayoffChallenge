/**
 * Discovery Service Cancellation Tests
 *
 * Integration tests for provider tournament cancellation propagation.
 * Verifies cascade logic, idempotency, and state transitions.
 */

const { Pool } = require('pg');
const { discoverTournament } = require('../../services/discovery/discoveryService');

describe('discoveryService - cancellation cascade', () => {
  let pool;
  const now = new Date('2026-03-01T12:00:00Z');
  let testProviderId;

  const getValidScheduledInput = (providerId) => ({
    provider_tournament_id: providerId,
    season_year: 2026,
    name: 'PGA Cancellation Test Tournament 2026',
    start_time: new Date('2026-03-15T08:00:00Z'),
    end_time: new Date('2026-03-18T20:00:00Z'),
    status: 'SCHEDULED'
  });

  const getValidCancelledInput = (providerId) => ({
    provider_tournament_id: providerId,
    season_year: 2026,
    name: 'PGA Cancellation Test Tournament 2026',
    start_time: new Date('2026-03-15T08:00:00Z'),
    end_time: new Date('2026-03-18T20:00:00Z'),
    status: 'CANCELLED'
  });

  beforeAll(() => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Create test users
    const userId = '00000000-0000-0000-0000-000000000001';
    await pool.query(
      `INSERT INTO users (id, email, username) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [userId, 'test-organizer@example.com', 'test-organizer']
    );

    // Generate unique provider ID for this test to avoid contamination
    testProviderId = `pga_cancel_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  });

  afterEach(async () => {
    // Clean up test data for this test's provider ID
    await pool.query(
      `DELETE FROM contest_state_transitions
       WHERE contest_instance_id IN (
         SELECT id FROM contest_instances
         WHERE template_id IN (
           SELECT id FROM contest_templates
           WHERE provider_tournament_id = $1
         )
       )`,
      [testProviderId]
    );
    await pool.query(
      `DELETE FROM contest_instances
       WHERE template_id IN (
         SELECT id FROM contest_templates
         WHERE provider_tournament_id = $1
       )`,
      [testProviderId]
    );
    await pool.query(
      `DELETE FROM contest_templates
       WHERE provider_tournament_id = $1`,
      [testProviderId]
    );
  });

  describe('new template discovery with CANCELLED status', () => {
    it('should create template with status=CANCELLED', async () => {
      const validCancelledInput = getValidCancelledInput(testProviderId);
      const result = await discoverTournament(validCancelledInput, pool, now);

      expect(result.success).toBe(true);
      expect(result.templateId).toBeTruthy();
      expect(result.created).toBe(true);
      expect(result.statusCode).toBe(201);

      // Verify template status is CANCELLED
      const template = await pool.query(
        `SELECT status FROM contest_templates WHERE id = $1`,
        [result.templateId]
      );
      expect(template.rows[0].status).toBe('CANCELLED');
    });

    it('should create primary marketing contest with status=CANCELLED', async () => {
      const validCancelledInput = getValidCancelledInput(testProviderId);
      const result = await discoverTournament(validCancelledInput, pool, now);
      const templateId = result.templateId;

      // Verify marketing contest exists and has CANCELLED status
      const contest = await pool.query(
        `SELECT status FROM contest_instances
         WHERE template_id = $1 AND is_primary_marketing = true`,
        [templateId]
      );
      expect(contest.rows).toHaveLength(1);
      expect(contest.rows[0].status).toBe('CANCELLED');
    });
  });

  describe('existing template discovered as CANCELLED', () => {
    it('should cascade SCHEDULED template to CANCELLED and create transitions', async () => {
      // 1. Create template with SCHEDULED status
      const validScheduledInput = getValidScheduledInput(testProviderId);
      const validCancelledInput = getValidCancelledInput(testProviderId);
      const schedResult = await discoverTournament(validScheduledInput, pool, now);
      const templateId = schedResult.templateId;

      // 2. Create some user-defined contest instances
      const userId = '00000000-0000-0000-0000-000000000001';
      const contest1 = await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, start_time, contest_name, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [
          templateId,
          userId,
          5000,
          JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2] }),
          'SCHEDULED',
          new Date(),
          'User Contest 1',
          50
        ]
      );
      const contest1Id = contest1.rows[0].id;

      const contest2 = await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, start_time, contest_name, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [
          templateId,
          userId,
          7500,
          JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2] }),
          'LOCKED',
          new Date(),
          'User Contest 2',
          25
        ]
      );
      const contest2Id = contest2.rows[0].id;

      // 3. Discover as CANCELLED
      const cancelResult = await discoverTournament(validCancelledInput, pool, now);

      expect(cancelResult.success).toBe(true);
      expect(cancelResult.created).toBe(false);
      expect(cancelResult.updated).toBe(true); // Cascade occurred
      expect(cancelResult.statusCode).toBe(200);

      // 4. Verify template status is CANCELLED
      const template = await pool.query(
        `SELECT status FROM contest_templates WHERE id = $1`,
        [templateId]
      );
      expect(template.rows[0].status).toBe('CANCELLED');

      // 5. Verify instances were cascaded
      const contest1After = await pool.query(
        `SELECT status FROM contest_instances WHERE id = $1`,
        [contest1Id]
      );
      expect(contest1After.rows[0].status).toBe('CANCELLED'); // SCHEDULED → CANCELLED

      const contest2After = await pool.query(
        `SELECT status FROM contest_instances WHERE id = $1`,
        [contest2Id]
      );
      expect(contest2After.rows[0].status).toBe('CANCELLED'); // LOCKED → CANCELLED

      // 6. Verify transitions were created
      const transitions = await pool.query(
        `SELECT contest_instance_id, from_state, to_state, triggered_by, created_at
         FROM contest_state_transitions
         WHERE contest_instance_id IN ($1, $2)
         ORDER BY created_at ASC`,
        [contest1Id, contest2Id]
      );
      expect(transitions.rows).toHaveLength(2);
      // Both transitions should be CANCELLED with PROVIDER_TOURNAMENT_CANCELLED trigger
      const scheduledTransition = transitions.rows.find(t => t.from_state === 'SCHEDULED');
      const lockedTransition = transitions.rows.find(t => t.from_state === 'LOCKED');

      expect(scheduledTransition).toBeTruthy();
      expect(scheduledTransition.to_state).toBe('CANCELLED');
      expect(scheduledTransition.triggered_by).toBe('PROVIDER_TOURNAMENT_CANCELLED');

      expect(lockedTransition).toBeTruthy();
      expect(lockedTransition.to_state).toBe('CANCELLED');
      expect(lockedTransition.triggered_by).toBe('PROVIDER_TOURNAMENT_CANCELLED');
    });

    it('should not cascade COMPLETE instances', async () => {
      // 1. Create template with SCHEDULED status
      const validScheduledInput = getValidScheduledInput(testProviderId);
      const validCancelledInput = getValidCancelledInput(testProviderId);
      const schedResult = await discoverTournament(validScheduledInput, pool, now);
      const templateId = schedResult.templateId;

      // 2. Create a COMPLETE instance (immutable)
      const userId = '00000000-0000-0000-0000-000000000001';
      const completeContest = await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, start_time, contest_name, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [
          templateId,
          userId,
          5000,
          JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2] }),
          'COMPLETE',
          new Date(),
          'Complete Contest',
          50
        ]
      );
      const completeContestId = completeContest.rows[0].id;

      // 3. Discover as CANCELLED
      const cancelResult = await discoverTournament(validCancelledInput, pool, now);
      expect(cancelResult.success).toBe(true);

      // 4. Verify COMPLETE instance was NOT changed
      const completeAfter = await pool.query(
        `SELECT status FROM contest_instances WHERE id = $1`,
        [completeContestId]
      );
      expect(completeAfter.rows[0].status).toBe('COMPLETE');

      // 5. Verify NO transition was created for COMPLETE
      const transitions = await pool.query(
        `SELECT COUNT(*) as count FROM contest_state_transitions
         WHERE contest_instance_id = $1`,
        [completeContestId]
      );
      expect(parseInt(transitions.rows[0].count, 10)).toBe(0);
    });

    it('should not cascade already CANCELLED instances', async () => {
      // 1. Create template and cascade it to CANCELLED
      const validScheduledInput = getValidScheduledInput(testProviderId);
      const validCancelledInput = getValidCancelledInput(testProviderId);
      const schedResult = await discoverTournament(validScheduledInput, pool, now);
      const templateId = schedResult.templateId;

      const cancelResult1 = await discoverTournament(validCancelledInput, pool, now);
      expect(cancelResult1.success).toBe(true);
      expect(cancelResult1.updated).toBe(true); // First cascade

      // 2. Rediscover as CANCELLED again
      const cancelResult2 = await discoverTournament(validCancelledInput, pool, now);

      expect(cancelResult2.success).toBe(true);
      expect(cancelResult2.updated).toBe(false); // No cascade (already CANCELLED)
      expect(cancelResult2.statusCode).toBe(200);

      // 3. Verify template is still CANCELLED
      const template = await pool.query(
        `SELECT status FROM contest_templates WHERE id = $1`,
        [templateId]
      );
      expect(template.rows[0].status).toBe('CANCELLED');
    });

    it('should be idempotent: repeated CANCELLED calls produce no duplicate transitions', async () => {
      // 1. Create template and user instance
      const validScheduledInput = getValidScheduledInput(testProviderId);
      const validCancelledInput = getValidCancelledInput(testProviderId);
      const schedResult = await discoverTournament(validScheduledInput, pool, now);
      const templateId = schedResult.templateId;

      const userId = '00000000-0000-0000-0000-000000000001';
      const contest = await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, start_time, contest_name, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [
          templateId,
          userId,
          5000,
          JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2] }),
          'SCHEDULED',
          new Date(),
          'Idempotency Test',
          50
        ]
      );
      const contestId = contest.rows[0].id;

      // 2. First cancellation
      const cancel1 = await discoverTournament(validCancelledInput, pool, now);
      expect(cancel1.success).toBe(true);
      expect(cancel1.updated).toBe(true);

      // 3. Verify transition count is 1
      const transitions1 = await pool.query(
        `SELECT COUNT(*) as count FROM contest_state_transitions
         WHERE contest_instance_id = $1`,
        [contestId]
      );
      const count1 = parseInt(transitions1.rows[0].count, 10);
      expect(count1).toBe(1);

      // 4. Second cancellation (should be no-op)
      const cancel2 = await discoverTournament(validCancelledInput, pool, now);
      expect(cancel2.success).toBe(true);
      expect(cancel2.updated).toBe(false); // No change

      // 5. Verify transition count is still 1 (no duplicate)
      const transitions2 = await pool.query(
        `SELECT COUNT(*) as count FROM contest_state_transitions
         WHERE contest_instance_id = $1`,
        [contestId]
      );
      const count2 = parseInt(transitions2.rows[0].count, 10);
      expect(count2).toBe(1); // No additional transition
    });

    it('should handle mixed instance statuses (partial cascade)', async () => {
      // 1. Create template
      const validScheduledInput = getValidScheduledInput(testProviderId);
      const validCancelledInput = getValidCancelledInput(testProviderId);
      const schedResult = await discoverTournament(validScheduledInput, pool, now);
      const templateId = schedResult.templateId;

      const userId = '00000000-0000-0000-0000-000000000001';

      // 2. Create instances with different statuses
      const scheduled = await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, start_time, contest_name, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [templateId, userId, 5000, JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2] }), 'SCHEDULED', new Date(), 'Scheduled', 50]
      );

      const locked = await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, start_time, contest_name, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [templateId, userId, 5000, JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2] }), 'LOCKED', new Date(), 'Locked', 50]
      );

      const complete = await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, start_time, contest_name, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [templateId, userId, 5000, JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2] }), 'COMPLETE', new Date(), 'Complete', 50]
      );

      const cancelled = await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, start_time, contest_name, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [templateId, userId, 5000, JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2] }), 'CANCELLED', new Date(), 'Cancelled', 50]
      );

      // 3. Cascade
      const result = await discoverTournament(validCancelledInput, pool, now);
      expect(result.success).toBe(true);
      expect(result.updated).toBe(true); // Some instances changed

      // 4. Verify cascade results
      const scheduledAfter = await pool.query(`SELECT status FROM contest_instances WHERE id = $1`, [scheduled.rows[0].id]);
      const lockedAfter = await pool.query(`SELECT status FROM contest_instances WHERE id = $1`, [locked.rows[0].id]);
      const completeAfter = await pool.query(`SELECT status FROM contest_instances WHERE id = $1`, [complete.rows[0].id]);
      const cancelledAfter = await pool.query(`SELECT status FROM contest_instances WHERE id = $1`, [cancelled.rows[0].id]);

      expect(scheduledAfter.rows[0].status).toBe('CANCELLED');
      expect(lockedAfter.rows[0].status).toBe('CANCELLED');
      expect(completeAfter.rows[0].status).toBe('COMPLETE'); // Unchanged
      expect(cancelledAfter.rows[0].status).toBe('CANCELLED'); // Already CANCELLED

      // 5. Verify exactly 2 transitions created (for SCHEDULED and LOCKED)
      const transitions = await pool.query(
        `SELECT COUNT(*) as count FROM contest_state_transitions
         WHERE contest_instance_id IN ($1, $2, $3, $4)`,
        [scheduled.rows[0].id, locked.rows[0].id, complete.rows[0].id, cancelled.rows[0].id]
      );
      expect(parseInt(transitions.rows[0].count, 10)).toBe(2);
    });
  });

  describe('endpoint E2E - cancellation discovery', () => {
    it('should return correct status codes and response contracts', async () => {
      // Scheduled discovery
      const validScheduledInput = getValidScheduledInput(testProviderId);
      const validCancelledInput = getValidCancelledInput(testProviderId);
      const schedResult = await discoverTournament(validScheduledInput, pool, now);
      expect(schedResult.statusCode).toBe(201);
      expect(schedResult.success).toBe(true);
      expect(schedResult.created).toBe(true);
      expect(schedResult.templateId).toBeTruthy();

      // Cancelled rediscovery
      const cancelResult = await discoverTournament(validCancelledInput, pool, now);
      expect(cancelResult.statusCode).toBe(200);
      expect(cancelResult.success).toBe(true);
      expect(cancelResult.created).toBe(false);
      expect(cancelResult.updated).toBe(true);
      expect(cancelResult.templateId).toBe(schedResult.templateId);
    });
  });
});
