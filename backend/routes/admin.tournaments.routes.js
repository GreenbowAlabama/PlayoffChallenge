/**
 * Admin Tournaments Routes
 *
 * Tournament discovery endpoint for auto-template creation.
 * Transport layer only — all business logic delegated to discoveryService.
 *
 * POST /api/admin/tournaments/discover
 *   - Validate admin authentication
 *   - Inject current time for determinism
 *   - Call discoverTournament service
 *   - Return service contract with exact statusCode
 */

const express = require('express');
const { discoverTournament } = require('../services/discovery/discoveryService');

const router = express.Router();

/**
 * POST /api/admin/tournaments/discover
 *
 * Discover tournament and create/update system template.
 *
 * Request body:
 * {
 *   provider_tournament_id: string,
 *   season_year: number,
 *   name: string,
 *   start_time: string (ISO 8601),
 *   end_time: string (ISO 8601),
 *   status: string (SCHEDULED | CANCELLED)
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   templateId: string | null,
 *   created: boolean,
 *   updated: boolean,
 *   error: string | null,
 *   errorCode: string | null,
 *   statusCode: number
 * }
 *
 * Status codes:
 *   201: Template created (success: true, created: true)
 *   200: Template found or updated (success: true, created: false)
 *   400: Validation error (success: false, statusCode: 400)
 *   500: System error (success: false, statusCode: 500)
 */
router.post('/discover', async (req, res) => {
  // ===== ADMIN AUTH VALIDATION =====
  // TODO: Add admin auth middleware
  // For now, admin check would go here

  const pool = req.app.locals.pool;
  const now = new Date();

  // ===== CALL SERVICE =====
  // Service handles all business logic:
  // - Input validation
  // - Existing template lookup
  // - Idempotency via unique constraint
  // - Metadata freeze check
  // - Transaction management
  const result = await discoverTournament(req.body, pool, now);

  // ===== RETURN EXACT SERVICE CONTRACT =====
  // Status code from service is authoritative
  // Do not transform, interpret, or branch
  res.status(result.statusCode).json({
    success: result.success,
    templateId: result.templateId,
    created: result.created,
    updated: result.updated,
    error: result.error,
    errorCode: result.errorCode
  });
});

module.exports = router;
