// ============================================
// Playoff Challenge Backend API V2
// Enhanced with Rules, Scoring, Payouts, Multipliers
// FIXED: All week columns now use week_number
// ============================================

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 8080;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(cors());
app.use(express.json());

// ============================================
// HELPER FUNCTIONS
// ============================================

// Verify admin middleware
const verifyAdmin = async (req, res, next) => {
  const { user_id } = req.body;
  if (!user_id) {
    return res.status(401).json({ error: 'User ID required' });
  }
  
  try {
    const result = await pool.query('SELECT is_admin FROM users WHERE id = $1', [user_id]);
    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (error) {
    console.error('Admin verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
};

// Check if game has started (with 1 minute buffer)
const hasGameStarted = (gameTime) => {
  const now = new Date();
  const gameStart = new Date(gameTime);
  const bufferTime = new Date(gameStart.getTime() - 60000); // 1 minute before
  return now >= bufferTime;
};

// Calculate points based on scoring rules
const calculatePlayerPoints = async (playerStats) => {
  const rulesResult = await pool.query('SELECT * FROM scoring_rules WHERE is_active = true');
  const rules = rulesResult.rows;
  
  let points = 0;
  
  // Apply each scoring rule
  for (const rule of rules) {
    const statValue = playerStats[rule.stat_name] || 0;
    points += statValue * rule.points;
  }
  
  // Handle bonus thresholds
  if (playerStats.passing_yards >= 400) {
    const bonusRule = rules.find(r => r.stat_name === 'passing_yards_bonus');
    if (bonusRule) points += bonusRule.points;
  }
  
  if (playerStats.rushing_yards >= 150) {
    const bonusRule = rules.find(r => r.stat_name === 'rushing_yards_bonus');
    if (bonusRule) points += bonusRule.points;
  }
  
  if (playerStats.receiving_yards >= 150) {
    const bonusRule = rules.find(r => r.stat_name === 'receiving_yards_bonus');
    if (bonusRule) points += bonusRule.points;
  }
  
  return points;
};

// ============================================
// EXISTING ENDPOINTS (keeping your current ones)
// ============================================

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Playoff Challenge API V2 Running', version: '2.0.0' });
});

// Get or create user
app.post('/api/users', async (req, res) => {
  const { apple_id, email, name } = req.body;
  
  try {
    // Check if user exists
    let result = await pool.query('SELECT * FROM users WHERE apple_user_id = $1', [apple_id]);
    
    if (result.rows.length > 0) {
      return res.json(result.rows[0]);
    }
    
    // Create new user
    result = await pool.query(
      'INSERT INTO users (apple_user_id, username) VALUES ($1, $2) RETURNING *',
      [apple_id, name || email || 'User']
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('User creation error:', error);
    res.status(500).json({ error: 'Failed to create user', details: error.message });
  }
});

// Get all players
app.get('/api/players', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        COALESCE(full_name, name) as full_name,
        position,
        team,
        COALESCE(is_active, available) as is_active,
        sleeper_id,
        game_time
      FROM players 
      WHERE COALESCE(is_active, available) = true 
      ORDER BY position, team, COALESCE(full_name, name)
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Get players error:', error);
    res.status(500).json({ error: 'Failed to fetch players' });
  }
});

