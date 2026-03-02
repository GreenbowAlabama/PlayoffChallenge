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
const { createContractValidator } = require('../middleware/contractValidator');

/**
 * Async route handler wrapper
 * Ensures unhandled Promise rejections propagate to Express error handler
 * instead of causing silent socket hang-ups
 */
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

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

  if (authHeader && authHeader.startsWith('Bearer ')) {
    userId = authHeader.substring(7, authHeader.length);
  } else if (xUserId) {
    userId = xUserId;
  } else {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!isValidUUID(userId)) {
    return res.status(400).json({ error: 'Invalid user ID format' });
  }

  if (process.env.LOG_AUTH_DEBUG === 'true') {
    console.log('[Auth]', req.method, req.originalUrl, 'user_id_suffix:', userId.slice(-6));
  }
  req.userId = userId;
  next();
}

/**
 * Middleware to optionally extract user ID from request.
 * Used for endpoints that work with or without authentication.
 *
 * Sets req.userId = null if Authorization header is missing.
 * Returns 400 if Authorization header is present but invalid UUID.
 * Preserves existing behavior if valid.
 */
function extractOptionalUserId(req, res, next) {
  let userId;
  const authHeader = req.headers['authorization'];
  const xUserId = req.headers['x-user-id'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    userId = authHeader.substring(7, authHeader.length);
  } else if (xUserId) {
    userId = xUserId;
  } else {
    // No auth header present - allow request with null userId
    req.userId = null;
    return next();
  }

  // Auth header was present but needs validation
  if (!isValidUUID(userId)) {
    return res.status(400).json({ error: 'Invalid user ID format' });
  }

  req.userId = userId;
  next();
}

// ============================================
// TEMPLATE ENDPOINTS (Public)
// ============================================

/**
 * GET /api/custom-contests/templates
 * Returns all active contest templates.
 * Enforces OpenAPI contract: all templates must have non-empty allowed_payout_structures.
 *
 * Response: Array of templates
 * - Each template contains allowed_payout_structures: [{ type: string, max_winners?: integer }]
 */
