/**
 * Admin Contest Template Routes
 *
 * Create and manage contest templates manually.
 * All endpoints under /api/admin/templates/*
 * Protected by existing admin middleware (requireAdmin).
 */

const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();

/**
 * GET /api/admin/templates/list
 * List all contest templates (system-generated and manually created).
 */
router.get('/list', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const isSystemOnly = req.query.system_only === 'true';

    let query = `
      SELECT
        id,
        name,
        sport,
        template_type,
        scoring_strategy_key,
        lock_strategy_key,
        settlement_strategy_key,
        default_entry_fee_cents,
        allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents,
        lineup_size,
        drop_lowest,
        is_system_generated,
        is_active,
        created_at
      FROM contest_templates
    `;

    const params = [];

    if (isSystemOnly) {
      query += ` WHERE is_system_generated = true`;
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, params);

    res.json({
      timestamp: new Date().toISOString(),
      count: result.rows.length,
      templates: result.rows
    });
  } catch (err) {
    console.error('[Admin Templates] Error listing templates:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/templates/create
 * Create a new manually-defined contest template.
 *
 * Request body:
 * {
 *   name: string,
 *   sport: string (e.g., 'PGA', 'NFL'),
 *   template_type: string (e.g., 'STROKE_PLAY'),
 *   scoring_strategy_key: string,
 *   lock_strategy_key: string,
 *   settlement_strategy_key: string,
 *   default_entry_fee_cents: number,
 *   allowed_entry_fee_min_cents: number,
 *   allowed_entry_fee_max_cents: number,
 *   allowed_payout_structures: array,
 *   lineup_size: number (optional),
 *   drop_lowest: boolean (optional),
 *   scoring_format: string (optional)
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   templateId: string | null,
 *   error: string | null
 * }
 */
router.post('/create', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const {
      name,
      sport,
      template_type,
      scoring_strategy_key,
      lock_strategy_key,
      settlement_strategy_key,
      default_entry_fee_cents,
      allowed_entry_fee_min_cents,
      allowed_entry_fee_max_cents,
      allowed_payout_structures,
      lineup_size,
      drop_lowest,
      scoring_format
    } = req.body;

    // Validation
    const errors = [];
    if (!name) errors.push('name is required');
    if (!sport) errors.push('sport is required');
    if (!template_type) errors.push('template_type is required');
    if (!scoring_strategy_key) errors.push('scoring_strategy_key is required');
    if (!lock_strategy_key) errors.push('lock_strategy_key is required');
    if (!settlement_strategy_key) errors.push('settlement_strategy_key is required');
    if (default_entry_fee_cents === undefined) errors.push('default_entry_fee_cents is required');
    if (allowed_entry_fee_min_cents === undefined) errors.push('allowed_entry_fee_min_cents is required');
    if (allowed_entry_fee_max_cents === undefined) errors.push('allowed_entry_fee_max_cents is required');
    if (!Array.isArray(allowed_payout_structures)) errors.push('allowed_payout_structures must be an array');

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: errors.join('; ')
      });
    }

    const templateId = randomUUID();

    const result = await pool.query(
      `INSERT INTO contest_templates (
        id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
        settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents, allowed_payout_structures, is_system_generated, is_active,
        lineup_size, drop_lowest, scoring_format
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id`,
      [
        templateId, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
        settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents, JSON.stringify(allowed_payout_structures), false, false,
        lineup_size || null, drop_lowest || false, scoring_format || null
      ]
    );

    const createdId = result.rows[0].id;

    console.log(
      `[Admin] Template created: ${createdId} (${sport}/${template_type}) by admin`
    );

    res.json({
      success: true,
      templateId: createdId
    });
  } catch (err) {
    console.error('[Admin Templates] Error creating template:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
