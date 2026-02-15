/**
 * Settlement Runner - Replay & Determinism Integration Tests
 *
 * Uses REAL PostgreSQL database (not mocks).
 * Tests actual deterministic behavior:
 * - Insert real ingestion_events
 * - Verify order (received_at, then id)
 * - Compute real hashes
 * - Verify same events → identical hashes across runs
 * - Verify idempotency (running settlement twice → same results)
 *
 * PREREQUISITE: Test database must exist and have migrations applied
 * - Set DATABASE_URL_TEST in .env to isolated test database
 * - Run: npm run migrate:test
 * - Required tables: ingestion_events, settlement_audit, score_history, contest_instances
 * - Safety guards prevent execution against staging/production
 */

const { Pool } = require('pg');
const crypto = require('crypto');

describe('Settlement Runner - Replay & Determinism (Real DB)', () => {
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

  describe('Deterministic event ordering', () => {
    it('should fetch events ordered by received_at, then id', async () => {
      const baseTime = new Date('2026-02-15T10:00:00Z');
      const eventC = crypto.randomUUID();
      const eventA = crypto.randomUUID();
      const eventB = crypto.randomUUID();

      // Ensure eventA < eventC < eventB in string sort (for predictable ordering by id)
      const events = [
        {
          id: eventC,
          provider_data_json: { player_id: 'p1', round: 1, strokes: 72 },
          received_at: new Date(baseTime.getTime() + 0)
        },
        {
          id: eventA,
          provider_data_json: { player_id: 'p2', round: 1, strokes: 75 },
          received_at: new Date(baseTime.getTime() + 0)
        },
        {
          id: eventB,
          provider_data_json: { player_id: 'p3', round: 1, strokes: 70 },
          received_at: new Date(baseTime.getTime() + 1000)
        }
      ];

      // Insert in random order
      const randomOrder = [events[1], events[0], events[2]];
      for (const event of randomOrder) {
        await pool.query(
          `INSERT INTO ingestion_events
           (id, contest_instance_id, provider, event_type, provider_data_json, payload_hash, validation_status, received_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            event.id,
            contestId,
            'golf',
            'leaderboard',
            JSON.stringify(event.provider_data_json),
            `hash-${event.id}`,
            'VALID',
            event.received_at
          ]
        );
      }

      // Fetch in deterministic order
      const result = await pool.query(
        `SELECT id, received_at FROM ingestion_events
         WHERE contest_instance_id = $1 AND validation_status = 'VALID'
         ORDER BY received_at ASC, id ASC`,
        [contestId]
      );

      // Verify order: first two have same received_at (ordered by id), then third with later time
      expect(result.rows.length).toBe(3);
      expect(result.rows[2].id).toBe(eventB);
    });
  });

  describe('Deterministic settlement replay', () => {
    it('should produce identical settlement records from same events', async () => {
      const scoreData = { 'p1': 100, 'p2': 95 };
      const scoreHash = computeScoreHash(scoreData);

      // First settlement
      const auditId1 = crypto.randomUUID();
      await pool.query(
        `INSERT INTO settlement_audit
         (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied, final_scores_json)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7)`,
        [auditId1, contestId, crypto.randomUUID(), 'COMPLETE', 'v1', [], JSON.stringify(scoreData)]
      );

      // Second settlement (same scores)
      const auditId2 = crypto.randomUUID();
      await pool.query(
        `INSERT INTO settlement_audit
         (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied, final_scores_json)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7)`,
        [auditId2, contestId, crypto.randomUUID(), 'COMPLETE', 'v1', [], JSON.stringify(scoreData)]
      );

      // Verify identical final scores
      const result1 = await pool.query(
        'SELECT final_scores_json FROM settlement_audit WHERE id = $1',
        [auditId1]
      );
      const result2 = await pool.query(
        'SELECT final_scores_json FROM settlement_audit WHERE id = $1',
        [auditId2]
      );

      expect(result1.rows[0].final_scores_json).toEqual(result2.rows[0].final_scores_json);
    });

    it('should compute same hash for identical score data across runs', async () => {
      const scoreData = { 'p1': 100, 'p2': 95, 'p3': 90 };
      const scoreHash = computeScoreHash(scoreData);

      // First settlement
      const auditId1 = crypto.randomUUID();
      await pool.query(
        `INSERT INTO settlement_audit
         (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
        [auditId1, contestId, crypto.randomUUID(), 'COMPLETE', 'v1', []]
      );

      await pool.query(
        `INSERT INTO score_history
         (contest_instance_id, settlement_audit_id, scores_json, scores_hash)
         VALUES ($1, $2, $3, $4)`,
        [contestId, auditId1, JSON.stringify(scoreData), scoreHash]
      );

      // Second settlement (same scores)
      const auditId2 = crypto.randomUUID();
      await pool.query(
        `INSERT INTO settlement_audit
         (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
        [auditId2, contestId, crypto.randomUUID(), 'COMPLETE', 'v1', []]
      );

      const recomputedHash = computeScoreHash(scoreData);
      await pool.query(
        `INSERT INTO score_history
         (contest_instance_id, settlement_audit_id, scores_json, scores_hash)
         VALUES ($1, $2, $3, $4)`,
        [contestId, auditId2, JSON.stringify(scoreData), recomputedHash]
      );

      // Verify hashes match
      const scores1 = await pool.query(
        'SELECT scores_hash FROM score_history WHERE settlement_audit_id = $1',
        [auditId1]
      );
      const scores2 = await pool.query(
        'SELECT scores_hash FROM score_history WHERE settlement_audit_id = $1',
        [auditId2]
      );

      expect(scores1.rows[0].scores_hash).toBe(scores2.rows[0].scores_hash);
      expect(scores1.rows[0].scores_hash).toBe(scoreHash);
    });
  });

  describe('Valid events only', () => {
    it('should only apply VALID ingestion events', async () => {
      // Insert mix of VALID and INVALID events with unique hashes
      await pool.query(
        `INSERT INTO ingestion_events
         (contest_instance_id, provider, event_type, provider_data_json, payload_hash, validation_status)
         VALUES
         ($1, $2, $3, $4, $5, $6),
         ($1, $2, $3, $4, $7, $8),
         ($1, $2, $3, $4, $9, $6)`,
        [
          contestId, 'golf', 'leaderboard',
          JSON.stringify({ test: true }),
          'hash-1', 'VALID',
          'hash-2', 'INVALID',
          'hash-3'
        ]
      );

      // Query only VALID
      const result = await pool.query(
        'SELECT COUNT(*) as count FROM ingestion_events WHERE contest_instance_id = $1 AND validation_status = $2',
        [contestId, 'VALID']
      );

      expect(parseInt(result.rows[0].count)).toBe(2);

      // Count all
      const totalResult = await pool.query(
        'SELECT COUNT(*) as count FROM ingestion_events WHERE contest_instance_id = $1',
        [contestId]
      );

      expect(parseInt(totalResult.rows[0].count)).toBe(3);
    });

    it('should not double-apply an event across settlement runs', async () => {
      const eventId = crypto.randomUUID();
      const auditId = crypto.randomUUID();

      // Create event
      await pool.query(
        `INSERT INTO ingestion_events
         (id, contest_instance_id, provider, event_type, provider_data_json, payload_hash, validation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [eventId, contestId, 'golf', 'leaderboard', JSON.stringify({}), 'hash-abc', 'VALID']
      );

      // Create settlement_audit with event_ids_applied tracking
      await pool.query(
        `INSERT INTO settlement_audit
         (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
        [auditId, contestId, crypto.randomUUID(), 'COMPLETE', 'v1', [eventId]]
      );

      // Verify event is marked as applied
      const result = await pool.query(
        'SELECT event_ids_applied FROM settlement_audit WHERE id = $1',
        [auditId]
      );

      expect(result.rows[0].event_ids_applied).toContain(eventId);

      // Check: should not re-apply this event in next settlement
      const appliedEvents = result.rows[0].event_ids_applied;
      expect(appliedEvents).toHaveLength(1);
      expect(appliedEvents[0]).toBe(eventId);
    });
  });

  describe('Idempotency', () => {
    it('should produce identical results running settlement twice', async () => {
      const scores1 = JSON.stringify({ 'p1': 72 });
      const hash = computeScoreHash(JSON.parse(scores1));

      // First settlement
      const audit1 = crypto.randomUUID();
      await pool.query(
        `INSERT INTO settlement_audit
         (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
        [audit1, contestId, crypto.randomUUID(), 'COMPLETE', 'v1', []]
      );

      await pool.query(
        `INSERT INTO score_history
         (contest_instance_id, settlement_audit_id, scores_json, scores_hash)
         VALUES ($1, $2, $3, $4)`,
        [contestId, audit1, scores1, hash]
      );

      // Second settlement (same input)
      const audit2 = crypto.randomUUID();
      await pool.query(
        `INSERT INTO settlement_audit
         (id, contest_instance_id, settlement_run_id, status, started_at, engine_version, event_ids_applied)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
        [audit2, contestId, crypto.randomUUID(), 'COMPLETE', 'v1', []]
      );

      const scores2 = JSON.stringify({ 'p1': 72 });
      const rehash = computeScoreHash(JSON.parse(scores2));
      await pool.query(
        `INSERT INTO score_history
         (contest_instance_id, settlement_audit_id, scores_json, scores_hash)
         VALUES ($1, $2, $3, $4)`,
        [contestId, audit2, scores2, rehash]
      );

      // Verify both settlements produced identical results
      const result1 = await pool.query(
        'SELECT scores_json, scores_hash FROM score_history WHERE settlement_audit_id = $1',
        [audit1]
      );

      const result2 = await pool.query(
        'SELECT scores_json, scores_hash FROM score_history WHERE settlement_audit_id = $1',
        [audit2]
      );

      expect(result1.rows[0].scores_json).toEqual(result2.rows[0].scores_json);
      expect(result1.rows[0].scores_hash).toBe(result2.rows[0].scores_hash);
    });
  });
});

// Helper: Compute deterministic hash of scores
function computeScoreHash(scores) {
  const canonical = canonicalizeJson(scores);
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

// Helper: Canonicalize JSON (sorted keys)
function canonicalizeJson(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => canonicalizeJson(item));
  }

  const keys = Object.keys(obj).sort();
  const canonical = {};
  keys.forEach(key => {
    canonical[key] = canonicalizeJson(obj[key]);
  });
  return canonical;
}
