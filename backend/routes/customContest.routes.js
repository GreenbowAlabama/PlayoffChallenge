/**
 * Custom Contest Routes
 *
 * All endpoints under /api/custom-contests/*
 * Handles contest instance lifecycle for user-created contests.
 *
 * Routes:
 * - GET  /api/custom-contests/templates     - List available templates
 * - POST /api/custom-contests               - Create a new contest instance
 * - GET  /api/custom-contests               - List my contest instances
 * - GET  /api/custom-contests/:id           - Get a specific contest instance
 * - POST /api/custom-contests/:id/publish   - Publish a contest (draft -> open)
 * - GET  /api/custom-contests/join/:token   - Resolve a join token
 */

const express = require('express');
const router = express.Router();

const customContestService = require('../services/customContestService');

/**
 * Middleware to extract user ID from request.
 * In production, this would come from authentication middleware.
 * For now, expects X-User-Id header.
 */
function extractUserId(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.userId = userId;
  next();
}

/**
 * Validate UUID format
 */
function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// ============================================
// TEMPLATE ENDPOINTS (Public)
// ============================================

/**
 * GET /api/custom-contests/templates
 * Returns all active contest templates.
 *
 * Response: Array of templates
 */
router.get('/templates', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const templates = await customContestService.listActiveTemplates(pool);
    res.json(templates);
  } catch (err) {
    console.error('[Custom Contest] Error fetching templates:', err);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// ============================================
// JOIN TOKEN RESOLUTION (Pre-auth)
// ============================================

/**
 * GET /api/custom-contests/join/:token
 * Resolves a join token and returns contest information.
 * Does not require authentication.
 *
 * Response:
 * - valid: boolean
 * - contest?: Object (if valid)
 * - reason?: string (if invalid)
 * - environment_mismatch?: boolean
 */
router.get('/join/:token', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        valid: false,
        reason: 'Token is required'
      });
    }

    const result = await customContestService.resolveJoinToken(pool, token);
    res.json(result);
  } catch (err) {
    console.error('[Custom Contest] Error resolving join token:', err);
    res.status(500).json({
      valid: false,
      reason: 'Failed to resolve token'
    });
  }
});

// ============================================
// PROTECTED ENDPOINTS (Require Auth)
// ============================================

// Apply auth middleware to remaining routes
router.use(extractUserId);

/**
 * POST /api/custom-contests
 * Create a new contest instance.
 *
 * Body:
 * - template_id: UUID of the template to use
 * - entry_fee_cents: Entry fee in cents
 * - payout_structure: Payout structure object
 * - start_time?: Optional start time
 * - lock_time?: Optional lock time
 * - settlement_time?: Optional settlement time
 *
 * Response: Created contest instance
 */
router.post('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const organizerId = req.userId;

    const {
      template_id,
      entry_fee_cents,
      payout_structure,
      start_time,
      lock_time,
      settlement_time
    } = req.body;

    // Validate template_id format
    if (template_id && !isValidUUID(template_id)) {
      return res.status(400).json({ error: 'Invalid template_id format' });
    }

    const instance = await customContestService.createContestInstance(pool, organizerId, {
      template_id,
      entry_fee_cents,
      payout_structure,
      start_time,
      lock_time,
      settlement_time
    });

    res.status(201).json(instance);
  } catch (err) {
    console.error('[Custom Contest] Error creating contest:', err);

    // Return validation errors with 400
    if (err.message.includes('required') ||
        err.message.includes('must be') ||
        err.message.includes('not found') ||
        err.message.includes('must match')) {
      return res.status(400).json({ error: err.message });
    }

    res.status(500).json({ error: 'Failed to create contest' });
  }
});

/**
 * GET /api/custom-contests
 * List all contest instances for the authenticated organizer.
 *
 * Response: Array of contest instances
 */
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const organizerId = req.userId;

    const instances = await customContestService.getContestInstancesForOrganizer(pool, organizerId);
    res.json(instances);
  } catch (err) {
    console.error('[Custom Contest] Error fetching contests:', err);
    res.status(500).json({ error: 'Failed to fetch contests' });
  }
});

/**
 * GET /api/custom-contests/:id
 * Get a specific contest instance by ID.
 *
 * Response: Contest instance with template info
 */
router.get('/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { id } = req.params;

    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid contest ID format' });
    }

    const instance = await customContestService.getContestInstance(pool, id);

    if (!instance) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    res.json(instance);
  } catch (err) {
    console.error('[Custom Contest] Error fetching contest:', err);
    res.status(500).json({ error: 'Failed to fetch contest' });
  }
});

/**
 * POST /api/custom-contests/:id/publish
 * Publish a contest (transition from draft to open).
 * Only the organizer can publish.
 *
 * Response: Updated contest instance
 */
router.post('/:id/publish', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { id } = req.params;
    const organizerId = req.userId;

    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid contest ID format' });
    }

    const instance = await customContestService.publishContestInstance(pool, id, organizerId);
    res.json(instance);
  } catch (err) {
    console.error('[Custom Contest] Error publishing contest:', err);

    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Only the organizer') || err.message.includes('Cannot transition')) {
      return res.status(403).json({ error: err.message });
    }

    res.status(500).json({ error: 'Failed to publish contest' });
  }
});

/**
 * PATCH /api/custom-contests/:id/status
 * Update contest status.
 * Only the organizer can update status.
 *
 * Body:
 * - status: New status value
 *
 * Response: Updated contest instance
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { id } = req.params;
    const organizerId = req.userId;
    const { status } = req.body;

    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid contest ID format' });
    }

    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    const instance = await customContestService.updateContestInstanceStatus(
      pool, id, organizerId, status
    );
    res.json(instance);
  } catch (err) {
    console.error('[Custom Contest] Error updating contest status:', err);

    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Only the organizer') || err.message.includes('Cannot transition')) {
      return res.status(403).json({ error: err.message });
    }
    if (err.message.includes('Invalid status')) {
      return res.status(400).json({ error: err.message });
    }

    res.status(500).json({ error: 'Failed to update contest status' });
  }
});

module.exports = router;
