const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// In-memory cache for live stats
const liveStatsCache = {
  games: new Map(),
  playerStats: new Map(),
  lastScoreboardUpdate: null,
  lastGameUpdates: new Map(),
  activeGameIds: new Set()
};

// Cache duration in milliseconds
const SCOREBOARD_CACHE_MS = 10 * 60 * 1000; // 10 minutes
const GAME_SUMMARY_CACHE_MS = 90 * 1000; // 90 seconds

// Helper: Map ESPN athlete ID to our player ID
async function mapESPNAthleteToPlayer(athleteId, athleteName) {
  try {
    // First try exact ESPN ID match
    let result = await pool.query(
      'SELECT id FROM players WHERE espn_id = $1 LIMIT 1',
      [athleteId.toString()]
    );
    
    if (result.rows.length > 0) {
      return result.rows[0].id;
    }
    
    // Fallback: try name matching (fuzzy)
    if (athleteName) {
      const nameParts = athleteName.trim().split(' ');
      if (nameParts.length >= 2) {
        const firstName = nameParts[0];
        const lastName = nameParts[nameParts.length - 1];
        
        result = await pool.query(
          `SELECT id FROM players 
           WHERE LOWER(first_name) = LOWER($1) 
           AND LOWER(last_name) = LOWER($2) 
           LIMIT 1`,
          [firstName, lastName]
        );
        
        if (result.rows.length > 0) {
          // Store the ESPN ID for future lookups
          await pool.query(
            'UPDATE players SET espn_id = $1 WHERE id = $2',
            [athleteId.toString(), result.rows[0].id]
          );
          return result.rows[0].id;
        }
      }
    }
    
    return null;
  } catch (err) {
    console.error('Error mapping ESPN athlete:', err);
    return null;
  }
}

// Helper: Parse stats from ESPN game summary
function parsePlayerStatsFromSummary(boxscore) {
  const playerStats = [];
  
  if (!boxscore || !boxscore.players) return playerStats;
  
  for (const team of boxscore.players) {
    if (!team.statistics) continue;
    
    for (const statGroup of team.statistics) {
      if (!statGroup.athletes) continue;
      
      for (const athlete of statGroup.athletes) {
        const athleteId = athlete.athlete?.id;
        const athleteName = athlete.athlete?.displayName || athlete.athlete?.shortName;
        
        if (!athleteId) continue;
        
        const stats = {
          athleteId: athleteId.toString(),
          athleteName: athleteName || 'Unknown',
          stats: {}
        };
        
        // Parse stat labels and values
        if (statGroup.labels && athlete.stats) {
          for (let i = 0; i < statGroup.labels.length; i++) {
            const label = statGroup.labels[i];
            const value = athlete.stats[i];
            
            // Map ESPN stat names to our stat names
            if (label && value) {
              stats.stats[label] = value;
            }
          }
        }
        
        playerStats.push(stats);
      }
    }
  }
  
  return playerStats;
}