router.get('/templates', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const templates = await customContestService.listActiveTemplates(pool);
    res.json(templates);
  } catch (err) {
    // Contract violations are logged and cause 500 (backend is authoritative)
    if (err.message.includes('[Template Contract Violation]')) {
      console.error('[Custom Contest Templates] Contract violation:', err.message);
      return res.status(500).json({
        error: 'Template contract violation',
        reason: err.message
      });
    }

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
router.post('/', extractUserId, async (req, res) => {
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

    // Validate lock_time: undefined -> null, null passes, string must be valid ISO date
    let finalLockTime = lock_time === undefined ? null : lock_time;
    if (finalLockTime !== null && typeof finalLockTime === 'string') {
      const lockTimeDate = new Date(finalLockTime);
      if (isNaN(lockTimeDate.getTime())) {
        return res.status(400).json({ error: 'Invalid lock_time format. Must be valid ISO date string or null.' });
      }
    }

    const instance = await customContestService.createContestInstance(pool, organizerId, {
      template_id,
      contest_name: contest_name ?? contestName,
      max_entries: max_entries ?? maxEntries,
      entry_fee_cents,
      payout_structure,
      start_time,
      lock_time: finalLockTime,
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
 * Normalize contest response for API contract compliance.
 * Converts Date objects to ISO strings and normalizes numeric types.
 *
 * @param {Array} contests - Array of contest objects from service
 * @returns {Array} Normalized contests matching contract schema
 */
function normalizeContestResponse(data) {
  const normalizeOne = (contest) => ({
    ...contest,
    // Normalize all timestamp fields: Date -> ISO 8601 string
    // Per OpenAPI contract: all datetime fields must be ISO 8601 string format
    start_time: contest.start_time ? new Date(contest.start_time).toISOString() : null,
    end_time: contest.end_time ? new Date(contest.end_time).toISOString() : null,
    lock_time: contest.lock_time ? new Date(contest.lock_time).toISOString() : null,
    created_at: new Date(contest.created_at).toISOString(),
    updated_at: new Date(contest.updated_at).toISOString(),
    // Normalize payout_table: ensure all timestamp and numeric fields are correct types
    payout_table: (contest.payout_table || []).map(row => ({
      place: row.place,
      rank_min: row.rank_min,
      rank_max: row.rank_max,
      amount: row.amount,
      currency: row.currency,
      payout_percent: row.payout_percent
    }))
  });

  // Handle both single objects and arrays
  return Array.isArray(data) ? data.map(normalizeOne) : normalizeOne(data);
}

/**
 * GET /api/custom-contests/available
 * List publicly joinable contests (authenticated).
 *
 * Returns SCHEDULED contests that are published and publicly shareable.
 * This is infrastructure plumbing for MVP contest discovery.
 *
 * Requires authentication: returns 401 if no valid user ID provided.
 * Includes user_has_entered field to show if user has already joined.
 * Does NOT filter by capacity or enrollment (all SCHEDULED + joinable).
 *
 * Response: Array of contest instances
 */
router.get('/available', extractUserId, createContractValidator('ContestListResponse'), asyncHandler(async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId;

  const instances = await customContestService.getAvailableContestInstances(pool, userId);

  console.log('[AVAILABLE]', {
    userIdPresent: !!userId,
    contestCount: instances.length
  });
  console.log('🔴 EXEC_MARKER:ROUTE_BEFORE_JSON id:organizer_name pairs:', instances.map(inst => ({ id: inst.id, organizer_name: inst.organizer_name })));

  // Normalize response to ensure Date objects are ISO strings and numeric types are correct
  const normalizedInstances = normalizeContestResponse(instances);

  res.json(normalizedInstances);
}));

/**
 * GET /api/custom-contests
 * List all contest instances for the authenticated organizer.
 *
 * Response: Array of contest instances
 */
router.get('/', extractUserId, createContractValidator('ContestListResponse'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const organizerId = req.userId;
    const requestingUserId = req.userId;

    const instances = await customContestService.getContestInstancesForOrganizer(pool, organizerId, requestingUserId);

    // Normalize response to ensure Date objects are ISO strings and numeric types are correct
    const normalizedInstances = normalizeContestResponse(instances);

    res.json(normalizedInstances);
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
router.get('/:id', extractUserId, createContractValidator('ContestDetailResponse'), async (req, res) => {
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

    // Normalize response to ensure Date objects are ISO strings and numeric types are correct
    const normalizedInstance = normalizeContestResponse(instance);

    res.json(normalizedInstance);
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
router.post('/:id/publish', extractUserId, async (req, res) => {
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
router.patch('/:id/status', extractUserId, async (req, res) => {
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
router.post('/:id/join', extractUserId, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { id } = req.params;
    const userId = req.userId;
    const { token } = req.body || {};

    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid contest ID format' });
    }

    const result = await customContestService.joinContest(pool, id, userId, token);

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

/**
 * GET /api/custom-contests/:id/leaderboard
 * Get contest leaderboard with standings and state information.
 * Requires authentication.
 *
 * Response: Leaderboard data with standings, column schema, and pagination
 */
router.get('/:id/leaderboard', extractUserId, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { id } = req.params;

    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid contest ID format' });
    }

    const leaderboard = await customContestService.getContestLeaderboard(pool, id);
    res.json(leaderboard);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: 'Contest not found' });
    }
    console.error('[Custom Contest] Error fetching leaderboard:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

/**
 * DELETE /api/custom-contests/:id
 * Delete a contest instance.
 * Only the organizer can delete.
 * Can only delete SCHEDULED contests with entry_count <= 1 or CANCELLED contests (idempotent).
 *
 * Response:
 * - 200: Updated contest instance with status = CANCELLED
 * - 403: { error_code: 'CONTEST_DELETE_NOT_ALLOWED', reason: '...' }
 * - 404: { error_code: 'CONTEST_NOT_FOUND', reason: '...' }
 */
router.delete('/:id', extractUserId, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { id } = req.params;

    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid contest ID format' });
    }

    const contest = await customContestService.deleteContestInstance(
      pool,
      id,
      req.userId
    );

    return res.status(200).json(contest);
  } catch (err) {
    if (err.code === 'CONTEST_NOT_FOUND') {
      return res.status(404).json({ error_code: err.code, reason: err.message });
    }
    if (err.code === 'CONTEST_DELETE_NOT_ALLOWED') {
      return res.status(403).json({ error_code: err.code, reason: err.message });
    }
    console.error('[Custom Contest] Error deleting contest:', err);
    res.status(500).json({ error: 'Failed to delete contest' });
  }
});

/**
 * DELETE /api/custom-contests/:id/entry
 * Unjoin a contest (remove user participation).
 * Requires authentication.
 * User can only unjoin SCHEDULED contests before lock_time.
 * Idempotent: returns 200 if user has no entry.
 *
 * Response:
 * - 200: Updated contest instance
 * - 403: { error_code: 'CONTEST_UNJOIN_NOT_ALLOWED', reason: '...' }
 * - 404: { error_code: 'CONTEST_NOT_FOUND', reason: '...' }
 */
router.delete('/:id/entry', extractUserId, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { id } = req.params;

    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid contest ID format' });
    }

    const contest = await customContestService.unJoinContest(
      pool,
      id,
      req.userId
    );

    return res.status(200).json(contest);
  } catch (err) {
    if (err.code === 'CONTEST_NOT_FOUND') {
      return res.status(404).json({ error_code: err.code, reason: err.message });
    }
    if (err.code === 'CONTEST_UNJOIN_NOT_ALLOWED') {
      return res.status(403).json({ error_code: err.code, reason: err.message });
    }
    console.error('[Custom Contest] Error unjoining contest:', err);
    res.status(500).json({ error: 'Failed to unjoin contest' });
  }
});

module.exports = router;
