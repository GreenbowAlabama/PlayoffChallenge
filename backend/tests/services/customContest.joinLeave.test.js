/**
 * Custom Contest Join/Leave Service Tests
 *
 * Purpose: Comprehensive test suite for contest join and leave workflows.
 * Ensures deterministic behavior, proper error handling, and transaction safety.
 *
 * Test cases cover:
 * TEST 1: User successfully joins contest
 * TEST 2: User cannot join twice (ALREADY_JOINED)
 * TEST 3: Contest full
 * TEST 4: Contest locked
 * TEST 5: User successfully leaves contest
 * TEST 6: User leaves contest they never joined (idempotent)
 * TEST 7: Wallet validation (insufficient funds)
 * TEST 8: Invalid contest
 */

const customContestService = require('../../services/customContestService');
const LedgerRepository = require('../../repositories/LedgerRepository');

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');

// Test fixtures
const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_CONTEST_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ENTRY_FEE_CENTS = 2500;
const WALLET_BALANCE_CENTS = 50000;

describe('customContestService.joinContest', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  // TEST 1: User successfully joins contest
  describe('TEST 1: Successful join', () => {
    it('should return 200 with participant when user successfully joins contest', async () => {
      // Mock user exists
      mockPool.setQueryResponse(
        sql => sql.includes('FROM users') && sql.includes('FOR UPDATE'),
        mockQueryResponses.single({ id: TEST_USER_ID })
      );

      // Mock contest exists and is SCHEDULED
      mockPool.setQueryResponse(
        sql => sql.includes('FROM contest_instances') && sql.includes('FOR UPDATE'),
        mockQueryResponses.single({
          id: TEST_CONTEST_ID,
          status: 'SCHEDULED',
          max_entries: 20,
          lock_time: new Date(Date.now() + 3600000).toISOString(), // 1 hour in future
          entry_fee_cents: ENTRY_FEE_CENTS,
          join_token: 'dev_token',
          is_system_generated: false
        })
      );

      // Mock no existing participant
      mockPool.setQueryResponse(
        sql => sql.includes('FROM contest_participants') && sql.includes('contest_instance_id') && sql.includes('user_id'),
        mockQueryResponses.empty()
      );

      // Mock capacity check - 3 out of 20
      mockPool.setQueryResponse(
        sql => sql.includes('COUNT(*)') && sql.includes('FROM contest_participants'),
        mockQueryResponses.single({ current_count: '3' })
      );

      // Mock wallet balance check - 500 dollars available
      mockPool.setQueryResponse(
        sql => sql.includes('FROM ledger') && sql.includes('COALESCE'),
        mockQueryResponses.single({ balance_cents: WALLET_BALANCE_CENTS.toString() })
      );

      // Mock participant insert succeeds
      mockPool.setQueryResponse(
        sql => sql.includes('INSERT INTO contest_participants') && sql.includes('ON CONFLICT'),
        mockQueryResponses.single({
          id: 'pppppppp-pppp-pppp-pppp-pppppppppppp',
          contest_instance_id: TEST_CONTEST_ID,
          user_id: TEST_USER_ID,
          joined_at: new Date().toISOString()
        })
      );

      // Mock ledger debit succeeds (first time)
      mockPool.setQueryResponse(
        sql => sql.includes('INSERT INTO ledger') && sql.includes('ENTRY_FEE') && !sql.includes('REFUND'),
        mockQueryResponses.single({
          id: 'ledger-1',
          entry_type: 'ENTRY_FEE',
          direction: 'DEBIT',
          amount_cents: ENTRY_FEE_CENTS,
          reference_type: 'CONTEST',
          reference_id: TEST_CONTEST_ID,
          contest_instance_id: TEST_CONTEST_ID,
          idempotency_key: `entry_fee:${TEST_CONTEST_ID}:${TEST_USER_ID}`
        })
      );

      // Mock ledger SELECT for verification (needed if INSERT returns 0 rows due to conflict)
      mockPool.setQueryResponse(
        sql => sql.includes('SELECT') && sql.includes('FROM ledger') && sql.includes('idempotency_key'),
        mockQueryResponses.single({
          entry_type: 'ENTRY_FEE',
          direction: 'DEBIT',
          amount_cents: ENTRY_FEE_CENTS,
          reference_type: 'CONTEST',
          reference_id: TEST_CONTEST_ID,
          contest_instance_id: TEST_CONTEST_ID,
          idempotency_key: `entry_fee:${TEST_CONTEST_ID}:${TEST_USER_ID}`
        })
      );

      // Mock transaction control
      mockPool.setQueryResponse(/^BEGIN$/i, mockQueryResponses.empty());
      mockPool.setQueryResponse(/^COMMIT$/i, mockQueryResponses.empty());
      mockPool.setQueryResponse(/^ROLLBACK$/i, mockQueryResponses.empty());

      const result = await customContestService.joinContest(mockPool, TEST_CONTEST_ID, TEST_USER_ID);

      expect(result.joined).toBe(true);
      expect(result.participant).toBeDefined();
      expect(result.participant.contest_instance_id).toBe(TEST_CONTEST_ID);
      expect(result.participant.user_id).toBe(TEST_USER_ID);
    });
  });

  // TEST 2: User cannot join twice (ALREADY_JOINED)
  describe('TEST 2: Already joined', () => {
    it('should return idempotent success when user already joined', async () => {
      // Mock user exists
      mockPool.setQueryResponse(
        sql => sql.includes('FROM users') && sql.includes('FOR UPDATE'),
        mockQueryResponses.single({ id: TEST_USER_ID })
      );

      // Mock contest exists
      mockPool.setQueryResponse(
        sql => sql.includes('FROM contest_instances') && sql.includes('FOR UPDATE'),
        mockQueryResponses.single({
          id: TEST_CONTEST_ID,
          status: 'SCHEDULED',
          max_entries: 20,
          lock_time: new Date(Date.now() + 3600000).toISOString(),
          entry_fee_cents: ENTRY_FEE_CENTS,
          join_token: 'dev_token',
          is_system_generated: false
        })
      );

      // Mock participant already exists
      mockPool.setQueryResponse(
        sql => sql.includes('FROM contest_participants') && sql.includes('contest_instance_id') && sql.includes('user_id'),
        mockQueryResponses.single({
          id: 'pppppppp-pppp-pppp-pppp-pppppppppppp',
          contest_instance_id: TEST_CONTEST_ID,
          user_id: TEST_USER_ID,
          joined_at: new Date().toISOString()
        })
      );

      // Mock transaction control
      mockPool.setQueryResponse(/^BEGIN$/i, mockQueryResponses.empty());
      mockPool.setQueryResponse(/^COMMIT$/i, mockQueryResponses.empty());
      mockPool.setQueryResponse(/^ROLLBACK$/i, mockQueryResponses.empty());

      const result = await customContestService.joinContest(mockPool, TEST_CONTEST_ID, TEST_USER_ID);

      expect(result.joined).toBe(true);
      expect(result.participant).toBeDefined();
      expect(result.participant.contest_instance_id).toBe(TEST_CONTEST_ID);
    });
  });

  // TEST 3: Contest full
  describe('TEST 3: Contest full', () => {
    it('should return CONTEST_FULL when contest has reached max capacity', async () => {
      // Mock user exists
      mockPool.setQueryResponse(
        sql => sql.includes('FROM users') && sql.includes('FOR UPDATE'),
        mockQueryResponses.single({ id: TEST_USER_ID })
      );

      // Mock contest exists
      mockPool.setQueryResponse(
        sql => sql.includes('FROM contest_instances') && sql.includes('FOR UPDATE'),
        mockQueryResponses.single({
          id: TEST_CONTEST_ID,
          status: 'SCHEDULED',
          max_entries: 3, // Small capacity
          lock_time: new Date(Date.now() + 3600000).toISOString(),
          entry_fee_cents: ENTRY_FEE_CENTS,
          join_token: 'dev_token',
          is_system_generated: false
        })
      );

      // Mock no existing participant
      mockPool.setQueryResponse(
        sql => sql.includes('FROM contest_participants') && sql.includes('contest_instance_id') && sql.includes('user_id'),
        mockQueryResponses.empty()
      );

      // Mock capacity check - 3 out of 3 (FULL)
      mockPool.setQueryResponse(
        sql => sql.includes('COUNT(*)') && sql.includes('FROM contest_participants'),
        mockQueryResponses.single({ current_count: '3' })
      );

      // Mock transaction control
      mockPool.setQueryResponse(/^BEGIN$/i, mockQueryResponses.empty());
      mockPool.setQueryResponse(/^ROLLBACK$/i, mockQueryResponses.empty());

      const result = await customContestService.joinContest(mockPool, TEST_CONTEST_ID, TEST_USER_ID);

      expect(result.joined).toBe(false);
      expect(result.error_code).toBe('CONTEST_FULL');
    });
  });

  // TEST 4: Contest locked
  describe('TEST 4: Contest locked', () => {
    it('should return CONTEST_LOCKED when lock_time has passed', async () => {
      // Mock user exists
      mockPool.setQueryResponse(
        sql => sql.includes('FROM users') && sql.includes('FOR UPDATE'),
        mockQueryResponses.single({ id: TEST_USER_ID })
      );

      // Mock contest exists but locked
      mockPool.setQueryResponse(
        sql => sql.includes('FROM contest_instances') && sql.includes('FOR UPDATE'),
        mockQueryResponses.single({
          id: TEST_CONTEST_ID,
          status: 'SCHEDULED',
          max_entries: 20,
          lock_time: new Date(Date.now() - 3600000).toISOString(), // 1 hour in past (locked)
          entry_fee_cents: ENTRY_FEE_CENTS,
          join_token: 'dev_token',
          is_system_generated: false
        })
      );

      // Mock transaction control
      mockPool.setQueryResponse(/^BEGIN$/i, mockQueryResponses.empty());
      mockPool.setQueryResponse(/^ROLLBACK$/i, mockQueryResponses.empty());

      const result = await customContestService.joinContest(mockPool, TEST_CONTEST_ID, TEST_USER_ID);

      expect(result.joined).toBe(false);
      expect(result.error_code).toBe('CONTEST_LOCKED');
    });
  });

  // TEST 7: Insufficient wallet funds
  describe('TEST 7: Insufficient wallet funds', () => {
    it('should return INSUFFICIENT_WALLET_FUNDS when balance < entry_fee', async () => {
      // Mock user exists
      mockPool.setQueryResponse(
        sql => sql.includes('FROM users') && sql.includes('FOR UPDATE'),
        mockQueryResponses.single({ id: TEST_USER_ID })
      );

      // Mock contest exists
      mockPool.setQueryResponse(
        sql => sql.includes('FROM contest_instances') && sql.includes('FOR UPDATE'),
        mockQueryResponses.single({
          id: TEST_CONTEST_ID,
          status: 'SCHEDULED',
          max_entries: 20,
          lock_time: new Date(Date.now() + 3600000).toISOString(),
          entry_fee_cents: ENTRY_FEE_CENTS,
          join_token: 'dev_token',
          is_system_generated: false
        })
      );

      // Mock no existing participant
      mockPool.setQueryResponse(
        sql => sql.includes('FROM contest_participants') && sql.includes('contest_instance_id') && sql.includes('user_id'),
        mockQueryResponses.empty()
      );

      // Mock capacity check - room available
      mockPool.setQueryResponse(
        sql => sql.includes('COUNT(*)') && sql.includes('FROM contest_participants'),
        mockQueryResponses.single({ current_count: '3' })
      );

      // Mock wallet balance check - insufficient funds (only $10, need $25)
      mockPool.setQueryResponse(
        sql => sql.includes('FROM ledger') && sql.includes('COALESCE'),
        mockQueryResponses.single({ balance_cents: '1000' })
      );

      // Mock transaction control
      mockPool.setQueryResponse(/^BEGIN$/i, mockQueryResponses.empty());
      mockPool.setQueryResponse(/^ROLLBACK$/i, mockQueryResponses.empty());

      const result = await customContestService.joinContest(mockPool, TEST_CONTEST_ID, TEST_USER_ID);

      expect(result.joined).toBe(false);
      expect(result.error_code).toBe('INSUFFICIENT_WALLET_FUNDS');
    });
  });
});

