// ============================================
// Playoff Challenge Backend API V2
// Enhanced with Rules, Scoring, Payouts, Multipliers
// ============================================

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

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
        name as full_name,
        position,
        team,
        available as is_active,
        id as sleeper_id,
        NULL as game_time
      FROM players 
      WHERE available = true 
      ORDER BY position, team, name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Get players error:', error);
    res.status(500).json({ error: 'Failed to fetch players' });
  }
});

// Get user picks
app.get('/api/picks/:user_id', async (req, res) => {
  const { user_id } = req.params;
  
  try {
    const result = await pool.query(`
      SELECT 
        p.id,
        p.user_id,
        p.player_id,
        'FLEX' as position,
        p.week as week_number,
        pl.name as full_name,
        pl.team,
        pl.position as player_position,
        pl.id as sleeper_id,
        pm.consecutive_weeks,
        pm.multiplier,
        pm.is_bye_week
      FROM picks p
      JOIN players pl ON p.player_id = pl.id
      LEFT JOIN pick_multipliers pm ON p.id = pm.pick_id AND pm.week_number = p.week
      WHERE p.user_id = $1
      ORDER BY p.week, pl.position
    `, [user_id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get picks error:', error);
    res.status(500).json({ error: 'Failed to fetch picks' });
  }
});

// Submit picks
app.post('/api/picks', async (req, res) => {
  const { user_id, picks, week_number } = req.body;
  
  try {
    // Validate position requirements
    const reqResult = await pool.query('SELECT * FROM position_requirements WHERE is_active = true');
    const requirements = reqResult.rows;
    
    const picksCount = {};
    picks.forEach(pick => {
      picksCount[pick.position] = (picksCount[pick.position] || 0) + 1;
    });
    
    for (const req of requirements) {
      if (picksCount[req.position] !== req.required_count) {
        return res.status(400).json({ 
          error: `Invalid roster: Need ${req.required_count} ${req.display_name}` 
        });
      }
    }
    
    // Delete existing picks for this week
    await pool.query('DELETE FROM picks WHERE user_id = $1 AND week_number = $2', [user_id, week_number]);
    
    // Insert new picks
    for (const pick of picks) {
      const pickResult = await pool.query(
        'INSERT INTO picks (user_id, player_id, week) VALUES ($1, $2, $3) RETURNING id',
        [user_id, pick.player_id, week_number]
      );
      
      // Initialize multiplier
      const pickId = pickResult.rows[0].id;
      await pool.query(
        'INSERT INTO pick_multipliers (pick_id, week_number, consecutive_weeks, multiplier) VALUES ($1, $2, 1, 1.0)',
        [pickId, week_number]
      );
    }
    
    res.json({ success: true, message: 'Picks submitted successfully' });
  } catch (error) {
    console.error('Submit picks error:', error);
    res.status(500).json({ error: 'Failed to submit picks' });
  }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id,
        u.username as name,
        NULL as email,
        COALESCE(SUM(s.points * COALESCE(pm.multiplier, 1.0)), 0) as total_points,
        u.paid as has_paid
      FROM users u
      LEFT JOIN picks p ON u.id = p.user_id
      LEFT JOIN scores s ON p.player_id = s.player_id AND p.week = s.week_number
      LEFT JOIN pick_multipliers pm ON p.id = pm.pick_id AND p.week = pm.week_number
      GROUP BY u.id, u.username, u.paid
      ORDER BY total_points DESC
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
      return res.status(404).json({ error: 'Scoring rule not found' });
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
      SELECT * FROM payout_structure 
      WHERE is_active = true 
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
      'UPDATE payout_structure SET percentage = $1 WHERE id = $2 RETURNING *',
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
// NEW V2 ENDPOINTS - PLAYER SWAPS
// ============================================

// Swap a player
app.post('/api/swaps', async (req, res) => {
  const { user_id, old_player_id, new_player_id, position, week_number } = req.body;
  
  try {
    // Get player game times to check if locked
    const oldPlayerGame = await pool.query(
      'SELECT game_time FROM players WHERE id = $1',
      [old_player_id]
    );
    
    const newPlayerGame = await pool.query(
      'SELECT game_time FROM players WHERE id = $1',
      [new_player_id]
    );
    
    // Check if either game has started (with 1 min buffer)
    if (oldPlayerGame.rows[0] && hasGameStarted(oldPlayerGame.rows[0].game_time)) {
      return res.status(400).json({ error: 'Cannot swap - old player game has started' });
    }
    
    if (newPlayerGame.rows[0] && hasGameStarted(newPlayerGame.rows[0].game_time)) {
      return res.status(400).json({ error: 'Cannot swap - new player game is starting soon' });
    }
    
    // Record the swap
    await pool.query(
      'INSERT INTO player_swaps (user_id, old_player_id, new_player_id, position, week_number) VALUES ($1, $2, $3, $4, $5)',
      [user_id, old_player_id, new_player_id, position, week_number]
    );
    
    // Update the pick
    const pickResult = await pool.query(
      'UPDATE picks SET player_id = $1 WHERE user_id = $2 AND player_id = $3 AND week_number = $4 RETURNING id',
      [new_player_id, user_id, old_player_id, week_number]
    );
    
    if (pickResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pick not found' });
    }
    
    const pickId = pickResult.rows[0].id;
    
    // Reset multiplier for this pick
    await pool.query(
      'UPDATE pick_multipliers SET consecutive_weeks = 1, multiplier = 1.0 WHERE pick_id = $1 AND week_number = $2',
      [pickId, week_number]
    );
    
    res.json({ success: true, message: 'Player swapped successfully - multiplier reset to 1x' });
  } catch (error) {
    console.error('Swap player error:', error);
    res.status(500).json({ error: 'Failed to swap player' });
  }
});

// Get swap history for user
app.get('/api/swaps/:user_id', async (req, res) => {
  const { user_id } = req.params;
  
  try {
    const result = await pool.query(`
      SELECT 
        ps.*,
        op.full_name as old_player_name,
        np.full_name as new_player_name
      FROM player_swaps ps
      JOIN players op ON ps.old_player_id = op.id
      JOIN players np ON ps.new_player_id = np.id
      WHERE ps.user_id = $1
      ORDER BY ps.swapped_at DESC
    `, [user_id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get swaps error:', error);
    res.status(500).json({ error: 'Failed to fetch swap history' });
  }
});

// ============================================
// NEW V2 ENDPOINTS - MULTIPLIER MANAGEMENT
// ============================================

// Calculate and update multipliers for next week (admin only)
app.post('/api/multipliers/calculate', verifyAdmin, async (req, res) => {
  const { current_week } = req.body;
  const next_week = current_week + 1;
  
  try {
    // Get all picks from current week
    const picksResult = await pool.query(`
      SELECT 
        p.id as pick_id,
        p.user_id,
        p.player_id,
        p.position,
        pm.consecutive_weeks,
        pm.is_bye_week
      FROM picks p
      JOIN pick_multipliers pm ON p.id = pm.pick_id
      WHERE p.week_number = $1
    `, [current_week]);
    
    for (const pick of picksResult.rows) {
      // Check if same player exists in next week
      const nextWeekPick = await pool.query(
        'SELECT id FROM picks WHERE user_id = $1 AND player_id = $2 AND week_number = $3',
        [pick.user_id, pick.player_id, next_week]
      );
      
      if (nextWeekPick.rows.length > 0) {
        // Player kept - increment consecutive weeks
        const newConsecutiveWeeks = pick.consecutive_weeks + 1;
        const newMultiplier = pick.is_bye_week ? 2.0 : newConsecutiveWeeks;
        
        await pool.query(
          'INSERT INTO pick_multipliers (pick_id, week_number, consecutive_weeks, multiplier) VALUES ($1, $2, $3, $4)',
          [nextWeekPick.rows[0].id, next_week, newConsecutiveWeeks, newMultiplier]
        );
      }
    }
    
    res.json({ success: true, message: 'Multipliers calculated for next week' });
  } catch (error) {
    console.error('Calculate multipliers error:', error);
    res.status(500).json({ error: 'Failed to calculate multipliers' });
  }
});

// Mark player as on bye (admin only)
app.post('/api/multipliers/bye', verifyAdmin, async (req, res) => {
  const { pick_id, week_number } = req.body;
  
  try {
    await pool.query(
      'UPDATE pick_multipliers SET is_bye_week = true WHERE pick_id = $1 AND week_number = $2',
      [pick_id, week_number]
    );
    
    res.json({ success: true, message: 'Player marked as on bye' });
  } catch (error) {
    console.error('Mark bye error:', error);
    res.status(500).json({ error: 'Failed to mark bye week' });
  }
});

// ============================================
// ADMIN ENDPOINTS (existing + enhancements)
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

// Update game settings (admin only)
app.put('/api/settings', verifyAdmin, async (req, res) => {
  const { entry_amount, venmo_handle, cashapp_handle, zelle_handle } = req.body;
  
  try {
    // Get the first (and likely only) settings record
    const existingResult = await pool.query('SELECT id FROM game_settings LIMIT 1');
    
    if (existingResult.rows.length === 0) {
      // Insert if doesn't exist
      const result = await pool.query(`
        INSERT INTO game_settings (entry_amount, venmo_handle, cashapp_handle, zelle_handle)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [entry_amount, venmo_handle, cashapp_handle, zelle_handle]);
      return res.json(result.rows[0]);
    }
    
    const settingsId = existingResult.rows[0].id;
    const result = await pool.query(`
      UPDATE game_settings 
      SET entry_amount = $1, venmo_handle = $2, cashapp_handle = $3, zelle_handle = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *
    `, [entry_amount, venmo_handle, cashapp_handle, zelle_handle, settingsId]);
    
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
      
      await pool.query(`
        INSERT INTO players (sleeper_id, full_name, position, team, is_active)
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT (sleeper_id) 
        DO UPDATE SET full_name = $2, position = $3, team = $4, is_active = true
      `, [playerId, player.full_name, position, team]);
      
      syncedCount++;
    }
    
    res.json({ success: true, synced_count: syncedCount });
  } catch (error) {
    console.error('Sync players error:', error);
    res.status(500).json({ error: 'Failed to sync players' });
  }
});

// ============================================
// START SERVER
// ============================================

app.listen(port, () => {
  console.log(`Playoff Challenge API V2 listening on port ${port}`);
});