const { v4: uuidv4 } = require('uuid');

async function getPlatformReconciliation(pool, options = {}) {
  const client = await pool.connect();
  try {
    const walletLiabilityResult = await client.query(`
      SELECT COALESCE(
        SUM(CASE
          WHEN direction = 'CREDIT' THEN amount_cents
          WHEN direction = 'DEBIT' THEN -amount_cents
        END),
        0
      ) as wallet_liability_cents
      FROM ledger
      WHERE reference_type = 'WALLET' AND reference_id IS NOT NULL
    `);
    const walletLiabilityCents = parseInt(walletLiabilityResult.rows[0].wallet_liability_cents, 10);

    const contestPoolsResult = await client.query(`
      SELECT COALESCE(
        SUM(CASE
          WHEN entry_type = 'ENTRY_FEE' AND direction = 'DEBIT' THEN amount_cents
          WHEN entry_type = 'ENTRY_FEE_REFUND' AND direction = 'CREDIT' THEN -amount_cents
          WHEN entry_type = 'PAYOUT_COMPLETED' AND direction = 'CREDIT' THEN -amount_cents
        END),
        0
      ) as contest_pools_cents
      FROM ledger
      WHERE reference_type = 'CONTEST'
    `);
    const contestPoolsCents = parseInt(contestPoolsResult.rows[0].contest_pools_cents, 10);

    const depositsResult = await client.query(`
      SELECT COALESCE(SUM(amount_cents), 0) as deposits_cents
      FROM ledger
      WHERE entry_type = 'WALLET_DEPOSIT' AND direction = 'CREDIT'
    `);
    const depositsCents = parseInt(depositsResult.rows[0].deposits_cents, 10);

    const withdrawalsResult = await client.query(`
      SELECT COALESCE(SUM(l.amount_cents), 0) as withdrawals_cents
      FROM ledger l
      WHERE l.entry_type = 'WALLET_WITHDRAWAL'
        AND l.direction = 'DEBIT'
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = l.reference_id)
    `);
    const withdrawalsCents = parseInt(withdrawalsResult.rows[0].withdrawals_cents, 10);

    const expectedFunding = walletLiabilityCents + contestPoolsCents;
    const actualFunding = depositsCents - withdrawalsCents;
    const differenceCents = expectedFunding - actualFunding;

    return {
      wallet_liability_cents: walletLiabilityCents,
      contest_pools_cents: contestPoolsCents,
      deposits_cents: depositsCents,
      withdrawals_cents: withdrawalsCents,
      difference_cents: differenceCents,
      status: {
        is_coherent: differenceCents === 0
      }
    };
  } finally {
    client.release();
  }
}

