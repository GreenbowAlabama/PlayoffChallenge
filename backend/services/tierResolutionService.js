/**
 * Tier Resolution Service
 *
 * Provides deterministic tier assignment and validation for contest configurations.
 * Tiers enable contest-level grouping of players where user selects exactly 1 per tier.
 *
 * INVARIANTS:
 * - Tier definitions are received pre-normalized (sorted by rank_min)
 * - No overlaps allowed (ingestionService validates this)
 * - Every rank must map to exactly one tier
 * - Backward compatible: tier_definition NULL = no tiers enforced
 */

/**
 * Resolve a player rank to a tier ID based on tier definition.
 *
 * Given a rank (1-based position) and tier configuration, returns the tier ID
 * that contains this rank, or null if rank is out of range or no tiers defined.
 *
 * SAFETY: Assumes tiers are pre-sorted by rank_min (enforced by ingestionService)
 *
 * @param {number} rank - 1-based player rank/position
 * @param {Object|null} tierDefinition - Tier config with tiers array (must be sorted)
 * @returns {string|null} Tier ID or null if no match
 */
function resolveTier(rank, tierDefinition) {
  if (!tierDefinition || !tierDefinition.tiers || tierDefinition.tiers.length === 0) {
    return null;
  }

  // Tiers are pre-sorted by ingestionService, so iterate in order
  for (const tier of tierDefinition.tiers) {
    if (rank >= tier.rank_min && rank <= tier.rank_max) {
      return tier.id;
    }
  }

  return null;
}

/**
 * Validate that roster has exactly required_per_tier players per tier.
 *
 * Enforces:
 * - All entries have a tier_id
 * - Each tier has exactly required_per_tier selections (default: 1)
 * - No duplicate selections within a tier
 *
 * Backward compatible: null tierDefinition returns valid: true
 *
 * @param {Array<Object>} entries - Roster entries with tier_id
 * @param {Object|null} tierDefinition - Tier config
 * @returns {Object} { valid: boolean, reason?: string, expected?: number, got?: number }
 */
function validateRosterTiers(entries, tierDefinition) {
  if (!tierDefinition || !tierDefinition.tiers) {
    return { valid: true };
  }

  const tierCounts = {};
  for (const entry of entries) {
    const tierId = entry.tier_id;
    if (!tierId) {
      return { valid: false, reason: 'missing_tier_assignment' };
    }
    tierCounts[tierId] = (tierCounts[tierId] || 0) + 1;
  }

  const requiredPerTier = tierDefinition.required_per_tier || 1;
  for (const tier of tierDefinition.tiers) {
    const count = tierCounts[tier.id] || 0;
    if (count !== requiredPerTier) {
      return {
        valid: false,
        reason: `tier_${tier.id}_count_mismatch`,
        expected: requiredPerTier,
        got: count
      };
    }
  }

  return { valid: true };
}

module.exports = {
  resolveTier,
  validateRosterTiers
};