// Get user picks - FIXED to use week_number consistently
app.get('/api/picks/user/:user_id', async (req, res) => {
  const { user_id } = req.params;
  
  try {
    const result = await pool.query(`
      SELECT 
        p.id,
        p.user_id,
        p.player_id,
        COALESCE(p.position, 'FLEX') as position,
        p.week_number,
        COALESCE(pl.full_name, pl.name) as full_name,
        pl.team,
        pl.position as player_position,
        COALESCE(pl.sleeper_id, pl.id) as sleeper_id,
        COALESCE(p.consecutive_weeks, 0) as consecutive_weeks,
        COALESCE(p.multiplier, 1.0) as multiplier,
        COALESCE(p.is_bye_week, false) as is_bye_week
      FROM picks p
      JOIN players pl ON p.player_id = pl.id
      WHERE p.user_id = $1
      ORDER BY p.week_number, pl.position
    `, [user_id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get picks error:', error);
    res.status(500).json({ error: 'Failed to fetch picks' });
  }
});

// Submit picks - FIXED
app.post('/api/picks', async (req, res) => {
  const { user_id, picks, week_number } = req.body;
  
  try {
    // Optional: Validate position limits
    const settingsResult = await pool.query('SELECT * FROM game_settings LIMIT 1');
    const settings = settingsResult.rows[0];
    
    if (settings) {
      const picksCount = {};
      picks.forEach(pick => {
        picksCount[pick.position] = (picksCount[pick.position] || 0) + 1;
      });
      
      // Check limits
      if (picksCount['QB'] > (settings.qb_limit || 1)) {
        return res.status(400).json({ error: `Max ${settings.qb_limit || 1} QB allowed` });
      }
      if (picksCount['RB'] > (settings.rb_limit || 2)) {
        return res.status(400).json({ error: `Max ${settings.rb_limit || 2} RB allowed` });
      }
      if (picksCount['WR'] > (settings.wr_limit || 3)) {
        return res.status(400).json({ error: `Max ${settings.wr_limit || 3} WR allowed` });
      }
      if (picksCount['TE'] > (settings.te_limit || 1)) {
        return res.status(400).json({ error: `Max ${settings.te_limit || 1} TE allowed` });
      }
      if (picksCount['K'] > (settings.k_limit || 1)) {
        return res.status(400).json({ error: `Max ${settings.k_limit || 1} K allowed` });
      }
      if (picksCount['DEF'] > (settings.def_limit || 1)) {
        return res.status(400).json({ error: `Max ${settings.def_limit || 1} DEF allowed` });
      }
    }
    
    // Delete existing picks for this week
    await pool.query('DELETE FROM picks WHERE user_id = $1 AND week_number = $2', [user_id, week_number]);
    
    // Insert new picks
    for (const pick of picks) {
      await pool.query(
        `INSERT INTO picks (user_id, player_id, position, week_number, consecutive_weeks, multiplier) 
         VALUES ($1, $2, $3, $4, 0, 1.0)`,
        [user_id, pick.player_id, pick.position, week_number]
      );
    }
    
    res.json({ success: true, message: 'Picks submitted successfully' });
  } catch (error) {
    console.error('Submit picks error:', error);
    res.status(500).json({ error: 'Failed to submit picks' });
  }
});

// Delete a single pick - FIXED
app.delete('/api/picks/:pick_id', async (req, res) => {
  const { pick_id } = req.params;
  const { user_id } = req.body;
  
  try {
    // Verify pick belongs to user
    const pickCheck = await pool.query('SELECT user_id FROM picks WHERE id = $1', [pick_id]);
    
    if (pickCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Pick not found' });
    }
    
    // Compare UUIDs as strings (case-insensitive)
    const pickUserId = pickCheck.rows[0].user_id.toString().toLowerCase();
    const requestUserId = user_id.toString().toLowerCase();
    
    if (pickUserId !== requestUserId) {
      console.log('User ID mismatch:', { pickUserId, requestUserId });
      return res.status(403).json({ error: 'Not authorized to delete this pick' });
    }
    
    // Delete pick
    await pool.query('DELETE FROM picks WHERE id = $1', [pick_id]);
    
    res.json({ success: true, message: 'Pick deleted successfully' });
  } catch (error) {
    console.error('Delete pick error:', error);
    res.status(500).json({ error: 'Failed to delete pick' });
  }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id,
        u.username as name,
        u.email,
        u.paid as has_paid,
        COALESCE(SUM(s.final_points), 0) as total_points,
        COUNT(DISTINCT s.week_number) as weeks_played
      FROM users u
      LEFT JOIN scores s ON u.id = s.user_id
      GROUP BY u.id, u.username, u.email, u.paid
      ORDER BY total_points DESC, u.username
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// ============================================
// NEW V2 ENDPOINTS - RULES & CONTENT
// ============================================

// Get all rules content
app.get('/api/rules', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM rules_content 
      ORDER BY display_order
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Get rules error:', error);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

// Update rules content (admin only)
app.put('/api/rules/:id', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  
  try {
    const result = await pool.query(
      'UPDATE rules_content SET content = $1 WHERE id = $2 RETURNING *',
      [content, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rule section not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update rules error:', error);
    res.status(500).json({ error: 'Failed to update rules' });
  }
});

// ============================================
// NEW V2 ENDPOINTS - SCORING RULES
// ============================================

// Get all scoring rules
app.get('/api/scoring-rules', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM scoring_rules 
      WHERE is_active = true 
      ORDER BY category, display_order
    `);
    
    // Group by category
    const grouped = result.rows.reduce((acc, rule) => {
      if (!acc[rule.category]) acc[rule.category] = [];
      acc[rule.category].push(rule);
      return acc;
    }, {});
    
    res.json(grouped);
  } catch (error) {
    console.error('Get scoring rules error:', error);
    res.status(500).json({ error: 'Failed to fetch scoring rules' });
  }
});

// Update scoring rule (admin only)
app.put('/api/scoring-rules/:id', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { points, description } = req.body;
  
  try {
    const result = await pool.query(
      'UPDATE scoring_rules SET points = $1, description = $2 WHERE id = $3 RETURNING *',
      [points, description, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scoring rule not found yes' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update scoring rule error:', error);
    res.status(500).json({ error: 'Failed to update scoring rule' });
  }
});

// ============================================
// NEW V2 ENDPOINTS - PAYOUT STRUCTURE
// ============================================

// Get payout structure
app.get('/api/payouts', async (req, res) => {
  try {
    const payoutsResult = await pool.query(`
      SELECT * FROM payouts 
      ORDER BY place
    `);
    
    const settingsResult = await pool.query('SELECT entry_amount FROM game_settings LIMIT 1');
    const entryAmount = parseFloat(settingsResult.rows[0]?.entry_amount || '50');
    
    const usersResult = await pool.query('SELECT COUNT(*) as total FROM users WHERE paid = true');
    const paidUsers = parseInt(usersResult.rows[0].total);
    
    const totalPot = entryAmount * paidUsers;
    
    const payouts = payoutsResult.rows.map(payout => ({
      id: payout.id,
      place: payout.place,
      percentage: parseFloat(payout.percentage),
      description: payout.description,
      amount: (totalPot * parseFloat(payout.percentage) / 100).toFixed(2)
    }));
    
    res.json({
      payouts,
      entry_amount: entryAmount,
      paid_users: paidUsers,
      total_pot: totalPot.toFixed(2)
    });
  } catch (error) {
    console.error('Get payouts error:', error);
    res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

// Update payout structure (admin only)
app.put('/api/payouts/:id', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { percentage } = req.body;
  
  try {
    const result = await pool.query(
      'UPDATE payouts SET percentage = $1 WHERE id = $2 RETURNING *',
      [percentage, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payout not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update payout error:', error);
    res.status(500).json({ error: 'Failed to update payout' });
  }
});

// ============================================
// NEW V2 ENDPOINTS - POSITION REQUIREMENTS
// ============================================

// Get position requirements
app.get('/api/position-requirements', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM position_requirements 
      WHERE is_active = true 
      ORDER BY display_order
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Get position requirements error:', error);
    res.status(500).json({ error: 'Failed to fetch position requirements' });
  }
});

// Update position requirement (admin only)
app.put('/api/position-requirements/:id', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { required_count } = req.body;
  
  try {
    const result = await pool.query(
      'UPDATE position_requirements SET required_count = $1 WHERE id = $2 RETURNING *',
      [required_count, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Position requirement not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update position requirement error:', error);
    res.status(500).json({ error: 'Failed to update position requirement' });
  }
});

// ============================================
// ADMIN ENDPOINTS
// ============================================

// Get all users (admin only)
app.get('/api/admin/users', async (req, res) => {
  const { user_id } = req.query;
  
  try {
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [user_id]);
    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const result = await pool.query('SELECT * FROM users ORDER BY username');
    res.json(result.rows);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Update user payment status (admin only)
app.put('/api/admin/users/:id/payment', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { has_paid } = req.body;
  
  try {
    const result = await pool.query(
      'UPDATE users SET paid = $1 WHERE id = $2 RETURNING *',
      [has_paid, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update payment error:', error);
    res.status(500).json({ error: 'Failed to update payment status' });
  }
});

// Get game settings
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM game_settings LIMIT 1');
    res.json(result.rows[0] || {});
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Get position limits for settings endpoint
app.get('/api/settings/position-limits', async (req, res) => {
  try {
    const result = await pool.query('SELECT qb_limit, rb_limit, wr_limit, te_limit, k_limit, def_limit FROM game_settings LIMIT 1');
    if (result.rows.length === 0) {
      return res.json({ QB: 1, RB: 2, WR: 3, TE: 1, K: 1, DEF: 1 });
    }
    
    const settings = result.rows[0];
    res.json({
      QB: settings.qb_limit || 1,
      RB: settings.rb_limit || 2,
      WR: settings.wr_limit || 3,
      TE: settings.te_limit || 1,
      K: settings.k_limit || 1,
      DEF: settings.def_limit || 1
    });
  } catch (error) {
    console.error('Get position limits error:', error);
    res.status(500).json({ error: 'Failed to fetch position limits' });
  }
});

// Update game settings (admin only)
app.put('/api/settings', verifyAdmin, async (req, res) => {
  const { entry_amount, venmo_handle, cashapp_handle, zelle_handle, qb_limit, rb_limit, wr_limit, te_limit, k_limit, def_limit } = req.body;
  
  try {
    // Get the first (and likely only) settings record
    const existingResult = await pool.query('SELECT id FROM game_settings LIMIT 1');
    
    if (existingResult.rows.length === 0) {
      // Insert if doesn't exist
      const result = await pool.query(`
        INSERT INTO game_settings (entry_amount, venmo_handle, cashapp_handle, zelle_handle, qb_limit, rb_limit, wr_limit, te_limit, k_limit, def_limit)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `, [entry_amount, venmo_handle, cashapp_handle, zelle_handle, qb_limit || 1, rb_limit || 2, wr_limit || 3, te_limit || 1, k_limit || 1, def_limit || 1]);
      return res.json(result.rows[0]);
    }
    
    const settingsId = existingResult.rows[0].id;
    
    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (entry_amount !== undefined) {
      updates.push(`entry_amount = $${paramCount++}`);
      values.push(entry_amount);
    }
    if (venmo_handle !== undefined) {
      updates.push(`venmo_handle = $${paramCount++}`);
      values.push(venmo_handle);
    }
    if (cashapp_handle !== undefined) {
      updates.push(`cashapp_handle = $${paramCount++}`);
      values.push(cashapp_handle);
    }
    if (zelle_handle !== undefined) {
      updates.push(`zelle_handle = $${paramCount++}`);
      values.push(zelle_handle);
    }
    if (qb_limit !== undefined) {
      updates.push(`qb_limit = $${paramCount++}`);
      values.push(qb_limit);
    }
    if (rb_limit !== undefined) {
      updates.push(`rb_limit = $${paramCount++}`);
      values.push(rb_limit);
    }
    if (wr_limit !== undefined) {
      updates.push(`wr_limit = $${paramCount++}`);
      values.push(wr_limit);
    }
    if (te_limit !== undefined) {
      updates.push(`te_limit = $${paramCount++}`);
      values.push(te_limit);
    }
    if (k_limit !== undefined) {
      updates.push(`k_limit = $${paramCount++}`);
      values.push(k_limit);
    }
    if (def_limit !== undefined) {
      updates.push(`def_limit = $${paramCount++}`);
      values.push(def_limit);
    }
    
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(settingsId);
    
    const result = await pool.query(`
      UPDATE game_settings 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `, values);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Sync players from Sleeper API (admin only)
app.post('/api/admin/sync-players', verifyAdmin, async (req, res) => {
  try {
    const response = await fetch('https://api.sleeper.app/v1/players/nfl');
    
    if (!response.ok) {
      throw new Error(`Sleeper API error: ${response.status}`);
    }
    
    const players = await response.json();
    
    let syncedCount = 0;
    
    // Only sync top players by position
    const positionLimits = { QB: 3, RB: 3, WR: 3, TE: 2, K: 1, DEF: 1 };
    const teamCounts = {};
    
    for (const playerId in players) {
      const player = players[playerId];
      
      if (!player.active || player.status === 'Inactive') continue;
      
      const position = player.position;
      const team = player.team;
      
      if (!positionLimits[position] || !team) continue;
      
      const teamKey = `${team}_${position}`;
      teamCounts[teamKey] = (teamCounts[teamKey] || 0) + 1;
      
      if (teamCounts[teamKey] > positionLimits[position]) continue;
      
      const fullName = player.full_name || `${player.first_name} ${player.last_name}`;
      
      await pool.query(`
        INSERT INTO players (id, sleeper_id, full_name, name, position, team, is_active, available)
        VALUES ($1, $2, $3, $3, $4, $5, true, true)
        ON CONFLICT (id) 
        DO UPDATE SET 
          sleeper_id = $2,
          full_name = $3, 
          name = $3,
          position = $4, 
          team = $5, 
          is_active = true,
          available = true
      `, [playerId, playerId, fullName, position, team]);
      
      syncedCount++;
    }
    
    res.json({ success: true, synced_count: syncedCount });
  } catch (error) {
    console.error('Sync players error:', error);
    res.status(500).json({ error: 'Failed to sync players' });
  }
});

// Get game status and week configuration
app.get('/api/game/status', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        playoff_start_week,
        current_playoff_week,
        season_year,
        CASE 
          WHEN current_playoff_week = 0 THEN 'Not Started'
          WHEN current_playoff_week = 1 THEN 'Wild Card Round'
          WHEN current_playoff_week = 2 THEN 'Divisional Round'
          WHEN current_playoff_week = 3 THEN 'Conference Championships'
          WHEN current_playoff_week = 4 THEN 'Super Bowl'
          ELSE 'Season Complete'
        END as current_round,
        (playoff_start_week + current_playoff_week - 1) as current_nfl_week
      FROM game_settings 
      LIMIT 1
    `);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Game settings not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get game status error:', error);
    res.status(500).json({ error: 'Failed to get game status' });
  }
});

// Admin: Configure playoff start week
app.post('/api/admin/game/configure', verifyAdmin, async (req, res) => {
  const { playoff_start_week, season_year } = req.body;
  
  if (!playoff_start_week) {
    return res.status(400).json({ error: 'playoff_start_week required' });
  }
  
  try {
    const result = await pool.query(`
      UPDATE game_settings 
      SET 
        playoff_start_week = $1,
        season_year = $2,
        updated_at = NOW()
      RETURNING *
    `, [playoff_start_week, season_year || '2024']);
    
    console.log(`Game configured: Start Week ${playoff_start_week}, Season ${season_year || '2024'}`);
    
    res.json({
      success: true,
      message: `Playoff start week set to ${playoff_start_week}`,
      settings: result.rows[0]
    });
  } catch (error) {
    console.error('Configure game error:', error);
    res.status(500).json({ error: 'Failed to configure game' });
  }
});

// Admin: Activate playoff week
app.post('/api/admin/game/activate-week', verifyAdmin, async (req, res) => {
  const { playoff_week } = req.body;
  
  if (!playoff_week || playoff_week < 1 || playoff_week > 4) {
    return res.status(400).json({ error: 'playoff_week must be 1-4' });
  }
  
  try {
    const result = await pool.query(`
      UPDATE game_settings 
      SET 
        current_playoff_week = $1,
        updated_at = NOW()
      RETURNING 
        playoff_start_week,
        current_playoff_week,
        (playoff_start_week + $1 - 1) as nfl_week
    `, [playoff_week]);
    
    const settings = result.rows[0];
    
    console.log(`Activated Playoff Week ${playoff_week} (NFL Week ${settings.nfl_week})`);
    
    res.json({
      success: true,
      message: `Activated playoff week ${playoff_week}`,
      playoff_week: playoff_week,
      nfl_week: settings.nfl_week
    });
  } catch (error) {
    console.error('Activate week error:', error);
    res.status(500).json({ error: 'Failed to activate week' });
  }
});

// Admin: Get week mapping (for UI display)
app.get('/api/admin/game/week-mapping', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT playoff_start_week FROM game_settings LIMIT 1
    `);
    
    const startWeek = result.rows[0]?.playoff_start_week || 19;
    
    const mapping = [
      { playoff_week: 1, display_name: 'Wild Card', nfl_week: startWeek },
      { playoff_week: 2, display_name: 'Divisional', nfl_week: startWeek + 1 },
      { playoff_week: 3, display_name: 'Conference', nfl_week: startWeek + 2 },
      { playoff_week: 4, display_name: 'Super Bowl', nfl_week: startWeek + 3 }
    ];
    
    res.json({
      playoff_start_week: startWeek,
      mapping: mapping
    });
  } catch (error) {
    console.error('Get week mapping error:', error);
    res.status(500).json({ error: 'Failed to get week mapping' });
  }
});

// ============================================
// SCORE SYNC ENDPOINTS
// ============================================

// UPDATED: Score sync now uses dynamic week calculation
app.post('/api/admin/sync-scores', verifyAdmin, async (req, res) => {
  const { playoff_week, force_nfl_week } = req.body;
  
  if (!playoff_week && !force_nfl_week) {
    return res.status(400).json({ error: 'playoff_week or force_nfl_week required' });
  }
  
  try {
    console.log(`Starting score sync for Playoff Week ${playoff_week || 'N/A'}`);
    
    // Get game settings
    const settingsResult = await pool.query(`
      SELECT playoff_start_week, season_year FROM game_settings LIMIT 1
    `);
    
    if (settingsResult.rows.length === 0) {
      return res.status(500).json({ error: 'Game settings not configured' });
    }
    
    const settings = settingsResult.rows[0];
    const season = settings.season_year || '2024';
    
    // Calculate NFL week
    const nflWeek = force_nfl_week || (settings.playoff_start_week + playoff_week - 1);
    
    console.log(`Using NFL Week ${nflWeek} for Season ${season}`);
    
    // Get all picks for this playoff week
    const picksResult = await pool.query(`
      SELECT DISTINCT ON (p.player_id)
        p.id as pick_id,
        p.user_id,
        p.player_id,
        p.week_number as playoff_week,
        COALESCE(p.multiplier, 1.0) as multiplier,
        COALESCE(p.consecutive_weeks, 0) as consecutive_weeks,
        COALESCE(pl.sleeper_id, pl.id) as sleeper_id,
        COALESCE(pl.full_name, pl.name) as full_name,
        pl.position
      FROM picks p
      JOIN players pl ON p.player_id = pl.id
      WHERE p.week_number = $1 AND COALESCE(pl.sleeper_id, pl.id) IS NOT NULL
    `, [playoff_week]);
    
    const picks = picksResult.rows;
    console.log(`Found ${picks.length} picks for Playoff Week ${playoff_week}`);
    
    if (picks.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No picks found for this week',
        scores_updated: 0,
        nfl_week: nflWeek
      });
    }
    
    // Fetch stats from Sleeper API
    const sleeperStatsUrl = `https://api.sleeper.app/v1/stats/nfl/${season}/${nflWeek}`;
    console.log(`Fetching from: ${sleeperStatsUrl}`);
    
    const sleeperResponse = await fetch(sleeperStatsUrl);
    
    if (!sleeperResponse.ok) {
      throw new Error(`Sleeper API returned ${sleeperResponse.status}`);
    }
    
    const sleeperStats = await sleeperResponse.json();
    console.log(`Fetched stats for ${Object.keys(sleeperStats).length} players from Sleeper`);
    
    // Get scoring rules
    const rulesResult = await pool.query('SELECT * FROM scoring_rules WHERE is_active = true');
    const scoringRules = rulesResult.rows.reduce((acc, rule) => {
      acc[rule.stat_name] = parseFloat(rule.points);
      return acc;
    }, {});
    
    console.log(`Loaded ${Object.keys(scoringRules).length} scoring rules`);
    
    // Calculate and save scores for each pick
    let updatedCount = 0;
    let errors = [];
    
    for (const pick of picks) {
      try {
        const playerStats = sleeperStats[pick.sleeper_id];
        
        if (!playerStats) {
          console.log(`No stats found for ${pick.full_name} (${pick.sleeper_id})`);
          continue;
        }
        
        // Calculate base points
        let basePoints = 0;
        const statBreakdown = {};
        
        // Apply each scoring rule
        for (const [statName, statPoints] of Object.entries(scoringRules)) {
          if (statName.includes('bonus')) continue;
          
          const statValue = parseFloat(playerStats[statName] || 0);
          if (statValue !== 0) {
            const points = statValue * statPoints;
            basePoints += points;
            statBreakdown[statName] = {
              value: statValue,
              points: statPoints,
              total: points
            };
          }
        }
        
        // Bonus yards
        const passYards = parseFloat(playerStats.pass_yd || 0);
        if (passYards >= 400 && scoringRules.pass_yd_bonus_400) {
          const bonusPoints = scoringRules.pass_yd_bonus_400;
          basePoints += bonusPoints;
          statBreakdown['pass_yd_bonus_400'] = {
            value: passYards,
            points: bonusPoints,
            total: bonusPoints
          };
        }
        
        const rushYards = parseFloat(playerStats.rush_yd || 0);
        if (rushYards >= 150 && scoringRules.rush_yd_bonus_150) {
          const bonusPoints = scoringRules.rush_yd_bonus_150;
          basePoints += bonusPoints;
          statBreakdown['rush_yd_bonus_150'] = {
            value: rushYards,
            points: bonusPoints,
            total: bonusPoints
          };
        }
        
        const recYards = parseFloat(playerStats.rec_yd || 0);
        if (recYards >= 150 && scoringRules.rec_yd_bonus_150) {
          const bonusPoints = scoringRules.rec_yd_bonus_150;
          basePoints += bonusPoints;
          statBreakdown['rec_yd_bonus_150'] = {
            value: recYards,
            points: bonusPoints,
            total: bonusPoints
          };
        }
        
        // Defense points allowed
        if (pick.position === 'DEF') {
          const ptsAllow = parseFloat(playerStats.pts_allow || 0);
          let ptsAllowRule = null;
          
          if (ptsAllow === 0) ptsAllowRule = 'pts_allow_0';
          else if (ptsAllow >= 1 && ptsAllow <= 6) ptsAllowRule = 'pts_allow_1_6';
          else if (ptsAllow >= 7 && ptsAllow <= 13) ptsAllowRule = 'pts_allow_7_13';
          else if (ptsAllow >= 14 && ptsAllow <= 20) ptsAllowRule = 'pts_allow_14_20';
          else if (ptsAllow >= 21 && ptsAllow <= 27) ptsAllowRule = 'pts_allow_21_27';
          else if (ptsAllow >= 28 && ptsAllow <= 34) ptsAllowRule = 'pts_allow_28_34';
          else if (ptsAllow >= 35) ptsAllowRule = 'pts_allow_35p';
          
          if (ptsAllowRule && scoringRules[ptsAllowRule]) {
            const points = scoringRules[ptsAllowRule];
            basePoints += points;
            statBreakdown[ptsAllowRule] = {
              value: ptsAllow,
              points: points,
              total: points
            };
          }
        }
        
        // Apply multiplier
        const multiplier = parseFloat(pick.multiplier) || 1.0;
        const finalPoints = basePoints * multiplier;
        
        console.log(`${pick.full_name}: Base=${basePoints.toFixed(2)}, Multiplier=${multiplier}x, Final=${finalPoints.toFixed(2)}`);
        
        // Save to database (using playoff_week)
        await pool.query(`
          INSERT INTO scores (
            user_id, 
            player_id, 
            week_number, 
            base_points, 
            multiplier, 
            final_points,
            stats_json,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT (user_id, player_id, week_number)
          DO UPDATE SET 
            base_points = $4,
            multiplier = $5,
            final_points = $6,
            stats_json = $7,
            updated_at = NOW()
        `, [
          pick.user_id,
          pick.player_id,
          pick.playoff_week,
          basePoints.toFixed(2),
          multiplier,
          finalPoints.toFixed(2),
          JSON.stringify({ ...playerStats, breakdown: statBreakdown, nfl_week: nflWeek })
        ]);
        
        updatedCount++;
      } catch (error) {
        console.error(`Error processing pick ${pick.pick_id}:`, error);
        errors.push({
          player: pick.full_name,
          error: error.message
        });
      }
    }
    
    console.log(`Score sync complete: ${updatedCount} scores updated`);
    
    res.json({ 
      success: true,
      scores_updated: updatedCount,
      total_picks: picks.length,
      playoff_week: playoff_week,
      nfl_week: nflWeek,
      season: season,
      errors: errors.length > 0 ? errors : undefined,
      message: `Synced scores for ${updatedCount} out of ${picks.length} picks (NFL Week ${nflWeek})`
    });
    
  } catch (error) {
    console.error('Sync scores error:', error);
    res.status(500).json({ 
      error: 'Failed to sync scores', 
      details: error.message 
    });
  }
});

// Helper endpoint to test week calculations
app.get('/api/admin/game/test-weeks', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT playoff_start_week FROM game_settings LIMIT 1
    `);
    
    const startWeek = result.rows[0]?.playoff_start_week || 19;
    
    const testCases = [];
    for (let i = 1; i <= 4; i++) {
      testCases.push({
        playoff_week: i,
        nfl_week: startWeek + (i - 1),
        round_name: ['Wild Card', 'Divisional', 'Conference', 'Super Bowl'][i - 1]
      });
    }
    
    res.json({
      playoff_start_week: startWeek,
      test_cases: testCases
    });
  } catch (error) {
    console.error('Test weeks error:', error);
    res.status(500).json({ error: 'Failed to test weeks' });
  }
});

// Get scores for a specific user and week
app.get('/api/scores/user/:userId/week/:weekNumber', async (req, res) => {
  const { userId, weekNumber } = req.params;
  
  try {
    const result = await pool.query(`
      SELECT 
        s.*,
        COALESCE(p.full_name, p.name) as full_name,
        p.position,
        p.team,
        pi.consecutive_weeks,
        pi.multiplier as pick_multiplier
      FROM scores s
      JOIN players p ON s.player_id = p.id
      LEFT JOIN picks pi ON s.user_id = pi.user_id 
        AND s.player_id = pi.player_id 
        AND s.week_number = pi.week_number
      WHERE s.user_id = $1 AND s.week_number = $2
      ORDER BY p.position, s.final_points DESC
    `, [userId, weekNumber]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get scores error:', error);
    res.status(500).json({ error: 'Failed to fetch scores' });
  }
});

// Get all scores for a specific week (for leaderboard)
app.get('/api/scores/week/:weekNumber', async (req, res) => {
  const { weekNumber } = req.params;
  
  try {
    const result = await pool.query(`
      SELECT 
        u.id,
        u.username,
        u.team_name,
        u.paid,
        SUM(s.final_points) as week_points
      FROM users u
      JOIN scores s ON u.id = s.user_id
      WHERE s.week_number = $1
      GROUP BY u.id, u.username, u.team_name, u.paid
      ORDER BY week_points DESC
    `, [weekNumber]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get week scores error:', error);
    res.status(500).json({ error: 'Failed to fetch week scores' });
  }
});

// Get player stats breakdown (detailed view)
app.get('/api/scores/:scoreId/breakdown', async (req, res) => {
  const { scoreId } = req.params;
  
  try {
    const result = await pool.query(`
      SELECT 
        s.id,
        s.base_points,
        s.multiplier,
        s.final_points,
        s.stats_json,
        COALESCE(p.full_name, p.name) as full_name,
        p.position,
        p.team
      FROM scores s
      JOIN players p ON s.player_id = p.id
      WHERE s.id = $1
    `, [scoreId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Score not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get score breakdown error:', error);
    res.status(500).json({ error: 'Failed to fetch score breakdown' });
  }
});

// Admin: Manual score override (for corrections)
app.put('/api/admin/scores/:scoreId', verifyAdmin, async (req, res) => {
  const { scoreId } = req.params;
  const { base_points, notes } = req.body;
  
  if (base_points === undefined) {
    return res.status(400).json({ error: 'base_points required' });
  }
  
  try {
    // Get current score to recalculate final points with multiplier
    const currentResult = await pool.query('SELECT multiplier FROM scores WHERE id = $1', [scoreId]);
    
    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Score not found' });
    }
    
    const multiplier = currentResult.rows[0].multiplier || 1.0;
    const finalPoints = base_points * multiplier;
    
    const result = await pool.query(`
      UPDATE scores 
      SET base_points = $1, final_points = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [base_points, finalPoints, scoreId]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update score error:', error);
    res.status(500).json({ error: 'Failed to update score' });
  }
});

// Get available weeks (weeks that have picks)
app.get('/api/weeks/available', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT week_number
      FROM picks
      ORDER BY week_number
    `);
    
    const weeks = result.rows.map(row => ({
      week_number: row.week_number,
      display_name: getWeekDisplayName(row.week_number)
    }));
    
    res.json(weeks);
  } catch (error) {
    console.error('Get available weeks error:', error);
    res.status(500).json({ error: 'Failed to fetch available weeks' });
  }
});

// Helper function for week display names
function getWeekDisplayName(weekNumber) {
  const weekNames = {
    1: 'Wild Card',
    2: 'Divisional',
    3: 'Conference',
    4: 'Super Bowl'
  };
  return weekNames[weekNumber] || `Week ${weekNumber}`;
}



// ============================================
// START SERVER
// ============================================

app.listen(port, () => {
  console.log(`Playoff Challenge API V2 listening on port ${port}`);
});