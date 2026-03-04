/**
 * Admin Contest Intervention Tests
 *
 * Tests for:
 * A) Contest cancellation refund behavior
 * B) Admin removal of user from contest
 *
 * Integration tests using real database transactions.
 */

const { v4: uuidv4 } = require('uuid');
const { pool } = require('../../server');
const adminContestService = require('../../services/adminContestService');

let TEST_ADMIN_ID;

// Set up test admin ID before running tests
beforeAll(async () => {
  const adminRes = await pool.query(`SELECT id FROM users LIMIT 1`);
  TEST_ADMIN_ID = adminRes.rows[0].id;
});

async function setupContest(entryFeeCents = 1000, status = 'SCHEDULED') {
  // Get an existing template
  const template = await pool.query(
    `SELECT id FROM contest_templates WHERE is_active = true LIMIT 1`
  );
  const templateId = template.rows[0].id;

  // Get an existing user as organizer
  const userRes = await pool.query(
    `SELECT id FROM users LIMIT 1`
  );
  const organizer = userRes.rows[0].id;

  const contest = await pool.query(
    `INSERT INTO contest_instances (
      template_id, organizer_id, entry_fee_cents, payout_structure, status,
      contest_name, max_entries, lock_time
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      templateId,
      organizer,
      entryFeeCents,
      JSON.stringify({ type: 'even_split', max_winners: 2 }),
      status,
      'Test Contest',
      10,
      new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
    ]
  );

  return {
    contestId: contest.rows[0].id,
    organizerId: organizer,
    templateId,
    contest: contest.rows[0]
  };
}

async function addParticipant(contestId, userId) {
  // First ensure the user exists
  const userCheck = await pool.query(
    `SELECT id FROM users WHERE id = $1`,
    [userId]
  );

  if (userCheck.rows.length === 0) {
    // Create the user if it doesn't exist
    await pool.query(
      `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [userId, `User ${userId.slice(0, 8)}`, `user.${userId.slice(0, 8)}@test.local`]
    );
  }

  return pool.query(
    `INSERT INTO contest_participants (contest_instance_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [contestId, userId]
  );
}

async function getLedgerEntries(userId, contestId) {
  return pool.query(
    `SELECT entry_type, direction, amount_cents, contest_instance_id, idempotency_key
     FROM ledger
     WHERE user_id = $1 AND contest_instance_id = $2
     ORDER BY created_at DESC`,
    [userId, contestId]
  );
}

async function getAuditEntries(contestId) {
  return pool.query(
    `SELECT action, from_status, to_status, admin_user_id, reason, payload::text as payload
     FROM admin_contest_audit
     WHERE contest_instance_id = $1
     ORDER BY created_at DESC`,
    [contestId]
  );
}

async function getParticipantCount(contestId) {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM contest_participants WHERE contest_instance_id = $1`,
    [contestId]
  );
  return parseInt(result.rows[0].count, 10);
}