describe('customContestService.unJoinContest', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  // TEST 5: User successfully leaves contest
  describe('TEST 5: Successful leave', () => {
    it('should remove participant and refund entry fee when user leaves SCHEDULED contest', async () => {
      // Mock contest exists and is SCHEDULED
      mockPool.setQueryResponse(
        sql => sql.includes('FROM contest_instances') && sql.includes('FOR UPDATE'),
        mockQueryResponses.single({
          id: TEST_CONTEST_ID,
          status: 'SCHEDULED',
          max_entries: 20,
          lock_time: new Date(Date.now() + 3600000).toISOString(),
          entry_fee_cents: ENTRY_FEE_CENTS,
          template_id: 'aaaa-aaaa-aaaa-aaaa',
          organizer_id: 'org-id',
          contest_name: 'Test Contest',
          start_time: null,
          end_time: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          join_token: 'dev_token',
          payout_structure: {}
        })
      );

      // Mock participant exists
      mockPool.setQueryResponse(
        sql => sql.includes('FROM contest_participants') && sql.includes('FOR UPDATE') && sql.includes('WHERE'),
        mockQueryResponses.single({
          contest_instance_id: TEST_CONTEST_ID,
          user_id: TEST_USER_ID
        })
      );

      // Mock participant delete
      mockPool.setQueryResponse(
        sql => sql.includes('DELETE FROM contest_participants'),
        mockQueryResponses.empty()
      );

      // Mock refund ledger entry
      mockPool.setQueryResponse(
        sql => sql.includes('INSERT INTO ledger') && sql.includes('ENTRY_FEE_REFUND'),
        mockQueryResponses.empty()
      );

      // Mock entry count after deletion
      mockPool.setQueryResponse(
        sql => sql.includes('COUNT(*)') && sql.includes('FROM contest_participants'),
        mockQueryResponses.single({ count: '2' })
      );

      // Mock transaction control
      mockPool.setQueryResponse(/^BEGIN$/i, mockQueryResponses.empty());
      mockPool.setQueryResponse(/^COMMIT$/i, mockQueryResponses.empty());
      mockPool.setQueryResponse(/^ROLLBACK$/i, mockQueryResponses.empty());

      const result = await customContestService.unJoinContest(mockPool, TEST_CONTEST_ID, TEST_USER_ID);

      expect(result).toBeDefined();
      expect(result.id).toBe(TEST_CONTEST_ID);
    });
  });

  // TEST 6: User leaves contest they never joined (idempotent)
  describe('TEST 6: Idempotent leave', () => {
    it('should return 200 when user leaves contest they never joined', async () => {
      // Mock contest exists
      mockPool.setQueryResponse(
        sql => sql.includes('FROM contest_instances') && sql.includes('FOR UPDATE'),
        mockQueryResponses.single({
          id: TEST_CONTEST_ID,
          status: 'SCHEDULED',
          max_entries: 20,
          lock_time: new Date(Date.now() + 3600000).toISOString(),
          entry_fee_cents: ENTRY_FEE_CENTS,
          template_id: 'aaaa-aaaa-aaaa-aaaa',
          organizer_id: 'org-id',
          contest_name: 'Test Contest',
          start_time: null,
          end_time: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          join_token: 'dev_token',
          payout_structure: {}
        })
      );

      // Mock no participant exists
      mockPool.setQueryResponse(
        sql => sql.includes('FROM contest_participants') && sql.includes('FOR UPDATE') && sql.includes('WHERE'),
        mockQueryResponses.empty()
      );

      // Mock entry count
      mockPool.setQueryResponse(
        sql => sql.includes('COUNT(*)') && sql.includes('FROM contest_participants'),
        mockQueryResponses.single({ count: '5' })
      );

      // Mock transaction control
      mockPool.setQueryResponse(/^BEGIN$/i, mockQueryResponses.empty());
      mockPool.setQueryResponse(/^COMMIT$/i, mockQueryResponses.empty());
      mockPool.setQueryResponse(/^ROLLBACK$/i, mockQueryResponses.empty());

      const result = await customContestService.unJoinContest(mockPool, TEST_CONTEST_ID, TEST_USER_ID);

      expect(result).toBeDefined();
      expect(result.id).toBe(TEST_CONTEST_ID);
    });
  });
});

