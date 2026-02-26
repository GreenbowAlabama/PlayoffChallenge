// Load environment variables from .env file FIRST, before any other requires
require('dotenv').config();

const { Pool } = require('pg');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const { app } = require('./app');
const jobsService = require('./services/adminJobs.service');
const scoringService = require('./services/scoringService');
const gameStateService = require('./services/gameStateService');
const picksService = require('./services/picksService');
const usersService = require('./services/usersService');
const adminService = require('./services/adminService');
const customContestService = require('./services/customContestService');
const ingestionService = require('./services/ingestionService');
const nflEspnIngestion = require('./services/ingestion/strategies/nflEspnIngestion');
const config = require('./config');
const { startCleanup, stopCleanup } = require('./auth/appleVerify');

// Fail fast on misconfigured environment
config.validateEnvironment();

// Validate admin JWT secret is configured (required for admin authentication)
if (process.env.NODE_ENV !== 'test') {
  if (!process.env.ADMIN_JWT_SECRET) {
    console.error('FATAL: ADMIN_JWT_SECRET environment variable not configured');
    process.exit(1);
  }
  // Start JTI cleanup interval only in production, not in tests
  startCleanup();
}

const PORT = process.env.PORT || 8080;

// Auth rate limiting configuration
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 auth attempts per IP per window
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Make pool available to routes
app.locals.pool = pool;

// Player cache
let playersCache = {
  data: [],
  lastUpdate: null
};

// Cache duration in milliseconds
const PLAYERS_CACHE_MS = 30 * 60 * 1000; // 30 minutes

// ==============================================
// VALIDATION HELPERS
// ==============================================

/**
 * Validate UUID format
 * @param {string} str - String to validate
 * @returns {boolean} True if valid UUID format
 */
function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// ==============================================
// GAME STATE (delegated to gameStateService)
// ==============================================
// Wrappers maintain backward compatibility with existing call sites

function normalizeTeamAbbr(abbr) {
  return gameStateService.normalizeTeamAbbr(abbr);
}

function normalizeActiveTeams(activeTeamsJson) {
  return gameStateService.normalizeActiveTeams(activeTeamsJson);
}

async function getSelectableTeams(dbPool) {
  return gameStateService.getSelectableTeams(dbPool);
}

// ==============================================
// CLIENT CAPABILITY DETECTION (Dual-Support)
// ==============================================
// Supported capability flags:
// - leaderboard_meta: Client can handle X-Leaderboard-* response headers
// - leaderboard_gating: Client supports pre-game gating (empty array before kickoff)
// - tos_required_flag: Client can handle /api/me/flags TOS signaling
// - picks_v2: Client supports /api/picks/v2 operation-based API

function getClientCapabilities(req) {
  const capabilities = new Set();
  let clientVersion = null;

  // 1. Check X-Client-Capabilities header (comma-separated tokens)
  const capHeader = req.headers['x-client-capabilities'];
  if (capHeader && typeof capHeader === 'string') {
    const tokens = capHeader.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    tokens.forEach(t => capabilities.add(t));
  }

  // 2. Check X-Client-Version header (semver string)
  const versionHeader = req.headers['x-client-version'];
  if (versionHeader && typeof versionHeader === 'string') {
    clientVersion = versionHeader.trim();
  }

  // 3. Query param fallback only if headers missing
  if (capabilities.size === 0 && !clientVersion) {
    const qCaps = req.query.clientCapabilities;
    if (qCaps && typeof qCaps === 'string') {
      const tokens = qCaps.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      tokens.forEach(t => capabilities.add(t));
    }
    const qVersion = req.query.clientVersion;
    if (qVersion && typeof qVersion === 'string') {
      clientVersion = qVersion.trim();
    }
  }

  return {
    capabilities,
    clientVersion,
    has: (cap) => capabilities.has(cap.toLowerCase()),
    isLegacy: () => capabilities.size === 0 && !clientVersion
  };
}

// Helper: Check if any games have started for a given week (for leaderboard gating)
// Uses ESPN scoreboard API with caching
const gameStartedCache = new Map();
const GAME_STARTED_CACHE_MS = 60 * 1000; // 1 minute cache

async function hasAnyGameStartedForWeek(weekNumber) {
  const cacheKey = `week_${weekNumber}`;
  const cached = gameStartedCache.get(cacheKey);

  if (cached && (Date.now() - cached.timestamp < GAME_STARTED_CACHE_MS)) {
    return cached.value;
  }

  try {
    const url = nflEspnIngestion.getESPNScoreboardUrl(weekNumber);
    const response = await axios.get(url, { timeout: 5000 });

    if (!response.data || !response.data.events) {
      // Fail closed for opt-in clients: treat as not started
      gameStartedCache.set(cacheKey, { value: false, timestamp: Date.now() });
      return false;
    }

    const now = new Date();
    let anyStarted = false;

    for (const event of response.data.events) {
      const gameDate = event.date ? new Date(event.date) : null;
      const status = event.status?.type?.name;

      // Game has started if: status is not "STATUS_SCHEDULED" or game date is in the past
      if (status && status !== 'STATUS_SCHEDULED') {
        anyStarted = true;
        break;
      }
      if (gameDate && gameDate <= now) {
        anyStarted = true;
        break;
      }
    }

    gameStartedCache.set(cacheKey, { value: anyStarted, timestamp: Date.now() });
    return anyStarted;
  } catch (err) {
    console.error(`[leaderboard] Error checking game start for week ${weekNumber}:`, err.message);
    // Fail closed for opt-in clients: treat as not started
    gameStartedCache.set(cacheKey, { value: false, timestamp: Date.now() });
    return false;
  }
}

// Helper: Generate image URL based on player position and sleeper_id
function getPlayerImageUrl(sleeperId, position) {
  if (!sleeperId) return null;

  // Defense teams use team logo URL format
  if (position === 'DEF') {
    return `https://sleepercdn.com/images/team_logos/nfl/${sleeperId.toLowerCase()}.png`;
  }

  // Regular players use player headshot URL format
  return `https://sleepercdn.com/content/nfl/players/${sleeperId}.jpg`;
}


// Simple wrapper to rescore an entire week using the ingestion pipeline
async function processWeekScoring(weekNumber) {
  console.log(`[admin] processWeekScoring called for week ${weekNumber}`);
  return updateLiveStats(weekNumber);
}

// ============================================
// TEMP ENDPOINT: Force refresh of scoring
// ============================================
app.post('/admin/refresh-week', async (req, res) => {
  const { week } = req.body;

  if (!week) {
    return res.status(400).json({ error: "Missing week" });
  }

  try {
    console.log(`[admin] Refreshing scoring for week ${week}...`);
    const result = await processWeekScoring(week);

    return res.json({
      message: `Week ${week} scoring refreshed`,
      ...result
    });

  } catch (err) {
    console.error("[admin refresh error]", err);
    res.status(500).json({ error: err.message });
  }
});



async function updateLiveStats(weekNumber) {
  const startTime = Date.now();
  console.log(`Scoring job started`, { week: weekNumber });
  try {
    // Find active contest instance for contest-scoped ingestion
    const ciResult = await pool.query(
      "SELECT id FROM contest_instances WHERE status IN ('OPEN', 'LOCKED', 'LIVE') ORDER BY created_at DESC LIMIT 1"
    );
    const contestInstanceId = ciResult.rows[0]?.id;
    if (!contestInstanceId) {
      console.log('No active contest instance found for ingestion', { week: weekNumber });
      return { success: true, message: 'No active contest instance', gamesUpdated: 0 };
    }
    const summary = await ingestionService.run(contestInstanceId, pool);
    const durationMs = Date.now() - startTime;
    console.log(`Scoring job completed`, { week: weekNumber, ...summary, duration_ms: durationMs });
    return { success: true, message: `Ingestion complete`, ...summary };
  } catch (err) {
    console.error('Scoring job failed', { week: weekNumber, error: err.message });
    return { success: false, error: err.message };
  }
}

// Calculate fantasy points from stats
// Used by live scoring display endpoints only (ephemeral, not stored).
// Pending: thread strategyKey when live endpoints are contest-scoped.
async function calculateFantasyPoints(stats) {
  return scoringService.calculateFantasyPoints(pool, stats, 'ppr');
}

// API ROUTES

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==============================================
// UNIVERSAL LINKS (iOS App Association)
// ==============================================

// Apple App Site Association for Universal Links
// Served at /.well-known/apple-app-site-association (no file extension)
app.get('/.well-known/apple-app-site-association', (req, res) => {
  const aasa = {
    applinks: {
      apps: [],
      details: [
        {
          appID: '24Z6R7U38A.com.iancarter.PlayoffChallenge',
          paths: ['/join/*']
        }
      ]
    }
  };
  res.setHeader('Content-Type', 'application/json');
  res.json(aasa);
});

// Backward compatibility: old URLs used /custom-contests/join/:token format
// Redirect to new format for old shared links
app.get('/custom-contests/join/:token', (req, res) => {
  const { token } = req.params;
  res.redirect(301, `/join/${token}`);
});

// Join link handler - redirects to App Store for iOS users without the app
// iOS users with the app installed will be intercepted by Universal Links before this route
app.get('/join/:token', (req, res) => {
  const appStoreUrl = config.getAppStoreUrl();
  res.redirect(302, appStoreUrl);
});