// Helper: Convert ESPN stats to our scoring format
function convertESPNStatsToScoring(espnStats) {
  const scoring = {
    pass_yd: 0,
    pass_td: 0,
    pass_int: 0,
    pass_2pt: 0,
    rush_yd: 0,
    rush_td: 0,
    rush_2pt: 0,
    rec: 0,
    rec_yd: 0,
    rec_td: 0,
    rec_2pt: 0,
    fum_lost: 0
  };
  
  if (!espnStats) return scoring;
  
  // Passing stats
  if (espnStats['C/ATT']) {
    // Format: "20/30" (completions/attempts)
    const parts = espnStats['C/ATT'].split('/');
    // We don't score completions, but we might need this
  }
  if (espnStats['YDS']) scoring.pass_yd = parseFloat(espnStats['YDS']) || 0;
  if (espnStats['TD']) scoring.pass_td = parseInt(espnStats['TD']) || 0;
  if (espnStats['INT']) scoring.pass_int = parseInt(espnStats['INT']) || 0;
  
  // Rushing stats
  if (espnStats['CAR']) {
    // Carries - we don't score this
  }
  if (espnStats['YDS']) {
    // This could be rushing yards if it's a RB
    const yds = parseFloat(espnStats['YDS']) || 0;
    // If we already have pass_yd, this might be rush_yd
    if (scoring.pass_yd === 0) {
      scoring.rush_yd = yds;
    }
  }
  if (espnStats['TD'] && scoring.pass_td === 0) {
    scoring.rush_td = parseInt(espnStats['TD']) || 0;
  }
  
  // Receiving stats
  if (espnStats['REC']) scoring.rec = parseInt(espnStats['REC']) || 0;
  if (espnStats['YDS'] && scoring.pass_yd === 0 && espnStats['REC']) {
    scoring.rec_yd = parseFloat(espnStats['YDS']) || 0;
  }
  if (espnStats['TD'] && scoring.pass_td === 0 && scoring.rush_td === 0) {
    scoring.rec_td = parseInt(espnStats['TD']) || 0;
  }
  
  // Fumbles
  if (espnStats['FUM']) scoring.fum_lost = parseInt(espnStats['FUM']) || 0;
  
  return scoring;
}

// Fetch scoreboard to get active games
async function fetchScoreboard() {
  try {
    const now = Date.now();
    
    // Check cache
    if (liveStatsCache.lastScoreboardUpdate && 
        (now - liveStatsCache.lastScoreboardUpdate) < SCOREBOARD_CACHE_MS) {
      return Array.from(liveStatsCache.activeGameIds);
    }
    
    console.log('Fetching ESPN scoreboard...');
    const response = await axios.get(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
    );
    
    const activeGames = [];
    
    if (response.data && response.data.events) {
      for (const event of response.data.events) {
        const gameId = event.id;
        const status = event.status?.type?.state;
        
        // Only track in-progress or recently completed games
        if (status === 'in' || status === 'post') {
          activeGames.push(gameId);
          
          // Store basic game info
          liveStatsCache.games.set(gameId, {
            id: gameId,
            name: event.name,
            shortName: event.shortName,
            status: status,
            homeTeam: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.team?.abbreviation,
            awayTeam: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away')?.team?.abbreviation
          });
        }
      }
    }
    
    liveStatsCache.activeGameIds = new Set(activeGames);
    liveStatsCache.lastScoreboardUpdate = now;
    
    console.log(`Found ${activeGames.length} active games`);
    return activeGames;
  } catch (err) {
    console.error('Error fetching scoreboard:', err.message);
    return [];
  }
}

