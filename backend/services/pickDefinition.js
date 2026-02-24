/**
 * Pick Definition Model (Scaffold)
 *
 * Purpose:
 * Defines the structure and rules for picks within a contest template.
 * PickDefinitions are template-owned and describe what picks are available
 * and their constraints (e.g., position limits, eligible players).
 *
 * Mental Model:
 * - Template owns zero or more PickDefinitions
 * - PickDefinitions are READ-ONLY after template creation
 * - No scoring logic lives here - scoring is handled by ScoringStrategy
 * - Instance picks are validated against the template's PickDefinitions
 *
 * Example Use Cases:
 * - Define "Pick 1 QB from active playoff teams"
 * - Define "Pick 2 RBs with max 1 per team"
 * - Define "Pick 3 WRs, any team"
 *
 * Data Model Intent:
 * {
 *   id: UUID,
 *   template_id: UUID (FK to contest_templates),
 *   position: string (e.g., 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'),
 *   required_count: number (how many picks required for this position),
 *   max_per_team: number | null (optional team diversity constraint),
 *   eligible_filter: object | null (optional filter for eligible players),
 *   display_order: number (UI ordering),
 *   created_at: timestamp,
 *   updated_at: timestamp
 * }
 *
 * TODO: Database table creation (manual step):
 * - pick_definitions table with FK to contest_templates
 * - Indexes on template_id
 *
 * TODO: Implementation steps:
 * 1. Add getPickDefinitionsForTemplate(pool, templateId) - fetch all definitions
 * 2. Add validatePicksAgainstDefinitions(picks, definitions) - validation helper
 * 3. Integrate with contestInstance creation/join flow
 */

// Placeholder constants
const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/**
 * Get all pick definitions for a template
 *
 * TODO: Implement database query
 *
 * @param {Object} pool - Database connection pool
 * @param {string} templateId - UUID of the contest template
 * @returns {Promise<Array>} Array of pick definitions
 */
async function getPickDefinitionsForTemplate(pool, templateId) {
  // TODO: Implement
  // const result = await pool.query(
  //   `SELECT * FROM pick_definitions WHERE template_id = $1 ORDER BY display_order`,
  //   [templateId]
  // );
  // return result.rows;

  throw new Error('Not implemented: getPickDefinitionsForTemplate');
}

/**
 * Validate a set of picks against template's pick definitions
 *
 * Checks:
 * - Correct number of picks per position
 * - Team diversity constraints (if applicable)
 * - Player eligibility (if filters defined)
 *
 * TODO: Implement validation logic
 *
 * @param {Array} picks - Array of pick objects { player_id, position, team }
 * @param {Array} definitions - Array of pick definitions from template
 * @returns {Object} Validation result { valid: boolean, errors?: string[] }
 */
function validatePicksAgainstDefinitions(picks, definitions) {
  // TODO: Implement
  // - Group picks by position
  // - Check required_count for each position
  // - Check max_per_team constraints
  // - Check eligible_filter if present

  throw new Error('Not implemented: validatePicksAgainstDefinitions');
}

/**
 * Check if a position is valid
 *
 * @param {string} position - Position code
 * @returns {boolean} True if valid
 */
function isValidPosition(position) {
  return VALID_POSITIONS.includes(position);
}

module.exports = {
  // Read operations (template-owned, read-only)
  getPickDefinitionsForTemplate,

  // Validation helpers
  validatePicksAgainstDefinitions,
  isValidPosition,

  // Constants
  VALID_POSITIONS
};
