/**
 * Admin Contest Service Unit Tests
 *
 * Tests admin-only contest operations:
 * - Status overrides with restricted transition rules
 * - Hard deletion with cascade and refund manifest
 * - Audit logging for all mutations
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const adminContestService = require('../../services/adminContestService');

const TEST_ADMIN_ID = '99999999-9999-9999-9999-999999999999';
const TEST_CONTEST_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TEST_ORGANIZER_ID = '11111111-1111-1111-1111-111111111111';

describe('Admin Contest Service', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('listContests', () => {
    it('should list contests with no filters', async () => {
      mockPool.setQueryResponse(
        /SELECT ci\.\*[\s\S]*FROM contest_instances ci/,
        mockQueryResponses.multiple([
          { id: TEST_CONTEST_ID, status: 'open', participant_count: '3' }
        ])
      );

      const contests = await adminContestService.listContests(mockPool);
      expect(contests).toHaveLength(1);
      expect(contests[0].id).toBe(TEST_CONTEST_ID);
    });

    it('should filter by status', async () => {
      mockPool.setQueryResponse(
        /SELECT ci\.\*[\s\S]*FROM contest_instances ci/,
        mockQueryResponses.multiple([
          { id: TEST_CONTEST_ID, status: 'open', participant_count: '2' }
        ])
      );

      const contests = await adminContestService.listContests(mockPool, { status: 'open' });
      expect(contests).toHaveLength(1);
    });
  });

  describe('getContest', () => {
    it('should return contest with participant count', async () => {
      mockPool.setQueryResponse(
        /SELECT ci\.\*[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({
          id: TEST_CONTEST_ID,
          status: 'open',
          participant_count: '5'
        })
      );

      const contest = await adminContestService.getContest(mockPool, TEST_CONTEST_ID);
      expect(contest).toBeDefined();
      expect(contest.id).toBe(TEST_CONTEST_ID);
      expect(contest.participant_count).toBe('5');
    });

    it('should return null if not found', async () => {
      mockPool.setQueryResponse(
        /SELECT ci\.\*[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.id/,
        mockQueryResponses.empty()
      );

      const contest = await adminContestService.getContest(mockPool, 'nonexistent');
      expect(contest).toBeNull();
    });
  });

  describe('overrideStatus', () => {
    it('should allow SCHEDULED → CANCELLED', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'SCHEDULED', organizer_id: TEST_ORGANIZER_ID })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'CANCELLED' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.overrideStatus(
        mockPool, TEST_CONTEST_ID, 'cancelled', TEST_ADMIN_ID, 'Violated rules'
      );
      expect(result.success).toBe(true);
      expect(result.contest.status).toBe('CANCELLED');
    });

    it('should allow LOCKED → CANCELLED', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'LOCKED', organizer_id: TEST_ORGANIZER_ID })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'CANCELLED' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.overrideStatus(
        mockPool, TEST_CONTEST_ID, 'cancelled', TEST_ADMIN_ID, 'Emergency cancellation'
      );
      expect(result.success).toBe(true);
      expect(result.contest.status).toBe('CANCELLED');
    });

    it('should reject draft transitions (legacy status not supported)', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'SCHEDULED', organizer_id: TEST_ORGANIZER_ID })
      );

      await expect(
        adminContestService.overrideStatus(mockPool, TEST_CONTEST_ID, 'draft', TEST_ADMIN_ID, 'Revert attempt')
      ).rejects.toThrow('Unsupported legacy overrideStatus transition to \'draft\'');
    });

    it('should reject transition out of COMPLETE (terminal state)', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'COMPLETE', organizer_id: TEST_ORGANIZER_ID })
      );

      await expect(
        adminContestService.overrideStatus(mockPool, TEST_CONTEST_ID, 'cancelled', TEST_ADMIN_ID, 'Trying to cancel complete')
      ).rejects.toThrow("Cannot cancel contest in status 'COMPLETE'. Only SCHEDULED, LOCKED, and ERROR contests can be cancelled.");
    });

    it('should be idempotent when re-cancelling CANCELLED contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'CANCELLED', organizer_id: TEST_ORGANIZER_ID })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.overrideStatus(
        mockPool, TEST_CONTEST_ID, 'cancelled', TEST_ADMIN_ID, 'Double cancel attempt'
      );
      expect(result.success).toBe(true);
      expect(result.noop).toBe(true);
    });

    it('should reject LIVE → CANCELLED (not admin-allowed in overrideStatus)', async () => {
      // overrideStatus only supports SCHEDULED, LOCKED, ERROR → CANCELLED
      // LIVE → CANCELLED is not supported (only through settlement)
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'LIVE', organizer_id: TEST_ORGANIZER_ID })
      );

      await expect(
        adminContestService.overrideStatus(mockPool, TEST_CONTEST_ID, 'cancelled', TEST_ADMIN_ID, 'Test')
      ).rejects.toThrow("Cannot cancel contest in status 'LIVE'. Only SCHEDULED, LOCKED, and ERROR contests can be cancelled.");
    });

    it('should reject when contest not found', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.empty()
      );

      await expect(
        adminContestService.overrideStatus(mockPool, 'nonexistent', 'cancelled', TEST_ADMIN_ID, 'Test')
      ).rejects.toThrow('Contest not found');
    });

    it('should reject when reason is missing', async () => {
      await expect(
        adminContestService.overrideStatus(mockPool, TEST_CONTEST_ID, 'cancelled', TEST_ADMIN_ID, '')
      ).rejects.toThrow('reason is required');
    });

    it('should write audit record on successful override', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'SCHEDULED', organizer_id: TEST_ORGANIZER_ID })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'CANCELLED' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      await adminContestService.overrideStatus(
        mockPool, TEST_CONTEST_ID, 'cancelled', TEST_ADMIN_ID, 'Test reason'
      );

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      expect(auditInserts[0].params[0]).toBe(TEST_CONTEST_ID);
      expect(auditInserts[0].params[1]).toBe(TEST_ADMIN_ID);
      expect(auditInserts[0].params[2]).toBe('cancel_contest');
      expect(auditInserts[0].params[3]).toBe('Test reason');
    });
  });

  describe('deleteContest', () => {
    const scheduledContest = {
      id: TEST_CONTEST_ID,
      status: 'SCHEDULED',
      entry_fee_cents: 0,
      organizer_id: TEST_ORGANIZER_ID
    };

    it('should cancel a SCHEDULED contest (v1 semantics)', async () => {
      // v1: deleteContest routes to cancelContestInstance
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ ...scheduledContest, status: 'CANCELLED' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.deleteContest(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Cleanup', false
      );

      expect(result.success).toBe(true);
      expect(result.contest.status).toBe('CANCELLED');
    });

    it('should be idempotent if already CANCELLED', async () => {
      const cancelledContest = { ...scheduledContest, status: 'CANCELLED' };
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(cancelledContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.deleteContest(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Test', false
      );

      expect(result.success).toBe(true);
      expect(result.noop).toBe(true);
    });

    it('should reject cancellation of COMPLETE contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...scheduledContest, status: 'COMPLETE' })
      );

      await expect(
        adminContestService.deleteContest(mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Test', false)
      ).rejects.toThrow('Cannot cancel contest in status \'COMPLETE\'. Only SCHEDULED, LOCKED, and ERROR contests can be cancelled.');
    });

    it('should accept hard parameter (unused in v1)', async () => {
      // v1: hard parameter is ignored, deleteContest always routes to cancelContestInstance
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ ...scheduledContest, status: 'CANCELLED' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.deleteContest(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Test', true
      );
      expect(result.success).toBe(true);
      expect(result.contest.status).toBe('CANCELLED');
    });

    it('should reject when contest not found', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.empty()
      );

      await expect(
        adminContestService.deleteContest(mockPool, 'nonexistent', TEST_ADMIN_ID, 'Test', false)
      ).rejects.toThrow('Contest not found');
    });

    it('should reject when reason is missing', async () => {
      await expect(
        adminContestService.deleteContest(mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, '', false)
      ).rejects.toThrow('reason is required');
    });

    it('should write audit record on cancellation', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ ...scheduledContest, status: 'CANCELLED' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      await adminContestService.deleteContest(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Audit test', false
      );

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      expect(auditInserts[0].params[0]).toBe(TEST_CONTEST_ID);
      expect(auditInserts[0].params[1]).toBe(TEST_ADMIN_ID);
      expect(auditInserts[0].params[2]).toBe('cancel_contest');
      expect(auditInserts[0].params[3]).toBe('Audit test');
    });
  });

  describe('updateLockTime', () => {
    it('should update lock_time and write audit', async () => {
      const newLockTime = '2026-02-10T18:00:00Z';

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'SCHEDULED', lock_time: null })
      );
      // updateContestTimeFields builds: `UPDATE contest_instances\nSET lock_time = ...` with newlines
      mockPool.setQueryResponse(
        /UPDATE[\s\S]*contest_instances[\s\S]*SET[\s\S]*lock_time/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'SCHEDULED', lock_time: newLockTime })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.updateLockTime(
        mockPool, TEST_CONTEST_ID, newLockTime, TEST_ADMIN_ID, 'Adjusting lock time'
      );

      expect(result.success).toBe(true);
      expect(result.contest.lock_time).toBe(newLockTime);

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      expect(auditInserts[0].params[2]).toBe('update_time_fields');
    });

    it('should reject when contest not found', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.empty()
      );

      await expect(
        adminContestService.updateLockTime(mockPool, 'nonexistent', '2026-02-10T18:00:00Z', TEST_ADMIN_ID, 'Test')
      ).rejects.toThrow('Contest not found');
    });

    it('should reject when reason is missing', async () => {
      await expect(
        adminContestService.updateLockTime(mockPool, TEST_CONTEST_ID, '2026-02-10T18:00:00Z', TEST_ADMIN_ID, '')
      ).rejects.toThrow('reason is required');
    });
  });

  describe('cancelContestInstance (GAP-13)', () => {
    const scheduledContest = {
      id: TEST_CONTEST_ID,
      status: 'SCHEDULED',
      lock_time: '2026-02-15T10:00:00Z',
      start_time: '2026-02-15T12:00:00Z',
      end_time: '2026-02-20T18:00:00Z'
    };

    it('should cancel a SCHEDULED contest', async () => {
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ ...scheduledContest, status: 'CANCELLED' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.cancelContestInstance(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'User requested cancellation'
      );

      expect(result.success).toBe(true);
      expect(result.noop).toBe(false);
      expect(result.contest.status).toBe('CANCELLED');
    });

    it('should be idempotent when already CANCELLED', async () => {
      const cancelledContest = { ...scheduledContest, status: 'CANCELLED' };
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(cancelledContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-2' })
      );

      const result = await adminContestService.cancelContestInstance(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Retry cancellation'
      );

      expect(result.success).toBe(true);
      expect(result.noop).toBe(true);
      expect(result.contest.status).toBe('CANCELLED');
    });

    it('should reject COMPLETE status (terminal state)', async () => {
      const completeContest = { ...scheduledContest, status: 'COMPLETE' };
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(completeContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-3' })
      );

      await expect(
        adminContestService.cancelContestInstance(
          mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Attempt to cancel complete contest'
        )
      ).rejects.toThrow('Cannot cancel contest in status \'COMPLETE\'. Only SCHEDULED, LOCKED, and ERROR contests can be cancelled.');
    });

    it('should throw CONTEST_NOT_FOUND when contest does not exist', async () => {
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.empty()
      );

      const err = new Error('Contest not found');
      err.code = 'CONTEST_NOT_FOUND';

      await expect(
        adminContestService.cancelContestInstance(
          mockPool, 'nonexistent-id', TEST_ADMIN_ID, 'Test'
        )
      ).rejects.toThrow('Contest not found');
    });

    it('should reject when reason is missing', async () => {
      await expect(
        adminContestService.cancelContestInstance(
          mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, ''
        )
      ).rejects.toThrow('reason is required');
    });

    it('should write audit record with noop=true on idempotent call', async () => {
      const cancelledContest = { ...scheduledContest, status: 'CANCELLED' };
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(cancelledContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-4' })
      );

      await adminContestService.cancelContestInstance(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Idempotent retry'
      );

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      // Check that noop is in the payload
      const payload = JSON.parse(auditInserts[0].params[6]);
      expect(payload.noop).toBe(true);
    });

    it('should write audit record with noop=false on successful transition', async () => {
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ ...scheduledContest, status: 'CANCELLED' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-5' })
      );

      await adminContestService.cancelContestInstance(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Valid cancellation'
      );

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      const payload = JSON.parse(auditInserts[0].params[6]);
      expect(payload.noop).toBe(false);
    });

    it('should set from_status and to_status in audit correctly', async () => {
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ ...scheduledContest, status: 'CANCELLED' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-6' })
      );

      await adminContestService.cancelContestInstance(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Audit test'
      );

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      // params: [contest_instance_id, admin_user_id, action, reason, from_status, to_status, payload]
      expect(auditInserts[0].params[0]).toBe(TEST_CONTEST_ID);
      expect(auditInserts[0].params[1]).toBe(TEST_ADMIN_ID);
      expect(auditInserts[0].params[2]).toBe('cancel_contest');
      expect(auditInserts[0].params[3]).toBe('Audit test');
      expect(auditInserts[0].params[4]).toBe('SCHEDULED'); // from_status
      expect(auditInserts[0].params[5]).toBe('CANCELLED'); // to_status
    });
  });

  describe('forceLockContestInstance (GAP-13)', () => {
    const scheduledContest = {
      id: TEST_CONTEST_ID,
      status: 'SCHEDULED',
      lock_time: null,
      start_time: '2026-02-15T12:00:00Z',
      end_time: '2026-02-20T18:00:00Z'
    };

    const lockedContest = {
      ...scheduledContest,
      status: 'LOCKED',
      lock_time: '2026-02-11T10:00:00Z'
    };

    it('should force SCHEDULED → LOCKED transition', async () => {
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET lock_time/,
        mockQueryResponses.single({ ...scheduledContest, lock_time: '2026-02-11T10:00:00Z' })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ ...scheduledContest, status: 'LOCKED', lock_time: '2026-02-11T10:00:00Z' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.forceLockContestInstance(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Force locking early'
      );

      expect(result.success).toBe(true);
      expect(result.noop).toBe(false);
      expect(result.contest.status).toBe('LOCKED');
    });

    it('should be idempotent when already LOCKED', async () => {
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(lockedContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-2' })
      );

      const result = await adminContestService.forceLockContestInstance(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Retry force lock'
      );

      expect(result.success).toBe(true);
      expect(result.noop).toBe(true);
      expect(result.contest.status).toBe('LOCKED');
    });

    it('should reject non-SCHEDULED status', async () => {
      const liveContest = { ...scheduledContest, status: 'LIVE' };
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(liveContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-3' })
      );

      await expect(
        adminContestService.forceLockContestInstance(
          mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Invalid force lock'
        )
      ).rejects.toThrow('Cannot force lock from status');
    });

    it('should reject COMPLETE status with error code', async () => {
      const completeContest = { ...scheduledContest, status: 'COMPLETE' };
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(completeContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-4' })
      );

      try {
        await adminContestService.forceLockContestInstance(
          mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Force lock complete'
        );
        fail('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe('INVALID_STATUS');
      }
    });

    it('should throw CONTEST_NOT_FOUND when contest does not exist', async () => {
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.empty()
      );

      await expect(
        adminContestService.forceLockContestInstance(
          mockPool, 'nonexistent-id', TEST_ADMIN_ID, 'Test'
        )
      ).rejects.toThrow('Contest not found');
    });

    it('should reject when reason is missing', async () => {
      await expect(
        adminContestService.forceLockContestInstance(
          mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, ''
        )
      ).rejects.toThrow('reason is required');
    });

    it('should set lock_time to NOW when null', async () => {
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET lock_time/,
        mockQueryResponses.single({ ...scheduledContest, lock_time: '2026-02-11T10:00:00Z' })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ ...scheduledContest, status: 'LOCKED', lock_time: '2026-02-11T10:00:00Z' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-5' })
      );

      const result = await adminContestService.forceLockContestInstance(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Force lock with null lock_time'
      );

      expect(result.contest.lock_time).toBeDefined();
    });

    it('should write audit record with noop=true on idempotent call', async () => {
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(lockedContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-6' })
      );

      await adminContestService.forceLockContestInstance(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Idempotent call'
      );

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      const payload = JSON.parse(auditInserts[0].params[6]);
      expect(payload.noop).toBe(true);
    });

    it('should write audit record with noop=false on successful transition', async () => {
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET lock_time/,
        mockQueryResponses.single({ ...scheduledContest, lock_time: '2026-02-11T10:00:00Z' })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ ...scheduledContest, status: 'LOCKED', lock_time: '2026-02-11T10:00:00Z' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-7' })
      );

      await adminContestService.forceLockContestInstance(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Valid force lock'
      );

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      const payload = JSON.parse(auditInserts[0].params[6]);
      expect(payload.noop).toBe(false);
    });

    it('should write audit record when rejecting invalid status', async () => {
      const liveContest = { ...scheduledContest, status: 'LIVE' };
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(liveContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-8' })
      );

      try {
        await adminContestService.forceLockContestInstance(
          mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Invalid status'
        );
      } catch (err) {
        // Expected
      }

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      const payload = JSON.parse(auditInserts[0].params[6]);
      expect(payload.rejected).toBe(true);
      expect(payload.error_code).toBe('INVALID_STATUS');
    });

    it('should set from_status=SCHEDULED and to_status=LOCKED in audit', async () => {
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET lock_time/,
        mockQueryResponses.single({ ...scheduledContest, lock_time: '2026-02-11T10:00:00Z' })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ ...scheduledContest, status: 'LOCKED', lock_time: '2026-02-11T10:00:00Z' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-9' })
      );

      await adminContestService.forceLockContestInstance(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Audit test'
      );

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      expect(auditInserts[0].params[4]).toBe('SCHEDULED'); // from_status
      expect(auditInserts[0].params[5]).toBe('LOCKED');    // to_status
    });

    it('should perform two separate UPDATEs: lock_time then status', async () => {
      mockPool.setQueryResponse(
        /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET lock_time/,
        mockQueryResponses.single({ ...scheduledContest, lock_time: '2026-02-11T10:00:00Z' })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ ...scheduledContest, status: 'LOCKED', lock_time: '2026-02-11T10:00:00Z' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-10' })
      );

      await adminContestService.forceLockContestInstance(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Two updates test'
      );

      const queries = mockPool.getQueryHistory();
      const lockTimeUpdates = queries.filter(q => /UPDATE contest_instances SET lock_time/.test(q.sql));
      const statusUpdates = queries.filter(q => /UPDATE contest_instances SET status/.test(q.sql));

      expect(lockTimeUpdates).toHaveLength(1);
      expect(statusUpdates).toHaveLength(1);
      // lock_time update should come before status update
      const lockTimeIndex = queries.findIndex(q => /UPDATE contest_instances SET lock_time/.test(q.sql));
      const statusIndex = queries.findIndex(q => /UPDATE contest_instances SET status/.test(q.sql));
      expect(lockTimeIndex).toBeLessThan(statusIndex);
    });
  });

  describe('updateContestTimeFields (GAP-13)', () => {
    const scheduledContest = {
      id: TEST_CONTEST_ID,
      status: 'SCHEDULED',
      lock_time: '2026-02-15T10:00:00Z',
      start_time: '2026-02-15T12:00:00Z',
      end_time: '2026-02-20T18:00:00Z',
      created_at: '2026-02-01T10:00:00Z'
    };

    it('should update start_time in SCHEDULED contest', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE[\s\S]*contest_instances[\s\S]*start_time/,
        mockQueryResponses.single({
          ...scheduledContest,
          start_time: '2026-02-15T13:00:00Z'
        })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.updateContestTimeFields(
        mockPool,
        TEST_CONTEST_ID,
        { start_time: '2026-02-15T13:00:00Z' },
        TEST_ADMIN_ID,
        'Adjust start time'
      );

      expect(result.success).toBe(true);
      expect(result.contest.start_time).toBe('2026-02-15T13:00:00Z');
    });

    it('should update multiple time fields in SCHEDULED contest', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE[\s\S]*contest_instances[\s\S]*SET/,
        mockQueryResponses.single({
          ...scheduledContest,
          lock_time: '2026-02-15T09:00:00Z',
          start_time: '2026-02-15T11:00:00Z',
          end_time: '2026-02-21T18:00:00Z'
        })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-2' })
      );

      const result = await adminContestService.updateContestTimeFields(
        mockPool,
        TEST_CONTEST_ID,
        {
          lock_time: '2026-02-15T09:00:00Z',
          start_time: '2026-02-15T11:00:00Z',
          end_time: '2026-02-21T18:00:00Z'
        },
        TEST_ADMIN_ID,
        'Adjust all times'
      );

      expect(result.success).toBe(true);
      expect(result.contest.lock_time).toBe('2026-02-15T09:00:00Z');
      expect(result.contest.start_time).toBe('2026-02-15T11:00:00Z');
      expect(result.contest.end_time).toBe('2026-02-21T18:00:00Z');
    });

    it('should be idempotent when values unchanged', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-3' })
      );

      const result = await adminContestService.updateContestTimeFields(
        mockPool,
        TEST_CONTEST_ID,
        {
          lock_time: scheduledContest.lock_time,
          start_time: scheduledContest.start_time,
          end_time: scheduledContest.end_time
        },
        TEST_ADMIN_ID,
        'Retry with same values'
      );

      expect(result.success).toBe(true);
      expect(result.noop).toBe(true);
    });

    it('should reject when status is not SCHEDULED', async () => {
      const lockedContest = { ...scheduledContest, status: 'LOCKED' };
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(lockedContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-4' })
      );

      await expect(
        adminContestService.updateContestTimeFields(
          mockPool,
          TEST_CONTEST_ID,
          { start_time: '2026-02-15T13:00:00Z' },
          TEST_ADMIN_ID,
          'Try to update locked contest'
        )
      ).rejects.toThrow('Cannot update time fields in status');
    });

    it('should reject LIVE status with error code', async () => {
      const liveContest = { ...scheduledContest, status: 'LIVE' };
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(liveContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-5' })
      );

      try {
        await adminContestService.updateContestTimeFields(
          mockPool,
          TEST_CONTEST_ID,
          { start_time: '2026-02-15T13:00:00Z' },
          TEST_ADMIN_ID,
          'Update live contest'
        );
        fail('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe('INVALID_STATUS');
      }
    });

    it('should reject COMPLETE status', async () => {
      const completeContest = { ...scheduledContest, status: 'COMPLETE' };
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(completeContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-6' })
      );

      await expect(
        adminContestService.updateContestTimeFields(
          mockPool,
          TEST_CONTEST_ID,
          { start_time: '2026-02-15T13:00:00Z' },
          TEST_ADMIN_ID,
          'Update complete contest'
        )
      ).rejects.toThrow('Cannot update time fields in status');
    });

    it('should reject CANCELLED status', async () => {
      const cancelledContest = { ...scheduledContest, status: 'CANCELLED' };
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(cancelledContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-7' })
      );

      await expect(
        adminContestService.updateContestTimeFields(
          mockPool,
          TEST_CONTEST_ID,
          { start_time: '2026-02-15T13:00:00Z' },
          TEST_ADMIN_ID,
          'Update cancelled contest'
        )
      ).rejects.toThrow('Cannot update time fields in status');
    });

    it('should reject ERROR status', async () => {
      const errorContest = { ...scheduledContest, status: 'ERROR' };
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(errorContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-8' })
      );

      await expect(
        adminContestService.updateContestTimeFields(
          mockPool,
          TEST_CONTEST_ID,
          { start_time: '2026-02-15T13:00:00Z' },
          TEST_ADMIN_ID,
          'Update error contest'
        )
      ).rejects.toThrow('Cannot update time fields in status');
    });

    it('should reject time invariant violation (start_time > end_time)', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-9' })
      );

      await expect(
        adminContestService.updateContestTimeFields(
          mockPool,
          TEST_CONTEST_ID,
          { start_time: '2026-02-21T19:00:00Z' }, // After end_time
          TEST_ADMIN_ID,
          'Invalid time order'
        )
      ).rejects.toThrow();
    });

    it('should throw CONTEST_NOT_FOUND when contest does not exist', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.empty()
      );

      await expect(
        adminContestService.updateContestTimeFields(
          mockPool,
          'nonexistent-id',
          { start_time: '2026-02-15T13:00:00Z' },
          TEST_ADMIN_ID,
          'Test'
        )
      ).rejects.toThrow('Contest not found');
    });

    it('should write audit record with old_values and new_values on success', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET start_time/,
        mockQueryResponses.single({
          ...scheduledContest,
          start_time: '2026-02-15T13:00:00Z'
        })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-10' })
      );

      await adminContestService.updateContestTimeFields(
        mockPool,
        TEST_CONTEST_ID,
        { start_time: '2026-02-15T13:00:00Z' },
        TEST_ADMIN_ID,
        'Update start time'
      );

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      const payload = JSON.parse(auditInserts[0].params[6]);
      expect(payload.old_values).toBeDefined();
      expect(payload.new_values).toBeDefined();
      expect(payload.noop).toBe(false);
    });

    it('should write audit record with noop=true on idempotent call', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-11' })
      );

      await adminContestService.updateContestTimeFields(
        mockPool,
        TEST_CONTEST_ID,
        { start_time: scheduledContest.start_time },
        TEST_ADMIN_ID,
        'Idempotent update'
      );

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      const payload = JSON.parse(auditInserts[0].params[6]);
      expect(payload.noop).toBe(true);
    });

    it('should write audit record when rejecting invalid status', async () => {
      const lockedContest = { ...scheduledContest, status: 'LOCKED' };
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(lockedContest)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-12' })
      );

      try {
        await adminContestService.updateContestTimeFields(
          mockPool,
          TEST_CONTEST_ID,
          { start_time: '2026-02-15T13:00:00Z' },
          TEST_ADMIN_ID,
          'Invalid status'
        );
      } catch (err) {
        // Expected
      }

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      const payload = JSON.parse(auditInserts[0].params[6]);
      expect(payload.rejected).toBe(true);
      expect(payload.error_code).toBe('INVALID_STATUS');
    });

    it('should use from_status and to_status (same) in audit', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET start_time/,
        mockQueryResponses.single({
          ...scheduledContest,
          start_time: '2026-02-15T13:00:00Z'
        })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-13' })
      );

      await adminContestService.updateContestTimeFields(
        mockPool,
        TEST_CONTEST_ID,
        { start_time: '2026-02-15T13:00:00Z' },
        TEST_ADMIN_ID,
        'Audit test'
      );

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      expect(auditInserts[0].params[4]).toBe('SCHEDULED'); // from_status
      expect(auditInserts[0].params[5]).toBe('SCHEDULED'); // to_status (same)
    });

    it('should use default reason when reason is empty', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(scheduledContest)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET start_time/,
        mockQueryResponses.single({
          ...scheduledContest,
          start_time: '2026-02-15T13:00:00Z'
        })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-14' })
      );

      await adminContestService.updateContestTimeFields(
        mockPool,
        TEST_CONTEST_ID,
        { start_time: '2026-02-15T13:00:00Z' },
        TEST_ADMIN_ID,
        '' // Empty reason
      );

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      // Should use default reason constant
      expect(auditInserts[0].params[3]).toBe('admin_time_update');
    });
  });

  describe('ADMIN_TRANSITIONS', () => {
    it('should export correct transition map', () => {
      expect(adminContestService.ADMIN_TRANSITIONS).toEqual({
        draft: [],
        open: ['draft', 'cancelled'],
        locked: ['cancelled'],
        settled: [],
        cancelled: []
      });
    });
  });
});
