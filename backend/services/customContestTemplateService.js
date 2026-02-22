/**
 * Custom Contest Template Service
 *
 * Handles admin operations for contest templates (ops-owned).
 * Templates define the constraints for user-created contest instances.
 *
 * Key Rules:
 * - Templates are immutable once referenced by a contest instance
 * - Deactivation is soft (is_active = false)
 * - Entry fee ranges must be valid (min <= max, non-negative)
 * - Payout structures must be non-empty arrays
 */

const { listScoringStrategies } = require('./scoringRegistry');
const { listSettlementStrategies } = require('./settlementRegistry');
const { VALID_STRATEGIES: VALID_LOCK_STRATEGIES } = require('./lockStrategy');
const { getIngestionStrategy } = require('./ingestionRegistry');

/**
 * Valid strategy keys for templates
 * These correspond to backend strategy implementations
 */
const VALID_SCORING_STRATEGIES = listScoringStrategies();
const VALID_SETTLEMENT_STRATEGIES = listSettlementStrategies();
const VALID_SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'PGA'];

/**
 * List all active templates (for admin view)
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Array>} Array of active templates
 */
async function listActiveTemplates(pool) {
  const result = await pool.query(
    `SELECT * FROM contest_templates WHERE is_active = true ORDER BY name`
  );
  return result.rows;
}

/**
 * List all templates including inactive (admin only)
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Array>} Array of all templates
 */
async function listAllTemplates(pool) {
  const result = await pool.query(
    `SELECT * FROM contest_templates ORDER BY is_active DESC, name`
  );
  return result.rows;
}

/**
 * Get a template by ID (including inactive)
 * @param {Object} pool - Database connection pool
 * @param {string} templateId - UUID of the template
 * @returns {Promise<Object|null>} Template or null if not found
 */
async function getTemplateById(pool, templateId) {
  const result = await pool.query(
    `SELECT * FROM contest_templates WHERE id = $1`,
    [templateId]
  );
  return result.rows[0] || null;
}

/**
 * Check if a template is referenced by any contest instances
 * @param {Object} pool - Database connection pool
 * @param {string} templateId - UUID of the template
 * @returns {Promise<boolean>} True if template is in use
 */
