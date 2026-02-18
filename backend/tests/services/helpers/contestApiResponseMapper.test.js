// tests/services/helpers/contestApiResponseMapper.test.js

const { mapContestToApiResponse } = require('../../../services/helpers/contestApiResponseMapper');

describe('contestApiResponseMapper', () => {
  const MOCK_UUID = '00000000-0000-0000-0000-000000000000';
  const MOCK_TIMESTAMP = new Date('2026-02-11T12:00:00.000Z'); // Consistent timestamp for tests
  const MOCK_TIMESTAMP_MS = MOCK_TIMESTAMP.getTime();

  // --- Helper to create a base contestRow for consistent testing ---
  const createBaseContestRow = (overrides = {}) => ({
    id: MOCK_UUID,
    template_id: MOCK_UUID,
    organizer_id: MOCK_UUID,
    entry_fee_cents: 1000,
    payout_structure: [{ rank: 1, percentage: 100 }],
    status: 'SCHEDULED', // Default status
    start_time: new Date('2026-02-12T10:00:00.000Z'),
    lock_time: new Date('2026-02-12T11:00:00.000Z'),
    created_at: new Date('2026-02-11T09:00:00.000Z'),
    updated_at: new Date('2026-02-11T09:00:00.000Z'),
    join_token: 'test_token',
    max_entries: 10,
    contest_name: 'Test Contest',
    end_time: new Date('2026-02-12T13:00:00.000Z'),
    settle_time: null, // Default to not settled
    entry_count: 0, // Default for derived field
    user_has_entered: false, // Default for derived field
    organizer_name: 'Test Organizer',
    ...overrides,
  });

  // --- Positive Cases: All eight fields appear correctly & base fields passthrough ---
  describe('Derived fields and base field passthrough', () => {
    it('should correctly map a SCHEDULED contest (before lock) and pass through base fields', () => {
      const contestRow = createBaseContestRow({
        status: 'SCHEDULED',
        lock_time: new Date('2026-02-11T13:00:00.000Z'), // 1 hour after MOCK_TIMESTAMP
        entry_count: 5,
        user_has_entered: true,
      });

      const result = mapContestToApiResponse(contestRow, { currentTimestamp: MOCK_TIMESTAMP });

      // Base fields passthrough
      expect(result.id).toBe(contestRow.id);
      expect(result.template_id).toBe(contestRow.template_id);
      expect(result.organizer_id).toBe(contestRow.organizer_id);
      expect(result.entry_fee_cents).toBe(contestRow.entry_fee_cents);
      expect(result.payout_structure).toEqual(contestRow.payout_structure);
      expect(result.contest_name).toBe(contestRow.contest_name);
      expect(result.start_time).toEqual(contestRow.start_time);
      expect(result.end_time).toEqual(contestRow.end_time);
      expect(result.max_entries).toBe(contestRow.max_entries);
      expect(result.join_token).toBe(contestRow.join_token);
      expect(result.created_at).toEqual(contestRow.created_at);
      expect(result.updated_at).toEqual(contestRow.updated_at);

      // Derived fields
      expect(result.status).toBe('SCHEDULED');
      expect(result.is_locked).toBe(false);
      expect(result.is_live).toBe(false);
      expect(result.is_settled).toBe(false);
      expect(result.entry_count).toBe(5);
      expect(result.user_has_entered).toBe(true);
      expect(result.time_until_lock).toBe(3600); // 1 hour in seconds
      expect('standings' in result).toBe(false); // standings should be omitted
    });

    it('should correctly map a LOCKED contest', () => {
      const contestRow = createBaseContestRow({
        status: 'LOCKED',
        lock_time: new Date('2026-02-11T11:00:00.000Z'), // Already passed
        entry_count: 10,
        user_has_entered: false,
      });

      const result = mapContestToApiResponse(contestRow, { currentTimestamp: MOCK_TIMESTAMP });

      expect(result.status).toBe('LOCKED');
      expect(result.is_locked).toBe(true);
      expect(result.is_live).toBe(false);
      expect(result.is_settled).toBe(false);
      expect(result.entry_count).toBe(10);
      expect(result.user_has_entered).toBe(false);
      expect(result.time_until_lock).toBeNull(); // null for non-SCHEDULED
      expect('standings' in result).toBe(false); // standings should be omitted
    });

    it('should correctly map a LIVE contest with standings', () => {
      const mockStandings = [{ user_id: MOCK_UUID, user_display_name: 'U1', total_score: 100, rank: 1 }];
      const contestRow = createBaseContestRow({
        status: 'LIVE',
        lock_time: new Date('2026-02-11T11:00:00.000Z'),
        standings: mockStandings, // Provided by service layer
      });

      const result = mapContestToApiResponse(contestRow, { currentTimestamp: MOCK_TIMESTAMP });

      expect(result.status).toBe('LIVE');
      expect(result.is_locked).toBe(true);
      expect(result.is_live).toBe(true);
      expect(result.is_settled).toBe(false);
      expect(result.standings).toEqual(mockStandings); // Present and correct
      expect(result.time_until_lock).toBeNull();
    });

    it('should correctly map a COMPLETE contest with standings', () => {
      const mockStandings = [{ user_id: MOCK_UUID, user_display_name: 'U1', total_score: 100, rank: 1 }];
      const contestRow = createBaseContestRow({
        status: 'COMPLETE',
        lock_time: new Date('2026-02-11T11:00:00.000Z'),
        settle_time: new Date('2026-02-11T11:30:00.000Z'), // Settled
        standings: mockStandings,
      });

      const result = mapContestToApiResponse(contestRow, { currentTimestamp: MOCK_TIMESTAMP });

      expect(result.status).toBe('COMPLETE');
      expect(result.is_locked).toBe(true);
      expect(result.is_live).toBe(false);
      expect(result.is_settled).toBe(true);
      expect(result.standings).toEqual(mockStandings);
      expect(result.time_until_lock).toBeNull();
    });

    it('should correctly map an ERROR contest without standings', () => {
      const contestRow = createBaseContestRow({
        status: 'ERROR',
        lock_time: new Date('2026-02-11T11:00:00.000Z'),
        settle_time: new Date('2026-02-11T11:30:00.000Z'),
      });

      const result = mapContestToApiResponse(contestRow, { currentTimestamp: MOCK_TIMESTAMP });

      expect(result.status).toBe('ERROR');
      expect(result.is_locked).toBe(true);
      expect(result.is_live).toBe(false);
      expect(result.is_settled).toBe(true);
      expect('standings' in result).toBe(false); // Must be omitted
      expect(result.time_until_lock).toBeNull();
    });
  });

  // --- Invariant Violations (Throw on invalid state) ---
  describe('Invariant Enforcement', () => {
    it('should throw if status is invalid', () => {
      const contestRow = createBaseContestRow({ status: 'INVALID_STATUS' });
      expect(() => mapContestToApiResponse(contestRow, { currentTimestamp: MOCK_TIMESTAMP }))
        .toThrow(/Invalid contest status/);
    });

    it('should throw if entry_count is not a valid number', () => {
      const contestRowString = createBaseContestRow({ entry_count: 'five' });
      expect(() => mapContestToApiResponse(contestRowString, { currentTimestamp: MOCK_TIMESTAMP }))
        .toThrow(/'entry_count' must be a valid number/);

      const contestRowNaN = createBaseContestRow({ entry_count: NaN });
      expect(() => mapContestToApiResponse(contestRowNaN, { currentTimestamp: MOCK_TIMESTAMP }))
        .toThrow(/'entry_count' must be a valid number/);
    });

    it('should throw if user_has_entered is not a boolean', () => {
      const contestRow = createBaseContestRow({ user_has_entered: 1 });
      expect(() => mapContestToApiResponse(contestRow, { currentTimestamp: MOCK_TIMESTAMP }))
        .toThrow(/'user_has_entered' must be a boolean/);
    });

    it('should throw if SCHEDULED contest has null lock_time', () => {
      const contestRow = createBaseContestRow({ status: 'SCHEDULED', lock_time: null });
      expect(() => mapContestToApiResponse(contestRow, { currentTimestamp: MOCK_TIMESTAMP }))
        .toThrow(/SCHEDULED contest cannot have a null lock_time/);
    });

    it('should throw if LIVE contest is missing standings', () => {
      const contestRow = createBaseContestRow({ status: 'LIVE', standings: undefined });
      expect(() => mapContestToApiResponse(contestRow, { currentTimestamp: MOCK_TIMESTAMP }))
        .toThrow(/Standings must be present in contestRow for status 'LIVE'/);
    });

    it('should throw if COMPLETE contest is missing standings', () => {
      const contestRow = createBaseContestRow({ status: 'COMPLETE', standings: null });
      expect(() => mapContestToApiResponse(contestRow, { currentTimestamp: MOCK_TIMESTAMP }))
        .toThrow(/Standings must be present in contestRow for status 'COMPLETE'/);
    });

    it('should throw if LIVE contest standings is not an array', () => {
      const contestRow = createBaseContestRow({ status: 'LIVE', standings: { foo: 'bar' } });
      expect(() => mapContestToApiResponse(contestRow, { currentTimestamp: MOCK_TIMESTAMP }))
        .toThrow(/Standings must be an array for status 'LIVE'/);
    });

    it('should throw if COMPLETE contest standings is not an array', () => {
      const contestRow = createBaseContestRow({ status: 'COMPLETE', standings: 'not an array' });
      expect(() => mapContestToApiResponse(contestRow, { currentTimestamp: MOCK_TIMESTAMP }))
        .toThrow(/Standings must be an array for status 'COMPLETE'/);
    });

    it('should throw if non-LIVE/COMPLETE contest has standings present', () => {
      const contestRow = createBaseContestRow({ status: 'LOCKED', standings: [{}] });
      expect(() => mapContestToApiResponse(contestRow, { currentTimestamp: MOCK_TIMESTAMP }))
        .toThrow(/Standings must NOT be present in contestRow for status 'LOCKED'/);
    });

    it('should throw if ERROR contest has standings present', () => {
      const contestRow = createBaseContestRow({ status: 'ERROR', standings: [{}] });
      expect(() => mapContestToApiResponse(contestRow, { currentTimestamp: MOCK_TIMESTAMP }))
        .toThrow(/Standings must NOT be present in contestRow for status 'ERROR'/); // Catches the general case now
    });

    it('should throw if currentTimestamp is invalid', () => {
      const contestRow = createBaseContestRow();
      expect(() => mapContestToApiResponse(contestRow, { currentTimestamp: 'not a timestamp' }))
        .toThrow(/currentTimestamp must be a valid number or Date object/);
      expect(() => mapContestToApiResponse(contestRow, { currentTimestamp: null }))
        .toThrow(/currentTimestamp must be a valid number or Date object/);
      // No test for undefined, as it falls back to Date.now() if not provided
    });
  });

  // --- Specific Requirements and Edge Cases ---
  describe('Specific Requirements', () => {
    it('should calculate time_until_lock correctly with numeric timestamp input', () => {
      const contestRow = createBaseContestRow({
        status: 'SCHEDULED',
        lock_time: new Date('2026-02-11T13:00:00.000Z'), // 1 hour after MOCK_TIMESTAMP
      });
      const result = mapContestToApiResponse(contestRow, { currentTimestamp: MOCK_TIMESTAMP_MS });
      expect(result.time_until_lock).toBe(3600);
    });

    it('should return time_until_lock as 0 if lock_time is in the past or exactly currentTimestamp for SCHEDULED', () => {
      const contestRowPastLock = createBaseContestRow({
        status: 'SCHEDULED',
        lock_time: new Date('2026-02-11T11:00:00.000Z'), // 1 hour before MOCK_TIMESTAMP
      });
      const resultPastLock = mapContestToApiResponse(contestRowPastLock, { currentTimestamp: MOCK_TIMESTAMP });
      expect(resultPastLock.time_until_lock).toBe(0);

      const contestRowAtLock = createBaseContestRow({
        status: 'SCHEDULED',
        lock_time: new Date('2026-02-11T12:00:00.000Z'), // Exactly MOCK_TIMESTAMP
      });
      const resultAtLock = mapContestToApiResponse(contestRowAtLock, { currentTimestamp: MOCK_TIMESTAMP });
      expect(resultAtLock.time_until_lock).toBe(0);
    });

    it('is_locked should depend only on status', () => {
      const scheduledResult = mapContestToApiResponse(createBaseContestRow({ status: 'SCHEDULED' }), { currentTimestamp: MOCK_TIMESTAMP });
      expect(scheduledResult.is_locked).toBe(false);

      const lockedResult = mapContestToApiResponse(createBaseContestRow({ status: 'LOCKED' }), { currentTimestamp: MOCK_TIMESTAMP });
      expect(lockedResult.is_locked).toBe(true);

      const liveResult = mapContestToApiResponse(createBaseContestRow({ status: 'LIVE', standings: [] }), { currentTimestamp: MOCK_TIMESTAMP });
      expect(liveResult.is_locked).toBe(true);

      const completeResult = mapContestToApiResponse(createBaseContestRow({ status: 'COMPLETE', settle_time: new Date(), standings: [] }), { currentTimestamp: MOCK_TIMESTAMP });
      expect(completeResult.is_locked).toBe(true);

      const cancelledResult = mapContestToApiResponse(createBaseContestRow({ status: 'CANCELLED' }), { currentTimestamp: MOCK_TIMESTAMP });
      expect(cancelledResult.is_locked).toBe(true);

      const errorResult = mapContestToApiResponse(createBaseContestRow({ status: 'ERROR' }), { currentTimestamp: MOCK_TIMESTAMP });
      expect(errorResult.is_locked).toBe(true);
    });
  });

  // --- Organizer Capability Tests ---
  describe('Organizer Capabilities: can_share_invite and can_manage_contest', () => {
    const organizerId = '11111111-1111-1111-1111-111111111111';
    const otherUserId = '22222222-2222-2222-2222-222222222222';

    it('should grant organizer capabilities when authenticated user is creator', () => {
      const contestRow = createBaseContestRow({
        organizer_id: organizerId,
        status: 'SCHEDULED'
      });

      const result = mapContestToApiResponse(contestRow, {
        currentTimestamp: MOCK_TIMESTAMP,
        authenticatedUserId: organizerId
      });

      expect(result.actions.can_share_invite).toBe(true);
      expect(result.actions.can_manage_contest).toBe(true);
    });

    it('should deny organizer capabilities for non-creator participant', () => {
      const contestRow = createBaseContestRow({
        organizer_id: organizerId,
        status: 'SCHEDULED'
      });

      const result = mapContestToApiResponse(contestRow, {
        currentTimestamp: MOCK_TIMESTAMP,
        authenticatedUserId: otherUserId
      });

      expect(result.actions.can_share_invite).toBe(false);
      expect(result.actions.can_manage_contest).toBe(false);
    });

    it('should deny organizer capabilities for unauthenticated user (null)', () => {
      const contestRow = createBaseContestRow({
        organizer_id: organizerId,
        status: 'SCHEDULED'
      });

      const result = mapContestToApiResponse(contestRow, {
        currentTimestamp: MOCK_TIMESTAMP,
        authenticatedUserId: null
      });

      expect(result.actions.can_share_invite).toBe(false);
      expect(result.actions.can_manage_contest).toBe(false);
    });

    it('should deny organizer capabilities when authenticatedUserId is not provided (defaults to null)', () => {
      const contestRow = createBaseContestRow({
        organizer_id: organizerId,
        status: 'SCHEDULED'
      });

      const result = mapContestToApiResponse(contestRow, {
        currentTimestamp: MOCK_TIMESTAMP
        // No authenticatedUserId parameter, should default to null
      });

      expect(result.actions.can_share_invite).toBe(false);
      expect(result.actions.can_manage_contest).toBe(false);
    });
  });
});
