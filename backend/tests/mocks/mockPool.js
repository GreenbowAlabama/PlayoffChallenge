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
  const contestStore = new Map(); // In-memory table for contest_instances

  function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim().toUpperCase();
  }

  /**
   * Safely merge a new row into an existing row, never overwriting with null/undefined
   */
  function mergeRow(existing, incoming) {
    if (!existing) return incoming;
    const merged = { ...existing };
    for (const [k, v] of Object.entries(incoming || {})) {
      if (v !== undefined && v !== null) merged[k] = v;
    }
    return merged;
  }

  /**
   * Store a contest row, safely merging with existing data
   */
  function storeContestRow(row) {
    if (!row || !row.id) return;
    const prev = contestStore.get(row.id);
    contestStore.set(row.id, mergeRow(prev, row));
  }

  /**
   * Check if a stored row has at least all the fields of a template row
   */
  function storeRowSatisfies(templateRow, storeRow) {
    if (!templateRow || !storeRow) return false;
    for (const k of Object.keys(templateRow)) {
      if (!(k in storeRow)) return false;
    }
    return true;
  }

  const mockPool = {
    /**
     * Mock query function - matches patterns and returns configured responses
     */
    query: jest.fn(async (sql, params = []) => {
      queryHistory.push({ sql, params, timestamp: Date.now() });

      const normalized = normalizeSql(sql);

      // Check for exact match first
      const key = `${normalized}::${JSON.stringify(params)}`;
      if (queryResponses.has(key)) {
        const response = queryResponses.get(key);
        if (response instanceof Error) throw response;
        return response;
      }

      // Check for SQL-only match (ignores params)
      if (queryResponses.has(normalized)) {
        const response = queryResponses.get(normalized);
        if (response instanceof Error) throw response;
        return response;
      }

      // Check for pattern matches (regex or function predicates)
      for (const [pattern, response] of queryResponses.entries()) {
        // Skip string/exact match keys (already checked above)
        if (typeof pattern === 'string') {
          continue;
        }

        let matched = false;

        // RegExp matching (test against original SQL to preserve case-sensitivity of test patterns)
        if (pattern instanceof RegExp && pattern.test(sql)) {
          matched = true;
        }

        // Function predicate matching (new: allows flexible query matching)
        // Pass original SQL (not normalized) to preserve case for test predicates
        if (!matched && typeof pattern === 'function') {
          try {
            if (pattern(sql, params)) {
              matched = true;
            }
          } catch (err) {
            // Predicate threw - treat as non-match and continue
            matched = false;
          }
        }

        if (matched) {
          if (response instanceof Error) throw response;

          // Simulate row persistence for UPDATE contest_instances
          if (
            normalized.startsWith('UPDATE CONTEST_INSTANCES') &&
            response &&
            response.rows &&
            response.rows.length > 0
          ) {
            const updatedRow = response.rows[0];
            storeContestRow(updatedRow);
          }

          // When a FOR UPDATE SELECT is stubbed, populate contestStore
          // so subsequent non-locking SELECTs find the row
          if (
            normalized.startsWith('SELECT') &&
            normalized.includes('FROM CONTEST_INSTANCES') &&
            normalized.includes('FOR UPDATE') &&
            response &&
            response.rows &&
            response.rows.length > 0
          ) {
            const row = response.rows[0];
            storeContestRow(row);
          }

          return response;
        }
      }

      // Fallback: if code now does a non-locking SELECT followed by a FOR UPDATE SELECT,
      // allow tests that only stub the FOR UPDATE variant to keep working.
      const isContestSelect =
        normalized.startsWith('SELECT') &&
        normalized.includes('FROM CONTEST_INSTANCES') &&
        normalized.includes('WHERE') &&
        normalized.includes('ID');

      const isForUpdate = normalized.includes('FOR UPDATE');

      if (isContestSelect && !isForUpdate) {
        const normalizedForUpdate = `${normalized} FOR UPDATE`;

        const keyForUpdate = `${normalizedForUpdate}::${JSON.stringify(params)}`;
        if (queryResponses.has(keyForUpdate)) {
          const response = queryResponses.get(keyForUpdate);
          if (response instanceof Error) throw response;
          // Populate contestStore only if not already populated (don't overwrite fresher data)
          if (response && response.rows && response.rows.length > 0) {
            const row = response.rows[0];
            if (!contestStore.has(row.id)) {
              storeContestRow(row);
            }
          }
          // Return from contestStore only if it satisfies the template
          const storeRow = contestStore.get(params[0]);
          const templateRow = response?.rows?.[0];
          if (storeRow && storeRowSatisfies(templateRow, storeRow)) {
            return { rows: [storeRow], rowCount: 1 };
          }
          return response;
        }

        if (queryResponses.has(normalizedForUpdate)) {
          const response = queryResponses.get(normalizedForUpdate);
          if (response instanceof Error) throw response;
          // Populate contestStore only if not already populated (don't overwrite fresher data)
          if (response && response.rows && response.rows.length > 0) {
            const row = response.rows[0];
            if (!contestStore.has(row.id)) {
              storeContestRow(row);
            }
          }
          // Return from contestStore only if it satisfies the template
          const storeRow = contestStore.get(params[0]);
          const templateRow = response?.rows?.[0];
          if (storeRow && storeRowSatisfies(templateRow, storeRow)) {
            return { rows: [storeRow], rowCount: 1 };
          }
          return response;
        }

        for (const [pattern, response] of queryResponses.entries()) {
          if (typeof pattern === 'string') continue;

          // Construct what the FOR UPDATE query would look like (original case)
          const sqlForUpdate = `${sql} FOR UPDATE`;

          if (pattern instanceof RegExp && pattern.test(sqlForUpdate)) {
            if (response instanceof Error) throw response;
            // Populate contestStore only if not already populated (don't overwrite fresher data)
            if (response && response.rows && response.rows.length > 0) {
              const row = response.rows[0];
              if (!contestStore.has(row.id)) {
                storeContestRow(row);
              }
            }
            // Return from contestStore only if it satisfies the template
            const storeRow = contestStore.get(params[0]);
            const templateRow = response?.rows?.[0];
            if (storeRow && storeRowSatisfies(templateRow, storeRow)) {
              return { rows: [storeRow], rowCount: 1 };
            }
            return response;
          }

          if (typeof pattern === 'function') {
            try {
              if (pattern(sqlForUpdate, params)) {
                if (response instanceof Error) throw response;
                // Populate contestStore only if not already populated (don't overwrite fresher data)
                if (response && response.rows && response.rows.length > 0) {
                  const row = response.rows[0];
                  if (!contestStore.has(row.id)) {
                    storeContestRow(row);
                  }
                }
                // Return from contestStore only if it satisfies the template
                const storeRow = contestStore.get(params[0]);
                const templateRow = response?.rows?.[0];
                if (storeRow && storeRowSatisfies(templateRow, storeRow)) {
                  return { rows: [storeRow], rowCount: 1 };
                }
                return response;
              }
            } catch (_) {}
          }
        }
      }

      // Fallback: Check in-memory contest store for SELECTs on contest_instances
      // This simulates a real table, allowing subsequent SELECTs to see UPDATEs
      if (
        normalized.startsWith('SELECT') &&
        normalized.includes('FROM CONTEST_INSTANCES') &&
        params &&
        params.length > 0
      ) {
        const row = contestStore.get(params[0]);
        if (row) {
          return { rows: [row], rowCount: 1 };
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
        const key = `${normalizeSql(sqlOrPattern)}::${JSON.stringify(params)}`;
        queryResponses.set(key, response);
      } else if (typeof sqlOrPattern === 'string') {
        queryResponses.set(normalizeSql(sqlOrPattern), response);
      } else {
        // RegExp or Function - don't normalize, use as-is
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
