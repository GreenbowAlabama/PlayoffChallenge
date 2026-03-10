/**
 * Contest Instance Repository
 *
 * SQL-only operations for contest_instances table.
 * Handles existence checks and queries for contest instances.
 *
 * Constraints:
 * - Must use provided pool or transaction client
 * - Caller manages transaction lifecycle
 * - All queries must be read-only or idempotent
 */

/**
 * Get existing platform-owned contest instance by business key.
 *
 * Used for idempotency checks when syncing fee-tiered contests.
 * Checks the complete business key: (provider_event_id, template_id, entry_fee_cents).
 *
 * Returns full row data to support:
 * • existence verification
 * • join_token repair operations
 * • audit logging
 *
 * Note: Cancelled contests still count as existing rows (financial exposure).
 * No status filtering.
 *
 * @param {Object} client - Database transaction client (from pool.connect())
 * @param {string} provider_event_id - Provider event identifier
 * @param {string} template_id - Template UUID
 * @param {number} entry_fee_cents - Entry fee in cents
 * @returns {Promise<Object|null>} { id, join_token } if exists, null otherwise
 */
async function getExistingContestInstance(client, provider_event_id, template_id, entry_fee_cents) {
  const result = await client.query(
    `SELECT id, join_token
     FROM contest_instances
     WHERE provider_event_id = $1
       AND template_id = $2
       AND entry_fee_cents = $3
       AND is_platform_owned = true
     LIMIT 1`,
    [provider_event_id, template_id, entry_fee_cents]
  );

  return result.rows[0] || null;
}

module.exports = {
  getExistingContestInstance
};