async function getFinancialInvariants(pool) {
  const client = await pool.connect();
  try {
    const negativeWalletsResult = await client.query(`
      SELECT COUNT(*) as count
      FROM (
        SELECT reference_id, SUM(
          CASE
            WHEN direction = 'CREDIT' THEN amount_cents
            WHEN direction = 'DEBIT' THEN -amount_cents
          END
        ) as balance_cents
        FROM ledger
        WHERE reference_type = 'WALLET'
        GROUP BY reference_id
        HAVING SUM(
          CASE
            WHEN direction = 'CREDIT' THEN amount_cents
            WHEN direction = 'DEBIT' THEN -amount_cents
          END
        ) < 0
      ) t
    `);
    const negativeWallets = parseInt(negativeWalletsResult.rows[0].count, 10);

    const illegalEntryFeeCreditResult = await client.query(`
      SELECT COUNT(*) as count FROM ledger WHERE entry_type = 'ENTRY_FEE' AND direction = 'CREDIT'
    `);
    const illegalEntryFeeDirection = parseInt(illegalEntryFeeCreditResult.rows[0].count, 10);

    const illegalRefundDebitResult = await client.query(`
      SELECT COUNT(*) as count FROM ledger WHERE entry_type = 'ENTRY_FEE_REFUND' AND direction = 'DEBIT'
    `);
    const illegalRefundDirection = parseInt(illegalRefundDebitResult.rows[0].count, 10);

    const orphanedEntriesResult = await client.query(`
      SELECT COUNT(*) as count FROM ledger WHERE reference_id IS NULL
    `);
    const orphanedLedgerEntries = parseInt(orphanedEntriesResult.rows[0].count, 10);

    const orphanedWithdrawalsResult = await client.query(`
      SELECT COUNT(*) as count
      FROM ledger l
      WHERE l.entry_type = 'WALLET_WITHDRAWAL'
        AND l.reference_type = 'WALLET'
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = l.reference_id)
    `);
    const orphanedWithdrawals = parseInt(orphanedWithdrawalsResult.rows[0].count, 10);

    const negativePoolsResult = await client.query(`
      SELECT COUNT(*) as count
      FROM (
        SELECT reference_id, SUM(
          CASE
            WHEN entry_type = 'ENTRY_FEE' AND direction = 'DEBIT' THEN amount_cents
            WHEN entry_type = 'ENTRY_FEE_REFUND' AND direction = 'CREDIT' THEN -amount_cents
            WHEN entry_type = 'PAYOUT_COMPLETED' AND direction = 'CREDIT' THEN -amount_cents
          END
        ) as pool_balance_cents
        FROM ledger
        WHERE reference_type = 'CONTEST'
        GROUP BY reference_id
        HAVING SUM(
          CASE
            WHEN entry_type = 'ENTRY_FEE' AND direction = 'DEBIT' THEN amount_cents
            WHEN entry_type = 'ENTRY_FEE_REFUND' AND direction = 'CREDIT' THEN -amount_cents
            WHEN entry_type = 'PAYOUT_COMPLETED' AND direction = 'CREDIT' THEN -amount_cents
          END
        ) < 0
      ) t
    `);
    const negativeContestPools = parseInt(negativePoolsResult.rows[0].count, 10);

    const issueCount = negativeWallets + illegalEntryFeeDirection + illegalRefundDirection +
                       orphanedLedgerEntries + orphanedWithdrawals + negativeContestPools;
    let healthStatus = 'PASS';
    if (issueCount > 0) healthStatus = 'WARN';
    if (issueCount > 5) healthStatus = 'FAIL';

    return {
      negative_wallets: negativeWallets,
      illegal_entry_fee_direction: illegalEntryFeeDirection,
      illegal_refund_direction: illegalRefundDirection,
      orphaned_ledger_entries: orphanedLedgerEntries,
      orphaned_withdrawals: orphanedWithdrawals,
      negative_contest_pools: negativeContestPools,
      health_status: healthStatus
    };
  } finally {
    client.release();
  }
}

