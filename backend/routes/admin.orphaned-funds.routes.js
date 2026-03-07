/**
 * Admin Orphaned Funds Routes
 *
 * All endpoints under /api/admin/orphaned-funds/*
 * Protected by existing admin middleware (requireAdmin).
 */

const express = require('express');
const router = express.Router();
const orphanedFundsService = require('../services/orphanedFundsService');

/**
 * GET /api/admin/orphaned-funds/summary
 * Get summary of all contests with stranded funds
 */
router.get('/summary', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const contests = await orphanedFundsService.getOrphanedFundsSummary(pool);

    const totalAffectedUsers = contests.reduce(
      (sum, c) => sum + c.affected_user_count,
      0
    );
    const totalStrandedCents = contests.reduce(
      (sum, c) => sum + c.total_stranded_cents,
      0
    );

    res.json({
      contests_with_stranded_funds: contests,
      total_affected_users: totalAffectedUsers,
      total_stranded_cents: totalStrandedCents,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Orphaned Funds] Error getting summary:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/orphaned-funds/:contestId
 * Get affected users for a specific contest
 */
router.get('/:contestId', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { contestId } = req.params;

    const result = await orphanedFundsService.getContestAffectedUsers(
      pool,
      contestId
    );

    res.json(result);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('[Orphaned Funds] Error getting affected users:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/orphaned-funds/:contestId/refund-all
 * Refund all affected users in a contest
 * Body: { reason: string }
 */
router.post('/:contestId/refund-all', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { contestId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const result = await orphanedFundsService.refundContest(
      pool,
      contestId,
      req.adminUser.id,
      reason
    );

    res.json(result);
  } catch (err) {
    console.error('[Orphaned Funds] Error refunding contest:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/case-notes
 * Add a case note to an issue
 * Body: {
 *   issue_type: 'NEGATIVE_POOL' | 'STRANDED_FUNDS',
 *   issue_contest_id: UUID,
 *   issue_user_id: UUID (optional, for STRANDED_FUNDS),
 *   note_text: string
 * }
 */
router.post('/case-notes', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { issue_type, issue_contest_id, issue_user_id, note_text } = req.body;
    const csa_user_id = req.adminUser.id;

    if (!issue_type || !issue_contest_id || !note_text) {
      return res.status(400).json({ error: 'issue_type, issue_contest_id, and note_text are required' });
    }

    if (!['NEGATIVE_POOL', 'STRANDED_FUNDS'].includes(issue_type)) {
      return res.status(400).json({ error: 'Invalid issue_type' });
    }

    const result = await pool.query(
      `INSERT INTO case_notes (issue_type, issue_contest_id, issue_user_id, csa_user_id, note_text)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, issue_type, issue_contest_id, issue_user_id, csa_user_id, note_text, created_at, updated_at, resolved_at`,
      [issue_type, issue_contest_id, issue_user_id || null, csa_user_id, note_text]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Case Notes] Error adding note:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/case-notes/:issueType/:contestId
 * Get all case notes for an issue
 * Query params: issue_user_id (optional, for STRANDED_FUNDS)
 */
router.get('/case-notes/:issueType/:contestId', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { issueType, contestId } = req.params;
    const { issue_user_id } = req.query;

    let query = `
      SELECT cn.id, cn.issue_type, cn.issue_contest_id, cn.issue_user_id, cn.csa_user_id, cn.note_text, cn.created_at, cn.updated_at, cn.resolved_at,
             u.username as csa_username
      FROM case_notes cn
      LEFT JOIN users u ON cn.csa_user_id = u.id
      WHERE cn.issue_type = $1 AND cn.issue_contest_id = $2
    `;
    const params = [issueType, contestId];

    if (issue_user_id) {
      query += ` AND cn.issue_user_id = $3`;
      params.push(issue_user_id);
    }

    query += ` ORDER BY cn.created_at DESC`;

    const result = await pool.query(query, params);

    res.json({
      case_notes: result.rows,
      total: result.rows.length
    });
  } catch (err) {
    console.error('[Case Notes] Error getting notes:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/admin/case-notes/:caseNoteId
 * Mark case note as resolved or update resolved_at
 * Body: { resolved: boolean }
 */
router.patch('/case-notes/:caseNoteId', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { caseNoteId } = req.params;
    const { resolved } = req.body;

    const resolvedAt = resolved ? new Date().toISOString() : null;

    const result = await pool.query(
      `UPDATE case_notes
       SET resolved_at = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, issue_type, issue_contest_id, issue_user_id, csa_user_id, note_text, created_at, updated_at, resolved_at`,
      [resolvedAt, caseNoteId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Case note not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Case Notes] Error updating note:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