// Fetch game summary for specific game
async function fetchGameSummary(gameId) {
  try {
    const now = Date.now();
    const lastUpdate = liveStatsCache.lastGameUpdates.get(gameId);
    
    // Check cache
    if (lastUpdate && (now - lastUpdate) < GAME_SUMMARY_CACHE_MS) {
      return false; // Already up to date
    }
    
    console.log(`Fetching summary for game ${gameId}...`);
    const response = await axios.get(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`
    );
    
    if (response.data && response.data.boxscore) {
      const playerStats = parsePlayerStatsFromSummary(response.data.boxscore);
      
      // Update cache
      for (const stat of playerStats) {
        liveStatsCache.playerStats.set(stat.athleteId, {
          ...stat,
          gameId: gameId,
          updatedAt: now
        });
      }
      
      liveStatsCache.lastGameUpdates.set(gameId, now);
      console.log(`Updated ${playerStats.length} player stats from game ${gameId}`);
      return true;
    }
    
    return false;
  } catch (err) {
    console.error(`Error fetching game summary ${gameId}:`, err.message);
    return false;
  }
}

// Get teams that have active picks this week
async function getActiveTeamsForWeek(weekNumber) {
  try {
    const result = await pool.query(`
      SELECT DISTINCT p.team
      FROM picks pk
      JOIN players p ON pk.player_id = p.id
      WHERE pk.week_number = $1 AND p.team IS NOT NULL
    `, [weekNumber]);
    
    return result.rows.map(r => r.team);
  } catch (err) {
    console.error('Error getting active teams:', err);
    return [];
  }
}

// Main live stats update function
async function updateLiveStats(weekNumber) {
  try {
    console.log(`\n=== Updating live stats for week ${weekNumber} ===`);
    
    // Step 1: Get active games
    const activeGameIds = await fetchScoreboard();
    if (activeGameIds.length === 0) {
      console.log('No active games found');
      return { success: true, message: 'No active games', gamesUpdated: 0 };
    }
    
    // Step 2: Get teams we care about
    const activeTeams = await getActiveTeamsForWeek(weekNumber);
    console.log(`Tracking teams: ${activeTeams.join(', ')}`);
    
    // Step 3: Filter games to only those with our teams
    const relevantGames = [];
    for (const gameId of activeGameIds) {
      const gameInfo = liveStatsCache.games.get(gameId);
      if (gameInfo && 
          (activeTeams.includes(gameInfo.homeTeam) || activeTeams.includes(gameInfo.awayTeam))) {
        relevantGames.push(gameId);
      }
    }
    
    console.log(`Found ${relevantGames.length} relevant games out of ${activeGameIds.length} active`);
    
    // Step 4: Fetch summaries for relevant games
    let gamesUpdated = 0;
    for (const gameId of relevantGames) {
      const updated = await fetchGameSummary(gameId);
      if (updated) gamesUpdated++;
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return {
      success: true,
      message: `Updated ${gamesUpdated} games`,
      gamesUpdated: gamesUpdated,
      totalActiveGames: activeGameIds.length,
      relevantGames: relevantGames.length
    };
  } catch (err) {
    console.error('Error in updateLiveStats:', err);
    return { success: false, error: err.message };
  }
}

// Calculate fantasy points from stats
async function calculateFantasyPoints(stats) {
  try {
    const rulesResult = await pool.query(
      'SELECT stat_name, points FROM scoring_rules WHERE is_active = true'
    );
    
    const rules = {};
    for (const row of rulesResult.rows) {
      rules[row.stat_name] = parseFloat(row.points);
    }
    
    let points = 0;
    
    // Passing
    points += (stats.pass_yd || 0) * (rules.pass_yd || 0);
    points += (stats.pass_td || 0) * (rules.pass_td || 0);
    points += (stats.pass_int || 0) * (rules.pass_int || 0);
    points += (stats.pass_2pt || 0) * (rules.pass_2pt || 0);
    
    // Rushing
    points += (stats.rush_yd || 0) * (rules.rush_yd || 0);
    points += (stats.rush_td || 0) * (rules.rush_td || 0);
    points += (stats.rush_2pt || 0) * (rules.rush_2pt || 0);
    
    // Receiving
    points += (stats.rec || 0) * (rules.rec || 0);
    points += (stats.rec_yd || 0) * (rules.rec_yd || 0);
    points += (stats.rec_td || 0) * (rules.rec_td || 0);
    points += (stats.rec_2pt || 0) * (rules.rec_2pt || 0);
    
    // Fumbles
    points += (stats.fum_lost || 0) * (rules.fum_lost || 0);
    
    // Bonuses
    if (stats.pass_yd >= 400) points += (rules.pass_yd_bonus || 0);
    if (stats.rush_yd >= 150) points += (rules.rush_yd_bonus || 0);
    if (stats.rec_yd >= 150) points += (rules.rec_yd_bonus || 0);
    
    return parseFloat(points.toFixed(2));
  } catch (err) {
    console.error('Error calculating points:', err);
    return 0;
  }
}

// API ROUTES

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get live stats for a specific player
app.get('/api/live-stats/player/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    
    // Get player info including ESPN ID
    const playerResult = await pool.query(
      'SELECT id, full_name, espn_id, team, position FROM players WHERE id = $1',
      [playerId]
    );
    
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    const player = playerResult.rows[0];
    
    // Check cache for live stats
    if (player.espn_id) {
      const liveStats = liveStatsCache.playerStats.get(player.espn_id);
      
      if (liveStats) {
        const scoringStats = convertESPNStatsToScoring(liveStats.stats);
        const points = await calculateFantasyPoints(scoringStats);
        
        return res.json({
          playerId: player.id,
          playerName: player.full_name,
          team: player.team,
          position: player.position,
          stats: scoringStats,
          points: points,
          isLive: true,
          updatedAt: new Date(liveStats.updatedAt).toISOString(),
          rawStats: liveStats.stats
        });
      }
    }
    
    // No live stats available
    res.json({
      playerId: player.id,
      playerName: player.full_name,
      team: player.team,
      position: player.position,
      stats: null,
      points: 0,
      isLive: false,
      message: 'No live stats available'
    });
  } catch (err) {
    console.error('Error getting live player stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get live stats for all picks in a week
app.get('/api/live-stats/week/:weekNumber', async (req, res) => {
  try {
    const { weekNumber } = req.params;
    
    // Get all picks for this week with player info
    const picksResult = await pool.query(`
      SELECT 
        pk.id as pick_id,
        pk.user_id,
        pk.player_id,
        pk.multiplier,
        p.full_name,
        p.espn_id,
        p.team,
        p.position
      FROM picks pk
      JOIN players p ON pk.player_id = p.id
      WHERE pk.week_number = $1
      ORDER BY pk.user_id, pk.position
    `, [weekNumber]);
    
    const picks = [];
    
    for (const pick of picksResult.rows) {
      let liveStats = null;
      let points = 0;
      let isLive = false;
      
      if (pick.espn_id) {
        const cached = liveStatsCache.playerStats.get(pick.espn_id);
        
        if (cached) {
          const scoringStats = convertESPNStatsToScoring(cached.stats);
          points = await calculateFantasyPoints(scoringStats);
          liveStats = scoringStats;
          isLive = true;
        }
      }
      
      picks.push({
        pickId: pick.pick_id,
        userId: pick.user_id,
        playerId: pick.player_id,
        playerName: pick.full_name,
        team: pick.team,
        position: pick.position,
        multiplier: pick.multiplier,
        basePoints: points,
        finalPoints: points * pick.multiplier,
        stats: liveStats,
        isLive: isLive
      });
    }
    
    res.json({ weekNumber: parseInt(weekNumber), picks: picks });
  } catch (err) {
    console.error('Error getting live week stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Trigger live stats update
app.post('/api/admin/update-live-stats', async (req, res) => {
  try {
    const { weekNumber } = req.body;
    
    if (!weekNumber) {
      return res.status(400).json({ error: 'weekNumber required' });
    }
    
    const result = await updateLiveStats(weekNumber);
    res.json(result);
  } catch (err) {
    console.error('Error triggering live stats update:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get cache status
app.get('/api/admin/cache-status', (req, res) => {
  res.json({
    activeGames: Array.from(liveStatsCache.games.values()),
    cachedPlayerCount: liveStatsCache.playerStats.size,
    lastScoreboardUpdate: liveStatsCache.lastScoreboardUpdate ? 
      new Date(liveStatsCache.lastScoreboardUpdate).toISOString() : null,
    gameUpdateTimes: Array.from(liveStatsCache.lastGameUpdates.entries()).map(([gameId, time]) => ({
      gameId,
      lastUpdate: new Date(time).toISOString()
    }))
  });
});

// ==============================================
// USER REGISTRATION / LOGIN
// ==============================================
app.post('/api/users', async (req, res) => {
  try {
    const { apple_id, email, name } = req.body;

    if (!apple_id) {
      return res.status(400).json({ error: 'apple_id is required' });
    }

    // Try to find existing user
    let result = await pool.query(
      'SELECT * FROM users WHERE apple_id = $1 LIMIT 1',
      [apple_id]
    );

    if (result.rows.length > 0) {
      return res.json(result.rows[0]);
    }

    // Create new user
    const insert = await pool.query(
      `INSERT INTO users (id, apple_id, email, name, username, created_at, updated_at, paid)
      VALUES (gen_random_uuid(), $1::text, $2::text, $3::text, COALESCE($3::text, $2::text), NOW(), NOW(), false)
      RETURNING *`,
      [apple_id, email || null, name || null]
    );

    res.json(insert.rows[0]);
  } catch (err) {
    console.error('Error in /api/users:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get single user by ID
app.get('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: err.message });
  }
});

// EXISTING ROUTES (keeping your original endpoints)

// Get all players
app.get('/api/players', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, sleeper_id, full_name, first_name, last_name, position, team, 
             number, status, injury_status, is_active, available
      FROM players 
      WHERE is_active = true 
      ORDER BY position, full_name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching players:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get user's picks
app.get('/api/picks/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(`
      SELECT pk.*, p.full_name, p.position, p.team
      FROM picks pk
      JOIN players p ON pk.player_id = p.id
      WHERE pk.user_id = $1
      ORDER BY pk.week_number, pk.position
    `, [userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching picks:', err);
    res.status(500).json({ error: err.message });
  }
});

// Alternative route for picks (handles /api/picks/user/:userId)
app.get('/api/picks/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(`
      SELECT pk.*, p.full_name, p.position, p.team
      FROM picks pk
      JOIN players p ON pk.player_id = p.id
      WHERE pk.user_id = $1
      ORDER BY pk.week_number, pk.position
    `, [userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching picks:', err);
    res.status(500).json({ error: err.message });
  }
});

// Submit picks
app.post('/api/picks', async (req, res) => {
  try {
    const { userId, playerId, weekNumber, position, multiplier } = req.body;
    
    const result = await pool.query(`
      INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 1, false, NOW())
      RETURNING *
    `, [userId, playerId, weekNumber, position, multiplier]);
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error creating pick:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get game config
app.get('/api/game-config', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM game_settings LIMIT 1');
    res.json(result.rows[0] || {});
  } catch (err) {
    console.error('Error fetching game config:', err);
    res.status(500).json({ error: err.message });
  }
});

// Alternative route for settings (same as game-config)
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM game_settings LIMIT 1');
    res.json(result.rows[0] || {});
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start background polling for live stats (every 2 minutes)
let liveStatsInterval = null;

async function startLiveStatsPolling() {
  // Get current playoff week
  const configResult = await pool.query('SELECT current_playoff_week FROM game_settings LIMIT 1');
  const currentWeek = configResult.rows[0]?.current_playoff_week || 1;
  
  console.log(`Starting live stats polling for week ${currentWeek}...`);
  
  // Initial update
  await updateLiveStats(currentWeek);
  
  // Poll every 2 minutes
  liveStatsInterval = setInterval(async () => {
    const config = await pool.query('SELECT current_playoff_week FROM game_settings LIMIT 1');
    const week = config.rows[0]?.current_playoff_week || 1;
    await updateLiveStats(week);
  }, 2 * 60 * 1000);
}

// ==============================================
// POSITION REQUIREMENTS ROUTES
// ==============================================

// Get all position requirements
app.get('/api/admin/position-requirements', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, position, required_count, display_name, display_order, is_active
      FROM position_requirements
      ORDER BY display_order ASC, position ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching position requirements:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update a specific position requirement
app.put('/api/admin/position-requirements/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { requiredCount } = req.body;

    if (requiredCount == null) {
      return res.status(400).json({ error: 'requiredCount is required' });
    }

    const result = await pool.query(
      `UPDATE position_requirements
       SET required_count = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, position, required_count, display_name, display_order, is_active`,
      [requiredCount, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Position requirement not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating position requirement:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Start live stats polling if in production
  if (process.env.NODE_ENV === 'production') {
    setTimeout(startLiveStatsPolling, 5000); // Start after 5 seconds
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  if (liveStatsInterval) clearInterval(liveStatsInterval);
  process.exit(0);
});