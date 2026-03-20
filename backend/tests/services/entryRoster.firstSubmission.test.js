/**
 * First Submission — Empty Roster UPSERT Test
 *
 * Proves the first-submission path works when:
 * - entry_rosters row EXISTS (created at join time)
 * - player_ids = [] (empty)
 * - expected_updated_at = null (no version)
 *
 * This is the exact scenario that was returning MISSING_VERSION in production.
 */

const entryRosterService = require('../../services/entryRosterService');
const { createMockPool } = require('../mocks/mockPool');

describe('FIRST SUBMISSION — EMPTY ROSTER UPSERT', () => {
  test('allows submission when roster exists but player_ids is empty and no version provided', async () => {
    const pool = createMockPool();
    const contestId = 'test-contest-first-sub';
    const userId = 'test-user-first-sub';
    const playerIds = ['espn_1', 'espn_2', 'espn_3', 'espn_4', 'espn_5', 'espn_6', 'espn_7'];

    // Mock contest row — SCHEDULED, future lock_time
    pool.setQueryResponse(
      q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
      {
        rows: [{
          id: contestId,
          status: 'SCHEDULED',
          lock_time: new Date(Date.now() + 3600000),
          scoring_strategy_key: 'pga_standard_v1'
        }],
        rowCount: 1
      }
    );

    // Mock participant check — user is a participant
    pool.setQueryResponse(
      q => q.includes('contest_participants') && q.includes('WHERE'),
      {
        rows: [{ 1: 1 }],
        rowCount: 1
      }
    );

    // Mock field_selections — all player IDs are valid
    pool.setQueryResponse(
      q => q.includes('field_selections'),
      {
        rows: [{
          selection_json: {
            primary: playerIds.map(id => ({ player_id: id, name: `Player ${id}` }))
          }
        }],
        rowCount: 1
      }
    );

    // CRITICAL MOCK: existing roster with EMPTY player_ids
    // This simulates the join-time scenario where a row is created with []
    pool.setQueryResponse(
      q => q.includes('entry_rosters') && q.includes('SELECT') && !q.includes('UPDATE') && !q.includes('INSERT'),
      {
        rows: [{
          player_ids: [],
          updated_at: new Date('2026-03-20T00:00:00Z')
        }],
        rowCount: 1
      }
    );

    // Mock UPSERT result (INSERT ... ON CONFLICT DO UPDATE)
    pool.setQueryResponse(
      q => q.includes('entry_rosters') && q.includes('INSERT') && q.includes('ON CONFLICT'),
      {
        rows: [{ updated_at: new Date().toISOString() }],
        rowCount: 1
      }
    );

    // Call with expected_updated_at = null (no version)
    const result = await entryRosterService.submitPicks(
      pool,
      contestId,
      userId,
      playerIds,
      false,  // allow_regression
      null    // NO VERSION — this is the bug scenario
    );

    // Must succeed — not return MISSING_VERSION
    expect(result.success).toBe(true);
    expect(result.error_code).toBeUndefined();
    expect(result.player_ids.length).toBe(7);
    expect(result.updated_at).toBeDefined();
  });

  test('still requires version when roster exists with NON-EMPTY player_ids', async () => {
    const pool = createMockPool();
    const contestId = 'test-contest-update';
    const userId = 'test-user-update';
    const playerIds = ['espn_1', 'espn_2', 'espn_3', 'espn_4', 'espn_5', 'espn_6', 'espn_7'];

    // Mock contest row
    pool.setQueryResponse(
      q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
      {
        rows: [{
          id: contestId,
          status: 'SCHEDULED',
          lock_time: new Date(Date.now() + 3600000),
          scoring_strategy_key: 'pga_standard_v1'
        }],
        rowCount: 1
      }
    );

    // Mock participant check
    pool.setQueryResponse(
      q => q.includes('contest_participants') && q.includes('WHERE'),
      { rows: [{ 1: 1 }], rowCount: 1 }
    );

    // Mock field_selections
    pool.setQueryResponse(
      q => q.includes('field_selections'),
      {
        rows: [{
          selection_json: {
            primary: playerIds.map(id => ({ player_id: id, name: `Player ${id}` }))
          }
        }],
        rowCount: 1
      }
    );

    // CRITICAL MOCK: existing roster with NON-EMPTY player_ids
    pool.setQueryResponse(
      q => q.includes('entry_rosters') && q.includes('SELECT') && !q.includes('UPDATE') && !q.includes('INSERT'),
      {
        rows: [{
          player_ids: ['espn_1', 'espn_2', 'espn_3'],
          updated_at: new Date('2026-03-20T00:00:00Z')
        }],
        rowCount: 1
      }
    );

    // Call with expected_updated_at = null (no version)
    const result = await entryRosterService.submitPicks(
      pool,
      contestId,
      userId,
      playerIds,
      false,
      null  // NO VERSION — should be required for non-empty roster
    );

    // Must fail with MISSING_VERSION
    expect(result.success).toBe(false);
    expect(result.error_code).toBe('MISSING_VERSION');
  });
});
