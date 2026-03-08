/**
 * Financial Reconciliation Routes
 */

const express = require('express');
const {
  getPlatformReconciliation,
  getFinancialInvariants,
  repairOrphanWithdrawal,
  convertIllegalEntryFeeToRefund,
  rollbackNonAtomicJoin,
  freezeNegativeWallet
} = require('../../services/financialReconciliationService');

const router = express.Router();

// Note: This router is mounted at /api/admin/financial-reconciliation
// The global requireAdmin middleware is already applied at /api/admin level
// No additional auth middleware needed here

// GET /api/admin/financial-reconciliation
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const reconciliation = await getPlatformReconciliation(pool);
    const invariants = await getFinancialInvariants(pool);

    return res.status(200).json({
      reconciliation,
      invariants,
      status: {
        is_coherent: reconciliation.status.is_coherent,
        health_status: invariants.health_status,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Financial Reconciliation] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/financial-repair
router.post('/repair', async (req, res) => {
  try {
    const { action, params, reason } = req.body;
    const pool = req.app.locals.pool;
    const adminId = req.user.id;

    if (!action) return res.status(400).json({ error: 'action is required' });
    if (!reason || reason.trim() === '') return res.status(400).json({ error: 'reason is required' });
    if (!params) return res.status(400).json({ error: 'params is required' });

    const validActions = [
      'repair_orphan_withdrawal',
      'convert_entry_fee_credit',
      'rollback_non_atomic_join',
      'freeze_wallet',
      'repair_illegal_refund'
    ];

    if (!validActions.includes(action)) {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    let result;

    switch (action) {
      case 'repair_orphan_withdrawal':
        if (!params.ledger_id) return res.status(400).json({ error: 'params.ledger_id is required' });
        result = await repairOrphanWithdrawal(pool, params.ledger_id, adminId, reason);
        break;

      case 'convert_entry_fee_credit':
        if (!params.ledger_id) return res.status(400).json({ error: 'params.ledger_id is required' });
        result = await convertIllegalEntryFeeToRefund(pool, params.ledger_id, adminId, reason);
        break;

      case 'rollback_non_atomic_join':
        if (!params.ledger_id) return res.status(400).json({ error: 'params.ledger_id is required' });
        result = await rollbackNonAtomicJoin(pool, params.ledger_id, adminId, reason);
        break;

      case 'freeze_wallet':
        if (!params.user_id) return res.status(400).json({ error: 'params.user_id is required' });
        result = await freezeNegativeWallet(pool, params.user_id, adminId, reason);
        break;

      case 'repair_illegal_refund':
        if (!params.ledger_id) return res.status(400).json({ error: 'params.ledger_id is required' });
        result = await rollbackNonAtomicJoin(pool, params.ledger_id, adminId, reason);
        break;

      default:
        return res.status(400).json({ error: `Unhandled action: ${action}` });
    }

    if (!result.success) {
      return res.status(400).json({ error: result.error, action, params });
    }

    return res.status(200).json({
      success: true,
      action,
      repair_id: result.adjustment_ledger_id || result.reversal_ledger_id || result.freeze_id,
      audit_log_id: result.audit_log_id,
      message: result.message
    });
  } catch (error) {
    console.error('[Financial Reconciliation] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/financial-audit-log
router.get('/audit-log', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { action_type, from_date, to_date } = req.query;
    const client = await pool.connect();

    try {
      let query = 'SELECT * FROM financial_admin_actions WHERE 1=1';
      const params = [];
      let paramIndex = 1;

      if (action_type) {
        query += ` AND action_type = $${paramIndex}`;
        params.push(action_type);
        paramIndex++;
      }

      if (from_date) {
        query += ` AND created_at >= $${paramIndex}`;
        params.push(from_date);
        paramIndex++;
      }

      if (to_date) {
        query += ` AND created_at <= $${paramIndex}`;
        params.push(to_date);
        paramIndex++;
      }

      query += ' ORDER BY created_at DESC';
      const result = await client.query(query, params);

      const entries = result.rows.map(row => ({
        id: row.id,
        admin_id: row.admin_id,
        action_type: row.action_type,
        amount_cents: row.amount_cents,
        reason: row.reason,
        status: row.status,
        reference_id: row.reference_id,
        details: row.details ? JSON.parse(row.details) : {},
        created_at: row.created_at.toISOString()
      }));

      return res.status(200).json({
        entries,
        count: entries.length,
        filters: { action_type: action_type || null, from_date: from_date || null, to_date: to_date || null }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[Financial Reconciliation] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
