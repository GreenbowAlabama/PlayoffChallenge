/**
 * Admin Discovery Routes
 *
 * Read-only visibility into what the discovery worker has discovered.
 * All endpoints under /api/admin/discovery/*
 * Protected by existing admin middleware (requireAdmin).
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/admin/discovery/recent-cycles
 * Returns recent discovery worker execution cycles.
 * Shows: when it ran, how many events found, templates created, instances created.
 */
router.get('/recent-cycles', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const limit = parseInt(req.query.limit || '20', 10);

    const result = await pool.query(
      `SELECT
        ct.id as template_id,
        ct.name as template_name,
        ct.provider_tournament_id,
        ct.season_year,
        ct.status as template_status,
        ct.created_at as template_created_at,
        COUNT(DISTINCT ci.id)::integer as instance_count,
        MAX(ci.created_at) as latest_instance_created_at
      FROM contest_templates ct
      LEFT JOIN contest_instances ci ON ci.template_id = ct.id AND ci.is_system_generated = true
      WHERE ct.is_system_generated = true
      GROUP BY ct.id
      ORDER BY ct.created_at DESC
      LIMIT $1`,
      [limit]
    );

    res.json({
      timestamp: new Date().toISOString(),
      count: result.rows.length,
      cycles: result.rows
    });
  } catch (err) {
    console.error('[Admin Discovery] Error fetching cycles:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/discovery/system-templates
 * Returns all system-generated templates (created by discovery worker).
 */
router.get('/system-templates', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const status = req.query.status; // Optional filter: SCHEDULED, COMPLETE, CANCELLED

    let query = `
      SELECT
        id,
        name,
        sport,
        template_type,
        provider_tournament_id,
        season_year,
        status,
        created_at,
        updated_at
      FROM contest_templates
      WHERE is_system_generated = true
    `;

    const params = [];

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, params);

    res.json({
      timestamp: new Date().toISOString(),
      count: result.rows.length,
      templates: result.rows
    });
  } catch (err) {
    console.error('[Admin Discovery] Error fetching system templates:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/discovery/system-instances
 * Returns all system-generated contest instances (auto-created from discovered tournaments).
 */
router.get('/system-instances', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const templateId = req.query.template_id; // Optional filter by template
    const status = req.query.status; // Optional filter by status

    let query = `
      SELECT
        ci.id,
        ci.contest_name,
        ci.status,
        ct.name as template_name,
        ct.provider_tournament_id,
        ci.provider_event_id,
        ci.entry_fee_cents,
        ci.max_entries,
        ci.current_entries,
        ci.lock_time,
        ci.tournament_start_time,
        ci.created_at
      FROM contest_instances ci
      JOIN contest_templates ct ON ct.id = ci.template_id
      WHERE 1=1
    `;

    const params = [];

    if (templateId) {
      query += ` AND ci.template_id = $${params.length + 1}`;
      params.push(templateId);
    }

    if (status) {
      query += ` AND ci.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY ci.created_at DESC LIMIT 50`;

    const result = await pool.query(query, params);

    res.json({
      timestamp: new Date().toISOString(),
      count: result.rows.length,
      instances: result.rows
    });
  } catch (err) {
    console.error('[Admin Discovery] Error fetching system instances:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/discovery/ingestion-events
 * Returns recent ingestion validation events (data received from ESPN/Sleeper).
 */
router.get('/ingestion-events', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const limit = parseInt(req.query.limit || '50', 10);

    const result = await pool.query(
      `SELECT
        ie.id,
        ie.contest_instance_id,
        ie.event_type,
        ie.provider,
        ie.validation_status,
        ie.received_at,
        ie.created_at,
        ci.contest_name,
        ct.name as template_name
      FROM ingestion_events ie
      LEFT JOIN contest_instances ci ON ci.id = ie.contest_instance_id
      LEFT JOIN contest_templates ct ON ct.id = ci.template_id
      ORDER BY ie.received_at DESC
      LIMIT $1`,
      [limit]
    );

    res.json({
      timestamp: new Date().toISOString(),
      count: result.rows.length,
      events: result.rows
    });
  } catch (err) {
    console.error('[Admin Discovery] Error fetching ingestion events:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
