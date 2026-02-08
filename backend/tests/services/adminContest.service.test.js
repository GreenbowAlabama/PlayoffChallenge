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
    it('should allow open → cancelled', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'open', organizer_id: TEST_ORGANIZER_ID })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'cancelled' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.overrideStatus(
        mockPool, TEST_CONTEST_ID, 'cancelled', TEST_ADMIN_ID, 'Violated rules'
      );
      expect(result.status).toBe('cancelled');
    });

    it('should allow locked → cancelled', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'locked', organizer_id: TEST_ORGANIZER_ID })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'cancelled' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.overrideStatus(
        mockPool, TEST_CONTEST_ID, 'cancelled', TEST_ADMIN_ID, 'Emergency cancellation'
      );
      expect(result.status).toBe('cancelled');
    });

    it('should allow open → draft when organizer is sole participant', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'open', organizer_id: TEST_ORGANIZER_ID })
      );
      mockPool.setQueryResponse(
        /SELECT COUNT[\s\S]*FROM contest_participants/,
        mockQueryResponses.single({ cnt: '1' })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'draft' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.overrideStatus(
        mockPool, TEST_CONTEST_ID, 'draft', TEST_ADMIN_ID, 'Organizer requested revert'
      );
      expect(result.status).toBe('draft');
    });

    it('should reject open → draft when contest has other participants', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'open', organizer_id: TEST_ORGANIZER_ID })
      );
      mockPool.setQueryResponse(
        /SELECT COUNT[\s\S]*FROM contest_participants/,
        mockQueryResponses.single({ cnt: '3' })
      );

      await expect(
        adminContestService.overrideStatus(mockPool, TEST_CONTEST_ID, 'draft', TEST_ADMIN_ID, 'Revert attempt')
      ).rejects.toThrow('Cannot revert to draft: contest has participants beyond the organizer');
    });

    it('should reject transition out of settled', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'settled', organizer_id: TEST_ORGANIZER_ID })
      );

      await expect(
        adminContestService.overrideStatus(mockPool, TEST_CONTEST_ID, 'cancelled', TEST_ADMIN_ID, 'Trying to cancel settled')
      ).rejects.toThrow("Admin cannot transition from 'settled' to 'cancelled'");
    });

    it('should reject transition out of cancelled', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'cancelled', organizer_id: TEST_ORGANIZER_ID })
      );

      await expect(
        adminContestService.overrideStatus(mockPool, TEST_CONTEST_ID, 'open', TEST_ADMIN_ID, 'Reopen attempt')
      ).rejects.toThrow("Admin cannot transition from 'cancelled' to 'open'");
    });

    it('should reject invalid transition draft → cancelled (not admin-allowed)', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'draft', organizer_id: TEST_ORGANIZER_ID })
      );

      await expect(
        adminContestService.overrideStatus(mockPool, TEST_CONTEST_ID, 'cancelled', TEST_ADMIN_ID, 'Test')
      ).rejects.toThrow("Admin cannot transition from 'draft' to 'cancelled'");
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
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'open', organizer_id: TEST_ORGANIZER_ID })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'cancelled' })
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
      expect(auditInserts[0].params[2]).toBe('status_override');
      expect(auditInserts[0].params[3]).toBe('Test reason');
    });
  });

  describe('deleteContest', () => {
    const openContest = {
      id: TEST_CONTEST_ID,
      status: 'open',
      entry_fee_cents: 0,
      organizer_id: TEST_ORGANIZER_ID
    };

    it('should delete a free contest and return refund manifest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(openContest)
      );
      mockPool.setQueryResponse(
        /SELECT user_id FROM contest_participants/,
        mockQueryResponses.multiple([
          { user_id: TEST_ORGANIZER_ID },
          { user_id: '22222222-2222-2222-2222-222222222222' }
        ])
      );
      mockPool.setQueryResponse(
        /DELETE FROM contest_participants/,
        mockQueryResponses.deleted(2)
      );
      mockPool.setQueryResponse(
        /DELETE FROM contest_instances/,
        mockQueryResponses.deleted(1)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.deleteContest(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Cleanup', false
      );

      expect(result.contest_id).toBe(TEST_CONTEST_ID);
      expect(result.entry_fee_cents).toBe(0);
      expect(result.participants).toHaveLength(2);
    });

    it('should cascade delete participants then contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(openContest)
      );
      mockPool.setQueryResponse(
        /SELECT user_id FROM contest_participants/,
        mockQueryResponses.multiple([{ user_id: TEST_ORGANIZER_ID }])
      );
      mockPool.setQueryResponse(
        /DELETE FROM contest_participants/,
        mockQueryResponses.deleted(1)
      );
      mockPool.setQueryResponse(
        /DELETE FROM contest_instances/,
        mockQueryResponses.deleted(1)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      await adminContestService.deleteContest(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Test', false
      );

      const queries = mockPool.getQueryHistory();
      const deleteParticipants = queries.findIndex(q => /DELETE FROM contest_participants/.test(q.sql));
      const deleteInstances = queries.findIndex(q => /DELETE FROM contest_instances/.test(q.sql));
      expect(deleteParticipants).toBeLessThan(deleteInstances);
    });

    it('should reject deletion of settled contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openContest, status: 'settled' })
      );

      await expect(
        adminContestService.deleteContest(mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Test', false)
      ).rejects.toThrow('Cannot delete a settled contest');
    });

    it('should reject paid contest deletion without confirm_refund', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openContest, entry_fee_cents: 2500 })
      );

      await expect(
        adminContestService.deleteContest(mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Test', false)
      ).rejects.toThrow('Paid contest deletion requires confirm_refund = true');
    });

    it('should allow paid contest deletion with confirm_refund = true', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openContest, entry_fee_cents: 2500 })
      );
      mockPool.setQueryResponse(
        /SELECT user_id FROM contest_participants/,
        mockQueryResponses.multiple([{ user_id: TEST_ORGANIZER_ID }])
      );
      mockPool.setQueryResponse(
        /DELETE FROM contest_participants/,
        mockQueryResponses.deleted(1)
      );
      mockPool.setQueryResponse(
        /DELETE FROM contest_instances/,
        mockQueryResponses.deleted(1)
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.deleteContest(
        mockPool, TEST_CONTEST_ID, TEST_ADMIN_ID, 'Refund required', true
      );
      expect(result.entry_fee_cents).toBe(2500);
      expect(result.participants).toContain(TEST_ORGANIZER_ID);
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

    it('should write audit record with refund manifest as payload', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(openContest)
      );
      mockPool.setQueryResponse(
        /SELECT user_id FROM contest_participants/,
        mockQueryResponses.multiple([{ user_id: TEST_ORGANIZER_ID }])
      );
      mockPool.setQueryResponse(
        /DELETE FROM contest_participants/,
        mockQueryResponses.deleted(1)
      );
      mockPool.setQueryResponse(
        /DELETE FROM contest_instances/,
        mockQueryResponses.deleted(1)
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
      expect(auditInserts[0].params[2]).toBe('delete_contest');
      expect(auditInserts[0].params[3]).toBe('Audit test');

      const payload = JSON.parse(auditInserts[0].params[4]);
      expect(payload.contest_id).toBe(TEST_CONTEST_ID);
      expect(payload.entry_fee_cents).toBe(0);
      expect(payload.participants).toContain(TEST_ORGANIZER_ID);
    });
  });

  describe('updateLockTime', () => {
    it('should update lock_time and write audit', async () => {
      const newLockTime = '2026-02-10T18:00:00Z';

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, status: 'open', lock_time: null })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET lock_time/,
        mockQueryResponses.single({ id: TEST_CONTEST_ID, lock_time: newLockTime })
      );
      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await adminContestService.updateLockTime(
        mockPool, TEST_CONTEST_ID, newLockTime, TEST_ADMIN_ID, 'Adjusting lock time'
      );

      expect(result.lock_time).toBe(newLockTime);

      const queries = mockPool.getQueryHistory();
      const auditInserts = queries.filter(q => /INSERT INTO admin_contest_audit/.test(q.sql));
      expect(auditInserts).toHaveLength(1);
      expect(auditInserts[0].params[2]).toBe('update_lock_time');
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
