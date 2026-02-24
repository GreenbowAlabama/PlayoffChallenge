/**
 * PGA ESPN Ingestion Adapter (Stub)
 *
 * Stub implementation for PGA Tour (Masters) ingestion via ESPN.
 * Provides template-level validation.
 * Remaining methods (getWorkUnits, ingestWorkUnit, etc.) not yet implemented.
 */

/**
 * Validate PGA template configuration
 * Called by contestTemplateService before template persistence.
 * @param {Object} input - Template input
 * @throws {Error} If validation fails
 */
function validateConfig(input) {
  // eventId validation
  if (!input.eventId || typeof input.eventId !== 'string' || input.eventId.trim() === '') {
    throw new Error('INVALID_PGA_TEMPLATE: eventId is required for pga_espn and must be a non-empty string');
  }

  // roster_size validation
  if (!Number.isInteger(input.roster_size) || input.roster_size < 1) {
    throw new Error('INVALID_PGA_TEMPLATE: roster_size is required for pga_espn and must be an integer >= 1');
  }

  // cut_after_round validation
  if (!Number.isInteger(input.cut_after_round) || input.cut_after_round < 1) {
    throw new Error('INVALID_PGA_TEMPLATE: cut_after_round is required for pga_espn and must be an integer >= 1');
  }

  // drop_lowest validation
  if (typeof input.drop_lowest !== 'boolean') {
    throw new Error('INVALID_PGA_TEMPLATE: drop_lowest is required for pga_espn and must be a boolean');
  }

  // payout_structure validation (using allowed_payout_structures field)
  if (!Array.isArray(input.allowed_payout_structures) || input.allowed_payout_structures.length === 0) {
    throw new Error('INVALID_PGA_TEMPLATE: payout_structure is required for pga_espn and must be a non-empty array');
  }
}

async function getWorkUnits(_ctx) {
  throw new Error("Ingestion adapter 'pga_espn' is not yet implemented");
}

function computeIngestionKey(_contestInstanceId, _unit) {
  throw new Error("Ingestion adapter 'pga_espn' is not yet implemented");
}

async function ingestWorkUnit(_ctx, _unit) {
  throw new Error("Ingestion adapter 'pga_espn' is not yet implemented");
}

async function upsertScores(_ctx, _normalizedScores) {
  throw new Error("Ingestion adapter 'pga_espn' is not yet implemented");
}

module.exports = {
  validateConfig,
  getWorkUnits,
  computeIngestionKey,
  ingestWorkUnit,
  upsertScores
};
