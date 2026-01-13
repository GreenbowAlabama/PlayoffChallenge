/**
 * Admin Trends Service
 *
 * Read-only analytics for pick trends across players, teams, and conferences.
 * Data sources: picks, players, users, game_settings
 *
 * IMPORTANT: This service is strictly read-only. No mutations.
 */

// NFL team to conference mapping
// Source of truth for AFC/NFC membership
const TEAM_CONFERENCE = {
  // AFC East
  BUF: 'AFC',
  MIA: 'AFC',
  NE: 'AFC',
  NYJ: 'AFC',
  // AFC North
  BAL: 'AFC',
  CIN: 'AFC',
  CLE: 'AFC',
  PIT: 'AFC',
  // AFC South
  HOU: 'AFC',
  IND: 'AFC',
  JAX: 'AFC',
  TEN: 'AFC',
  // AFC West
  DEN: 'AFC',
  KC: 'AFC',
  LV: 'AFC',
  LAC: 'AFC',
  // NFC East
  DAL: 'NFC',
  NYG: 'NFC',
  PHI: 'NFC',
  WAS: 'NFC',
  // NFC North
  CHI: 'NFC',
  DET: 'NFC',
  GB: 'NFC',
  MIN: 'NFC',
  // NFC South
  ATL: 'NFC',
  CAR: 'NFC',
  NO: 'NFC',
  TB: 'NFC',
  // NFC West
  ARI: 'NFC',
  LAR: 'NFC',
  SEA: 'NFC',
  SF: 'NFC'
};

/**
 * Gets current NFL week number from game settings.
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @returns {Promise<number|null>} Current NFL week or null if not in playoffs
 */
async function getCurrentNflWeek(pool) {
  const result = await pool.query(`
    SELECT
      current_playoff_week,
      playoff_start_week
    FROM game_settings
    LIMIT 1
  `);

  if (!result.rows[0]) {
    return null;
  }

  const { current_playoff_week, playoff_start_week } = result.rows[0];

  // If playoffs haven't started, return null
  if (current_playoff_week <= 0) {
    return null;
  }

  // NFL week = playoff_start_week + current_playoff_week - 1
  return playoff_start_week + current_playoff_week - 1;
}

/**
 * Builds week filter clause for SQL queries.
 *
 * @param {string} weekRange - 'current' or 'all'
 * @param {number|null} currentNflWeek - Current NFL week number
 * @returns {{ clause: string, params: any[] }} SQL clause and parameters
 */
function buildWeekFilter(weekRange, currentNflWeek) {
  if (weekRange === 'current' && currentNflWeek !== null) {
    return {
      clause: 'AND pk.week_number = $1',
      params: [currentNflWeek]
    };
  }
  return {
    clause: '',
    params: []
  };
}

/**
 * Retrieves player pick trends aggregated across paid users.
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {string} weekRange - 'current' for current week only, 'all' for entire contest
 * @returns {Promise<Array>} Array of player trend records
 */
async function getPlayerTrends(pool, weekRange = 'all') {
  const currentNflWeek = await getCurrentNflWeek(pool);
  const weekFilter = buildWeekFilter(weekRange, currentNflWeek);

  // Build query with parameterized week filter
  const query = `
    SELECT
      p.id AS "playerId",
      p.full_name AS "playerName",
      p.position AS "position",
      p.team AS "team",
      COUNT(pk.id)::integer AS "pickCount"
    FROM picks pk
    INNER JOIN players p ON pk.player_id = p.id
    INNER JOIN users u ON pk.user_id = u.id
    WHERE u.paid = true
    ${weekFilter.clause}
    GROUP BY p.id, p.full_name, p.position, p.team
    ORDER BY COUNT(pk.id) DESC, p.full_name ASC
  `;

  const result = await pool.query(query, weekFilter.params);
  return result.rows;
}

/**
 * Retrieves team pick trends aggregated across paid users.
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {string} weekRange - 'current' for current week only, 'all' for entire contest
 * @returns {Promise<Array>} Array of team trend records
 */
async function getTeamTrends(pool, weekRange = 'all') {
  const currentNflWeek = await getCurrentNflWeek(pool);
  const weekFilter = buildWeekFilter(weekRange, currentNflWeek);

  const query = `
    SELECT
      p.team AS "teamAbbr",
      COUNT(pk.id)::integer AS "pickCount"
    FROM picks pk
    INNER JOIN players p ON pk.player_id = p.id
    INNER JOIN users u ON pk.user_id = u.id
    WHERE u.paid = true
    AND p.team IS NOT NULL
    ${weekFilter.clause}
    GROUP BY p.team
    ORDER BY COUNT(pk.id) DESC, p.team ASC
  `;

  const result = await pool.query(query, weekFilter.params);
  return result.rows;
}

/**
 * Retrieves conference pick trends aggregated across paid users.
 * Conference is derived from team abbreviation using TEAM_CONFERENCE mapping.
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {string} weekRange - 'current' for current week only, 'all' for entire contest
 * @returns {Promise<Array>} Array of conference trend records with AFC/NFC counts
 */
async function getConferenceTrends(pool, weekRange = 'all') {
  const currentNflWeek = await getCurrentNflWeek(pool);
  const weekFilter = buildWeekFilter(weekRange, currentNflWeek);

  // Build CASE statement from conference mapping
  const caseStatements = Object.entries(TEAM_CONFERENCE)
    .map(([team, conf]) => `WHEN '${team}' THEN '${conf}'`)
    .join(' ');

  const query = `
    SELECT
      CASE p.team ${caseStatements} ELSE 'UNKNOWN' END AS "conference",
      COUNT(pk.id)::integer AS "pickCount"
    FROM picks pk
    INNER JOIN players p ON pk.player_id = p.id
    INNER JOIN users u ON pk.user_id = u.id
    WHERE u.paid = true
    AND p.team IS NOT NULL
    ${weekFilter.clause}
    GROUP BY CASE p.team ${caseStatements} ELSE 'UNKNOWN' END
    ORDER BY "conference" ASC
  `;

  const result = await pool.query(query, weekFilter.params);

  // Filter out UNKNOWN if present (defensive)
  return result.rows.filter(row => row.conference !== 'UNKNOWN');
}

/**
 * Gets the team-to-conference mapping.
 * Exposed for potential extension or debugging.
 *
 * @returns {Object} Team abbreviation to conference mapping
 */
function getTeamConferenceMapping() {
  return { ...TEAM_CONFERENCE };
}

module.exports = {
  getPlayerTrends,
  getTeamTrends,
  getConferenceTrends,
  getTeamConferenceMapping,
  getCurrentNflWeek
};