describe('Admin Contest Intervention', () => {
  // ===================================================================
  // PART A — Contest Cancellation Refund Coverage
  // ===================================================================

  describe('PART A: Cancel Contest Refunds (GAP-13)', () => {
    it('should refund all participants when cancelling a SCHEDULED contest', async () => {
      const { contestId, contest } = await setupContest(2000, 'SCHEDULED');
      const user1 = uuidv4();
      const user2 = uuidv4();

      // Add two participants
      await addParticipant(contestId, user1);
      await addParticipant(contestId, user2);

      // Cancel the contest
      const result = await adminContestService.cancelContestInstance(
        pool,
        contestId,
        TEST_ADMIN_ID,
        'Test cancellation with refunds'
      );

      // Verify contest status
      expect(result.success).toBe(true);
      expect(result.contest.status).toBe('CANCELLED');

      // Verify refund ledger entries for both users
      const user1Ledger = await getLedgerEntries(user1, contestId);
      const user2Ledger = await getLedgerEntries(user2, contestId);

      expect(user1Ledger.rows).toContainEqual(
        expect.objectContaining({
          entry_type: 'ENTRY_FEE_REFUND',
          direction: 'CREDIT',
          amount_cents: 2000,
          contest_instance_id: contestId
        })
      );

      expect(user2Ledger.rows).toContainEqual(
        expect.objectContaining({
          entry_type: 'ENTRY_FEE_REFUND',
          direction: 'CREDIT',
          amount_cents: 2000,
          contest_instance_id: contestId
        })
      );
    });

    it('should create ENTRY_FEE_REFUND ledger entries with CREDIT direction', async () => {
      const { contestId } = await setupContest(1500, 'SCHEDULED');
      const userId = uuidv4();

      await addParticipant(contestId, userId);
      await adminContestService.cancelContestInstance(
        pool,
        contestId,
        TEST_ADMIN_ID,
        'Verify refund entry_type and direction'
      );

      const ledger = await getLedgerEntries(userId, contestId);
      const refundEntry = ledger.rows.find(r => r.entry_type === 'ENTRY_FEE_REFUND');

      expect(refundEntry).toBeDefined();
      expect(refundEntry.direction).toBe('CREDIT');
      expect(refundEntry.amount_cents).toBe(1500);
    });

    it('should enforce refund idempotency (same user not refunded twice)', async () => {
      const { contestId } = await setupContest(1000, 'SCHEDULED');
      const userId = uuidv4();

      await addParticipant(contestId, userId);

      // Cancel once
      await adminContestService.cancelContestInstance(
        pool,
        contestId,
        TEST_ADMIN_ID,
        'First cancellation'
      );

      // Manually reset contest to SCHEDULED for second cancel attempt
      await pool.query(
        `UPDATE contest_instances SET status = $1 WHERE id = $2`,
        ['SCHEDULED', contestId]
      );

      // Cancel again (idempotency test)
      const result2 = await adminContestService.cancelContestInstance(
        pool,
        contestId,
        TEST_ADMIN_ID,
        'Second cancellation (idempotent)'
      );

      expect(result2.success).toBe(true);

      // Verify only ONE refund entry exists for this user
      const ledger = await getLedgerEntries(userId, contestId);
      const refundEntries = ledger.rows.filter(r => r.entry_type === 'ENTRY_FEE_REFUND');

      expect(refundEntries).toHaveLength(1);
      expect(refundEntries[0].amount_cents).toBe(1000);
    });

    it('should transition contest status to CANCELLED', async () => {
      const { contestId } = await setupContest(500, 'SCHEDULED');

      const result = await adminContestService.cancelContestInstance(
        pool,
        contestId,
        TEST_ADMIN_ID,
        'Status transition test'
      );

      expect(result.contest.status).toBe('CANCELLED');

      // Verify in database
      const check = await pool.query(
        `SELECT status FROM contest_instances WHERE id = $1`,
        [contestId]
      );
      expect(check.rows[0].status).toBe('CANCELLED');
    });

    it('should write audit entry to admin_contest_audit', async () => {
      const { contestId } = await setupContest(1000, 'SCHEDULED');

      await adminContestService.cancelContestInstance(
        pool,
        contestId,
        TEST_ADMIN_ID,
        'Audit entry test'
      );

      const audit = await getAuditEntries(contestId);
      expect(audit.rows.length).toBeGreaterThan(0);

      const cancelAudit = audit.rows.find(a => a.action === 'cancel_contest');
      expect(cancelAudit).toBeDefined();
      expect(cancelAudit.from_status).toBe('SCHEDULED');
      expect(cancelAudit.to_status).toBe('CANCELLED');
      expect(cancelAudit.admin_user_id).toBe(TEST_ADMIN_ID);
      expect(cancelAudit.reason).toBe('Audit entry test');
    });

    it('should refund LOCKED contests on cancellation', async () => {
      const { contestId } = await setupContest(2500, 'LOCKED');
      const userId = uuidv4();

      await addParticipant(contestId, userId);
      await adminContestService.cancelContestInstance(
        pool,
        contestId,
        TEST_ADMIN_ID,
        'Locked contest cancellation'
      );

      const ledger = await getLedgerEntries(userId, contestId);
      expect(ledger.rows).toContainEqual(
        expect.objectContaining({
          entry_type: 'ENTRY_FEE_REFUND',
          direction: 'CREDIT',
          amount_cents: 2500
        })
      );
    });
  });

  // ===================================================================
  // PART B — Admin Remove User From Contest
  // ===================================================================

  describe('PART B: Admin Remove User From Contest', () => {
    it('should remove user and refund successfully from SCHEDULED contest', async () => {
      const { contestId } = await setupContest(1500, 'SCHEDULED');
      const userId = uuidv4();

      await addParticipant(contestId, userId);

      // Verify participant exists
      let count = await getParticipantCount(contestId);
      expect(count).toBe(1);

      // Remove user
      const result = await adminContestService.adminRemoveUserFromContest(
        pool,
        contestId,
        userId,
        TEST_ADMIN_ID,
        'User removal test'
      );

      expect(result.success).toBe(true);
      expect(result.noop).toBe(false);
      expect(result.refunded).toBe(true);

      // Verify participant removed
      count = await getParticipantCount(contestId);
      expect(count).toBe(0);

      // Verify refund ledger entry created
      const ledger = await getLedgerEntries(userId, contestId);
      expect(ledger.rows).toContainEqual(
        expect.objectContaining({
          entry_type: 'ENTRY_FEE_REFUND',
          direction: 'CREDIT',
          amount_cents: 1500,
          contest_instance_id: contestId
        })
      );
    });

    it('should be idempotent (user not in contest)', async () => {
      const { contestId } = await setupContest(1000, 'SCHEDULED');
      const userId = uuidv4();

      // Remove non-participant (should not error)
      const result = await adminContestService.adminRemoveUserFromContest(
        pool,
        contestId,
        userId,
        TEST_ADMIN_ID,
        'Remove non-participant'
      );

      expect(result.success).toBe(true);
      expect(result.noop).toBe(true);
      expect(result.refunded).toBe(false);

      // Verify no ledger entry created
      const ledger = await getLedgerEntries(userId, contestId);
      expect(ledger.rows.filter(r => r.entry_type === 'ENTRY_FEE_REFUND')).toHaveLength(0);
    });

    it('should reject removal from LIVE contest', async () => {
      const { contestId } = await setupContest(1000, 'LIVE');
      const userId = uuidv4();

      await addParticipant(contestId, userId);

      await expect(
        adminContestService.adminRemoveUserFromContest(
          pool,
          contestId,
          userId,
          TEST_ADMIN_ID,
          'Attempt to remove from LIVE'
        )
      ).rejects.toThrow(/LIVE.*not allowed|cannot remove/i);
    });

    it('should reject removal from COMPLETE contest', async () => {
      const { contestId } = await setupContest(1000, 'COMPLETE');
      const userId = uuidv4();

      await expect(
        adminContestService.adminRemoveUserFromContest(
          pool,
          contestId,
          userId,
          TEST_ADMIN_ID,
          'Attempt to remove from COMPLETE'
        )
      ).rejects.toThrow(/COMPLETE.*not allowed|cannot remove/i);
    });

    it('should reject removal from CANCELLED contest', async () => {
      const { contestId } = await setupContest(1000, 'CANCELLED');
      const userId = uuidv4();

      await expect(
        adminContestService.adminRemoveUserFromContest(
          pool,
          contestId,
          userId,
          TEST_ADMIN_ID,
          'Attempt to remove from CANCELLED'
        )
      ).rejects.toThrow(/CANCELLED.*not allowed|cannot remove/i);
    });

    it('should reject removal from ERROR contest', async () => {
      const { contestId } = await setupContest(1000, 'ERROR');
      const userId = uuidv4();

      await expect(
        adminContestService.adminRemoveUserFromContest(
          pool,
          contestId,
          userId,
          TEST_ADMIN_ID,
          'Attempt to remove from ERROR'
        )
      ).rejects.toThrow(/ERROR.*not allowed|cannot remove/i);
    });

    it('should leave other participants unaffected', async () => {
      const { contestId } = await setupContest(2000, 'SCHEDULED');
      const user1 = uuidv4();
      const user2 = uuidv4();

      await addParticipant(contestId, user1);
      await addParticipant(contestId, user2);

      // Remove only user1
      await adminContestService.adminRemoveUserFromContest(
        pool,
        contestId,
        user1,
        TEST_ADMIN_ID,
        'Remove one user'
      );

      // Verify user2 still participant
      const result = await pool.query(
        `SELECT user_id FROM contest_participants WHERE contest_instance_id = $1 AND user_id = $2`,
        [contestId, user2]
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].user_id).toBe(user2);

      // Verify user1 refunded but user2 not refunded
      const user1Ledger = await getLedgerEntries(user1, contestId);
      const user2Ledger = await getLedgerEntries(user2, contestId);

      expect(user1Ledger.rows.filter(r => r.entry_type === 'ENTRY_FEE_REFUND')).toHaveLength(1);
      expect(user2Ledger.rows.filter(r => r.entry_type === 'ENTRY_FEE_REFUND')).toHaveLength(0);
    });

    it('should ensure ledger entries are append-only', async () => {
      const { contestId } = await setupContest(1000, 'SCHEDULED');
      const userId = uuidv4();

      await addParticipant(contestId, userId);

      // Remove user
      await adminContestService.adminRemoveUserFromContest(
        pool,
        contestId,
        userId,
        TEST_ADMIN_ID,
        'Append-only test'
      );

      const ledger = await getLedgerEntries(userId, contestId);
      const refundEntries = ledger.rows.filter(r => r.entry_type === 'ENTRY_FEE_REFUND');

      expect(refundEntries).toHaveLength(1);

      // Verify via query (ledger table has no UPDATE or DELETE)
      const directQuery = await pool.query(
        `SELECT * FROM ledger WHERE user_id = $1 AND entry_type = 'ENTRY_FEE_REFUND'`,
        [userId]
      );
      expect(directQuery.rows).toHaveLength(1);
    });

    it('should create audit entry with correct payload', async () => {
      const { contestId } = await setupContest(1500, 'SCHEDULED');
      const userId = uuidv4();

      await addParticipant(contestId, userId);
      await adminContestService.adminRemoveUserFromContest(
        pool,
        contestId,
        userId,
        TEST_ADMIN_ID,
        'Audit entry creation test'
      );

      const audit = await getAuditEntries(contestId);
      const removeAudit = audit.rows.find(a => a.action === 'remove_user_from_contest');

      expect(removeAudit).toBeDefined();
      expect(removeAudit.admin_user_id).toBe(TEST_ADMIN_ID);
      expect(removeAudit.reason).toBe('Audit entry creation test');

      const payload = JSON.parse(removeAudit.payload);
      expect(payload.user_id).toBe(userId);
      expect(payload.refunded).toBe(true);
    });

    it('should allow removal from LOCKED contest', async () => {
      const { contestId } = await setupContest(2000, 'LOCKED');
      const userId = uuidv4();

      await addParticipant(contestId, userId);

      const result = await adminContestService.adminRemoveUserFromContest(
        pool,
        contestId,
        userId,
        TEST_ADMIN_ID,
        'Remove from LOCKED'
      );

      expect(result.success).toBe(true);
      expect(result.refunded).toBe(true);

      // Verify refund
      const ledger = await getLedgerEntries(userId, contestId);
      expect(ledger.rows).toContainEqual(
        expect.objectContaining({
          entry_type: 'ENTRY_FEE_REFUND',
          direction: 'CREDIT',
          amount_cents: 2000
        })
      );
    });

    it('should handle zero entry fee correctly', async () => {
      const { contestId } = await setupContest(0, 'SCHEDULED');
      const userId = uuidv4();

      await addParticipant(contestId, userId);

      const result = await adminContestService.adminRemoveUserFromContest(
        pool,
        contestId,
        userId,
        TEST_ADMIN_ID,
        'Zero fee removal'
      );

      expect(result.success).toBe(true);
      expect(result.noop).toBe(false);
      expect(result.refunded).toBe(false); // No refund for zero fee

      // Verify no ledger entry created (or zero amount)
      const ledger = await getLedgerEntries(userId, contestId);
      const refunds = ledger.rows.filter(r => r.entry_type === 'ENTRY_FEE_REFUND');
      expect(refunds).toHaveLength(0);
    });
  });
});