async function repairOrphanWithdrawal(pool, ledgerId, adminId, reason) {
  if (!ledgerId) return { success: false, error: 'ledger_id is required' };
  if (!adminId) return { success: false, error: 'admin_id is required' };
  if (!reason || reason.trim() === '') return { success: false, error: 'reason is required and cannot be empty' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ledgerResult = await client.query('SELECT id, amount_cents FROM ledger WHERE id = $1', [ledgerId]);
    if (ledgerResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Ledger entry not found' };
    }

    const ledger = ledgerResult.rows[0];
    const existingRepairResult = await client.query(
      `SELECT id FROM ledger WHERE entry_type = 'ADJUSTMENT' AND direction = 'CREDIT' AND amount_cents = $1 AND reference_id IS NULL`,
      [ledger.amount_cents]
    );

    let adjustmentLedgerId;
    if (existingRepairResult.rowCount > 0) {
      adjustmentLedgerId = existingRepairResult.rows[0].id;
    } else {
      adjustmentLedgerId = uuidv4();
      await client.query(
        `INSERT INTO ledger (id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at)
         VALUES ($1, 'ADJUSTMENT', 'CREDIT', $2, 'WALLET', NULL, $3, NOW())`,
        [adjustmentLedgerId, ledger.amount_cents, `orphan_reversal:${ledgerId}`]
      );
    }

    const auditLogId = await logFinancialAction(client, adminId, 'repair_orphan_withdrawal', reason);

    await client.query('COMMIT');
    return {
      success: true,
      adjustment_ledger_id: adjustmentLedgerId,
      audit_log_id: auditLogId,
      message: `Orphaned withdrawal reversed with ADJUSTMENT CREDIT ${ledger.amount_cents} cents`
    };
  } catch (error) {
    await client.query('ROLLBACK');
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

async function convertIllegalEntryFeeToRefund(pool, ledgerId, adminId, reason) {
  if (!ledgerId || !adminId || !reason || reason.trim() === '') {
    return { success: false, error: 'ledger_id, admin_id, and reason are required' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ledgerResult = await client.query(
      'SELECT id, amount_cents, reference_id FROM ledger WHERE id = $1 AND entry_type = $2 AND direction = $3',
      [ledgerId, 'ENTRY_FEE', 'CREDIT']
    );

    if (ledgerResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Illegal ENTRY_FEE CREDIT entry not found' };
    }

    const ledger = ledgerResult.rows[0];
    const existingRefundResult = await client.query(
      `SELECT id FROM ledger WHERE entry_type = 'ENTRY_FEE_REFUND' AND direction = 'CREDIT' AND amount_cents = $1`,
      [ledger.amount_cents]
    );

    let refundLedgerId, adjustmentLedgerId;
    if (existingRefundResult.rowCount > 0) {
      refundLedgerId = existingRefundResult.rows[0].id;
      const existingAdjustmentResult = await client.query(
        `SELECT id FROM ledger WHERE entry_type = 'ADJUSTMENT' AND direction = 'DEBIT' AND amount_cents = $1`,
        [ledger.amount_cents]
      );
      adjustmentLedgerId = existingAdjustmentResult.rowCount > 0 ? existingAdjustmentResult.rows[0].id : uuidv4();
    } else {
      refundLedgerId = uuidv4();
      await client.query(
        `INSERT INTO ledger (id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at)
         VALUES ($1, 'ENTRY_FEE_REFUND', 'CREDIT', $2, 'CONTEST', $3, $4, NOW())`,
        [refundLedgerId, ledger.amount_cents, ledger.reference_id, `refund_conversion:${ledgerId}`]
      );

      adjustmentLedgerId = uuidv4();
      await client.query(
        `INSERT INTO ledger (id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at)
         VALUES ($1, 'ADJUSTMENT', 'DEBIT', $2, 'CONTEST', $3, $4, NOW())`,
        [adjustmentLedgerId, ledger.amount_cents, ledger.reference_id, `refund_offset:${ledgerId}`]
      );
    }

    const auditLogId = await logFinancialAction(client, adminId, 'convert_entry_fee_credit', reason);
    await client.query('COMMIT');

    return {
      success: true,
      refund_ledger_id: refundLedgerId,
      adjustment_ledger_id: adjustmentLedgerId,
      audit_log_id: auditLogId,
      message: `Illegal ENTRY_FEE CREDIT converted`
    };
  } catch (error) {
    await client.query('ROLLBACK');
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

async function rollbackNonAtomicJoin(pool, ledgerId, adminId, reason) {
  if (!ledgerId || !adminId || !reason || reason.trim() === '') {
    return { success: false, error: 'ledger_id, admin_id, and reason are required' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ledgerResult = await client.query(
      'SELECT id, amount_cents, reference_id FROM ledger WHERE id = $1 AND entry_type = $2 AND direction = $3',
      [ledgerId, 'ENTRY_FEE', 'DEBIT']
    );

    if (ledgerResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'ENTRY_FEE DEBIT entry not found' };
    }

    const ledger = ledgerResult.rows[0];
    const participantResult = await client.query('SELECT id FROM contest_participants WHERE entry_fee_ledger_id = $1', [ledgerId]);

    if (participantResult.rowCount > 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Participant exists for this entry; cannot rollback' };
    }

    const existingReversalResult = await client.query(
      `SELECT id FROM ledger WHERE entry_type = 'ADJUSTMENT' AND direction = 'CREDIT' AND amount_cents = $1 AND idempotency_key LIKE $2`,
      [ledger.amount_cents, `rollback:${ledgerId}%`]
    );

    let reversalLedgerId;
    if (existingReversalResult.rowCount > 0) {
      reversalLedgerId = existingReversalResult.rows[0].id;
    } else {
      reversalLedgerId = uuidv4();
      await client.query(
        `INSERT INTO ledger (id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at)
         VALUES ($1, 'ADJUSTMENT', 'CREDIT', $2, 'CONTEST', $3, $4, NOW())`,
        [reversalLedgerId, ledger.amount_cents, ledger.reference_id, `rollback:${ledgerId}`]
      );
    }

    const auditLogId = await logFinancialAction(client, adminId, 'rollback_non_atomic_join', reason);
    await client.query('COMMIT');

    return {
      success: true,
      reversal_ledger_id: reversalLedgerId,
      audit_log_id: auditLogId,
      message: `Non-atomic join rolled back`
    };
  } catch (error) {
    await client.query('ROLLBACK');
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

async function freezeNegativeWallet(pool, userId, adminId, reason) {
  if (!userId || !adminId || !reason || reason.trim() === '') {
    return { success: false, error: 'userId, admin_id, and reason are required' };
  }

  const client = await pool.connect();
  try {
    const freezeId = uuidv4();
    const result = await client.query(
      `INSERT INTO user_wallet_freeze (id, user_id, frozen_at, admin_id) VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (user_id) DO NOTHING RETURNING id`,
      [freezeId, userId, adminId]
    );

    if (result.rowCount === 0) {
      return { success: false, error: 'User wallet is already frozen or does not exist' };
    }

    const actualFreezeId = result.rows[0].id;
    const auditResult = await client.query(
      `INSERT INTO financial_admin_actions (id, admin_id, action_type, amount_cents, reason, status, reference_id, created_at)
       VALUES ($1, $2, 'freeze_wallet', 0, $3, 'completed', $4, NOW())
       RETURNING id`,
      [uuidv4(), adminId, reason, userId]
    );

    return {
      success: true,
      freeze_id: actualFreezeId,
      audit_log_id: auditResult.rows[0].id,
      message: `User wallet frozen`
    };
  } catch (error) {
    if (error.code === '23505') {
      return { success: false, error: 'User wallet is already frozen' };
    }
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

async function logFinancialAction(poolOrClient, adminId, actionType, reason, details = {}) {
  if (!adminId) return { success: false, error: 'admin_id is required', log_id: null, timestamp: null };
  if (!actionType) return { success: false, error: 'action_type is required', log_id: null, timestamp: null };
  if (!reason || reason.trim() === '') return { success: false, error: 'reason is required and cannot be empty', log_id: null, timestamp: null };

  const isClient = poolOrClient.query && !poolOrClient.connect;
  const client = isClient ? poolOrClient : await poolOrClient.connect();

  try {
    const logId = uuidv4();
    const now = new Date();

    await client.query(
      `INSERT INTO financial_admin_actions (id, admin_id, action_type, amount_cents, reason, status, reference_id, details, created_at)
       VALUES ($1, $2, $3, 0, $4, 'completed', NULL, $5, $6)`,
      [logId, adminId, actionType, reason, JSON.stringify(details), now]
    );

    return { success: true, log_id: logId, timestamp: now.toISOString() };
  } catch (error) {
    return { success: false, error: error.message, log_id: null, timestamp: null };
  } finally {
    if (!isClient) client.release();
  }
}

module.exports = {
  getPlatformReconciliation,
  getFinancialInvariants,
  repairOrphanWithdrawal,
  convertIllegalEntryFeeToRefund,
  rollbackNonAtomicJoin,
  freezeNegativeWallet,
  logFinancialAction
};
