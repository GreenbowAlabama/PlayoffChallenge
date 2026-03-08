/**
 * Canonical Sport Type Constants
 *
 * Purpose: Eliminate magic strings. Every sport reference in the system
 * must use these constants to prevent:
 *   - Typos ('pga' vs 'GOLF')
 *   - Case sensitivity bugs ('golf' vs 'GOLF')
 *   - Silent failures when string literals drift
 *
 * Usage:
 *   const SPORTS = require('../domain/sports');
 *   if (template.sport === SPORTS.GOLF) { ... }
 *
 * CRITICAL: These values are persisted in the database.
 * Do not change them without a migration.
 */

const SPORTS = Object.freeze({
  NFL: 'NFL',
  GOLF: 'GOLF',
  NBA: 'NBA',
  MLB: 'MLB'
});

module.exports = SPORTS;
