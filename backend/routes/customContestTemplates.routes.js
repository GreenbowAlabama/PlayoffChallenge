/**
 * Custom Contest Templates Admin Routes
 *
 * Admin-only endpoints for managing contest templates.
 * All routes are protected by requireAdmin middleware (applied at /api/admin level).
 *
 * Endpoints:
 * - GET /api/admin/custom-contests/templates - List all templates (active and inactive)
 * - POST /api/admin/custom-contests/templates - Create a new template
 * - DELETE /api/admin/custom-contests/templates/:id - Soft deactivate a template
 */

const express = require('express');
const router = express.Router();
const templateService = require('../services/customContestTemplateService');

/**
 * Validate UUID format
 * @param {string} id - ID to validate
 * @returns {boolean} True if valid UUID
 */
function isValidUUID(id) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * GET /
 * List all templates (including inactive) for admin management
 */
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const templates = await templateService.listAllTemplates(pool);
    res.json(templates);
  } catch (error) {
    console.error('[Template Routes] Error listing templates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /
 * Create a new contest template
 * Returns 201 on success, 400 on validation failure
 */
router.post('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const template = await templateService.createTemplate(pool, req.body);
    res.status(201).json(template);
  } catch (error) {
    console.error('[Template Routes] Error creating template:', error);

    // Validation errors return 400
    if (error.message.includes('is required') ||
        error.message.includes('must be') ||
        error.message.includes('must have') ||
        error.message.includes('must define')) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /:id
 * Soft deactivate a template (set is_active = false)
 * Returns 200 on success, 404 if not found, 409 if template is in use
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid template ID format' });
    }

    const pool = req.app.locals.pool;
    const template = await templateService.deactivateTemplate(pool, id);
    res.json(template);
  } catch (error) {
    console.error('[Template Routes] Error deactivating template:', error);

    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: error.message });
    }

    if (error.code === 'ALREADY_INACTIVE') {
      return res.status(400).json({ error: error.message });
    }

    if (error.code === 'IN_USE') {
      return res.status(409).json({ error: error.message });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