async function isTemplateInUse(pool, templateId) {
  const result = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM contest_instances WHERE template_id = $1) AS in_use`,
    [templateId]
  );
  return result.rows[0].in_use;
}

/**
 * Validate template input for creation
 * @param {Object} input - Template input
 * @throws {Error} If validation fails
 */
function validateTemplateInput(input) {
  // Required fields
  if (!input.name || typeof input.name !== 'string' || input.name.trim() === '') {
    throw new Error('name is required and must be a non-empty string');
  }

  if (!input.sport || !VALID_SPORTS.includes(input.sport)) {
    throw new Error(`sport is required and must be one of: ${VALID_SPORTS.join(', ')}`);
  }

  if (!input.template_type || typeof input.template_type !== 'string' || input.template_type.trim() === '') {
    throw new Error('template_type is required and must be a non-empty string');
  }

  if (!input.scoring_strategy_key || !VALID_SCORING_STRATEGIES.includes(input.scoring_strategy_key)) {
    throw new Error(`scoring_strategy_key is required and must be one of: ${VALID_SCORING_STRATEGIES.join(', ')}`);
  }

  if (!input.lock_strategy_key || !VALID_LOCK_STRATEGIES.includes(input.lock_strategy_key)) {
    throw new Error(`lock_strategy_key is required and must be one of: ${VALID_LOCK_STRATEGIES.join(', ')}`);
  }

  if (!input.settlement_strategy_key || !VALID_SETTLEMENT_STRATEGIES.includes(input.settlement_strategy_key)) {
    throw new Error(`settlement_strategy_key is required and must be one of: ${VALID_SETTLEMENT_STRATEGIES.join(', ')}`);
  }

  // Entry fee validation
  if (!Number.isInteger(input.default_entry_fee_cents) || input.default_entry_fee_cents < 0) {
    throw new Error('default_entry_fee_cents is required and must be a non-negative integer');
  }

  if (!Number.isInteger(input.allowed_entry_fee_min_cents) || input.allowed_entry_fee_min_cents < 0) {
    throw new Error('allowed_entry_fee_min_cents is required and must be a non-negative integer');
  }

  if (!Number.isInteger(input.allowed_entry_fee_max_cents) || input.allowed_entry_fee_max_cents < 0) {
    throw new Error('allowed_entry_fee_max_cents is required and must be a non-negative integer');
  }

  if (input.allowed_entry_fee_min_cents > input.allowed_entry_fee_max_cents) {
    throw new Error('allowed_entry_fee_min_cents must be <= allowed_entry_fee_max_cents');
  }

  if (input.default_entry_fee_cents < input.allowed_entry_fee_min_cents ||
      input.default_entry_fee_cents > input.allowed_entry_fee_max_cents) {
    throw new Error('default_entry_fee_cents must be within the allowed range');
  }

  // Payout structures validation
  if (!Array.isArray(input.allowed_payout_structures) || input.allowed_payout_structures.length === 0) {
    throw new Error('allowed_payout_structures is required and must be a non-empty array');
  }

  // Validate each payout structure
  for (const structure of input.allowed_payout_structures) {
    if (!structure || typeof structure !== 'object') {
      throw new Error('Each payout structure must be an object');
    }
    // Basic validation: structure should have at least one payout key
    const keys = Object.keys(structure);
    if (keys.length === 0) {
      throw new Error('Each payout structure must define at least one payout');
    }
  }

  // Ingestion strategy validation (optional, if strategy is registered)
  if (input.ingestion_strategy_key) {
    let strategy = null;

    try {
      strategy = getIngestionStrategy(input.ingestion_strategy_key);
    } catch {
      strategy = null; // Unknown strategy → no-op
    }

    if (strategy?.validateConfig) {
      strategy.validateConfig(input);
    }
  }
}

/**
 * Create a new contest template
 * @param {Object} pool - Database connection pool
 * @param {Object} input - Template input
 * @returns {Promise<Object>} Created template
 */
async function createTemplate(pool, input) {
  // Validate input
  validateTemplateInput(input);

  const result = await pool.query(
    `INSERT INTO contest_templates (
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
      is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
    RETURNING *`,
    [
      input.name.trim(),
      input.sport,
      input.template_type.trim(),
      input.scoring_strategy_key,
      input.lock_strategy_key,
      input.settlement_strategy_key,
      input.default_entry_fee_cents,
      input.allowed_entry_fee_min_cents,
      input.allowed_entry_fee_max_cents,
      JSON.stringify(input.allowed_payout_structures)
    ]
  );

  return result.rows[0];
}

/**
 * Deactivate a template (soft delete)
 * Templates that are referenced by contest instances cannot be deactivated.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} templateId - UUID of the template
 * @returns {Promise<Object>} Updated template
 * @throws {Error} If template not found, already inactive, or in use
 */
async function deactivateTemplate(pool, templateId) {
  // Check if template exists
  const template = await getTemplateById(pool, templateId);
  if (!template) {
    const error = new Error('Template not found');
    error.code = 'NOT_FOUND';
    throw error;
  }

  // Check if already inactive
  if (!template.is_active) {
    const error = new Error('Template is already inactive');
    error.code = 'ALREADY_INACTIVE';
    throw error;
  }

  // Check if in use
  const inUse = await isTemplateInUse(pool, templateId);
  if (inUse) {
    const error = new Error('Template is referenced by existing contests and cannot be deactivated');
    error.code = 'IN_USE';
    throw error;
  }

  // Perform soft delete
  const result = await pool.query(
    `UPDATE contest_templates SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [templateId]
  );

  return result.rows[0];
}

module.exports = {
  // Query functions
  listActiveTemplates,
  listAllTemplates,
  getTemplateById,
  isTemplateInUse,

  // Mutation functions
  createTemplate,
  deactivateTemplate,

  // Validation
  validateTemplateInput,

  // Constants (for testing)
  VALID_SCORING_STRATEGIES,
  VALID_LOCK_STRATEGIES,
  VALID_SETTLEMENT_STRATEGIES,
  VALID_SPORTS
};
