const express = require('express');
const { Pool } = require('pg');
const pg = require('pg');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

pg.types.setTypeParser(1700, (v) => v === null ? null : parseFloat(v));

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

// Player cache
let playersCache = {
  data: [],
  lastUpdate: null
};

// Cache duration in milliseconds
const SCOREBOARD_CACHE_MS = 10 * 60 * 1000; // 10 minutes
const GAME_SUMMARY_CACHE_MS = 90 * 1000; // 90 seconds
const PLAYERS_CACHE_MS = 30 * 60 * 1000; // 30 minutes

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

// Fetch individual player stats from ESPN boxscore (more reliable than summaries)
async function fetchPlayerStats(espnId, weekNumber) {
  try {
    // Search through the active games for this week
    for (const gameId of liveStatsCache.activeGameIds) {
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`;
        const response = await axios.get(url);
        
        if (!response.data || !response.data.boxscore) continue;
        
        const boxscore = response.data.boxscore;
        if (!boxscore.players) continue;
        
        // Initialize stats object
        const stats = {
          pass_yd: 0,
          pass_td: 0,
          pass_int: 0,
          rush_yd: 0,
          rush_td: 0,
          rec: 0,
          rec_yd: 0,
          rec_td: 0,
          fum_lost: 0
        };
        
        let foundPlayer = false;
        const categoriesSeen = new Set();
        
        // Search through both teams
        for (const team of boxscore.players) {
          if (!team.statistics) continue;
          
          for (const statCategory of team.statistics) {
            if (!statCategory.athletes) continue;
            
            for (const athlete of statCategory.athletes) {
              // ESPN returns IDs as strings, ensure comparison works
              const athleteId = athlete.athlete?.id?.toString();
              const searchId = espnId.toString();
              
              if (athleteId === searchId) {
                foundPlayer = true;
                categoriesSeen.add(statCategory.name);
              }
            }
          }
        }
        
        // Second pass: extract stats, prioritizing primary position
        // If player has receiving stats, skip their passing stats (trick plays)
        const skipPassing = categoriesSeen.has('receiving');
        
        for (const team of boxscore.players) {
          if (!team.statistics) continue;
          
          for (const statCategory of team.statistics) {
            if (!statCategory.athletes) continue;
            
            for (const athlete of statCategory.athletes) {
              const athleteId = athlete.athlete?.id?.toString();
              const searchId = espnId.toString();
              
              if (athleteId === searchId) {
                // Skip passing if player is primarily a receiver
                if (statCategory.name === 'passing' && skipPassing) {
                  continue;
                }
                
                // Accumulate stats from this category
                if (statCategory.name === 'passing' && athlete.stats) {
                  // Format: [comp/att, yards, TD, INT]
                  const yards = parseFloat(athlete.stats[1]) || 0;
                  stats.pass_yd += yards;
                  stats.pass_td += parseFloat(athlete.stats[2]) || 0;
                  stats.pass_int += parseFloat(athlete.stats[3]) || 0;
                }
                
                if (statCategory.name === 'rushing' && athlete.stats) {
                  // Format: [carries, yards, avg, TD]
                  const yards = parseFloat(athlete.stats[1]) || 0;
                  stats.rush_yd += yards;
                  stats.rush_td += parseFloat(athlete.stats[3]) || 0;
                }
                
                if (statCategory.name === 'receiving' && athlete.stats) {
                  // Format: [rec, yards, avg, TD, targets, long]
                  stats.rec += parseFloat(athlete.stats[0]) || 0;
                  stats.rec_yd += parseFloat(athlete.stats[1]) || 0;
                  stats.rec_td += parseFloat(athlete.stats[3]) || 0;
                }
                
                if (statCategory.name === 'fumbles' && athlete.stats) {
                  // Format: [fumbles, lost]
                  stats.fum_lost += parseFloat(athlete.stats[1]) || 0;
                }
              }
            }
          }
        }
        
        if (foundPlayer) {
          return stats;
        }
      } catch (err) {
        // Continue to next game
        continue;
      }
    }
    
    return null;
  } catch (err) {
    console.error(`Error fetching player stats for ESPN ID ${espnId}:`, err.message);
    return null;
  }
}

// Save player scores to database
async function savePlayerScoresToDatabase(weekNumber) {
  try {
    console.log(`Saving scores for week ${weekNumber}...`);
    
    // Get all user picks for this week
    const picksResult = await pool.query(`
      SELECT pk.id as pick_id, pk.user_id, pk.player_id, pk.position, pk.multiplier
      FROM picks pk
      WHERE pk.week_number = $1
    `, [weekNumber]);
    
    let savedCount = 0;
    
    for (const pick of picksResult.rows) {
      // Check if player has ESPN ID
      const player = await pool.query('SELECT espn_id, full_name FROM players WHERE id::text = $1', [pick.player_id]);
      if (player.rows.length === 0 || !player.rows[0].espn_id) continue;
      
      const espnId = player.rows[0].espn_id;
      const playerName = player.rows[0].full_name;
      
      // Always fetch from boxscore for accurate stats
      // Game summaries have ambiguous 'YDS' fields that mix pass/rush/rec yards
      console.log(`Fetching stats for ${playerName} from boxscore...`);
      const playerStats = await fetchPlayerStats(espnId, weekNumber);
      
      if (!playerStats) {
        console.log(`No stats found for ${playerName} in week ${weekNumber}`);
        continue;
      }
      
      scoring = playerStats;
      
      const basePoints = await calculateFantasyPoints(scoring);
      const multiplier = pick.multiplier || 1;
      const finalPoints = basePoints * multiplier;
      
      // Upsert to scores table
      await pool.query(`
        INSERT INTO scores (id, user_id, player_id, week_number, base_points, multiplier, final_points, stats_json, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (user_id, player_id, week_number) DO UPDATE SET
          base_points = $4,
          multiplier = $5,
          final_points = $6,
          stats_json = $7,
          updated_at = NOW()
      `, [
        pick.user_id, 
        pick.player_id, 
        weekNumber,
        basePoints,
        multiplier,
        finalPoints,
        JSON.stringify(scoring)
      ]);
      
      savedCount++;
    }
    
    console.log(`Saved scores for ${savedCount} picks`);
    return savedCount;
  } catch (err) {
    console.error('Error saving scores:', err);
    return 0;
  }
}

// Fetch scoreboard to get active games
async function fetchScoreboard(weekNumber) {
  try {
    const now = Date.now();
    
    // Check cache (include week in cache key)
    const cacheKey = `week_${weekNumber}`;
    if (liveStatsCache.lastScoreboardUpdate && 
        liveStatsCache.currentCachedWeek === weekNumber &&
        (now - liveStatsCache.lastScoreboardUpdate) < SCOREBOARD_CACHE_MS) {
      return Array.from(liveStatsCache.activeGameIds);
    }
    
    console.log(`Fetching ESPN scoreboard for week ${weekNumber}...`);
    const response = await axios.get(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${weekNumber}`
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
    liveStatsCache.currentCachedWeek = weekNumber;
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
      JOIN players p ON pk.player_id = p.id::text
      WHERE pk.week_number = $1 AND p.team IS NOT NULL
    `, [weekNumber]);
    
    console.log(`Active teams for week ${weekNumber}:`, result.rows.map(r => r.team).join(', '));
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
    
    // Step 1: Get active games for this specific week
    const activeGameIds = await fetchScoreboard(weekNumber);
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
    
    // Step 5: Save scores to database
    await savePlayerScoresToDatabase(weekNumber);
    
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

// Debug: Check if specific ESPN IDs are in cache
app.get('/api/admin/check-espn-ids', (req, res) => {
  const { espnIds } = req.query; // Comma-separated list
  
  if (!espnIds) {
    return res.json({
      totalCached: liveStatsCache.playerStats.size,
      message: 'Provide ?espnIds=123,456,789 to check specific players'
    });
  }
  
  const ids = espnIds.split(',');
  const results = ids.map(espnId => {
    const cached = liveStatsCache.playerStats.get(espnId);
    return {
      espnId,
      found: !!cached,
      stats: cached ? cached.stats : null,
      gameId: cached ? cached.gameId : null
    };
  });
  
  res.json({
    totalCached: liveStatsCache.playerStats.size,
    results
  });
});

// Admin: Set active playoff week
app.post('/api/admin/set-active-week', async (req, res) => {
  try {
    const { userId, weekNumber } = req.body;
    
    if (!userId || !weekNumber) {
      return res.status(400).json({ error: 'userId and weekNumber required' });
    }
    
    // Verify user is admin
    const userCheck = await pool.query(
      'SELECT is_admin FROM users WHERE id = $1',
      [userId]
    );
    
    if (userCheck.rows.length === 0 || !userCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Update the playoff_start_week setting
    await pool.query(
      `INSERT INTO game_settings (setting_key, setting_value, updated_by, updated_at)
       VALUES ('playoff_start_week', $1, $2, NOW())
       ON CONFLICT (setting_key) 
       DO UPDATE SET setting_value = $1, updated_by = $2, updated_at = NOW()`,
      [weekNumber.toString(), userId]
    );
    
    res.json({ 
      success: true, 
      message: `Active week set to ${weekNumber}`,
      weekNumber 
    });
  } catch (err) {
    console.error('Error setting active week:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================================
// USER REGISTRATION / LOGIN
// ==============================================
app.post('/api/users', async (req, res) => {
  try {
    const { apple_id, email, name } = req.body;
    
    console.log('POST /api/users - Received:', { apple_id, email, name });

    if (!apple_id) {
      return res.status(400).json({ error: 'apple_id is required' });
    }

    // Try to find existing user
    let result = await pool.query(
      'SELECT * FROM users WHERE apple_id = $1 LIMIT 1',
      [apple_id]
    );

    if (result.rows.length > 0) {
      const existingUser = result.rows[0];
      console.log('Found existing user:', existingUser.id);
      
      // Update email/name if provided and currently NULL
      if ((email && !existingUser.email) || (name && !existingUser.name)) {
        console.log('Updating user with new email/name');
        const updateResult = await pool.query(
          `UPDATE users 
           SET email = COALESCE($1, email), 
               name = COALESCE($2, name),
               updated_at = NOW()
           WHERE id = $3
           RETURNING *`,
          [email || null, name || null, existingUser.id]
        );
        return res.json(updateResult.rows[0]);
      }
      
      return res.json(existingUser);
    }

    // Create new user
    console.log('Creating new user...');
    // Generate a username: use name if available, else email, else random
    let generatedUsername = name || email;
    if (!generatedUsername) {
      // Generate random username like "User_abc123"
      generatedUsername = 'User_' + Math.random().toString(36).substring(2, 10);
    }
    
    const insert = await pool.query(
      `INSERT INTO users (id, apple_id, email, name, username, created_at, updated_at, paid)
      VALUES (gen_random_uuid(), $1::text, $2::text, $3::text, $4::text, NOW(), NOW(), false)
      RETURNING *`,
      [apple_id, email || null, name || null, generatedUsername]
    );

    console.log('Created new user:', insert.rows[0].id);
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

// Sync players from Sleeper API (admin only)
app.post('/api/admin/sync-players', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    
    // Verify user is admin
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    console.log('Fetching players from Sleeper API...');
    
    // Fetch all NFL players from Sleeper
    const response = await axios.get('https://api.sleeper.app/v1/players/nfl');
    const allPlayers = response.data;
    
    // NFL playoff teams (update this list as needed)
    const playoffTeams = [
      'KC', 'BUF', 'BAL', 'HOU', 'LAC', 'PIT', 'DEN', // AFC
      'DET', 'PHI', 'LAR', 'TB', 'MIN', 'GB', 'WSH'  // NFC
    ];
    
    // Filter to active players on playoff teams, top depth chart
    const playoffPlayers = Object.values(allPlayers).filter(p => {
      return p.active &&
             p.team &&
             playoffTeams.includes(p.team) &&
             p.position &&
             ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(p.position) &&
             (p.depth_chart_order === 1 || p.depth_chart_order === 2 || p.position === 'K' || p.position === 'DEF');
    });
    
    console.log(`Found ${playoffPlayers.length} playoff players to sync`);
    
    let inserted = 0;
    let updated = 0;
    
    for (const player of playoffPlayers) {
      try {
        // Check if player already exists
        const existing = await pool.query(
          'SELECT id FROM players WHERE id = $1',
          [player.player_id || player.sleeper_id]
        );
        
        if (existing.rows.length > 0) {
          // Update existing player
          await pool.query(`
            UPDATE players SET
              first_name = $1,
              last_name = $2,
              full_name = $3,
              position = $4,
              team = $5,
              number = $6,
              status = $7,
              injury_status = $8,
              espn_id = $9,
              is_active = true,
              available = true,
              updated_at = NOW()
            WHERE id = $10
          `, [
            player.first_name || '',
            player.last_name || '',
            player.full_name || `${player.first_name} ${player.last_name}`,
            player.position,
            player.team,
            player.number ? player.number.toString() : null,
            player.status || 'Active',
            player.injury_status || null,
            player.espn_id || null,
            player.player_id || player.sleeper_id
          ]);
          updated++;
        } else {
          // Insert new player
          await pool.query(`
            INSERT INTO players (
              id, sleeper_id, espn_id, first_name, last_name, full_name,
              position, team, number, status, injury_status, 
              is_active, available, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, true, NOW(), NOW())
          `, [
            player.player_id || player.sleeper_id,
            player.player_id,
            player.espn_id || null,
            player.first_name || '',
            player.last_name || '',
            player.full_name || `${player.first_name} ${player.last_name}`,
            player.position,
            player.team,
            player.number ? player.number.toString() : null,
            player.status || 'Active',
            player.injury_status || null
          ]);
          inserted++;
        }
      } catch (err) {
        console.error(`Error syncing player ${player.full_name}:`, err.message);
      }
    }
    
    // Clear player cache so fresh data is fetched
    playersCache.data = [];
    playersCache.lastUpdate = null;
    
    console.log(`Player sync complete: ${inserted} inserted, ${updated} updated`);
    
    res.json({
      success: true,
      inserted,
      updated,
      total: inserted + updated
    });
    
  } catch (err) {
    console.error('Error syncing players:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all players (with caching)
app.get('/api/players', async (req, res) => {
  try {
    const now = Date.now();
    
    // Return cached data if fresh
    if (playersCache.lastUpdate && 
        (now - playersCache.lastUpdate) < PLAYERS_CACHE_MS &&
        playersCache.data.length > 0) {
      console.log(`Returning ${playersCache.data.length} cached players`);
      return res.json(playersCache.data);
    }
    
    // Fetch fresh data - only available and active players
    console.log('Fetching players from database...');
    
    // Playoff teams only
    const playoffTeams = [
      'KC', 'BUF', 'BAL', 'HOU', 'LAC', 'PIT', 'DEN', // AFC
      'DET', 'PHI', 'LAR', 'TB', 'MIN', 'GB', 'WSH'  // NFC
    ];
    
    const result = await pool.query(`
      SELECT id, sleeper_id, full_name, first_name, last_name, position, team, 
             number, status, injury_status, is_active, available
      FROM players 
      WHERE is_active = true 
        AND available = true
        AND team = ANY($1)
        AND position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
      ORDER BY position, team, full_name
      LIMIT 200
    `, [playoffTeams]);
    
    // Update cache
    playersCache.data = result.rows;
    playersCache.lastUpdate = now;
    console.log(`Cached ${result.rows.length} players`);
    
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

// Get user picks
app.get('/api/picks', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    
    const result = await pool.query(
      `SELECT p.*, pl.full_name, pl.position as player_position, pl.team 
       FROM picks p
       LEFT JOIN players pl ON p.player_id = pl.id
       WHERE p.user_id = $1
       ORDER BY p.week_number, p.position`,
      [userId]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error getting picks:', err);
    res.status(500).json({ error: err.message });
  }
});

// Submit picks (supports single pick or batch)
app.post('/api/picks', async (req, res) => {
  try {
    const { userId, playerId, weekNumber, position, multiplier, picks } = req.body;
    
    // Support batch submission
    if (picks && Array.isArray(picks)) {
      const results = [];
      
      for (const pick of picks) {
        const result = await pool.query(`
          INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 1, false, NOW())
          ON CONFLICT (user_id, player_id, week_number) 
          DO UPDATE SET 
            position = $4,
            multiplier = $5,
            created_at = NOW()
          RETURNING *
        `, [userId, pick.playerId, weekNumber, pick.position, pick.multiplier || 1]);
        
        results.push(result.rows[0]);
      }
      
      return res.json({ success: true, picks: results });
    }
    
    // Single pick submission with UPSERT
    const result = await pool.query(`
      INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 1, false, NOW())
      ON CONFLICT (user_id, player_id, week_number) 
      DO UPDATE SET 
        position = $4,
        multiplier = $5,
        created_at = NOW()
      RETURNING *
    `, [userId, playerId, weekNumber, position, multiplier || 1]);
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error creating pick:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete a pick
app.delete('/api/picks/:pickId', async (req, res) => {
  try {
    const { pickId } = req.params;
    
    const result = await pool.query(
      'DELETE FROM picks WHERE id = $1 RETURNING *',
      [pickId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pick not found' });
    }
    
    res.json({ success: true, deletedPick: result.rows[0] });
  } catch (err) {
    console.error('Error deleting pick:', err);
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

// ==============================================
// ADMIN USER MANAGEMENT ROUTES
// ==============================================

// Get all users (admin only)
app.get('/api/admin/users', async (req, res) => {
  try {
    const { user_id, adminId } = req.query;
    const requestingUserId = user_id || adminId; // Accept either parameter name
    
    if (!requestingUserId) {
      return res.status(400).json({ error: 'user_id or adminId parameter required' });
    }
    
    // Verify requesting user is admin
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [requestingUserId]);
    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Get all users
    const result = await pool.query(`
      SELECT 
        id,
        username,
        email,
        name,
        paid,
        is_admin,
        apple_id,
        created_at
      FROM users 
      ORDER BY username
    `);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update user payment status (admin only)
app.put('/api/admin/users/:id/payment', async (req, res) => {
  try {
    const { id } = req.params;
    const { has_paid, user_id } = req.body;
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id required in request body' });
    }
    
    // Verify requesting user is admin
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [user_id]);
    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Update payment status
    const result = await pool.query(
      'UPDATE users SET paid = $1 WHERE id = $2 RETURNING *',
      [has_paid, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating user payment:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete user (admin only)
app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, adminId } = req.query;
    const requestingUserId = user_id || adminId;
    
    if (!requestingUserId) {
      return res.status(400).json({ error: 'user_id or adminId parameter required' });
    }
    
    // Verify requesting user is admin
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [requestingUserId]);
    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Delete user's picks first (foreign key constraint)
    await pool.query('DELETE FROM picks WHERE user_id = $1', [id]);
    
    // Delete user's scores
    await pool.query('DELETE FROM scores WHERE user_id = $1', [id]);
    
    // Delete the user
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ success: true, deletedUser: result.rows[0] });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================================
// PUBLIC ROUTES (Leaderboard, Rules, Payouts)
// ==============================================

// Get scores for a user and week
app.get('/api/scores', async (req, res) => {
  try {
    const { userId, weekNumber } = req.query;
    
    if (!userId || !weekNumber) {
      return res.status(400).json({ error: 'userId and weekNumber required' });
    }
    
    const result = await pool.query(`
      SELECT 
        s.id,
        s.user_id,
        s.player_id,
        s.week_number,
        s.base_points,
        s.multiplier,
        s.final_points,
        s.stats_json,
        p.full_name as player_name,
        p.position,
        p.team
      FROM scores s
      JOIN players p ON s.player_id = p.id::text
      WHERE s.user_id = $1 AND s.week_number = $2
      ORDER BY p.position, p.full_name
    `, [userId, weekNumber]);
    
    // Convert to camelCase for iOS
    const scores = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      playerId: row.player_id,
      weekNumber: row.week_number,
      basePoints: parseFloat(row.base_points),
      multiplier: parseFloat(row.multiplier),
      finalPoints: parseFloat(row.final_points),
      statsJson: row.stats_json,
      playerName: row.player_name,
      position: row.position,
      team: row.team
    }));
    
    res.json(scores);
  } catch (err) {
    console.error('Error fetching scores:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id,
        u.username,
        u.email,
        u.name,
        u.paid as has_paid,
        COALESCE(SUM(s.final_points), 0) as total_points
      FROM users u
      LEFT JOIN scores s ON u.id = s.user_id
      WHERE u.paid = true
      GROUP BY u.id, u.username, u.email, u.name, u.paid
      ORDER BY total_points DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching leaderboard:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get rules content
app.get('/api/rules', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, section, content, display_order
      FROM rules_content
      ORDER BY display_order
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching rules:', err);
    // Return empty array if table doesn't exist yet
    res.json([]);
  }
});

// Get payouts structure
app.get('/api/payouts', async (req, res) => {
  try {
    const settingsResult = await pool.query(`
      SELECT entry_amount::float8 AS entry_amount
      FROM game_settings
      LIMIT 1
    `);
    const entryAmount = settingsResult.rows[0]?.entry_amount || 50.0;

    const paidResult = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE paid = true
    `);
    const paidUsers = paidResult.rows[0]?.count || 0;

    const payoutsResult = await pool.query(`
      SELECT place, percentage::float8 AS percentage, description
      FROM payouts
      ORDER BY place
    `);

    const totalPot = paidUsers * entryAmount;
    const payouts = payoutsResult.rows.map((p, index) => ({
      id: index + 1,
      place: p.place,
      percentage: p.percentage,
      description: p.description || null,
      amount: parseFloat((totalPot * (p.percentage / 100)).toFixed(2))
    }));

    res.json({
      entry_amount: entryAmount,
      paid_users: paidUsers,
      total_pot: parseFloat(totalPot.toFixed(2)),
      payouts
    });
  } catch (err) {
    console.error('Error fetching payouts:', err);
    res.json({
      entry_amount: 50.0,
      paid_users: 0,
      total_pot: 0.0,
      payouts: []
    });
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