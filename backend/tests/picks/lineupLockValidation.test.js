/**
 * Lineup Lock Validation Tests
 *
 * **THE BUG:**
 * When previous event is IN_PROGRESS but contest references a NEW event,
 * lineup submission is incorrectly blocked.
 *
 * **ROOT CAUSE:**
 * pgaRoundValidator queries event_data_snapshots WITHOUT filtering by the contest's event_id.
 * It implicitly uses "latest event" (ORDER BY ingested_at DESC LIMIT 1).
 *
 * **THE FIX:**
 * pgaRoundValidator must join through tournament_config to get contest_instance.provider_event_id,
 * then filter event_data_snapshots by THAT event, not the latest globally.
 *
 * **TEST SCENARIO:**
 * - Event A (old): provider_event_id = "espn_pga_401811937", round_status IN_PROGRESS
 * - Event B (new): provider_event_id = "espn_pga_401811938", round_status NOT_STARTED
 * - Contest: references Event B via tournament_config
 * - Expected: lineup submission ALLOWED (Event B is not in progress)
 * - Actual (buggy): lineup submission BLOCKED (checking Event A instead)
 */

const { v4: uuidv4 } = require('uuid');
const { pool } = require('../../server');
const entryRosterService = require('../../services/entryRosterService');

describe('Lineup Lock Validation — Contest-Scoped Event (pgaRoundValidator Bug)', () => {
  let userId;
  let organizerId;
  let templateId;
  let testPlayerIds = []; // Track players for cleanup
  let testContestIds = []; // Track contests for cleanup
  let testSnapshotIds = []; // Track snapshots for cleanup

  beforeAll(async () => {
    // Create users
    userId = uuidv4();
    organizerId = uuidv4();

    await pool.query(
      'INSERT INTO users (id, email, created_at) VALUES ($1, $2, NOW())',
      [userId, `user-${userId}@test.com`]
    );
    await pool.query(
      'INSERT INTO users (id, email, created_at) VALUES ($1, $2, NOW())',
      [organizerId, `organizer-${organizerId}@test.com`]
    );

    // Create a GOLF contest template
    templateId = uuidv4();
    await pool.query(
      `INSERT INTO contest_templates
       (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
        settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents, allowed_payout_structures)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [templateId, 'PGA Test Template', 'pga', 'pga_contest', 'pga_standard_v1', 'pga_lock',
       'pga_settlement', 0, 0, 50000, JSON.stringify([])]
    );
  });

  afterAll(async () => {
    // Clean up all test data in reverse dependency order
    if (testContestIds.length > 0) {
      await pool.query(
        'DELETE FROM contest_participants WHERE contest_instance_id = ANY($1)',
        [testContestIds]
      );
      await pool.query(
        'DELETE FROM field_selections WHERE contest_instance_id = ANY($1)',
        [testContestIds]
      );
      await pool.query(
        'DELETE FROM tournament_configs WHERE contest_instance_id = ANY($1)',
        [testContestIds]
      );
      await pool.query(
        'DELETE FROM contest_instances WHERE id = ANY($1)',
        [testContestIds]
      );
    }

    if (testSnapshotIds.length > 0) {
      await pool.query(
        'DELETE FROM event_data_snapshots WHERE id = ANY($1)',
        [testSnapshotIds]
      );
    }

    if (testPlayerIds.length > 0) {
      await pool.query(
        'DELETE FROM players WHERE id = ANY($1)',
        [testPlayerIds]
      );
    }

    // Clean up users and template
    await pool.query('DELETE FROM users WHERE id = $1 OR id = $2', [userId, organizerId]);
    await pool.query('DELETE FROM contest_templates WHERE id = $1', [templateId]);
  });

  describe('Test 3: CRITICAL BUG — Latest Event Override', () => {
    it('should allow lineup submission when PREVIOUS event is IN_PROGRESS but contest is for NEW event', async () => {
      const now = new Date();
      const futureTime = new Date(now.getTime() + 60 * 60 * 1000);
      const lockTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      // ═══════════════════════════════════════════════════════════════════
      // Create 7 test players (PGA roster requires exactly 7)
      // ═══════════════════════════════════════════════════════════════════
      const playerIds = [];
      for (let i = 0; i < 7; i++) {
        const playerId = `test_player_${uuidv4().substring(0, 8)}`;
        playerIds.push(playerId);
        testPlayerIds.push(playerId);
        await pool.query(
          `INSERT INTO players (id, sport) VALUES ($1, $2)`,
          [playerId, 'GOLF']
        );
      }

      // ═══════════════════════════════════════════════════════════════════
      // Create contest first (Event B)
      // ═══════════════════════════════════════════════════════════════════

      const contestId = uuidv4();
      testContestIds.push(contestId);

      const eventAId = 'espn_pga_401811937';  // OLD event
      const eventBId = 'espn_pga_401811938';  // NEW event

      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
          contest_name, lock_time, tournament_start_time, start_time, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          contestId,
          templateId,
          organizerId,
          0,
          JSON.stringify({ tiers: [] }),
          'SCHEDULED',
          'Arnold Palmer Contest (Event B)',
          lockTime,
          futureTime,
          futureTime
        ]
      );

      // ═══════════════════════════════════════════════════════════════════
      // Insert BOTH event snapshots linked to this contest
      // Event A (OLD): ingested 1 hour ago, IN_PROGRESS
      // Event B (NEW): ingested now, NOT_STARTED
      // ═══════════════════════════════════════════════════════════════════

      // Event A (OLD): The Master's 2026 — ingested 1 hour ago
      const eventASnapshotId = uuidv4();
      testSnapshotIds.push(eventASnapshotId);

      const oldEventTime = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
      await pool.query(
        `INSERT INTO event_data_snapshots
         (id, contest_instance_id, provider_event_id, payload, snapshot_hash, provider_final_flag, ingested_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          eventASnapshotId,
          contestId,  // ← Link to contest
          eventAId,
          JSON.stringify({
            events: [{
              id: eventAId,
              status: { type: { name: 'STATUS_IN_PROGRESS' } },
              competitions: [{
                status: { type: { state: 'in' } }, // Round IN_PROGRESS
                competitors: []
              }]
            }]
          }),
          'hash_a_old',
          false,
          oldEventTime
        ]
      );

      // Event B (NEW): Arnold Palmer Invitational 2026 — ingested just now
      const eventBSnapshotId = uuidv4();
      testSnapshotIds.push(eventBSnapshotId);

      await pool.query(
        `INSERT INTO event_data_snapshots
         (id, contest_instance_id, provider_event_id, payload, snapshot_hash, provider_final_flag, ingested_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          eventBSnapshotId,
          contestId,  // ← Link to same contest
          eventBId,
          JSON.stringify({
            events: [{
              id: eventBId,
              status: { type: { name: 'STATUS_SCHEDULED' } },
              competitions: [{
                status: { type: { state: 'pre' } }, // Round NOT_STARTED
                competitors: []
              }]
            }]
          }),
          'hash_b_new',
          false
        ]
      );

      // Link contest to Event B via tournament_config
      const configId = uuidv4();
      await pool.query(
        `INSERT INTO tournament_configs
         (id, contest_instance_id, provider_event_id, ingestion_endpoint,
          event_start_date, event_end_date, round_count, leaderboard_schema_version,
          field_source, is_active, created_at, published_at, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), $11)`,
        [
          configId,
          contestId,
          eventBId,  // ← Contest points to Event B (new tournament)
          'https://api.espn.com/pga',
          futureTime,
          futureTime,
          4,
          1,
          'provider_sync',
          true,
          'test_hash_config'
        ]
      );

      // Initialize field selections for the contest
      const fieldSelId = uuidv4();
      const primaryField = playerIds.map(id => ({ player_id: id }));
      await pool.query(
        `INSERT INTO field_selections
         (id, contest_instance_id, tournament_config_id, selection_json, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [
          fieldSelId,
          contestId,
          configId,
          JSON.stringify({ primary: primaryField, alternates: [] })
        ]
      );

      // Add participant
      await pool.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id)
         VALUES ($1, $2)`,
        [contestId, userId]
      );

      // ═══════════════════════════════════════════════════════════════════
      // THE TEST: Submit lineup for Event B contest
      // ═══════════════════════════════════════════════════════════════════

      // EXPECTED BEHAVIOR:
      // Lineup should be ALLOWED because:
      // - Contest references Event B
      // - Event B round is NOT_STARTED (pre-tournament)
      // - Previous event (A) being in progress should NOT block this

      // BUGGY BEHAVIOR:
      // Lineup would be BLOCKED if validator uses "latest event" (Event A)
      // instead of the contest's linked event (Event B)

      const result = await entryRosterService.submitPicks(
        pool,
        contestId,
        userId,
        playerIds  // All 7 players
      );

      expect(result.success).toBe(true);
      expect(result.player_ids).toHaveLength(7);
    });
  });

  describe('Test 4: Lineup blocked ONLY when round IN_PROGRESS for SAME event', () => {
    it('should block lineup only when the contest\'s SAME event round is IN_PROGRESS', async () => {
      const now = new Date();
      const futureTime = new Date(now.getTime() + 60 * 60 * 1000);
      const lockTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      // Create 7 test players (PGA roster requires exactly 7)
      const playerIds = [];
      for (let i = 0; i < 7; i++) {
        const playerId = `test_player_${uuidv4().substring(0, 8)}`;
        playerIds.push(playerId);
        testPlayerIds.push(playerId);
        await pool.query(
          `INSERT INTO players (id, sport) VALUES ($1, $2)`,
          [playerId, 'GOLF']
        );
      }

      const eventId = 'espn_pga_401811939'; // Single event for this test

      const contestId = uuidv4();
      testContestIds.push(contestId);

      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
          contest_name, lock_time, tournament_start_time, start_time, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          contestId,
          templateId,
          organizerId,
          0,
          JSON.stringify({ tiers: [] }),
          'SCHEDULED',
          'Live Event Contest',
          lockTime,
          futureTime,
          futureTime
        ]
      );

      // Event is IN_PROGRESS
      const snapshotId = uuidv4();
      testSnapshotIds.push(snapshotId);

      await pool.query(
        `INSERT INTO event_data_snapshots
         (id, contest_instance_id, provider_event_id, payload, snapshot_hash, provider_final_flag, ingested_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          snapshotId,
          contestId,  // ← Link to contest
          eventId,
          JSON.stringify({
            events: [{
              id: eventId,
              status: { type: { name: 'STATUS_IN_PROGRESS' } },
              competitions: [{
                status: { type: { state: 'in' } }, // Round IN_PROGRESS
                competitors: []
              }]
            }]
          }),
          'hash_live',
          false
        ]
      );

      const configId = uuidv4();
      await pool.query(
        `INSERT INTO tournament_configs
         (id, contest_instance_id, provider_event_id, ingestion_endpoint,
          event_start_date, event_end_date, round_count, leaderboard_schema_version,
          field_source, is_active, created_at, published_at, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), $11)`,
        [
          configId,
          contestId,
          eventId,
          'https://api.espn.com/pga',
          futureTime,
          futureTime,
          4,
          1,
          'provider_sync',
          true,
          'test_hash_config_2'
        ]
      );

      const fieldSelId = uuidv4();
      const primaryField = playerIds.map(id => ({ player_id: id }));
      await pool.query(
        `INSERT INTO field_selections
         (id, contest_instance_id, tournament_config_id, selection_json, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [
          fieldSelId,
          contestId,
          configId,
          JSON.stringify({ primary: primaryField, alternates: [] })
        ]
      );

      await pool.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id)
         VALUES ($1, $2)`,
        [contestId, userId]
      );

      // EXPECTED: This lineup submission should be BLOCKED
      // because the tournament round is IN_PROGRESS.
      // The validator should correctly read the event snapshot and detect the round status.
      try {
        await entryRosterService.submitPicks(
          pool,
          contestId,
          userId,
          playerIds  // All 7 players
        );
        fail('Expected ROUND_LOCKED error');
      } catch (error) {
        expect(error.message).toContain('Tournament round is in progress');
        expect(error.code).toBe('ROUND_LOCKED');
      }
    });
  });
});
