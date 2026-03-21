/**
 * Roster Invariant Integration Test
 *
 * Tests the hard guard: entry_rosters.player_ids ⊆ field_selections.primary
 * Ensures invalid player IDs are rejected at submission and NO row is written.
 */

const { Pool } = require('pg');
const entryRosterService = require('../../services/entryRosterService');

describe('Roster Invariant - entry_rosters.player_ids ⊆ field_selections.primary', () => {
  let pool;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL env var is required');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('submitPicks hard guard', () => {
    it('rejects roster with 1 invalid player_id not in field_selections.primary', async () => {
      // Setup: Create minimal contest, participant, field_selections
      const contestId = await setupTestContest(pool);
      const userId = 'test-user-' + Math.random().toString(36).slice(2, 9);

      // Add user as participant
      await pool.query(
        'INSERT INTO contest_participants (contest_instance_id, user_id) VALUES ($1, $2)',
        [contestId, userId]
      );

      // Verify field_selections exists with 3 valid IDs
      const fieldCheck = await pool.query(
        'SELECT selection_json FROM field_selections WHERE contest_instance_id = $1',
        [contestId]
      );
      expect(fieldCheck.rows.length).toBe(1);
      expect(Array.isArray(fieldCheck.rows[0].selection_json.primary)).toBe(true);
      expect(fieldCheck.rows[0].selection_json.primary.length).toBe(3);

      // Get the valid IDs from field_selections
      const validIds = fieldCheck.rows[0].selection_json.primary;

      // Build a roster with 1 valid + 1 INVALID (not in field)
      const invalidRoster = [
        validIds[0],           // Valid ID from field
        'espn_999999'          // INVALID - not in field_selections.primary
      ];

      // Attempt to submit roster with invalid ID
      let submitError;
      try {
        await entryRosterService.submitPicks(pool, contestId, userId, invalidRoster);
      } catch (err) {
        submitError = err;
      }

      // ASSERT: Submit fails with INVARIANT VIOLATION error
      expect(submitError).toBeDefined();
      expect(submitError.message).toMatch(/INVARIANT VIOLATION/);
      expect(submitError.message).toMatch(/espn_999999/);

      // ASSERT: No row was inserted into entry_rosters
      const rosterCheck = await pool.query(
        'SELECT player_ids FROM entry_rosters WHERE contest_instance_id = $1 AND user_id = $2',
        [contestId, userId]
      );
      expect(rosterCheck.rows.length).toBe(0);
    });

    it('accepts roster with all valid player_ids from field_selections.primary', async () => {
      // Setup: Create minimal contest, participant, field_selections
      const contestId = await setupTestContest(pool);
      const userId = 'test-user-' + Math.random().toString(36).slice(2, 9);

      // Add user as participant
      await pool.query(
        'INSERT INTO contest_participants (contest_instance_id, user_id) VALUES ($1, $2)',
        [contestId, userId]
      );

      // Get valid IDs from field_selections
      const fieldCheck = await pool.query(
        'SELECT selection_json FROM field_selections WHERE contest_instance_id = $1',
        [contestId]
      );
      const validIds = fieldCheck.rows[0].selection_json.primary;

      // Build roster with only valid IDs
      const validRoster = [validIds[0], validIds[1]];

      // Submit roster with valid IDs
      const result = await entryRosterService.submitPicks(pool, contestId, userId, validRoster);

      // ASSERT: Submit succeeds
      expect(result.success).toBe(true);
      expect(result.player_ids).toEqual(validRoster);

      // ASSERT: Row was inserted into entry_rosters with correct player_ids
      const rosterCheck = await pool.query(
        'SELECT player_ids FROM entry_rosters WHERE contest_instance_id = $1 AND user_id = $2',
        [contestId, userId]
      );
      expect(rosterCheck.rows.length).toBe(1);
      expect(rosterCheck.rows[0].player_ids).toEqual(validRoster);
    });

    it('rejects roster with multiple invalid player_ids', async () => {
      // Setup: Create minimal contest, participant, field_selections
      const contestId = await setupTestContest(pool);
      const userId = 'test-user-' + Math.random().toString(36).slice(2, 9);

      // Add user as participant
      await pool.query(
        'INSERT INTO contest_participants (contest_instance_id, user_id) VALUES ($1, $2)',
        [contestId, userId]
      );

      // Get valid ID from field_selections
      const fieldCheck = await pool.query(
        'SELECT selection_json FROM field_selections WHERE contest_instance_id = $1',
        [contestId]
      );
      const validIds = fieldCheck.rows[0].selection_json.primary;

      // Build roster with 1 valid + 2 invalid IDs
      const invalidRoster = [
        validIds[0],           // Valid
        'espn_111111',         // Invalid
        'espn_222222'          // Invalid
      ];

      // Attempt to submit
      let submitError;
      try {
        await entryRosterService.submitPicks(pool, contestId, userId, invalidRoster);
      } catch (err) {
        submitError = err;
      }

      // ASSERT: Fails with INVARIANT VIOLATION
      expect(submitError).toBeDefined();
      expect(submitError.message).toMatch(/INVARIANT VIOLATION/);
      expect(submitError.message).toMatch(/espn_111111/);
      expect(submitError.message).toMatch(/espn_222222/);

      // ASSERT: No row inserted
      const rosterCheck = await pool.query(
        'SELECT player_ids FROM entry_rosters WHERE contest_instance_id = $1 AND user_id = $2',
        [contestId, userId]
      );
      expect(rosterCheck.rows.length).toBe(0);
    });
  });
});

/**
 * Helper: Create a test contest with field_selections
 * Returns: contestInstanceId
 */
async function setupTestContest(pool) {
  const templateRes = await pool.query(
    `SELECT id FROM contest_templates
     WHERE sport = 'pga' AND scoring_strategy_key = 'pga_standard_v1' LIMIT 1`
  );

  let templateId = templateRes.rows[0]?.id;

  // Create template if it doesn't exist
  if (!templateId) {
    const createTemplate = await pool.query(
      `INSERT INTO contest_templates (sport, scoring_strategy_key, name)
       VALUES ('pga', 'pga_standard_v1', 'Test PGA Template')
       RETURNING id`
    );
    templateId = createTemplate.rows[0].id;
  }

  // Create contest instance
  const contestRes = await pool.query(
    `INSERT INTO contest_instances (
       template_id,
       status,
       contest_name,
       max_entries
     )
     VALUES ($1, 'SCHEDULED', 'Test Contest', 10)
     RETURNING id`,
    [templateId]
  );
  const contestId = contestRes.rows[0].id;

  // Create field_selections with 3 valid player IDs
  const validPlayerIds = ['espn_10054', 'espn_10166', 'espn_10548'];
  await pool.query(
    `INSERT INTO field_selections (
       contest_instance_id,
       selection_json,
       created_at
     )
     VALUES ($1, $2::jsonb, now())`,
    [contestId, JSON.stringify({ primary: validPlayerIds, alternates: [] })]
  );

  return contestId;
}
