/**
 * Mock Database Pool
 *
 * Provides a mock PostgreSQL pool for unit testing.
 * Configure query responses per test to isolate database behavior.
 *
 * Usage:
 *   const { createMockPool, mockQueryResponses } = require('./mocks/mockPool');
 *   const mockPool = createMockPool();
 *   mockPool.setQueryResponse('SELECT * FROM users', { rows: [mockUser] });
 */

/**
 * Creates a mock pool with configurable query responses
 */
function createMockPool() {
  const queryResponses = new Map();
  const queryHistory = [];

  const mockPool = {
    /**
     * Mock query function - matches patterns and returns configured responses
     */
    query: jest.fn(async (sql, params = []) => {
      queryHistory.push({ sql, params, timestamp: Date.now() });

      // Check for exact match first
      const key = `${sql}::${JSON.stringify(params)}`;
      if (queryResponses.has(key)) {
        const response = queryResponses.get(key);
        if (response instanceof Error) throw response;
        return response;
      }

      // Check for SQL-only match (ignores params)
      if (queryResponses.has(sql)) {
        const response = queryResponses.get(sql);
        if (response instanceof Error) throw response;
        return response;
      }

      // Check for pattern matches (regex or function predicates)
      for (const [pattern, response] of queryResponses.entries()) {
        // Skip string/exact match keys (already checked above)
        if (typeof pattern === 'string') {
          continue;
        }

        // RegExp matching
        if (pattern instanceof RegExp && pattern.test(sql)) {
          if (response instanceof Error) throw response;
          return response;
        }

        // Function predicate matching (new: allows flexible query matching)
        if (typeof pattern === 'function') {
          try {
            if (pattern(sql)) {
              if (response instanceof Error) throw response;
              return response;
            }
          } catch (err) {
            // Predicate threw - treat as non-match and continue
            continue;
          }
        }
      }

      // Default empty result
      return { rows: [], rowCount: 0 };
    }),

    /**
     * Set a specific query response
     * @param {string|RegExp|Function} sqlOrPattern - SQL string, RegExp pattern, or predicate function
     *   - string: exact match (no params) or with params for full key match
     *   - RegExp: pattern test on SQL
     *   - Function: predicate(sql) => boolean for flexible matching
     * @param {Object|Error} response - Response object with rows/rowCount or Error to throw
     * @param {Array} params - Optional params for exact matching (string only)
     *
     * @example
     *   // Exact match
     *   mockPool.setQueryResponse('SELECT * FROM users', response);
     *   // RegExp pattern
     *   mockPool.setQueryResponse(/SELECT.*FROM users/, response);
     *   // Function predicate (flexible, robust)
     *   mockPool.setQueryResponse(
     *     q => q.includes('FROM users') && q.includes('FOR UPDATE'),
     *     response
     *   );
     */
    setQueryResponse(sqlOrPattern, response, params = null) {
      if (params !== null) {
        const key = `${sqlOrPattern}::${JSON.stringify(params)}`;
        queryResponses.set(key, response);
      } else {
        queryResponses.set(sqlOrPattern, response);
      }
      return this;
    },

    /**
     * Get query history for assertions
     */
    getQueryHistory() {
      return [...queryHistory];
    },

    /**
     * Clear query history and responses
     */
    reset() {
      queryResponses.clear();
      queryHistory.length = 0;
      mockPool.query.mockClear();
      return this;
    },

    /**
     * Mock end function for cleanup
     */
    end: jest.fn(async () => {}),

    /**
     * Mock connect function for transaction support
     */
    connect: jest.fn(async () => ({
      query: mockPool.query,
      release: jest.fn()
    }))
  };

  return mockPool;
}

/**
 * Common query response factories
 */
const mockQueryResponses = {
  // Empty result
  empty: () => ({ rows: [], rowCount: 0 }),

  // Single row result
  single: (row) => ({ rows: [row], rowCount: 1 }),

  // Multiple rows result
  multiple: (rows) => ({ rows, rowCount: rows.length }),

  // Insert/Update result with returning
  inserted: (row) => ({ rows: [row], rowCount: 1 }),

  // Delete result
  deleted: (count = 1) => ({ rows: [], rowCount: count }),

  // Error response
  error: (message, code = 'UNKNOWN') => {
    const err = new Error(message);
    err.code = code;
    return err;
  },

  // Scoring rules response (commonly needed)
  scoringRules: () => ({
    rows: [
      { stat_name: 'pass_yd', points: 0.04 },
      { stat_name: 'pass_td', points: 4 },
      { stat_name: 'pass_int', points: -2 },
      { stat_name: 'pass_2pt', points: 2 },
      { stat_name: 'rush_yd', points: 0.1 },
      { stat_name: 'rush_td', points: 6 },
      { stat_name: 'rush_2pt', points: 2 },
      { stat_name: 'rec', points: 1 },
      { stat_name: 'rec_yd', points: 0.1 },
      { stat_name: 'rec_td', points: 6 },
      { stat_name: 'rec_2pt', points: 2 },
      { stat_name: 'fum_lost', points: -2 },
      { stat_name: 'pass_yd_bonus', points: 3 },
      { stat_name: 'rush_yd_bonus', points: 3 },
      { stat_name: 'rec_yd_bonus', points: 3 },
      { stat_name: 'def_sack', points: 1 },
      { stat_name: 'def_int', points: 2 },
      { stat_name: 'def_fum_rec', points: 2 },
      { stat_name: 'def_td', points: 6 },
      { stat_name: 'def_safety', points: 2 },
      { stat_name: 'def_block', points: 4 },
      { stat_name: 'def_ret_td', points: 6 }
    ],
    rowCount: 22
  }),

  // Game settings response
  gameSettings: (overrides = {}) => ({
    rows: [{
      current_week: 19,
      current_playoff_week: 1,
      is_week_active: true,
      active_teams: ['BUF', 'KC', 'DET', 'PHI', 'BAL', 'HOU', 'LAR', 'TB', 'PIT', 'DEN', 'GB', 'WAS', 'MIN', 'LAC'],
      ...overrides
    }],
    rowCount: 1
  })
};

module.exports = {
  createMockPool,
  mockQueryResponses
};
