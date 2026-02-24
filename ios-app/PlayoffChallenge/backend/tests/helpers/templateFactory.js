/**
 * Template Factory - Deterministic Test Template Management
 *
 * CRITICAL CONSTRAINTS:
 * - Jest MUST run with --runInBand (single process)
 * - ensureActiveTemplate deactivates all OTHER active templates for same sport/type
 * - This is only safe in single-threaded mode
 * - If parallelization is enabled, templates will race and corrupt test state
 *
 * Purpose:
 * - Generate deterministic UUIDs from (sport, templateType) to prevent accumulation
 * - Ensure only ONE active template per (sport, template_type) combination
 * - Deactivate previous templates instead of deleting them (respects append-only invariants)
 * - Support both pool and client (for transaction-based isolation)
 *
 * Design:
 * - getDeterministicTemplateId() creates stable UUID from input (v5 hash in UUID namespace)
 * - ensureActiveTemplate() deactivates all other active templates for that sport/type,
 *   then upserts the target template with is_active=true
 * - This ensures unique_active_template_per_type constraint is never violated
 */

const { v5: uuidv5 } = require('uuid');

// Project-specific UUID v5 namespace (generated for playoff-challenge)
// This prevents collisions with other deterministic IDs in the system
const TEMPLATE_NAMESPACE = '7f5a9c8e-3b1d-4c2a-9f6e-2d8a1b4c5e7a';

/**
 * Generate a deterministic UUID from sport and template_type.
 * Same inputs always produce the same UUID.
 *
 * @param {Object} params
 * @param {string} params.sport - Sport code (e.g., 'NFL', 'golf')
 * @param {string} params.templateType - Template type (e.g., 'playoff_challenge', 'playoff')
 * @returns {string} Deterministic UUID v5
 */
function getDeterministicTemplateId({ sport, templateType }) {
  if (!sport || !templateType) {
    throw new Error('getDeterministicTemplateId: sport and templateType are required');
  }

  // Create stable input string for UUID generation
  const input = `template:${sport}:${templateType}`;

  // Generate UUIDv5 (stable, deterministic from namespace + input)
  return uuidv5(input, TEMPLATE_NAMESPACE);
}

/**
 * Ensure one and only one active template exists for (sport, templateType).
 *
 * This function:
 * 1. Deactivates any OTHER active templates for this sport/type
 * 2. Upserts (insert or update) the target template with is_active=true
 * 3. Returns the final template row
 *
 * CRITICAL: This prevents unique_active_template_per_type violations by ensuring
 * there's never more than one active template per sport/templateType combination.
 *
 * IMPORTANT: This function is NOT thread-safe. Jest MUST run with --runInBand.
 *
 * @param {Object} poolOrClient - pg Pool or Client instance
 * @param {Object} params - Template parameters
 * @param {string} params.sport - Sport code (e.g., 'NFL', 'golf')
 * @param {string} params.templateType - Template type (e.g., 'playoff_challenge', 'playoff')
 * @param {string} params.name - Template name for display
 * @param {string} params.scoringKey - Scoring strategy key (must exist in scoringRegistry)
 * @param {string} params.lockKey - Lock strategy key (must exist in lockStrategy)
 * @param {string} params.settlementKey - Settlement strategy key (must exist in settlementRegistry)
 * @param {Object|Array} params.allowedPayoutStructures - Payout structures (standardized format)
 * @param {number} params.entryFeeCents - Default entry fee in cents
 * @param {number} [params.minEntryFeeCents=0] - Minimum entry fee
 * @param {number} [params.maxEntryFeeCents=1000000] - Maximum entry fee
 * @returns {Promise<Object>} Template row from database
 */
