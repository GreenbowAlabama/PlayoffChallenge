/**
 * Players Route
 *
 * GET /api/players - Retrieve players with optional filtering
 * - sport: GOLF | NFL (default: NFL)
 * - position: filter by position (e.g., 'G', 'QB')
 * - limit: max results per page (default: 100)
 * - offset: pagination offset (default: 0)
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/players
 *
 * Returns a paginated list of players, filtered by sport and other criteria.
 * Only returns active, available players.
 */
router.get('/', async (req, res) => {
  const pool = req.app.locals.pool;
  const { sport = 'NFL', position, limit = 100, offset = 0 } = req.query;

  try {
    // Convert limit and offset to integers
    const parsedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 100, 1000));
    const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

    // Build dynamic WHERE clause
    const conditions = [
      'is_active = true',
      'available = true',
      'sport = $1'
    ];
    const params = [sport];
    let paramIndex = 2;

    if (position) {
      conditions.push(`"position" = $${paramIndex}`);
      params.push(position);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM players WHERE ${whereClause}`,
      params.slice(0, paramIndex - 1)
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Get paginated results
    const queryParams = [...params.slice(0, paramIndex - 1), parsedLimit, parsedOffset];
    const result = await pool.query(
      `SELECT id, full_name, position, image_url, sport
       FROM players
       WHERE ${whereClause}
       ORDER BY full_name ASC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      queryParams
    );

    res.json({
      players: result.rows,
      total,
      limit: parsedLimit,
      offset: parsedOffset
    });
  } catch (err) {
    console.error('[Players Route] Error:', err);
    res.status(500).json({
      error: 'Failed to fetch players',
      message: process.env.NODE_ENV === 'test' ? err.message : 'Internal server error'
    });
  }
});

module.exports = router;
