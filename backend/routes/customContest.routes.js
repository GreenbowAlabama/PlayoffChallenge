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
const { logJoinSuccess, logJoinFailure, logContestCreated, logContestPublished } = require('../services/joinAuditService');
const { createCombinedJoinRateLimiter } = require('../middleware/joinRateLimit');

/**
 * Validate UUID format
 */
function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Middleware to extract user ID from request.
 * In production, this would come from authentication middleware.
 * For now, expects X-User-Id header.
 *
 * Validates UUID format to prevent invalid IDs from reaching database queries.
 */
function extractUserId(req, res, next) {
  let userId;
  const authHeader = req.headers['authorization'];
  const xUserId = req.headers['x-user-id'];

  // Detailed logging for debugging
  console.log('[Auth] ENTER extractUserId middleware');
  console.log('[Auth] req.method:', req.method);
  console.log('[Auth] req.url:', req.originalUrl);
  console.log('[Auth] Authorization Header:', authHeader);
  console.log('[Auth] X-User-Id Header:', xUserId);

  if (authHeader && authHeader.startsWith('Bearer ')) {
    userId = authHeader.substring(7, authHeader.length);
    console.log('[Auth] Extracted userId from Bearer token:', userId);
  } else if (xUserId) {
    userId = xUserId;
    console.log('[Auth] Extracted userId from X-User-Id header:', userId);
  } else {
    console.log('[Auth] No user ID found in headers.');
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!isValidUUID(userId)) {
    console.log('[Auth] Invalid UUID format for userId:', userId);
    return res.status(400).json({ error: 'Invalid user ID format' });
  }

  console.log('[Auth] Successfully validated userId:', userId);
  req.userId = userId;
  next();
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

// Create rate limiter for join endpoint
const joinRateLimiter = createCombinedJoinRateLimiter();

/**
 * GET /api/custom-contests/join/:token
 * Resolves a join token and returns contest information.
 * Does not require authentication.
 *
 * Rate limited to prevent token brute forcing.
 *
 * Response:
 * - valid: boolean
 * - contest?: Object (if valid)
 * - error_code?: string (structured error code if invalid)
 * - reason?: string (human-readable reason if invalid)
 * - environment_mismatch?: boolean
 */
router.get('/join/:token', joinRateLimiter, async (req, res) => {
  const { token } = req.params;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const joinSource = req.query.source || 'universal_link';
  const userId = req.headers['x-user-id'] || null; // Optional if provided

  try {
    const pool = req.app.locals.pool;

    if (!token) {
      logJoinFailure({
        token: '',
        errorCode: customContestService.JOIN_ERROR_CODES.CONTEST_UNAVAILABLE,
        ipAddress,
        joinSource
      });
      return res.status(400).json({
        valid: false,
        error_code: customContestService.JOIN_ERROR_CODES.CONTEST_UNAVAILABLE,
        reason: 'Token is required'
      });
    }

    const result = await customContestService.resolveJoinToken(pool, token);

    // Log the attempt
    if (result.valid) {
      logJoinSuccess({
        token,
        contestId: result.contest.id,
        userId,
        ipAddress,
        joinSource
      });
    } else {
      logJoinFailure({
        token,
        errorCode: result.error_code,
        contestId: result.contest?.id || null,
        userId,
        ipAddress,
        joinSource,
        extra: result.environment_mismatch ? {
          token_environment: result.token_environment,
          current_environment: result.current_environment
        } : undefined
      });
    }

    res.json(result);
  } catch (err) {
    console.error('[Custom Contest] Error resolving join token:', err);
    logJoinFailure({
      token,
      errorCode: 'INTERNAL_ERROR',
      userId,
      ipAddress,
      joinSource,
      extra: { error: err.message }
    });
    res.status(500).json({
      valid: false,
      error_code: 'INTERNAL_ERROR',
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
      contest_name,
      contestName,
      max_entries,
      maxEntries,
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
      contest_name: contest_name ?? contestName,
      max_entries: max_entries ?? maxEntries,
      entry_fee_cents,
      payout_structure,
      start_time,
      lock_time,
      settlement_time
    });

    // Log contest creation (join_token is assigned at publish time)
    logContestCreated({
      contestId: instance.id,
      organizerId,
      templateId: template_id,
      token: null
    });

    res.status(201).json(instance);
  } catch (err) {
    // Template not found is a 404
    if (err.message.includes('Template not found')) {
      return res.status(404).json({ error: err.message });
    }

    // Return validation errors with 400
    if (err.message.includes('required') ||
        err.message.includes('must be') ||
        err.message.includes('must match')) {
      return res.status(400).json({ error: err.message });
    }

    // Unexpected error - log with stack trace
    console.error('[Custom Contest] Error creating contest:', err);
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
    const requestingUserId = req.userId;

    const instances = await customContestService.getContestInstancesForOrganizer(pool, organizerId, requestingUserId);
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
    const requestingUserId = req.userId;

    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid contest ID format' });
    }

    const instance = await customContestService.getContestInstance(pool, id, requestingUserId);

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

    // Log contest publish
    logContestPublished({
      contestId: instance.id,
      organizerId,
      token: instance.join_token
    });

    // Return the specific format expected by clients
    res.json({
      contestId: instance.id,
      joinToken: instance.join_token,
      joinURL: instance.join_url
    });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Only the organizer') || err.message.includes('Cannot transition') || err.message.includes('Cannot publish')) {
      return res.status(403).json({ error: err.message });
    }
    if (err.message.includes('was modified by another operation')) {
      return res.status(409).json({ error: err.message });
    }

    // Unexpected error - log with stack trace
    console.error('[Custom Contest] Error publishing contest:', err);
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
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Only the organizer') || err.message.includes('Cannot transition')) {
      return res.status(403).json({ error: err.message });
    }
    if (err.message.includes('Invalid status')) {
      return res.status(400).json({ error: err.message });
    }

    // Unexpected error - log with stack trace
    console.error('[Custom Contest] Error updating contest status:', err);
    res.status(500).json({ error: 'Failed to update contest status' });
  }
});

/**
 * POST /api/custom-contests/:id/join
 * Join a contest as a participant.
 * Requires authentication.
 *
 * Enforces:
 * - ALREADY_JOINED (DB unique constraint)
 * - CONTEST_FULL (capacity check)
 * - Contest must be open
 *
 * Response:
 * - 200: { joined: true, participant: { ... } }
 * - 404: { error_code: 'CONTEST_NOT_FOUND', reason: '...' }
 * - 409: { error_code: 'ALREADY_JOINED' | 'CONTEST_FULL' | 'CONTEST_LOCKED' | ... }
 */
router.post('/:id/join', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { id } = req.params;
    const userId = req.userId;

    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid contest ID format' });
    }

    const result = await customContestService.joinContest(pool, id, userId);

    if (result.joined) {
      return res.json(result);
    }

    // Map error codes to HTTP status
    const httpStatus = result.error_code === 'CONTEST_NOT_FOUND' ? 404 : 409;
    return res.status(httpStatus).json(result);
  } catch (err) {
    console.error('[Custom Contest] Error joining contest:', err);
    res.status(500).json({ error: 'Failed to join contest' });
  }
});

module.exports = router;