async function ensureActiveTemplate(poolOrClient, params) {
  const {
    sport,
    templateType,
    name,
    scoringKey,
    lockKey,
    settlementKey,
    allowedPayoutStructures,
    entryFeeCents,
    minEntryFeeCents = 0,
    maxEntryFeeCents = 1000000
  } = params;

  // Validate required inputs
  if (!sport || !templateType || !name || !scoringKey || !lockKey || !settlementKey) {
    throw new Error(
      'ensureActiveTemplate: sport, templateType, name, scoringKey, lockKey, settlementKey are required'
    );
  }

  if (allowedPayoutStructures === undefined) {
    throw new Error('ensureActiveTemplate: allowedPayoutStructures is required (can be empty object/array)');
  }

  // Generate deterministic template ID
  const templateId = getDeterministicTemplateId({ sport, templateType });

  // Prepare payout structures as JSON
  const payoutStructuresJson =
    typeof allowedPayoutStructures === 'string'
      ? allowedPayoutStructures
      : JSON.stringify(allowedPayoutStructures || {});

  // Step 1: Deactivate all OTHER active templates for this sport/templateType
  // This ensures only our template is active
  await poolOrClient.query(
    `UPDATE contest_templates
     SET is_active = false, updated_at = NOW()
     WHERE sport = $1 AND template_type = $2 AND is_active = true AND id <> $3`,
    [sport, templateType, templateId]
  );

  // Step 2: Insert or update the target template (always active)
  const result = await poolOrClient.query(
    `INSERT INTO contest_templates
     (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key,
      default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents,
      allowed_payout_structures, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       scoring_strategy_key = EXCLUDED.scoring_strategy_key,
       lock_strategy_key = EXCLUDED.lock_strategy_key,
       settlement_strategy_key = EXCLUDED.settlement_strategy_key,
       allowed_payout_structures = EXCLUDED.allowed_payout_structures,
       default_entry_fee_cents = EXCLUDED.default_entry_fee_cents,
       allowed_entry_fee_min_cents = EXCLUDED.allowed_entry_fee_min_cents,
       allowed_entry_fee_max_cents = EXCLUDED.allowed_entry_fee_max_cents,
       is_active = true,
       updated_at = NOW()
     RETURNING *`,
    [
      templateId,
      name,
      sport,
      templateType,
      scoringKey,
      lockKey,
      settlementKey,
      entryFeeCents,
      minEntryFeeCents,
      maxEntryFeeCents,
      payoutStructuresJson
    ]
  );

  return result.rows[0];
}

/**
 * Deactivate a template by ID (for cleanup if needed).
 * This is an alternative to DELETE that respects append-only invariants.
 *
 * @param {Object} poolOrClient - pg Pool or Client instance
 * @param {string} templateId - Template ID to deactivate
 * @returns {Promise<void>}
 */
async function deactivateTemplate(poolOrClient, templateId) {
  if (!templateId) {
    throw new Error('deactivateTemplate: templateId is required');
  }

  await poolOrClient.query(
    `UPDATE contest_templates SET is_active = false, updated_at = NOW() WHERE id = $1`,
    [templateId]
  );
}

/**
 * Pre-built template for NFL Playoff Challenge
 * Sport: NFL, Template Type: playoff_challenge
 * Uses verified registry keys from scoringRegistry, lockStrategy, settlementRegistry
 */
async function ensureNflPlayoffChallengeTemplate(poolOrClient, overrides = {}) {
  return ensureActiveTemplate(poolOrClient, {
    sport: 'NFL',
    templateType: 'playoff_challenge',
    name: overrides.name || 'NFL Playoff Challenge',
    scoringKey: overrides.scoringKey || 'standard',
    lockKey: overrides.lockKey || 'manual',
    settlementKey: overrides.settlementKey || 'final_standings',
    allowedPayoutStructures: overrides.allowedPayoutStructures || [{ '1': 100 }],
    entryFeeCents: overrides.entryFeeCents ?? 0,
    minEntryFeeCents: overrides.minEntryFeeCents ?? 0,
    maxEntryFeeCents: overrides.maxEntryFeeCents ?? 10000000
  });
}

/**
 * Pre-built template for PGA Golf Playoff
 * Sport: golf, Template Type: playoff
 * Uses verified registry keys from scoringRegistry, lockStrategy, settlementRegistry
 */
async function ensureGolfMajorTemplate(poolOrClient, overrides = {}) {
  return ensureActiveTemplate(poolOrClient, {
    sport: 'golf',
    templateType: 'playoff',
    name: overrides.name || 'Golf Playoff',
    scoringKey: overrides.scoringKey || 'pga_standard_v1',
    lockKey: overrides.lockKey || 'time_based_lock_v1',
    settlementKey: overrides.settlementKey || 'pga_standard_v1',
    allowedPayoutStructures: overrides.allowedPayoutStructures || [{ '1': 60, '2': 40 }],
    entryFeeCents: overrides.entryFeeCents ?? 10000,
    minEntryFeeCents: overrides.minEntryFeeCents ?? 0,
    maxEntryFeeCents: overrides.maxEntryFeeCents ?? 1000000
  });
}

module.exports = {
  getDeterministicTemplateId,
  ensureActiveTemplate,
  deactivateTemplate,
  ensureNflPlayoffChallengeTemplate,
  ensureGolfMajorTemplate,
  // Exposed for tests that need custom values
  TEMPLATE_NAMESPACE
};