describe('Response structure validation', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  // TEST 8: Invalid contest
  it('TEST 8: joinContest should return CONTEST_NOT_FOUND when contest does not exist', async () => {
    // Mock user exists
    mockPool.setQueryResponse(
      sql => sql.includes('FROM users') && sql.includes('FOR UPDATE'),
      mockQueryResponses.single({ id: TEST_USER_ID })
    );

    // Mock contest does not exist
    mockPool.setQueryResponse(
      sql => sql.includes('FROM contest_instances') && sql.includes('FOR UPDATE'),
      mockQueryResponses.empty()
    );

    // Mock transaction control
    mockPool.setQueryResponse(/^BEGIN$/i, mockQueryResponses.empty());
    mockPool.setQueryResponse(/^ROLLBACK$/i, mockQueryResponses.empty());

    const result = await customContestService.joinContest(mockPool, TEST_CONTEST_ID, TEST_USER_ID);

    expect(result.joined).toBe(false);
    expect(result.error_code).toBe('CONTEST_NOT_FOUND');
    expect(result.reason).toBeDefined();
  });

  // TEST 9: Response structure validation
  it('TEST 9: joinContest response should always have proper structure', async () => {
    // Mock user exists
    mockPool.setQueryResponse(
      sql => sql.includes('FROM users') && sql.includes('FOR UPDATE'),
      mockQueryResponses.single({ id: TEST_USER_ID })
    );

    // Mock contest does not exist
    mockPool.setQueryResponse(
      sql => sql.includes('FROM contest_instances') && sql.includes('FOR UPDATE'),
      mockQueryResponses.empty()
    );

    // Mock transaction control
    mockPool.setQueryResponse(/^BEGIN$/i, mockQueryResponses.empty());
    mockPool.setQueryResponse(/^ROLLBACK$/i, mockQueryResponses.empty());

    const result = await customContestService.joinContest(mockPool, TEST_CONTEST_ID, TEST_USER_ID);

    // Response structure is always: { joined: boolean, ... }
    expect(typeof result.joined).toBe('boolean');

    // If joined: false, must have error_code
    if (result.joined === false) {
      expect(result.error_code).toBeDefined();
      expect(typeof result.error_code).toBe('string');
    }

    // If joined: true, must have participant
    if (result.joined === true) {
      expect(result.participant).toBeDefined();
    }
  });
});