// Update week active status (lock/unlock)
app.post('/api/admin/update-week-status', async (req, res) => {
  try {
    const { is_week_active } = req.body;

    if (typeof is_week_active !== 'boolean') {
      return res.status(400).json({ success: false, error: 'is_week_active must be a boolean' });
    }

    const result = await adminService.updateWeekStatus(pool, is_week_active);
    res.json(result);
  } catch (err) {
    console.error('Error updating week status:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Verify week lock status - provides authoritative confirmation for admin verification
app.get('/api/admin/verify-lock-status', async (req, res) => {
  try {
    const verification = await adminService.getLockStatusVerification(pool);

    if (!verification) {
      return res.status(500).json({
        success: false,
        error: 'Game settings not found'
      });
    }

    res.json({
      success: true,
      verification
    });
  } catch (err) {
    console.error('Error verifying lock status:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get users with incomplete lineups for the active week
app.get('/api/admin/incomplete-lineups', async (req, res) => {
  try {
    // Get current game state and position requirements
    const gameStateResult = await pool.query(
      `SELECT
        current_playoff_week,
        playoff_start_week,
        is_week_active,
        qb_limit, rb_limit, wr_limit, te_limit, k_limit, def_limit
       FROM game_settings LIMIT 1`
    );

    if (gameStateResult.rows.length === 0) {
      return res.status(500).json({ success: false, error: 'Game settings not found' });
    }

    const settings = gameStateResult.rows[0];
    const effectiveWeek = settings.current_playoff_week > 0
      ? settings.playoff_start_week + settings.current_playoff_week - 1
      : null;

    if (!effectiveWeek) {
      return res.json({
        success: true,
        weekNumber: null,
        playoffWeek: settings.current_playoff_week,
        isWeekActive: settings.is_week_active,
        users: [],
        message: 'Playoffs have not started (current_playoff_week = 0)'
      });
    }

    // Required picks per position
    const required = {
      QB: settings.qb_limit || 1,
      RB: settings.rb_limit || 2,
      WR: settings.wr_limit || 3,
      TE: settings.te_limit || 1,
      K: settings.k_limit || 1,
      DEF: settings.def_limit || 1
    };
    const totalRequired = Object.values(required).reduce((a, b) => a + b, 0);

    // Get all paid users and their pick counts by position for the current week
    const usersResult = await pool.query(`
      SELECT
        u.id,
        u.email,
        u.username,
        u.is_admin,
        COUNT(p.id) as total_picks,
        COUNT(CASE WHEN p.position = 'QB' THEN 1 END) as qb_count,
        COUNT(CASE WHEN p.position = 'RB' THEN 1 END) as rb_count,
        COUNT(CASE WHEN p.position = 'WR' THEN 1 END) as wr_count,
        COUNT(CASE WHEN p.position = 'TE' THEN 1 END) as te_count,
        COUNT(CASE WHEN p.position = 'K' THEN 1 END) as k_count,
        COUNT(CASE WHEN p.position = 'DEF' THEN 1 END) as def_count
      FROM users u
      LEFT JOIN picks p ON u.id = p.user_id AND p.week_number = $1
      WHERE u.paid = true
      GROUP BY u.id, u.email, u.username, u.is_admin
      ORDER BY u.username, u.email
    `, [effectiveWeek]);

    // Identify incomplete lineups
    const incompleteUsers = [];
    for (const user of usersResult.rows) {
      const missing = [];

      const qbCount = parseInt(user.qb_count);
      const rbCount = parseInt(user.rb_count);
      const wrCount = parseInt(user.wr_count);
      const teCount = parseInt(user.te_count);
      const kCount = parseInt(user.k_count);
      const defCount = parseInt(user.def_count);

      if (qbCount < required.QB) missing.push(`QB (${qbCount}/${required.QB})`);
      if (rbCount < required.RB) missing.push(`RB (${rbCount}/${required.RB})`);
      if (wrCount < required.WR) missing.push(`WR (${wrCount}/${required.WR})`);
      if (teCount < required.TE) missing.push(`TE (${teCount}/${required.TE})`);
      if (kCount < required.K) missing.push(`K (${kCount}/${required.K})`);
      if (defCount < required.DEF) missing.push(`DEF (${defCount}/${required.DEF})`);

      if (missing.length > 0) {
        incompleteUsers.push({
          userId: user.id,
          email: user.email,
          username: user.username || null,
          isAdmin: user.is_admin,
          totalPicks: parseInt(user.total_picks),
          missingPositions: missing,
          positionCounts: {
            QB: qbCount,
            RB: rbCount,
            WR: wrCount,
            TE: teCount,
            K: kCount,
            DEF: defCount
          }
        });
      }
    }

    res.json({
      success: true,
      weekNumber: effectiveWeek,
      playoffWeek: settings.current_playoff_week,
      isWeekActive: settings.is_week_active,
      totalRequired: totalRequired,
      requiredByPosition: required,
      incompleteCount: incompleteUsers.length,
      totalPaidUsers: usersResult.rows.length,
      users: incompleteUsers
    });
  } catch (err) {
    console.error('Error fetching incomplete lineups:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all users with their lineup status (complete and incomplete)
app.get('/api/admin/all-lineups', async (req, res) => {
  try {
    // Get current game state and position requirements
    const gameStateResult = await pool.query(
      `SELECT
        current_playoff_week,
        playoff_start_week,
        is_week_active,
        qb_limit, rb_limit, wr_limit, te_limit, k_limit, def_limit
       FROM game_settings LIMIT 1`
    );

    if (gameStateResult.rows.length === 0) {
      return res.status(500).json({ success: false, error: 'Game settings not found' });
    }

    const settings = gameStateResult.rows[0];
    const effectiveWeek = settings.current_playoff_week > 0
      ? settings.playoff_start_week + settings.current_playoff_week - 1
      : null;

    if (!effectiveWeek) {
      return res.json({
        success: true,
        weekNumber: null,
        playoffWeek: settings.current_playoff_week,
        isWeekActive: settings.is_week_active,
        users: [],
        message: 'Playoffs have not started (current_playoff_week = 0)'
      });
    }

    // Required picks per position
    const required = {
      QB: settings.qb_limit || 1,
      RB: settings.rb_limit || 2,
      WR: settings.wr_limit || 3,
      TE: settings.te_limit || 1,
      K: settings.k_limit || 1,
      DEF: settings.def_limit || 1
    };
    const totalRequired = Object.values(required).reduce((a, b) => a + b, 0);

    // Get all paid users and their pick counts by position for the current week
    const usersResult = await pool.query(`
      SELECT
        u.id,
        u.email,
        u.username,
        u.is_admin,
        COUNT(p.id) as total_picks,
        COUNT(CASE WHEN p.position = 'QB' THEN 1 END) as qb_count,
        COUNT(CASE WHEN p.position = 'RB' THEN 1 END) as rb_count,
        COUNT(CASE WHEN p.position = 'WR' THEN 1 END) as wr_count,
        COUNT(CASE WHEN p.position = 'TE' THEN 1 END) as te_count,
        COUNT(CASE WHEN p.position = 'K' THEN 1 END) as k_count,
        COUNT(CASE WHEN p.position = 'DEF' THEN 1 END) as def_count
      FROM users u
      LEFT JOIN picks p ON u.id = p.user_id AND p.week_number = $1
      WHERE u.paid = true
      GROUP BY u.id, u.email, u.username, u.is_admin
      ORDER BY u.username, u.email
    `, [effectiveWeek]);

    // Build user list with complete/incomplete status
    const allUsers = [];
    let completeCount = 0;
    let incompleteCount = 0;

    for (const user of usersResult.rows) {
      const qbCount = parseInt(user.qb_count);
      const rbCount = parseInt(user.rb_count);
      const wrCount = parseInt(user.wr_count);
      const teCount = parseInt(user.te_count);
      const kCount = parseInt(user.k_count);
      const defCount = parseInt(user.def_count);

      const missing = [];
      if (qbCount < required.QB) missing.push(`QB (${qbCount}/${required.QB})`);
      if (rbCount < required.RB) missing.push(`RB (${rbCount}/${required.RB})`);
      if (wrCount < required.WR) missing.push(`WR (${wrCount}/${required.WR})`);
      if (teCount < required.TE) missing.push(`TE (${teCount}/${required.TE})`);
      if (kCount < required.K) missing.push(`K (${kCount}/${required.K})`);
      if (defCount < required.DEF) missing.push(`DEF (${defCount}/${required.DEF})`);

      const isComplete = missing.length === 0;
      if (isComplete) {
        completeCount++;
      } else {
        incompleteCount++;
      }

      allUsers.push({
        userId: user.id,
        email: user.email,
        username: user.username || null,
        isAdmin: user.is_admin,
        totalPicks: parseInt(user.total_picks),
        isComplete: isComplete,
        missingPositions: missing,
        positionCounts: {
          QB: qbCount,
          RB: rbCount,
          WR: wrCount,
          TE: teCount,
          K: kCount,
          DEF: defCount
        }
      });
    }

    res.json({
      success: true,
      weekNumber: effectiveWeek,
      playoffWeek: settings.current_playoff_week,
      isWeekActive: settings.is_week_active,
      totalRequired: totalRequired,
      requiredByPosition: required,
      completeCount: completeCount,
      incompleteCount: incompleteCount,
      totalPaidUsers: usersResult.rows.length,
      users: allUsers
    });
  } catch (err) {
    console.error('Error fetching all lineups:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sync ESPN IDs from Sleeper API
app.post('/api/admin/sync-espn-ids', async (req, res) => {
  try {
    console.log('Starting ESPN ID sync from Sleeper...');

    // Fetch all players from Sleeper
    const response = await axios.get('https://api.sleeper.app/v1/players/nfl');
    const sleeperPlayers = response.data;

    // Get all players missing ESPN IDs
    const playersResult = await pool.query(`
      SELECT id, sleeper_id, full_name, position
      FROM players
      WHERE (espn_id IS NULL OR espn_id = '')
        AND sleeper_id IS NOT NULL
    `);

    console.log(`Found ${playersResult.rows.length} players missing ESPN IDs`);

    let updated = 0;
    let notFound = 0;
    let skippedDuplicate = 0;

    for (const player of playersResult.rows) {
      const sleeperData = sleeperPlayers[player.sleeper_id];

      if (sleeperData && sleeperData.espn_id) {
        const espnIdStr = sleeperData.espn_id.toString();

        // Check if this ESPN ID is already assigned to another player
        const existingCheck = await pool.query(
          'SELECT id, full_name FROM players WHERE espn_id = $1 AND id != $2',
          [espnIdStr, player.id]
        );

        if (existingCheck.rows.length > 0) {
          console.log(`Skipping ${player.full_name}: ESPN ID ${espnIdStr} already assigned to ${existingCheck.rows[0].full_name}`);
          skippedDuplicate++;
          continue;
        }

        const imageUrl = getPlayerImageUrl(player.sleeper_id, player.position);
        await pool.query(
          'UPDATE players SET espn_id = $1, image_url = $2 WHERE id = $3',
          [espnIdStr, imageUrl, player.id]
        );
        console.log(`Updated ${player.full_name}: ESPN ID = ${espnIdStr}`);
        updated++;
      } else {
        console.log(`No ESPN ID found for ${player.full_name} (${player.sleeper_id})`);
        notFound++;
      }
    }

    console.log(`ESPN ID sync complete: ${updated} updated, ${notFound} not found, ${skippedDuplicate} skipped (duplicate)`);

    res.json({
      success: true,
      message: `Synced ESPN IDs: ${updated} updated, ${notFound} not found, ${skippedDuplicate} skipped (duplicate)`,
      updated,
      notFound,
      skippedDuplicate
    });
  } catch (err) {
    console.error('Error syncing ESPN IDs:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Populate image URLs for all existing players
app.post('/api/admin/populate-image-urls', async (req, res) => {
  try {
    console.log('Populating image URLs for all players...');

    const result = await pool.query('SELECT id, sleeper_id, position FROM players WHERE sleeper_id IS NOT NULL');

    console.log(`Found ${result.rows.length} players with sleeper_id`);

    let updated = 0;

    for (const player of result.rows) {
      const imageUrl = getPlayerImageUrl(player.sleeper_id, player.position);

      await pool.query(
        'UPDATE players SET image_url = $1 WHERE id = $2',
        [imageUrl, player.id]
      );

      updated++;
    }

    // Clear player cache
    playersCache.data = [];
    playersCache.lastUpdate = null;

    console.log(`Updated ${updated} players with image URLs`);
    res.json({ success: true, message: `Updated ${updated} players with image URLs`, updated });
  } catch (err) {
    console.error('Error populating image URLs:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update current playoff week
app.post('/api/admin/update-current-week', async (req, res) => {
  try {
    const { current_playoff_week, is_week_active } = req.body;

    // Validate playoff week is within valid range (0 = not started, 1-4 = playoff rounds)
    if (current_playoff_week === undefined || current_playoff_week === null || current_playoff_week < 0 || current_playoff_week > 4) {
      return res.status(400).json({ success: false, error: 'current_playoff_week must be between 0 and 4 (0=not started, 1=Wild Card, 2=Divisional, 3=Conference, 4=Super Bowl)' });
    }

    let query = 'UPDATE game_settings SET current_playoff_week = $1';
    const params = [current_playoff_week];

    if (typeof is_week_active === 'boolean') {
      query += ', is_week_active = $2';
      params.push(is_week_active);
    }

    query += ' RETURNING *';

    const result = await pool.query(query, params);

    console.log(`Current week updated to ${current_playoff_week}, is_week_active = ${is_week_active ?? 'unchanged'}`);

    res.json({ success: true, message: `Current week set to ${current_playoff_week}` });
  } catch (err) {
    console.error('Error updating current week:', err);
    res.status(500).json({ success: false, error: err.message });
  }
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
      const liveStats = nflEspnIngestion.getCachedPlayerStats(player.espn_id);

      if (liveStats) {
        const scoringStats = nflEspnIngestion.convertESPNStatsToScoring(liveStats.stats);
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
        const cached = nflEspnIngestion.getCachedPlayerStats(pick.espn_id);

        if (cached) {
          const scoringStats = nflEspnIngestion.convertESPNStatsToScoring(cached.stats);
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

    res.json({ week_number: parseInt(weekNumber), picks: picks });
  } catch (err) {
    console.error('Error getting live week stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// Alias endpoint for iOS app compatibility
app.get('/api/live-scores', async (req, res) => {
  try {
    const weekNumber = req.query.weekNumber;

    if (!weekNumber) {
      return res.status(400).json({ error: 'weekNumber query parameter required' });
    }

    // Remap playoff week index (1-4) to NFL week (19-22)
    const actualWeekNumber = await nflEspnIngestion.resolveActualWeekNumber(weekNumber, pool, 'LiveScores');
    if (!actualWeekNumber) {
      return res.status(400).json({ error: 'Invalid weekNumber' });
    }

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
    `, [actualWeekNumber]);

    const picks = [];

    for (const pick of picksResult.rows) {
      let liveStats = null;
      let points = 0;
      let isLive = false;

      if (pick.espn_id) {
        const cached = nflEspnIngestion.getCachedPlayerStats(pick.espn_id);

        if (cached) {
          const scoringStats = nflEspnIngestion.convertESPNStatsToScoring(cached.stats);
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

    res.json({ picks });
  } catch (err) {
    console.error('Error getting live scores:', err);
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
  res.json(nflEspnIngestion.getCacheStatus());
});

// ============================================
// VERIFICATION ENDPOINTS FOR WEEK TRANSITIONS
// ============================================
// These endpoints support post-transition verification in web-admin.
// They are read-only and return counts/distributions for a given week.

// Admin: Get pick count for a specific week
app.get('/api/admin/picks/count', async (req, res) => {
  try {
    const { week } = req.query;

    if (!week) {
      return res.status(400).json({ error: 'week query parameter required' });
    }

    const weekNumber = parseInt(week, 10);
    if (isNaN(weekNumber)) {
      return res.status(400).json({ error: 'week must be a valid number' });
    }

    const result = await pool.query(
      'SELECT COUNT(*) as count FROM picks WHERE week_number = $1',
      [weekNumber]
    );

    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    console.error('Error fetching pick count:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get score count for a specific week
app.get('/api/admin/scores/count', async (req, res) => {
  try {
    const { week } = req.query;

    if (!week) {
      return res.status(400).json({ error: 'week query parameter required' });
    }

    const weekNumber = parseInt(week, 10);
    if (isNaN(weekNumber)) {
      return res.status(400).json({ error: 'week must be a valid number' });
    }

    const result = await pool.query(
      'SELECT COUNT(*) as count FROM scores WHERE week_number = $1',
      [weekNumber]
    );

    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    console.error('Error fetching score count:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get multiplier distribution for picks in a specific week
app.get('/api/admin/picks/multiplier-distribution', async (req, res) => {
  try {
    const { week } = req.query;

    if (!week) {
      return res.status(400).json({ error: 'week query parameter required' });
    }

    const weekNumber = parseInt(week, 10);
    if (isNaN(weekNumber)) {
      return res.status(400).json({ error: 'week must be a valid number' });
    }

    const result = await pool.query(
      `SELECT multiplier, COUNT(*) as count
       FROM picks
       WHERE week_number = $1
       GROUP BY multiplier
       ORDER BY multiplier`,
      [weekNumber]
    );

    // Convert to object format: { "1": 10, "2": 5, "3": 2 }
    const distribution = {};
    result.rows.forEach(row => {
      const multiplierKey = parseFloat(row.multiplier).toString();
      distribution[multiplierKey] = parseInt(row.count, 10);
    });

    res.json(distribution);
  } catch (err) {
    console.error('Error fetching multiplier distribution:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Manually update a player's ESPN ID
app.put('/api/admin/players/:playerId/espn-id', async (req, res) => {
  try {
    const { playerId } = req.params;
    const { adminUserId, espnId } = req.body;

    if (!adminUserId || !espnId) {
      return res.status(400).json({ error: 'adminUserId and espnId required' });
    }

    // Verify requesting user is admin
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [adminUserId]);
    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Update the player's ESPN ID
    const result = await pool.query(
      `UPDATE players SET espn_id = $1 WHERE id = $2 RETURNING id, sleeper_id, espn_id, first_name, last_name, team, position`,
      [espnId, playerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    console.log(`Updated player ${result.rows[0].first_name} ${result.rows[0].last_name} ESPN ID to ${espnId}`);

    res.json({
      success: true,
      player: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating player ESPN ID:', err);
    res.status(500).json({ error: err.message });
  }
});

// Debug: Check if specific ESPN IDs are in cache
app.get('/api/admin/check-espn-ids', (req, res) => {
  const { espnIds } = req.query; // Comma-separated list

  if (!espnIds) {
    return res.json({
      totalCached: nflEspnIngestion.getCacheStatus().cachedPlayerCount,
      message: 'Provide ?espnIds=123,456,789 to check specific players'
    });
  }

  const ids = espnIds.split(',');
  const results = ids.map(espnId => {
    const cached = nflEspnIngestion.getCachedPlayerStats(espnId);
    return {
      espnId,
      found: !!cached,
      stats: cached ? cached.stats : null,
      gameId: cached ? cached.gameId : null
    };
  });

  res.json({
    totalCached: nflEspnIngestion.getCacheStatus().cachedPlayerCount,
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

    const result = await adminService.setActiveWeek(pool, userId, weekNumber);
    res.json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('Error setting active week:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================================
// MULTIPLIER & PLAYER REPLACEMENT ENDPOINTS
// ==============================================

// Admin: Preview week transition - READ-ONLY, returns ESPN data for confirmation
// This endpoint does NOT mutate any state. It only fetches and returns preview data.
app.get('/api/admin/preview-week-transition', async (req, res) => {
  try {
    const preview = await adminService.getWeekTransitionPreview(pool, nflEspnIngestion.fetchValidPostseasonWeek);
    res.json({ success: true, preview });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message, currentState: err.currentState });
    }
    if (err.message.includes('ESPN') || err.message.includes('postseason')) {
      console.error('[admin] Preview: ESPN fetch failed:', err.message);
      return res.status(502).json({ error: 'Failed to fetch valid ESPN postseason data', details: err.message });
    }
    console.error('Error generating week transition preview:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Process week transition - update multipliers for advancing players
// CONTRACT: This endpoint is atomic. It either completes fully or leaves no partial state.
// PRECONDITION: Caller must have confirmed preview (previewConfirmed: true)
app.post('/api/admin/process-week-transition', async (req, res) => {
  const client = await pool.connect();

  try {
    const { userId, previewConfirmed } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    // PRECONDITION 0: Preview must be confirmed
    if (previewConfirmed !== true) {
      return res.status(400).json({
        error: 'Preview confirmation required. Call GET /api/admin/preview-week-transition first and confirm the teams.',
        hint: 'Include previewConfirmed: true in request body after confirming preview.'
      });
    }

    const result = await adminService.processWeekTransition(client, {
      userId,
      fetchValidPostseasonWeek: nflEspnIngestion.fetchValidPostseasonWeek,
      getESPNScoreboardUrl: nflEspnIngestion.getESPNScoreboardUrl
    });

    res.json(result);
  } catch (err) {
    if (err.statusCode === 403) {
      return res.status(403).json({ error: err.message });
    }
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message, currentState: err.currentState, espnUrl: err.espnUrl });
    }
    if (err.message.includes('ESPN') || err.message.includes('postseason')) {
      console.error('[admin] ESPN fetch failed:', err.message);
      return res.status(502).json({ error: 'Failed to fetch valid ESPN postseason data', details: err.message });
    }
    console.error('Error processing week transition:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Get eliminated players for a user in a specific week
app.get('/api/picks/eliminated/:userId/:weekNumber', async (req, res) => {
  try {
    const { userId, weekNumber } = req.params;

    if (!userId || !weekNumber) {
      return res.status(400).json({ error: 'userId and weekNumber required' });
    }

    // Fetch scoreboard for this week to see which teams are active
    const scoreboardResponse = await axios.get(nflEspnIngestion.getESPNScoreboardUrl(weekNumber));

    const activeTeams = new Set();

    if (scoreboardResponse.data && scoreboardResponse.data.events) {
      for (const event of scoreboardResponse.data.events) {
        const competitors = event.competitions?.[0]?.competitors || [];
        for (const competitor of competitors) {
          const teamAbbr = competitor.team?.abbreviation;
          if (teamAbbr) {
            activeTeams.add(teamAbbr);
          }
        }
      }
    }

    // Get eliminated players via service
    const eliminated = await picksService.getEliminatedPlayers(pool, userId, parseInt(weekNumber), activeTeams);

    res.json({
      weekNumber: parseInt(weekNumber),
      previousWeek: parseInt(weekNumber) - 1,
      activeTeams: Array.from(activeTeams),
      eliminated
    });

  } catch (err) {
    console.error('Error checking eliminated players:', err);
    res.status(500).json({ error: err.message });
  }
});

// Replace an eliminated player with a new player
app.post('/api/picks/replace-player', async (req, res) => {
  try {
    const { contestInstanceId, userId, oldPlayerId, newPlayerId, position, weekNumber } = req.body;

    // contestInstanceId is now required in the service layer, so no need to explicitly check here,
    // as the service will throw a PicksError if missing.
    if (!userId || !oldPlayerId || !newPlayerId || !position || !weekNumber) {
      return res.status(400).json({
        error: 'userId, oldPlayerId, newPlayerId, position, and weekNumber required'
      });
    }

    // Fetch ESPN scoreboard to determine active teams
    const gameStateResult = await pool.query(
      'SELECT current_playoff_week, playoff_start_week FROM game_settings LIMIT 1'
    );
    const { current_playoff_week, playoff_start_week } = gameStateResult.rows[0] || {};
    const effectiveWeekNumber = current_playoff_week > 0
      ? playoff_start_week + Math.min(current_playoff_week - 1, 3)
      : weekNumber;

    const scoreboardResponse = await axios.get(nflEspnIngestion.getESPNScoreboardUrl(effectiveWeekNumber));
    const activeTeams = new Set();
    if (scoreboardResponse.data && scoreboardResponse.data.events) {
      for (const event of scoreboardResponse.data.events) {
        const competitors = event.competitions?.[0]?.competitors || [];
        for (const competitor of competitors) {
          const teamAbbr = competitor.team?.abbreviation;
          if (teamAbbr) {
            activeTeams.add(teamAbbr);
          }
        }
      }
    }

    // Get selectable teams
    const selectableResult = await getSelectableTeams(pool);
    if (selectableResult.error) {
      console.error(`[swap] ${selectableResult.error}: active_teams not set for playoff week ${selectableResult.currentPlayoffWeek}`);
      return res.status(500).json({ error: 'Server configuration error. Please contact support.' });
    }

    const result = await picksService.executePlayerReplacement(pool, {
      contestInstanceId, // NEW
      userId,
      oldPlayerId,
      newPlayerId,
      position,
      weekNumber,
      activeTeams,
      selectableTeams: selectableResult.teams,
      normalizeTeamAbbr
    });

    res.json(result);
  } catch (err) {
    console.error('Error replacing player:', err);
    if (err.name === 'PicksError') {
      const response = { error: err.message };
      if (err.details) {
        Object.assign(response, err.details);
      }
      if (err.code) { // Include custom error code
        response.code = err.code;
      }
      return res.status(err.statusCode).json(response);
    }
    res.status(500).json({ error: err.message });
  }
});

// ==============================================
// USER REGISTRATION / LOGIN
// ==============================================
// Business logic delegated to usersService

app.post('/api/users', authLimiter, async (req, res) => {
  try {
    const { apple_id, email, name, state, eligibility_certified, tos_version } = req.body;

    console.log('POST /api/users - Received:', { apple_id, email, name, state, eligibility_certified });

    if (!apple_id) {
      return res.status(400).json({ error: 'apple_id is required' });
    }

    // Try to find existing user first (allow returning users)
    const existingUser = await usersService.findUserByAppleId(pool, apple_id);

    if (existingUser) {
      console.log('Found existing user:', existingUser.id);

      // Update email/name if provided and currently NULL
      if ((email && !existingUser.email) || (name && !existingUser.name)) {
        console.log('Updating user with new email/name');
        const updatedUser = await usersService.updateUserEmailName(pool, existingUser.id, email, name);
        return res.json(updatedUser);
      }

      return res.json(existingUser);
    }

    // NEW USER SIGNUP - Compliance checks required
    if (!state || !eligibility_certified) {
      return res.status(400).json({
        error: 'State and eligibility certification are required for new users'
      });
    }

    // Get IP-based state for audit trail
    const ipState = usersService.getIPState(req);

    // Check if state is restricted
    if (usersService.isRestrictedState(state)) {
      console.log(`[COMPLIANCE] Blocking signup from restricted state: ${state}`);

      // Log blocked attempt
      await usersService.logSignupAttempt(pool, {
        appleId: apple_id, email, name, attemptedState: state.toUpperCase(),
        ipState, blocked: true, blockedReason: 'Restricted state'
      });

      return res.status(403).json({
        error: 'Fantasy contests are not available in your state'
      });
    }

    // Log mismatch if IP state differs from claimed state (don't block, just audit)
    if (ipState && state.toUpperCase() !== ipState) {
      console.warn(`[COMPLIANCE] State mismatch - User claimed: ${state}, IP shows: ${ipState}`);
    }

    // Create new user with compliance fields
    console.log('Creating new user with compliance data...');
    const newUser = await usersService.createAppleUser(pool, {
      appleId: apple_id, email, name, state, ipState, tosVersion: tos_version
    });

    // Log successful signup attempt
    await usersService.logSignupAttempt(pool, {
      appleId: apple_id, email, name, attemptedState: state.toUpperCase(),
      ipState, blocked: false, blockedReason: null
    });

    console.log(`[COMPLIANCE] Created new user: ${newUser.id} (State: ${state})`);
    res.json(newUser);
  } catch (err) {
    console.error('Error in /api/users:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// Email/Password Authentication Endpoints
// (For TestFlight testing only - remove before App Store launch)
// =============================================

// Register with email/password
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { email, password, name, state, eligibility_certified, tos_version } = req.body;

    console.log('POST /api/auth/register - Received:', { email, name, state, eligibility_certified });

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!state || !eligibility_certified) {
      return res.status(400).json({ error: 'State and eligibility certification are required for new users' });
    }

    // Check if email already exists
    if (await usersService.isEmailRegistered(pool, email)) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Get IP-based state for audit trail
    const ipState = usersService.getIPState(req);

    // Check if state is restricted
    if (usersService.isRestrictedState(state)) {
      console.log(`[COMPLIANCE] Blocking signup from restricted state: ${state}`);

      // Log blocked attempt
      await usersService.logSignupAttempt(pool, {
        appleId: null, email, name, attemptedState: state.toUpperCase(),
        ipState, blocked: true, blockedReason: 'Restricted state'
      });

      return res.status(403).json({
        error: 'Fantasy contests are not available in your state'
      });
    }

    // Log mismatch if IP state differs from claimed state
    if (ipState && state.toUpperCase() !== ipState) {
      console.warn(`[COMPLIANCE] State mismatch - User claimed: ${state}, IP shows: ${ipState}`);
    }

    // Create new user
    const newUser = await usersService.createEmailUser(pool, {
      email, password, name, state, ipState, tosVersion: tos_version
    });

    // Log successful signup
    await usersService.logSignupAttempt(pool, {
      appleId: null, email, name, attemptedState: state.toUpperCase(),
      ipState, blocked: false, blockedReason: null
    });

    console.log(`[AUTH] Created new email user: ${newUser.id} (State: ${state})`);

    res.json(newUser);
  } catch (err) {
    console.error('Error in /api/auth/register:', err);
    res.status(500).json({ error: err.message });
  }
});

// Login with email/password
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('POST /api/auth/login - Received:', { email });

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user by email
    const user = await usersService.findUserByEmail(pool, email);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if user has password_hash (might be Apple Sign In user)
    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account uses Sign in with Apple. Please use Apple Sign In.' });
    }

    // Verify password
    const validPassword = await usersService.verifyPassword(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    console.log(`[AUTH] User logged in: ${user.id}`);

    // Return user (without password_hash)
    delete user.password_hash;
    res.json(user);
  } catch (err) {
    console.error('Error in /api/auth/login:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get single user by ID
app.get('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isValidUUID(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    const user = await usersService.findUserById(pool, userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update user profile (username, email, phone)
app.put('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, email, phone, name } = req.body;

    if (!isValidUUID(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    console.log('PUT /api/users/:userId - Updating user:', { userId, username, email, phone, name });

    // Verify user exists
    const existingUser = await usersService.findUserById(pool, userId);
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check username uniqueness if username is being updated
    if (username) {
      const isAvailable = await usersService.isUsernameAvailable(pool, username, userId);
      if (!isAvailable) {
        return res.status(400).json({ error: 'Username already taken' });
      }

      // Validate username format
      const validation = usersService.validateUsername(username);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
    }

    // Check if there are fields to update
    if (username === undefined && email === undefined && phone === undefined && name === undefined) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const user = await usersService.updateUserProfile(pool, userId, { username, email, phone, name });

    console.log('User updated successfully:', user.id);

    res.json(user);
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ error: err.message });
  }
});

// Accept Terms of Service
app.put('/api/users/:userId/accept-tos', async (req, res) => {
  try {
    const { userId } = req.params;
    const { tos_version } = req.body;

    const user = await usersService.acceptTos(pool, userId, tos_version);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error('Error accepting TOS:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================================
// ACCOUNT DELETION ENDPOINT
// ==============================================

// DELETE /api/user - Permanently delete the authenticated user's account
// This endpoint satisfies Apple App Review requirements for account deletion
app.delete('/api/user', async (req, res) => {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    const { userId } = req.query;

    if (!userId) {
      client.release();
      return res.status(401).json({ error: 'Unauthorized - userId is required' });
    }

    await client.query('BEGIN');
    inTransaction = true;

    // Verify user exists
    const userCheck = await client.query(
      'SELECT id FROM users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(401).json({ error: 'Unauthorized - user not found' });
    }

    console.log(`[ACCOUNT DELETION] Deleting user: ${userId}`);

    await usersService.deleteUserById(client, userId);
    await client.query('COMMIT');

    console.log(`[ACCOUNT DELETION] User ${userId} permanently deleted`);

    client.release();
    res.json({ success: true });
  } catch (err) {
    if (inTransaction) {
      await client.query('ROLLBACK');
    }
    client.release();
    console.error('Error deleting user account:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// ==============================================
// ADMIN COMPLIANCE ENDPOINTS
// ==============================================

// Get state distribution for compliance reporting
app.get('/api/admin/compliance/state-distribution', async (req, res) => {
  try {
    const { adminUserId } = req.query;

    if (!adminUserId) {
      return res.status(400).json({ error: 'adminUserId is required' });
    }

    // Check admin status
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [adminUserId]);
    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get user distribution by state
    const usersByState = await pool.query(`
      SELECT
        state,
        COUNT(*) as user_count,
        COUNT(*) FILTER (WHERE ip_state_verified IS NOT NULL AND ip_state_verified != state) as ip_mismatches
      FROM users
      WHERE state IS NOT NULL
      GROUP BY state
      ORDER BY user_count DESC
    `);

    // Get blocked signup attempts by state
    const blockedAttempts = await pool.query(`
      SELECT
        attempted_state,
        COUNT(*) as blocked_count
      FROM signup_attempts
      WHERE blocked = true
      GROUP BY attempted_state
      ORDER BY blocked_count DESC
    `);

    res.json({
      total_users: usersByState.rows.reduce((sum, row) => sum + parseInt(row.user_count), 0),
      by_state: usersByState.rows,
      blocked_attempts: blockedAttempts.rows
    });
  } catch (err) {
    console.error('Error fetching state distribution:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get users with IP/state mismatches
app.get('/api/admin/compliance/ip-mismatches', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        username,
        email,
        state as claimed_state,
        ip_state_verified as ip_state,
        created_at
      FROM users
      WHERE state IS NOT NULL
        AND ip_state_verified IS NOT NULL
        AND state != ip_state_verified
      ORDER BY created_at DESC
    `);

    res.json({ mismatches: result.rows });
  } catch (err) {
    console.error('Error fetching IP mismatches:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all signup attempts (including blocked)
app.get('/api/admin/compliance/signup-attempts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        apple_id,
        email,
        name,
        attempted_state,
        ip_state_verified,
        blocked,
        blocked_reason,
        attempted_at
      FROM signup_attempts
      ORDER BY attempted_at DESC
      LIMIT 100
    `);

    const summary = await pool.query(`
      SELECT
        COUNT(*) as total_attempts,
        COUNT(*) FILTER (WHERE blocked = true) as blocked_count,
        COUNT(*) FILTER (WHERE blocked = false) as successful_count
      FROM signup_attempts
    `);

    res.json({
      summary: summary.rows[0],
      attempts: result.rows
    });
  } catch (err) {
    console.error('Error fetching signup attempts:', err);
    res.status(500).json({ error: err.message });
  }
});

// EXISTING ROUTES (keeping your original endpoints)

// Sync players from Sleeper API (admin only)
app.post('/api/admin/sync-players', async (req, res) => {
  try {
    const response = await axios.get('https://api.sleeper.app/v1/players/nfl');
    const sleeperPlayers = response.data;

    let inserted = 0;
    let updated = 0;

    for (const sleeperId in sleeperPlayers) {
      const player = sleeperPlayers[sleeperId];

      const result = await pool.query(
        `INSERT INTO players (id, sleeper_id, full_name, position, team)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (sleeper_id) DO UPDATE
          SET full_name = EXCLUDED.full_name,
              position = EXCLUDED.position,
              team = EXCLUDED.team
          RETURNING xmax = 0 AS inserted`,
        [
          player.player_id,
          sleeperId,
          player.full_name,
          player.position,
          player.team
        ]
      );

      if (result.rows[0].inserted) inserted++;
      else updated++;
    }

    res.json({ success: true, inserted, updated });
  } catch (err) {
    console.error('Error syncing players:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all players (with caching)
app.get('/api/players', async (req, res) => {
  // Prevent HTTP 304 responses - always send fresh data
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  try {
    // Only apply limit/offset if explicitly requested (for pagination)
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    const offset = parseInt(req.query.offset) || 0;
    const position = req.query.position;

    const now = Date.now();

    // Return cached data if fresh and no specific filters or pagination
    if (!position && offset === 0 && !limit &&
        playersCache.lastUpdate &&
        (now - playersCache.lastUpdate) < PLAYERS_CACHE_MS &&
        playersCache.data.length > 0) {
      console.log(`Returning ${playersCache.data.length} cached players`);
      return res.json({
        players: playersCache.data,
        total: playersCache.data.length,
        limit: playersCache.data.length,
        offset: 0
      });
    }

    // Fetch selectable teams from DB (with caching)
    const selectableResult = await getSelectableTeams(pool);
    if (selectableResult.error) {
      console.error(`[players] ${selectableResult.error}: active_teams not set for playoff week ${selectableResult.currentPlayoffWeek}`);
      return res.status(500).json({ error: 'Server configuration error. Please contact support.' });
    }
    const selectableTeams = selectableResult.teams;

    // Fetch fresh data - only available and active players from selectable teams
    console.log(`[players] Fetching from database (selectable teams: ${selectableTeams.join(', ')})...`);

    // Filter to only selectable teams and exclude IR players
    let query = `
      SELECT id, sleeper_id,
              COALESCE(full_name, first_name || ' ' || last_name) as full_name,
              first_name, last_name, position, team,
              number, status, injury_status, is_active, available, image_url
      FROM players
      WHERE is_active = true
        AND available = true
        AND team = ANY($1)
        AND position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
        AND (injury_status IS NULL OR UPPER(TRIM(injury_status)) NOT IN ('IR', 'PUP', 'SUSP'))`;

    const params = [selectableTeams];

    if (position) {
      query += ` AND position = $${params.length + 1}`;
      params.push(position);
    }

    query += ` ORDER BY position, team, full_name`;

    // Only apply LIMIT/OFFSET if explicitly requested (for pagination)
    if (limit !== null) {
      query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
    }

    const result = await pool.query(query, params);

    // Get total count (filtered to selectable teams and excluding IR players)
    const countQuery = `
      SELECT COUNT(*) as total
      FROM players
      WHERE is_active = true
        AND available = true
        AND team = ANY($1)
        AND position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
        AND (injury_status IS NULL OR UPPER(TRIM(injury_status)) NOT IN ('IR', 'PUP', 'SUSP'))
      ${position ? `AND position = $2` : ''}
    `;
    const countParams = position ? [selectableTeams, position] : [selectableTeams];
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    // Update cache if fetching all (no position filter, no pagination)
    if (!position && offset === 0 && limit === null) {
      playersCache.data = result.rows;
      playersCache.lastUpdate = now;
      console.log(`Cached ${result.rows.length} players`);
    }

    res.json({
      players: result.rows,
      total: total,
      limit: limit !== null ? limit : result.rows.length,
      offset: offset
    });
  } catch (err) {
    console.error('Error fetching players:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================================
// PICKS API (v2 only - v1 routes removed)
// ==============================================

// GET /api/picks/v2 - Get normalized lineup for v2 clients
app.get('/api/picks/v2', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  try {
    const { userId, weekNumber } = req.query;

    // Require picks_v2 capability
    const client = getClientCapabilities(req);
    if (!client.has('picks_v2')) {
      return res.status(400).json({
        error: 'This endpoint requires picks_v2 capability. Use /api/picks/:userId instead.'
      });
    }

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // For reads: allow viewing historical weeks, default to server week when omitted
    let effectiveWeek;
    if (weekNumber !== undefined) {
      effectiveWeek = await nflEspnIngestion.resolveActualWeekNumber(weekNumber, pool, 'PicksV2');
      if (!effectiveWeek) {
        return res.status(400).json({ error: 'Invalid weekNumber' });
      }
    } else {
      effectiveWeek = await getEffectiveWeekNumber();
    }

    // Get picks and position limits via service
    const { picks, positionLimits } = await picksService.getPicksV2(pool, userId, effectiveWeek);

    res.json({
      userId,
      weekNumber: effectiveWeek,
      picks,
      positionLimits
    });
  } catch (err) {
    console.error('Error in GET /api/picks/v2:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/picks/v2 - Operation-based lineup management
app.post('/api/picks/v2', async (req, res) => {
  try {
    const { contestInstanceId, userId, weekNumber, ops } = req.body;

    // Require picks_v2 capability
    const client = getClientCapabilities(req);
    if (!client.has('picks_v2')) {
      return res.status(400).json({
        error: 'This endpoint requires picks_v2 capability. Use POST /api/picks instead.'
      });
    }

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    // contestInstanceId is now required in the service layer, so no need to explicitly check here,
    // as the service will throw a PicksError if missing.

    if (!ops || !Array.isArray(ops) || ops.length === 0) {
      return res.status(400).json({ error: 'ops array is required and must not be empty' });
    }

    // Get selectable teams
    const selectableResult = await getSelectableTeams(pool);
    if (selectableResult.error) {
      console.error(`[picks/v2] ${selectableResult.error}: active_teams not set for playoff week ${selectableResult.currentPlayoffWeek}`);
      return res.status(500).json({ error: 'Server configuration error. Please contact support.' });
    }

    const result = await picksService.executePicksV2Operations(pool, {
      contestInstanceId, // NEW
      userId,
      weekNumber,
      ops,
      selectableTeams: selectableResult.teams,
      normalizeTeamAbbr
    });

    res.json(result);
  } catch (err) {
    console.error('Error in POST /api/picks/v2:', err);
    if (err.name === 'PicksError') {
      const response = { error: err.message };
      if (err.details) {
        Object.assign(response, err.details);
      }
      if (err.code) { // Include custom error code
        response.code = err.code;
      }
      return res.status(err.statusCode).json(response);
    }
    res.status(500).json({ error: err.message });
  }
});

// Get user's picks with scores for a specific week (for leaderboard quick view)
app.get('/api/users/:userId/picks/:weekNumber', async (req, res) => {
  try {
    const { userId, weekNumber } = req.params;

    // Remap playoff week index (1-4) to NFL week (19-22)
    const actualWeekNumber = await nflEspnIngestion.resolveActualWeekNumber(weekNumber, pool, 'UserPicks');
    if (!actualWeekNumber) {
      return res.status(400).json({ error: 'Invalid weekNumber' });
    }

    const result = await pool.query(`
      SELECT
        pk.id as pick_id,
        pk.locked,
        pk.position,
        p.full_name,
        p.team,
        p.position as player_position,
        COALESCE(s.base_points, 0) as base_points,
        COALESCE(s.multiplier, 1) as multiplier,
        COALESCE(s.final_points, 0) as points
      FROM picks pk
      JOIN players p ON pk.player_id = p.id
      LEFT JOIN scores s ON s.user_id = pk.user_id
        AND s.player_id = pk.player_id
        AND s.week_number = pk.week_number
      WHERE pk.user_id = $1 AND pk.week_number = $2
      ORDER BY
        CASE pk.position
          WHEN 'QB' THEN 1
          WHEN 'RB' THEN 2
          WHEN 'WR' THEN 3
          WHEN 'TE' THEN 4
          WHEN 'K' THEN 5
          WHEN 'DEF' THEN 6
          ELSE 7
        END
    `, [userId, actualWeekNumber]);

    res.json({ picks: result.rows });
  } catch (err) {
    console.error('Error fetching user picks with scores:', err);
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

// ==============================================
// LEGACY JOIN ROUTE (delegates to canonical endpoint)
// ==============================================
// DEPRECATED: Use /api/custom-contests/join/:token instead.
// This route exists for backward compatibility with mobile clients.
// It delegates to the same service with identical behavior and rate limiting.

const { createCombinedJoinRateLimiter } = require('./middleware/joinRateLimit');
const { logJoinSuccess, logJoinFailure } = require('./services/joinAuditService');
const legacyJoinRateLimiter = createCombinedJoinRateLimiter();

app.get('/api/join/:token', legacyJoinRateLimiter, async (req, res) => {
  const { token } = req.params;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const joinSource = req.query.source || 'legacy_join';
  const userId = req.headers['x-user-id'] || null;

  try {
    const result = await customContestService.resolveJoinToken(pool, token);

    if (result.valid) {
      logJoinSuccess({
        token,
        contestId: result.contest.id,
        userId,
        ipAddress,
        joinSource
      });
    } else {
      logJoinFailure({
        token,
        errorCode: result.error_code,
        contestId: result.contest?.id || null,
        userId,
        ipAddress,
        joinSource,
        extra: result.environment_mismatch ? {
          token_environment: result.token_environment,
          current_environment: result.current_environment
        } : undefined
      });
    }

    return res.json(result);
  } catch (err) {
    console.error('[Join Legacy] Unexpected error resolving token:', err.message);
    logJoinFailure({
      token,
      errorCode: 'INTERNAL_ERROR',
      userId,
      ipAddress,
      joinSource,
      extra: { error: err.message }
    });
    return res.status(500).json({
      valid: false,
      error_code: 'INTERNAL_ERROR',
      reason: 'Failed to resolve token'
    });
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

// Update game settings (admin only)
app.put('/api/admin/settings', async (req, res) => {
  try {
    const {
      adminUserId,
      entry_amount,
      venmo_handle,
      cashapp_handle,
      zelle_handle,
      qb_limit,
      rb_limit,
      wr_limit,
      te_limit,
      k_limit,
      def_limit
    } = req.body;

    if (!adminUserId) {
      return res.status(400).json({ error: 'adminUserId is required' });
    }

    // Check admin status
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [adminUserId]);
    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Build dynamic update query based on provided fields
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (entry_amount !== undefined) {
      updates.push(`entry_amount = $${paramCount}`);
      values.push(entry_amount);
      paramCount++;
    }

    if (venmo_handle !== undefined) {
      updates.push(`venmo_handle = $${paramCount}`);
      values.push(venmo_handle);
      paramCount++;
    }

    if (cashapp_handle !== undefined) {
      updates.push(`cashapp_handle = $${paramCount}`);
      values.push(cashapp_handle);
      paramCount++;
    }

    if (zelle_handle !== undefined) {
      updates.push(`zelle_handle = $${paramCount}`);
      values.push(zelle_handle);
      paramCount++;
    }

    if (qb_limit !== undefined) {
      updates.push(`qb_limit = $${paramCount}`);
      values.push(qb_limit);
      paramCount++;
    }

    if (rb_limit !== undefined) {
      updates.push(`rb_limit = $${paramCount}`);
      values.push(rb_limit);
      paramCount++;
    }

    if (wr_limit !== undefined) {
      updates.push(`wr_limit = $${paramCount}`);
      values.push(wr_limit);
      paramCount++;
    }

    if (te_limit !== undefined) {
      updates.push(`te_limit = $${paramCount}`);
      values.push(te_limit);
      paramCount++;
    }

    if (k_limit !== undefined) {
      updates.push(`k_limit = $${paramCount}`);
      values.push(k_limit);
      paramCount++;
    }

    if (def_limit !== undefined) {
      updates.push(`def_limit = $${paramCount}`);
      values.push(def_limit);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'At least one setting field is required' });
    }

    updates.push('updated_at = NOW()');

    const result = await pool.query(
      `UPDATE game_settings
       SET ${updates.join(', ')}
       WHERE id = (SELECT id FROM game_settings LIMIT 1)
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Settings not found' });
    }

    console.log(`[admin] Updated game settings`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start background polling for live stats (every 2 minutes)
let liveStatsInterval = null;
const LIVE_STATS_INTERVAL_MS = 2 * 60 * 1000;

// Payout scheduler (every 5 minutes)
let payoutSchedulerInterval = null;
const PAYOUT_SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;

async function startLiveStatsPolling() {
  // Register the job with diagnostics service
  jobsService.registerJob('live-stats-polling', {
    interval_ms: LIVE_STATS_INTERVAL_MS,
    description: 'Polls ESPN for live game stats and updates scores'
  });

  // Get current playoff week and derive NFL week number
  // FIX: Use NFL week numbers (19-22) for scoring, not playoff round (1-4)
  // Cap offset at 3 to handle Pro Bowl skip (round 5 = Super Bowl = offset 3)
  const configResult = await pool.query(
    'SELECT current_playoff_week, playoff_start_week FROM game_settings LIMIT 1'
  );
  const { current_playoff_week, playoff_start_week } = configResult.rows[0] || {};
  const currentWeek = current_playoff_week > 0
    ? playoff_start_week + Math.min(current_playoff_week - 1, 3)
    : current_playoff_week || 1;

  console.log(`Starting live stats polling for week ${currentWeek}...`);

  // Initial update
  await runLiveStatsWithTracking(currentWeek);

  // Poll every 2 minutes
  liveStatsInterval = setInterval(async () => {
    const config = await pool.query(
      'SELECT current_playoff_week, playoff_start_week FROM game_settings LIMIT 1'
    );
    const { current_playoff_week: cpw, playoff_start_week: psw } = config.rows[0] || {};
    const week = cpw > 0 ? psw + cpw - 1 : cpw || 1;
    await runLiveStatsWithTracking(week);
  }, LIVE_STATS_INTERVAL_MS);
}

// Wrapper to track job status for diagnostics
async function runLiveStatsWithTracking(week) {
  jobsService.markJobRunning('live-stats-polling');
  try {
    await updateLiveStats(week);
    jobsService.updateJobStatus('live-stats-polling', { success: true });
  } catch (err) {
    console.error('[Live Stats Job] Error:', err.message);
    jobsService.updateJobStatus('live-stats-polling', { success: false, error: err.message });
  }
}

// Start background payout scheduler (every 5 minutes)
async function startPayoutScheduler() {
  // Register the job with diagnostics service (once at startup, not on every tick)
  jobsService.registerJob('payout-scheduler', {
    interval_ms: PAYOUT_SCHEDULER_INTERVAL_MS,
    description: 'Process pending payout jobs'
  });

  console.log('Payout scheduler initialized (runs every 5 minutes)');

  // Poll every 5 minutes (skip in test environment)
  if (process.env.NODE_ENV !== 'test') {
    payoutSchedulerInterval = setInterval(async () => {
      await runPayoutSchedulerWithTracking();
    }, PAYOUT_SCHEDULER_INTERVAL_MS);
  }
}

// Wrapper to track payout job status for diagnostics
async function runPayoutSchedulerWithTracking() {
  jobsService.markJobRunning('payout-scheduler');
  try {
    const result = await jobsService.runPayoutScheduler(pool);

    // INSTRUMENTATION: Log full result object
    console.log('[runPayoutSchedulerWithTracking] Scheduler result:', {
      success: result.success,
      jobs_processed: result.jobs_processed,
      jobs_completed: result.jobs_completed,
      total_transfers_processed: result.total_transfers_processed,
      errors_count: result.errors?.length || 0,
      error: result.error || null
    });

    jobsService.updateJobStatus('payout-scheduler', {
      success: result.success,
      jobs_processed: result.jobs_processed,
      transfers_created: result.transfers_created,
      failures: result.failures
    });
  } catch (err) {
    // INSTRUMENTATION: Log full error object, not just err.message
    console.error('[runPayoutSchedulerWithTracking] Exception caught:', {
      error_message: err?.message || 'No message',
      error_code: err?.code || 'No code',
      error_type: err?.constructor?.name || 'Unknown',
      full_error: err || 'Unknown error'
    });

    jobsService.updateJobStatus('payout-scheduler', {
      success: false,
      error: err?.message || String(err) || 'Unknown scheduler error'
    });
  }
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
    const { requiredCount, isActive } = req.body;

    // Build dynamic SQL based on what fields are provided
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (requiredCount != null) {
      updates.push(`required_count = $${paramCount}`);
      values.push(requiredCount);
      paramCount++;
    }

    if (isActive != null) {
      updates.push(`is_active = $${paramCount}`);
      values.push(isActive);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'At least one of requiredCount or isActive is required' });
    }

    // Always update updated_at
    updates.push('updated_at = NOW()');

    // Add id as the last parameter
    values.push(id);

    const result = await pool.query(
      `UPDATE position_requirements
       SET ${updates.join(', ')}
       WHERE id = $${paramCount}
       RETURNING id, position, required_count, display_name, display_order, is_active`,
      values
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
    // Admin verification is handled by requireAdmin middleware
    // req.adminUser is set by the middleware

    // Get all users
    const result = await pool.query(`
      SELECT
        id,
        username,
        email,
        name,
        phone,
        paid,
        is_admin,
        apple_id,
        created_at,
        admin_notes
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
    const { has_paid, hasPaid } = req.body;

    const actualHasPaid = has_paid !== undefined ? has_paid : hasPaid;

    if (actualHasPaid === undefined) {
      return res.status(400).json({ error: 'has_paid or hasPaid required in request body' });
    }

    const result = await pool.query(
      'UPDATE users SET paid = $1 WHERE id = $2 RETURNING *',
      [actualHasPaid, id]
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

// Update user admin notes (admin only)
app.patch('/api/admin/users/:id/notes', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes } = req.body;

    if (adminNotes === undefined) {
      return res.status(400).json({ error: 'adminNotes required in request body' });
    }

    const trimmed = typeof adminNotes === 'string' ? adminNotes.trim() : '';

    if (trimmed.length > 500) {
      return res.status(400).json({ error: 'adminNotes must be 500 characters or less' });
    }

    const result = await pool.query(
      'UPDATE users SET admin_notes = $1 WHERE id = $2 RETURNING admin_notes',
      [trimmed || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ adminNotes: result.rows[0].admin_notes });
  } catch (err) {
    console.error('Error updating user notes:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete user (admin only)
app.delete('/api/admin/users/:id', async (req, res) => {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    const { id } = req.params;

    await client.query('BEGIN');
    inTransaction = true;

    const result = await deleteUserById(client, id);
    await client.query('COMMIT');

    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, deletedUser: result.rows[0] });
  } catch (err) {
    if (inTransaction) {
      await client.query('ROLLBACK');
    }
    client.release();
    console.error('Error deleting user:', err);
    res.status(500).json({ error: err.message });
  }
});

// Bulk delete all non-admin users (preserves admin users)
app.post('/api/admin/users/cleanup', async (req, res) => {
  try {
    // First get count for response
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM users WHERE is_admin = false'
    );
    const userCount = parseInt(countResult.rows[0].count);

    if (userCount === 0) {
      return res.json({ success: true, deletedCount: 0, message: 'No non-admin users to delete' });
    }

    // Delete picks for non-admin users first (foreign key constraint)
    await pool.query(
      'DELETE FROM picks WHERE user_id IN (SELECT id FROM users WHERE is_admin = false)'
    );

    // Delete scores for non-admin users
    await pool.query(
      'DELETE FROM scores WHERE user_id IN (SELECT id FROM users WHERE is_admin = false)'
    );

    // Delete all non-admin users
    const result = await pool.query(
      'DELETE FROM users WHERE is_admin = false RETURNING id'
    );

    res.json({
      success: true,
      deletedCount: result.rows.length,
      message: `Deleted ${result.rows.length} non-admin users. Admin users preserved.`
    });
  } catch (err) {
    console.error('Error in user cleanup:', err);
    res.status(500).json({ error: err.message });
  }
});

// Bulk delete all picks belonging to non-admin users (preserves admin picks)
app.post('/api/admin/picks/cleanup', async (req, res) => {
  try {
    // First get count for response
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM picks WHERE user_id IN (SELECT id FROM users WHERE is_admin = false)'
    );
    const pickCount = parseInt(countResult.rows[0].count);

    if (pickCount === 0) {
      return res.json({ success: true, deletedCount: 0, message: 'No non-admin picks to delete' });
    }

    // Delete picks belonging to non-admin users
    const result = await pool.query(
      'DELETE FROM picks WHERE user_id IN (SELECT id FROM users WHERE is_admin = false) RETURNING id'
    );

    // Also delete associated scores for these picks
    await pool.query(
      'DELETE FROM scores WHERE user_id IN (SELECT id FROM users WHERE is_admin = false)'
    );

    res.json({
      success: true,
      deletedCount: result.rows.length,
      message: `Deleted ${result.rows.length} picks from non-admin users. Admin picks preserved.`
    });
  } catch (err) {
    console.error('Error in picks cleanup:', err);
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

// Helper: Build a matchup map for a given week (fetches scoreboard once and caches)
async function getWeekMatchupMap(weekNumber) {
  try {
    // Fetch ESPN scoreboard for this week
    const response = await axios.get(nflEspnIngestion.getESPNScoreboardUrl(weekNumber));

    if (!response.data || !response.data.events) {
      return new Map();
    }

    // Build a map of team -> {opponent, isHome}
    const matchupMap = new Map();

    for (const event of response.data.events) {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      const competitors = competition.competitors || [];
      const homeTeam = competitors.find(c => c.homeAway === 'home')?.team?.abbreviation;
      const awayTeam = competitors.find(c => c.homeAway === 'away')?.team?.abbreviation;

      if (homeTeam && awayTeam) {
        matchupMap.set(homeTeam, { opponent: awayTeam, isHome: true });
        matchupMap.set(awayTeam, { opponent: homeTeam, isHome: false });
      }
    }

    return matchupMap;
  } catch (err) {
    console.error(`Error fetching matchup map for week ${weekNumber}:`, err.message);
    return new Map();
  }
}

// Helper: Get team's opponent and home/away status from a matchup map
function getTeamMatchup(teamAbbr, matchupMap) {
  return matchupMap.get(teamAbbr) || null;
}

// Helper: Map playoff round to NFL week number
function getWeekNumberForRound(round) {
  const roundToWeekMap = {
    'wildcard':   19,
    'divisional': 20,
    'conference': 21,
    'superbowl':  22,
    'super bowl': 22
  };

  return roundToWeekMap[round.toLowerCase()] || null;
}

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    // Force iOS clients to bypass cached responses (CFNetwork/URLSession caching fix)
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    const { weekNumber, round, includePicks, mode: explicitMode } = req.query;

    // === DUAL-SUPPORT: Client capability detection ===
    const client = getClientCapabilities(req);
    const supportsMetadata = client.has('leaderboard_meta');
    const supportsGating = client.has('leaderboard_gating');

    // Map round to week number if round is provided
    let actualWeekNumber = weekNumber;
    if (round && !weekNumber) {
      actualWeekNumber = getWeekNumberForRound(round);
      if (!actualWeekNumber) {
        return res.status(400).json({ error: `Invalid round: ${round}` });
      }
    }

    // === PLAYOFF WEEK INDEX REMAPPING ===
    // iOS app sends weekNumber as playoff index (1-4) but scores table uses NFL weeks.
    // iOS LeaderboardView/MyPicksView picker also uses 16-19 for playoff rounds.
    // Fetch playoff_start_week from settings and remap:
    //   - If weekNumber is 1-4: actualWeekNumber = playoff_start_week + (weekNumber - 1)
    //   - If weekNumber is 16-19: actualWeekNumber = weekNumber + 3 (iOS picker)
    //   - If weekNumber >= 20: treat as literal NFL week (no remap)
    if (actualWeekNumber) {
      const inputWeek = parseInt(actualWeekNumber, 10);
      const settingsResult = await pool.query('SELECT playoff_start_week FROM game_settings LIMIT 1');
      const playoffStartWeek = settingsResult.rows[0]?.playoff_start_week || 19;

      if (inputWeek >= 1 && inputWeek <= 4) {
        // Treat as playoff index week (1=Wild Card, 2=Divisional, etc.)
        actualWeekNumber = playoffStartWeek + (inputWeek - 1);
        console.log(`[Leaderboard] Week remap: received=${inputWeek}, playoff_start_week=${playoffStartWeek}, resolved=${actualWeekNumber}`);
      } else if (inputWeek >= 16 && inputWeek <= 19) {
        // iOS picker uses 16-19 for playoff rounds
        // Remap: 16→19 (Wild Card), 17→20 (Divisional), 18→21 (Conference), 19→22 (Super Bowl)
        actualWeekNumber = inputWeek + 3;
        console.log(`[Leaderboard] Week remap (iOS picker): received=${inputWeek}, resolved=${actualWeekNumber}`);
      } else if (inputWeek >= 20) {
        // Already an NFL week number (20-22), use as-is
        actualWeekNumber = inputWeek;
        console.log(`[Leaderboard] Week passthrough: received=${inputWeek}, resolved=${actualWeekNumber} (literal NFL week)`);
      } else {
        // Week number outside expected range (5-15) - use as-is but log warning
        actualWeekNumber = inputWeek;
        console.log(`[Leaderboard] Week WARNING: received=${inputWeek}, playoff_start_week=${playoffStartWeek}, resolved=${actualWeekNumber} (unexpected range)`);
      }
    }

    // === EXPLICIT MODE SUPPORT (Phase 1) ===
    // New iOS clients can send explicit mode parameter to bypass implicit heuristic:
    //   - mode=cumulative: Force cumulative view regardless of weekNumber
    //   - mode=week: Force week-specific view, skip implicit cumulative detection
    // Old clients without mode parameter fall through to existing implicit heuristic.
    let explicitModeUsed = false;
    if (explicitMode === 'cumulative') {
      console.log(`[Leaderboard] Explicit mode=cumulative requested, forcing cumulative view`);
      actualWeekNumber = null;
      explicitModeUsed = true;
    } else if (explicitMode === 'week' && actualWeekNumber) {
      console.log(`[Leaderboard] Explicit mode=week requested for week ${actualWeekNumber}, skipping implicit heuristic`);
      explicitModeUsed = true;
    }

    // Determine if this is a week-specific or cumulative request
    let isWeekSpecific = !!actualWeekNumber;
    let isCumulative = !actualWeekNumber;
    let mode = isWeekSpecific ? 'week' : 'cumulative';

    // === METADATA HEADERS ===
    // Set metadata headers for opt-in clients (no game-time filtering)
    if (supportsMetadata) {
      res.set('X-Leaderboard-Meta', '1');
      res.set('X-Leaderboard-Games-Started', 'true');
      res.set('X-Leaderboard-Active-Week', actualWeekNumber || '');
      res.set('X-Leaderboard-Mode', mode);
    }

    // === LEGACY BEHAVIOR: Query and return data (unchanged) ===
    let query;
    let params = [];

    if (actualWeekNumber) {
      // Filter by specific week - email removed from SELECT for privacy
      // NOTE: 'points' and 'score' aliases added for iOS app compatibility
      query = `
        SELECT
          u.id,
          u.username,
          u.name,
          u.team_name,
          u.paid as has_paid,
          COALESCE(SUM(s.final_points), 0) as total_points,
          COALESCE(SUM(s.final_points), 0) as points,
          COALESCE(SUM(s.final_points), 0) as score
        FROM users u
        LEFT JOIN scores s ON u.id = s.user_id AND s.week_number = $1
        WHERE u.paid = true
        GROUP BY u.id, u.username, u.name, u.team_name, u.paid
        ORDER BY total_points DESC
      `;
      params = [actualWeekNumber];
    } else {
      // All weeks (cumulative) - sum all playoff weeks dynamically based on playoff_start_week
      // NOTE: 'points' and 'score' aliases added for iOS app compatibility
      const cumulativeSettingsResult = await pool.query('SELECT playoff_start_week FROM game_settings LIMIT 1');
      const cumulativeStartWeek = cumulativeSettingsResult.rows[0]?.playoff_start_week || 19;
      const cumulativeEndWeek = cumulativeStartWeek + 3; // 4 playoff rounds

      query = `
        SELECT
          u.id,
          u.username,
          u.name,
          u.team_name,
          u.paid as has_paid,
          COALESCE(SUM(s.final_points), 0) as total_points,
          COALESCE(SUM(s.final_points), 0) as points,
          COALESCE(SUM(s.final_points), 0) as score
        FROM users u
        LEFT JOIN scores s ON u.id = s.user_id AND s.week_number BETWEEN $1 AND $2
        WHERE u.paid = true
        GROUP BY u.id, u.username, u.name, u.team_name, u.paid
        ORDER BY total_points DESC
      `;
      params = [cumulativeStartWeek, cumulativeEndWeek];
    }

    const result = await pool.query(query, params);

    // If includePicks is requested, fetch picks for each user
    // SECURITY: Only expose picks if week is locked OR games have started
    if (includePicks === 'true' && actualWeekNumber) {
      // Check if picks should be visible (week locked or games started)
      const lockStatusResult = await pool.query('SELECT is_week_active FROM game_settings LIMIT 1');
      const isWeekLocked = lockStatusResult.rows[0]?.is_week_active === false;
      const gamesStarted = await hasAnyGameStartedForWeek(actualWeekNumber);

      // If week is unlocked AND no games have started, don't expose picks
      if (!isWeekLocked && !gamesStarted) {
        console.log(`[Leaderboard] Picks gated: week ${actualWeekNumber} is unlocked and no games started`);
        // Return leaderboard without picks
        return res.json(result.rows);
      }

      // Fetch matchup map once for this week
      const matchupMap = await getWeekMatchupMap(actualWeekNumber);

      const leaderboardWithPicks = await Promise.all(
        result.rows.map(async (user) => {
          const picksResult = await pool.query(`
            SELECT
              pk.id as pick_id,
              pk.locked,
              pk.position,
              p.full_name,
              p.team,
              p.sleeper_id,
              p.image_url,
              COALESCE(s.base_points, 0) as base_points,
              COALESCE(s.multiplier, pk.multiplier, 1) as multiplier,
              COALESCE(s.final_points, 0) as points
            FROM picks pk
            JOIN players p ON pk.player_id = p.id
            LEFT JOIN scores s ON s.user_id = pk.user_id
              AND s.player_id = pk.player_id
              AND s.week_number = pk.week_number
            WHERE pk.user_id = $1 AND pk.week_number = $2
            ORDER BY
              CASE pk.position
                WHEN 'QB' THEN 1
                WHEN 'RB' THEN 2
                WHEN 'WR' THEN 3
                WHEN 'TE' THEN 4
                WHEN 'K' THEN 5
                WHEN 'DEF' THEN 6
                ELSE 7
              END
          `, [user.id, actualWeekNumber]);

          // Add opponent matchup data to each pick
          const picksWithMatchups = picksResult.rows.map((pick) => {
            const matchup = getTeamMatchup(pick.team, matchupMap);
            return {
              ...pick,
              opponent: matchup?.opponent || null,
              is_home: matchup?.isHome ?? null
            };
          });

          return {
            ...user,
            picks: picksWithMatchups
          };
        })
      );

      res.json(leaderboardWithPicks);
    } else {
      res.json(result.rows);
    }
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

// Update rules content (admin only)
app.put('/api/admin/rules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminUserId, content } = req.body;

    if (!adminUserId) {
      return res.status(400).json({ error: 'adminUserId is required' });
    }

    // Check admin status
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [adminUserId]);
    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const result = await pool.query(
      `UPDATE rules_content
       SET content = $1
       WHERE id = $2
       RETURNING *`,
      [content, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    console.log(`[admin] Updated rule ${id} (${result.rows[0].section})`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating rule:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get Terms of Service
app.get('/api/terms', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT content, updated_at
      FROM rules_content
      WHERE section = 'terms_of_service'
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Terms of service not found' });
    }

    res.json({
      content: result.rows[0].content,
      version: result.rows[0].updated_at.toISOString().split('T')[0], // e.g., "2025-12-12"
      lastUpdated: result.rows[0].updated_at
    });
  } catch (err) {
    console.error('Error fetching terms:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update Terms of Service (admin only)
app.put('/api/admin/terms', async (req, res) => {
  try {
    const { adminUserId, content } = req.body;

    if (!adminUserId) {
      return res.status(400).json({ error: 'adminUserId is required' });
    }

    // Check admin status
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [adminUserId]);
    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    // Update or insert TOS
    const result = await pool.query(`
      INSERT INTO rules_content (section, content, display_order, created_at, updated_at)
      VALUES ('terms_of_service', $1, 100, NOW(), NOW())
      ON CONFLICT (section)
      DO UPDATE SET content = $1, updated_at = NOW()
      RETURNING *
    `, [content]);

    console.log(`[admin] Updated Terms of Service (${result.rows[0].content.length} characters)`);
    res.json({
      message: 'Terms of service updated successfully',
      version: result.rows[0].updated_at.toISOString().split('T')[0],
      lastUpdated: result.rows[0].updated_at
    });
  } catch (err) {
    console.error('Error updating terms:', err);
    res.status(500).json({ error: err.message });
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

// Get scoring rules
app.get('/api/scoring-rules', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, category, stat_name, points::float8 AS points, description, display_order
      FROM scoring_rules
      WHERE is_active = true
      ORDER BY category, display_order, stat_name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching scoring rules:', err);
    res.json([]);
  }
});

// ==============================================
// V2 PICKS API (Dual-Support for WR Bug Fix)
// ==============================================
// These endpoints support operation-based lineup management
// Required for iOS clients with picks_v2 capability

// Helper: Get effective week number (centralized, server-authoritative)
// IMPORTANT: This function is the single source of truth for the active week.
// It NEVER trusts client-provided week numbers for write operations.
async function getEffectiveWeekNumber() {
  const gameStateResult = await pool.query(
    'SELECT current_playoff_week, playoff_start_week FROM game_settings LIMIT 1'
  );
  const { current_playoff_week, playoff_start_week } = gameStateResult.rows[0] || {};

  // Calculate from playoff state if in playoffs
  // Cap offset at 3 to handle Pro Bowl skip (round 5 = Super Bowl = offset 3)
  // This ensures: Wild Card=0, Divisional=1, Conference=2, Super Bowl=3
  if (current_playoff_week > 0 && playoff_start_week > 0) {
    const offset = Math.min(current_playoff_week - 1, 3);
    return playoff_start_week + offset;
  }

  // Fall back to playoff_start_week if set
  if (playoff_start_week > 0) {
    return playoff_start_week;
  }

  // Final fallback: return 1 (never return 0, null, or undefined)
  return 1;
}

// Helper: Validate position counts for v2 API
// Wrapper that delegates to picksService with injected pool
async function validatePositionCounts(userId, weekNumber, proposedOps = []) {
  return picksService.validatePositionCounts(pool, userId, weekNumber, proposedOps);
}

// ==============================================
// TOS FLAGS ENDPOINT (Dual-Support)
// ==============================================
// Signals TOS requirements to new iOS clients
// Non-blocking - for investigative/signaling purposes only

app.get('/api/me/flags', async (req, res) => {
  try {
    const { userId } = req.query;

    // Require tos_required_flag capability (or allow for diagnostic purposes)
    // Note: We allow this endpoint even for legacy clients for diagnostic purposes
    // but new clients should send tos_required_flag capability

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const tosStatus = await usersService.getUserTosStatus(pool, userId);

    if (!tosStatus) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(tosStatus);
  } catch (err) {
    console.error('Error in GET /api/me/flags:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server only when run directly (not when required by tests)
function startServer() {
  return app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`APP_ENV: ${process.env.APP_ENV || '(not set)'}`);
    console.log(`JOIN_BASE_URL: ${process.env.JOIN_BASE_URL || '(not set)'}`);

    // Start live stats polling if in production
    if (process.env.NODE_ENV === 'production') {
      setTimeout(startLiveStatsPolling, 5000); // Start after 5 seconds
    }

    // Start payout scheduler if not in test environment
    if (process.env.NODE_ENV !== 'test') {
      setTimeout(startPayoutScheduler, 5000); // Start after 5 seconds
    }
  });
}

// Start server when executed directly
if (require.main === module) {
  startServer();
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  if (liveStatsInterval) clearInterval(liveStatsInterval);
  if (payoutSchedulerInterval) clearInterval(payoutSchedulerInterval);
  process.exit(0);
});

// Export for testing (does not affect production behavior)
module.exports = { app, pool, calculateFantasyPoints, startServer, stopCleanup };
