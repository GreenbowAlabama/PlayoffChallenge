/**
 * Admin Runbooks Routes
 *
 * Endpoints for recording runbook execution audit trail.
 * Ops team records runbook start, progress, and completion via these endpoints.
 * No direct database access required; all logging flows through API.
 *
 * All endpoints under /api/admin/runbooks/*
 * Protected by existing admin middleware (requireAdmin).
 */

const express = require('express');
const router = express.Router();

module.exports = function createAdminRunbooksRouter({ pool }) {
  /**
   * POST /api/admin/runbooks/start
   * Initiates a runbook execution record.
   * Returns execution_id for subsequent progress updates.
   */
  router.post('/start', async (req, res) => {
    try {
      const {
        runbook_name,
        runbook_version,
        executed_by,
        system_state_before
      } = req.body || {};

      if (!runbook_name || !runbook_version || !executed_by) {
        return res.status(400).json({ error: 'missing_required_fields' });
      }

      const result = await pool.query(
        `
        INSERT INTO runbook_executions (
          runbook_name,
          runbook_version,
          executed_by,
          status,
          execution_phase,
          phase_step,
          start_time,
          system_state_before
        )
        VALUES ($1, $2, $3, 'in_progress', 'DIAGNOSIS', 1, NOW(), $4)
        RETURNING id
        `,
        [runbook_name, runbook_version, executed_by, system_state_before || null]
      );

      res.json({
        timestamp: new Date().toISOString(),
        execution_id: result.rows[0].id
      });
    } catch (err) {
      console.error('[admin:runbooks:start] error', err);
      res.status(500).json({ error: 'runbook_start_failed' });
    }
  });

  /**
   * POST /api/admin/runbooks/complete
   * Completes a runbook execution record.
   * Updates status, end time, duration, and final system state.
   */
  router.post('/complete', async (req, res) => {
    try {
      const {
        execution_id,
        status,
        result_json,
        error_reason,
        system_state_after
      } = req.body || {};

      if (!execution_id || !status) {
        return res.status(400).json({ error: 'missing_required_fields' });
      }

      if (!['completed', 'failed', 'partial'].includes(status)) {
        return res.status(400).json({ error: 'invalid_status' });
      }

      const update = await pool.query(
        `
        UPDATE runbook_executions
        SET
          status = $2,
          end_time = NOW(),
          duration_seconds = EXTRACT(EPOCH FROM (NOW() - start_time))::INTEGER,
          execution_phase = 'COMPLETION',
          phase_step = 9,
          result_json = $3,
          error_reason = $4,
          system_state_after = $5
        WHERE id = $1
        RETURNING id
        `,
        [
          execution_id,
          status,
          result_json || null,
          error_reason || null,
          system_state_after || null
        ]
      );

      if (update.rowCount === 0) {
        return res.status(404).json({ error: 'execution_id_not_found' });
      }

      res.json({
        timestamp: new Date().toISOString(),
        success: true
      });
    } catch (err) {
      console.error('[admin:runbooks:complete] error', err);
      res.status(500).json({ error: 'runbook_complete_failed' });
    }
  });

  return router;
};
