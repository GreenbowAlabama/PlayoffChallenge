require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  user: process.env.DB_USER || 'iancarter',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'playoff_challenge',
  password: process.env.DB_PASSWORD || '',
  port: process.env.DB_PORT || 5432,
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Database connected successfully');
  }
});

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Playoff Challenge API is running!' });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Auth routes
app.post('/auth/apple', async (req, res) => {
  try {
    const { appleUserId, username, email } = req.body;
    
    // Use username if provided, otherwise use email, otherwise use "User"
    const displayName = username && username !== 'User' ? username : (email || 'User');
    
    // Check if user exists
    let result = await pool.query(
      'SELECT * FROM users WHERE apple_user_id = $1',
      [appleUserId]
    );
    
    let user;
    
    if (result.rows.length === 0) {
      // Create new user
      const insertResult = await pool.query(
        'INSERT INTO users (apple_user_id, username, team_name, paid) VALUES ($1, $2, $3, $4) RETURNING *',
        [appleUserId, displayName, displayName + "'s Team", false]
      );
      user = insertResult.rows[0];
    } else {
      // User already exists
      user = result.rows[0];
    }
    
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Get user by ID
app.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Admin: Get all users
app.get('/admin/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Admin: Mark user as paid
app.put('/admin/users/:userId/payment', async (req, res) => {
  try {
    const { userId } = req.params;
    const { paid, paymentMethod } = req.body;
    
    const result = await pool.query(
      'UPDATE users SET paid = $1, payment_method = $2, payment_date = $3 WHERE id = $4 RETURNING *',
      [paid, paymentMethod, paid ? new Date() : null, userId]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update payment status' });
  }
});

// Admin: Get game settings
app.get('/admin/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM game_settings LIMIT 1');
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Settings not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Admin: Update game settings
app.put('/admin/settings', async (req, res) => {
  try {
    const { entryAmount, venmoHandle, cashappHandle, zelleHandle, gameMode } = req.body;
    
    const result = await pool.query(
      'UPDATE game_settings SET entry_amount = $1, venmo_handle = $2, cashapp_handle = $3, zelle_handle = $4, game_mode = $5, updated_at = NOW() RETURNING *',
      [entryAmount, venmoHandle, cashappHandle, zelleHandle, gameMode]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Admin: Sync players from Sleeper API
app.post('/admin/sync-players', async (req, res) => {
  try {
    console.log('Fetching players from Sleeper API...');
    
    // Fetch all NFL players from Sleeper
    const response = await fetch('https://api.sleeper.app/v1/players/nfl');
    const allPlayers = await response.json();
    
    // Playoff teams for 2024-2025 season (update these as needed)
    const playoffTeams = ['KC', 'BUF', 'BAL', 'HOU', 'LAC', 'PIT', 'DEN', 
                          'PHI', 'DET', 'TB', 'LAR', 'MIN', 'GB', 'WAS'];
    
    // Filter to relevant players
    const relevantPlayers = Object.values(allPlayers).filter(player => {
      return player.team && 
             playoffTeams.includes(player.team) && 
             player.active === true &&
             ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(player.position);
    });
    
    console.log(`Found ${relevantPlayers.length} playoff players`);
    
    // Clear existing players (optional - or update instead)
    await pool.query('DELETE FROM players');
    
    // Insert players into database
    let insertedCount = 0;
    for (const player of relevantPlayers) {
      try {
        await pool.query(
          'INSERT INTO players (id, name, position, team, available) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET name = $2, position = $3, team = $4',
          [player.player_id, player.full_name || `${player.first_name} ${player.last_name}`, player.position, player.team, true]
        );
        insertedCount++;
      } catch (err) {
        console.error(`Error inserting player ${player.full_name}:`, err.message);
      }
    }
    
    console.log(`Successfully synced ${insertedCount} players`);
    res.json({ 
      success: true, 
      count: insertedCount,
      message: `Synced ${insertedCount} players from Sleeper API`
    });
    
  } catch (err) {
    console.error('Sleeper API sync error:', err);
    res.status(500).json({ error: 'Failed to sync players from Sleeper API' });
  }
});

// Player routes
app.get('/players', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM players ORDER BY team, position');
    
    if (result.rows.length === 0) {
      return res.status(200).json({ message: 'No players found - Admins can Sync with sleeper bot', players: [] });
    }

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching players:', err);
    res.status(500).json({ error: 'Failed to fetch players' });
  }
});

// Picks routes
app.get('/picks/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      'SELECT * FROM picks WHERE user_id = $1 ORDER BY week',
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch picks' });
  }
});

app.post('/picks', async (req, res) => {
  try {
    const { userId, playerId, week } = req.body;
    const result = await pool.query(
      'INSERT INTO picks (user_id, player_id, week) VALUES ($1, $2, $3) RETURNING *',
      [userId, playerId, week]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create pick' });
  }
});

// Delete a pick
app.delete('/picks/:pickId', async (req, res) => {
  try {
    const { pickId } = req.params;
    await pool.query('DELETE FROM picks WHERE id = $1', [pickId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete pick' });
  }
});

// Leaderboard route
app.get('/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, 
        u.username, 
        u.team_name,
        COALESCE(SUM(s.points), 0) as total_points
      FROM users u
      LEFT JOIN scores s ON u.id = s.user_id
      WHERE u.paid = true
      GROUP BY u.id, u.username, u.team_name
      ORDER BY total_points DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// User payment status
app.get('/user/:userId/payment-status', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      'SELECT paid FROM users WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ paid: result.rows[0].paid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to check payment status' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;