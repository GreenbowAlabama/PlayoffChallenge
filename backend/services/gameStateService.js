/**
 * Game State Service
 *
 * Extracted from server.js as part of SOLID refactor.
 * Contains game settings and state logic with injected dependencies.
 */

// Fallback playoff teams - used only during Wildcard if DB active_teams is not set
const FALLBACK_PLAYOFF_TEAMS = process.env.PLAYOFF_TEAMS
  ? process.env.PLAYOFF_TEAMS.split(',').map(t => t.trim())
  : ['DEN','NE','JAX','PIT','HOU','LAC','BUF','SEA','CHI','PHI','CAR','SF','LAR','GB'];

// Selectable teams cache with TTL
const selectableTeamsCache = {
  teams: null,
  currentPlayoffWeek: null,
  lastFetch: 0
};
const SELECTABLE_TEAMS_CACHE_MS = 60 * 1000; // 60 seconds TTL

/**
 * Normalize team abbreviation to standard format.
 * Handles legacy/alternate abbreviations.
 *
 * @param {string} abbr - Team abbreviation
 * @returns {string|null} - Normalized abbreviation or null
 */
function normalizeTeamAbbr(abbr) {
  if (!abbr) return null;

  const map = {
    WSH: 'WAS',
    JAC: 'JAX',
    LA: 'LAR',
    STL: 'LAR',
    SD: 'LAC',
    OAK: 'LV'
  };

  return map[abbr] || abbr;
}

/**
 * Normalize active_teams JSON from game_settings into array of team abbreviations.
 * Handles various possible shapes safely:
 * - Array of strings: ["BUF","KC"]
 * - Array of objects: [{abbreviation:"BUF"}, {abbr:"KC"}]
 * - Object map: {"BUF": true, "KC": true} or {"BUF": {...}, "KC": {...}}
 * - Object wrapper: {teams:[...]} or {activeTeams:[...]}
 *
 * @param {any} activeTeamsJson - Raw active_teams value from DB
 * @returns {string[]} - Array of normalized team abbreviations
 */
function normalizeActiveTeams(activeTeamsJson) {
  if (!activeTeamsJson) return [];

  let data = activeTeamsJson;

  // If it's a string, try to parse it
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      console.error('[normalizeActiveTeams] Failed to parse JSON string:', e.message);
      return [];
    }
  }

  // If it's already an array
  if (Array.isArray(data)) {
    return data.map(item => {
      if (typeof item === 'string') {
        return normalizeTeamAbbr(item);
      }
      if (typeof item === 'object' && item !== null) {
        // Handle {abbreviation: "BUF"} or {abbr: "KC"} or {team: "SF"}
        const abbr = item.abbreviation || item.abbr || item.team || null;
        return normalizeTeamAbbr(abbr);
      }
      return null;
    }).filter(Boolean);
  }

  // If it's an object (not array)
  if (typeof data === 'object' && data !== null) {
    // Check for wrapper keys: {teams:[...]} or {activeTeams:[...]}
    if (Array.isArray(data.teams)) {
      return normalizeActiveTeams(data.teams);
    }
    if (Array.isArray(data.activeTeams)) {
      return normalizeActiveTeams(data.activeTeams);
    }
    if (Array.isArray(data.active_teams)) {
      return normalizeActiveTeams(data.active_teams);
    }

    // Otherwise treat keys as team abbreviations: {"BUF": true, "KC": {...}}
    return Object.keys(data).map(key => normalizeTeamAbbr(key)).filter(Boolean);
  }

  return [];
}

/**
 * Get selectable teams from DB with caching.
 * Returns { teams: string[], currentPlayoffWeek: number }
 * Fails closed after Wildcard if active_teams is missing/empty.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<{teams: string[]|null, currentPlayoffWeek: number, error?: string}>}
 */
async function getSelectableTeams(pool) {
  const now = Date.now();

  // Return cached value if still valid
  if (selectableTeamsCache.teams !== null &&
      (now - selectableTeamsCache.lastFetch) < SELECTABLE_TEAMS_CACHE_MS) {
    return {
      teams: selectableTeamsCache.teams,
      currentPlayoffWeek: selectableTeamsCache.currentPlayoffWeek
    };
  }

  // Fetch from DB
  const result = await pool.query(
    'SELECT active_teams, current_playoff_week FROM game_settings LIMIT 1'
  );

  const row = result.rows[0] || {};
  const currentPlayoffWeek = row.current_playoff_week || 1;
  const normalizedTeams = normalizeActiveTeams(row.active_teams);

  // Fail-closed after Wildcard: if active_teams is missing/empty, return error indicator
  if (currentPlayoffWeek > 1 && normalizedTeams.length === 0) {
    // Don't cache error state - allow retry
    return {
      teams: null,
      currentPlayoffWeek: currentPlayoffWeek,
      error: 'Server configuration error'
    };
  }

  // During Wildcard (week 1): fallback to env/hardcoded if DB active_teams is empty
  let teams;
  if (normalizedTeams.length === 0) {
    teams = FALLBACK_PLAYOFF_TEAMS.map(t => normalizeTeamAbbr(t));
  } else {
    teams = normalizedTeams;
  }

  // Update cache
  selectableTeamsCache.teams = teams;
  selectableTeamsCache.currentPlayoffWeek = currentPlayoffWeek;
  selectableTeamsCache.lastFetch = now;

  return { teams, currentPlayoffWeek };
}

/**
 * Get active teams for a specific week based on picks in the database.
 *
 * @param {Object} pool - Database connection pool
 * @param {number} weekNumber - NFL week number
 * @returns {Promise<string[]>} - Array of team abbreviations
 */
async function getActiveTeamsForWeek(pool, weekNumber) {
  try {
    const result = await pool.query(`
      SELECT DISTINCT p.team
      FROM picks pk
      JOIN players p ON pk.player_id = p.id::text
      WHERE pk.week_number = $1 AND p.team IS NOT NULL
    `, [weekNumber]);

    return result.rows.map(r => r.team);
  } catch (err) {
    console.error('Error getting active teams:', err);
    return [];
  }
}

/**
 * Get core game settings from database.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<{currentPlayoffWeek: number, playoffStartWeek: number, isWeekActive: boolean}|null>}
 */
async function getGameSettings(pool) {
  const result = await pool.query(
    'SELECT current_playoff_week, playoff_start_week, is_week_active FROM game_settings LIMIT 1'
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    currentPlayoffWeek: row.current_playoff_week,
    playoffStartWeek: row.playoff_start_week,
    isWeekActive: row.is_week_active
  };
}

/**
 * Check if the current week is active (unlocked for picks).
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<boolean>}
 */
async function isWeekActive(pool) {
  const result = await pool.query(
    'SELECT is_week_active FROM game_settings LIMIT 1'
  );

  if (result.rows.length === 0) {
    return false;
  }

  return result.rows[0].is_week_active === true;
}

/**
 * Clear the selectable teams cache.
 * Useful for testing or after admin updates.
 */
function clearSelectableTeamsCache() {
  selectableTeamsCache.teams = null;
  selectableTeamsCache.currentPlayoffWeek = null;
  selectableTeamsCache.lastFetch = 0;
}

module.exports = {
  normalizeTeamAbbr,
  normalizeActiveTeams,
  getSelectableTeams,
  getActiveTeamsForWeek,
  getGameSettings,
  isWeekActive,
  clearSelectableTeamsCache,
  // Expose constants for testing
  FALLBACK_PLAYOFF_TEAMS,
  SELECTABLE_TEAMS_CACHE_MS
};
