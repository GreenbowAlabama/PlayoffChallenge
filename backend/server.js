const express = require('express');
const { Pool } = require('pg');
const pg = require('pg');
const cors = require('cors');
const axios = require('axios');
const geoip = require('geoip-lite');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const requireAdmin = require('./middleware/adminAuth');
const adminAuthRoutes = require('./routes/adminAuth');
const adminDiagnosticsRoutes = require('./routes/admin.diagnostics.routes');
const adminTrendsRoutes = require('./routes/admin.trends.routes');
const jobsService = require('./services/adminJobs.service');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 8080;

pg.types.setTypeParser(1700, (v) => v === null ? null : parseFloat(v));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting configuration
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 auth attempts per IP per window
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limit to all API routes
app.use('/api/', apiLimiter);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Make pool available to routes
app.locals.pool = pool;

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

// Fallback playoff teams - used only during Wildcard if DB active_teams is not set
const FALLBACK_PLAYOFF_TEAMS = process.env.PLAYOFF_TEAMS
  ? process.env.PLAYOFF_TEAMS.split(',').map(t => t.trim())
  : ['DEN','NE','JAX','PIT','HOU','LAC','BUF','SEA','CHI','PHI','CAR','SF','LAR','GB'];

// Helper: Handle team abbreviations better.

function normalizeTeamAbbr(abbr) {
  if (!abbr) return null;

  const map = {
    WSH: 'WAS',
    JAC: 'JAX',
    LA: 'LAR',
    STL: 'LAR',
    SD: 'LAC',
    OAK: 'LV'
  };

  return map[abbr] || abbr;
}

// ==============================================
// SELECTABLE TEAMS (DB-backed with TTL cache)
// ==============================================
const selectableTeamsCache = {
  teams: null,
  currentPlayoffWeek: null,
  lastFetch: 0
};
const SELECTABLE_TEAMS_CACHE_MS = 60 * 1000; // 60 seconds TTL

// Helper: Normalize active_teams JSON from game_settings into array of team abbreviations
// Handles various possible shapes safely:
// - Array of strings: ["BUF","KC"]
// - Array of objects: [{abbreviation:"BUF"}, {abbr:"KC"}]
// - Object map: {"BUF": true, "KC": true} or {"BUF": {...}, "KC": {...}}
// - Object wrapper: {teams:[...]} or {activeTeams:[...]}
function normalizeActiveTeams(activeTeamsJson) {
  if (!activeTeamsJson) return [];

  let data = activeTeamsJson;

  // If it's a string, try to parse it
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      console.error('[normalizeActiveTeams] Failed to parse JSON string:', e.message);
      return [];
    }
  }

  // If it's already an array
  if (Array.isArray(data)) {
    return data.map(item => {
      if (typeof item === 'string') {
        return normalizeTeamAbbr(item);
      }
      if (typeof item === 'object' && item !== null) {
        // Handle {abbreviation: "BUF"} or {abbr: "KC"} or {team: "SF"}
        const abbr = item.abbreviation || item.abbr || item.team || null;
        return normalizeTeamAbbr(abbr);
      }
      return null;
    }).filter(Boolean);
  }

  // If it's an object (not array)
  if (typeof data === 'object' && data !== null) {
    // Check for wrapper keys: {teams:[...]} or {activeTeams:[...]}
    if (Array.isArray(data.teams)) {
      return normalizeActiveTeams(data.teams);
    }
    if (Array.isArray(data.activeTeams)) {
      return normalizeActiveTeams(data.activeTeams);
    }
    if (Array.isArray(data.active_teams)) {
      return normalizeActiveTeams(data.active_teams);
    }

    // Otherwise treat keys as team abbreviations: {"BUF": true, "KC": {...}}
    return Object.keys(data).map(key => normalizeTeamAbbr(key)).filter(Boolean);
  }

  return [];
}

// Helper: Get selectable teams from DB with caching
// Returns { teams: string[], currentPlayoffWeek: number }
// Fails closed after Wildcard if active_teams is missing/empty
async function getSelectableTeams(dbPool) {
  const now = Date.now();

  // Return cached value if still valid
  if (selectableTeamsCache.teams !== null &&
      (now - selectableTeamsCache.lastFetch) < SELECTABLE_TEAMS_CACHE_MS) {
    return {
      teams: selectableTeamsCache.teams,
      currentPlayoffWeek: selectableTeamsCache.currentPlayoffWeek
    };
  }

  // Fetch from DB
  const result = await dbPool.query(
    'SELECT active_teams, current_playoff_week FROM game_settings LIMIT 1'
  );

  const row = result.rows[0] || {};
  const currentPlayoffWeek = row.current_playoff_week || 1;
  const normalizedTeams = normalizeActiveTeams(row.active_teams);

  // Fail-closed after Wildcard: if active_teams is missing/empty, return error indicator
  if (currentPlayoffWeek > 1 && normalizedTeams.length === 0) {
    // Don't cache error state - allow retry
    return {
      teams: null,
      currentPlayoffWeek: currentPlayoffWeek,
      error: 'Server configuration error'
    };
  }

  // During Wildcard (week 1): fallback to env/hardcoded if DB active_teams is empty
  let teams;
  if (normalizedTeams.length === 0) {
    teams = FALLBACK_PLAYOFF_TEAMS.map(t => normalizeTeamAbbr(t));
  } else {
    teams = normalizedTeams;
  }

  // Update cache
  selectableTeamsCache.teams = teams;
  selectableTeamsCache.currentPlayoffWeek = currentPlayoffWeek;
  selectableTeamsCache.lastFetch = now;

  return { teams, currentPlayoffWeek };
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
    const url = getESPNScoreboardUrl(weekNumber);
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

// Helper: Resolve actual NFL week number from iOS playoff index
// iOS sends playoff week indices (1-4), but backend stores NFL weeks (19-22).
// iOS LeaderboardView picker also uses 16-19 for Wild Card through Super Bowl.
// This function performs the same remapping used in /api/leaderboard.
async function resolveActualWeekNumber(inputWeek, pool, logPrefix = 'WeekRemap') {
  if (!inputWeek) return null;

  const weekNum = parseInt(inputWeek, 10);
  if (isNaN(weekNum)) return null;

  const settingsResult = await pool.query('SELECT playoff_start_week FROM game_settings LIMIT 1');
  const playoffStartWeek = settingsResult.rows[0]?.playoff_start_week || 19;

  if (weekNum >= 1 && weekNum <= 4) {
    // Treat as playoff index week (1=Wild Card, 2=Divisional, etc.)
    const resolved = playoffStartWeek + (weekNum - 1);
    console.log(`[${logPrefix}] Week remap: received=${weekNum}, playoff_start_week=${playoffStartWeek}, resolved=${resolved}`);
    return resolved;
  } else if (weekNum >= 19) {
    // NFL week number (19-22), use as-is
    console.log(`[${logPrefix}] Week passthrough: received=${weekNum}, resolved=${weekNum} (literal NFL week)`);
    return weekNum;
  } else if (weekNum >= 16 && weekNum <= 18) {
    // Legacy iOS picker format (16-18 only, not 19)
    // Remap: 16→19 (Wild Card), 17→20 (Divisional), 18→21 (Conference)
    const resolved = weekNum + 3;
    console.log(`[${logPrefix}] Week remap (iOS picker): received=${weekNum}, resolved=${resolved}`);
    return resolved;
  } else {
    // Week number outside expected range (5-15) - use as-is but log warning
    console.log(`[${logPrefix}] Week WARNING: received=${weekNum}, playoff_start_week=${playoffStartWeek}, resolved=${weekNum} (unexpected range)`);
    return weekNum;
  }
}

// Helper: Normalize player name for matching (strips suffixes, periods, normalizes case)
function normalizePlayerName(name) {
  if (!name) return { firstName: '', lastName: '', normalized: '' };

  // Common suffixes to strip
  const suffixes = ['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v'];

  // Normalize: lowercase, remove periods, trim
  let normalized = name.toLowerCase().replace(/\./g, '').trim();

  // Split into parts
  let parts = normalized.split(/\s+/);

  // Remove suffix if last part is a suffix
  if (parts.length > 1 && suffixes.includes(parts[parts.length - 1])) {
    parts = parts.slice(0, -1);
  }

  const firstName = parts[0] || '';
  const lastName = parts.length > 1 ? parts[parts.length - 1] : '';

  return {
    firstName,
    lastName,
    normalized: parts.join(' '),
    parts
  };
}

// Helper: Build ESPN scoreboard URL with correct season type for playoffs
function getESPNScoreboardUrl(weekNumber) {
  // Weeks 19+ are playoff weeks (seasontype=3)
  // Regular season weeks use seasontype=2
  if (weekNumber >= 19) {
    const playoffWeek = weekNumber - 18; // Week 19 = playoff week 1
    return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=3&week=${playoffWeek}`;
  } else {
    return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${weekNumber}`;
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

// Helper: Parse stats from ESPN game summary
function parsePlayerStatsFromSummary(boxscore) {
  if (!boxscore || !boxscore.players) return [];

  // Use a Map to accumulate stats per player across all categories
  const playerStatsMap = new Map();

  for (const team of boxscore.players) {
    if (!team.statistics) continue;

    // Get team abbreviation for fallback matching
    const teamAbbrev = team.team?.abbreviation || null;

    for (const statGroup of team.statistics) {
      if (!statGroup.athletes) continue;
      const categoryName = statGroup.name; // 'passing', 'rushing', 'receiving', etc.

      for (const athlete of statGroup.athletes) {
        const athleteId = athlete.athlete?.id;
        const athleteName = athlete.athlete?.displayName || athlete.athlete?.shortName;

        if (!athleteId) continue;

        const athleteIdStr = athleteId.toString();


        // Get or create player entry
        if (!playerStatsMap.has(athleteIdStr)) {
          playerStatsMap.set(athleteIdStr, {
            athleteId: athleteIdStr,
            athleteName: athleteName || 'Unknown',
            teamAbbrev: teamAbbrev,
            stats: {}
          });
        }

        const playerEntry = playerStatsMap.get(athleteIdStr);

        // Parse stat labels and values with category prefix to avoid collisions
        if (statGroup.labels && athlete.stats) {
          for (let i = 0; i < statGroup.labels.length; i++) {
            const label = statGroup.labels[i];
            const value = athlete.stats[i];

            if (label && value) {
              // Prefix stats with category to avoid collisions (e.g., passing_YDS, rushing_YDS)
              const prefixedLabel = `${categoryName}_${label}`;
              playerEntry.stats[prefixedLabel] = value;
            }
          }
        }
      }
    }
  }

  // Convert Map to array
  return Array.from(playerStatsMap.values());
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
    fum_lost: 0,
    // Kicker fields
    fg_made: 0,
    fg_att: 0,
    fg_longest: 0,
    fg_missed: 0,
    xp_made: 0,
    xp_att: 0,
    xp_missed: 0
  };

  if (!espnStats) return scoring;

  // Passing stats (now prefixed with 'passing_')
  if (espnStats['passing_YDS']) {
    scoring.pass_yd = parseFloat(espnStats['passing_YDS']) || 0;
  }
  if (espnStats['passing_TD']) {
    scoring.pass_td = parseInt(espnStats['passing_TD']) || 0;
  }
  if (espnStats['passing_INT']) {
    scoring.pass_int = parseInt(espnStats['passing_INT']) || 0;
  }
  if (espnStats['passing_2PT']) {
    scoring.pass_2pt = parseInt(espnStats['passing_2PT']) || 0;
  }

  // Rushing stats (now prefixed with 'rushing_')
  if (espnStats['rushing_YDS']) {
    scoring.rush_yd = parseFloat(espnStats['rushing_YDS']) || 0;
  }
  if (espnStats['rushing_TD']) {
    scoring.rush_td = parseInt(espnStats['rushing_TD']) || 0;
  }
  if (espnStats['rushing_2PT']) {
    scoring.rush_2pt = parseInt(espnStats['rushing_2PT']) || 0;
  }

  // Receiving stats (now prefixed with 'receiving_')
  if (espnStats['receiving_REC']) {
    scoring.rec = parseInt(espnStats['receiving_REC']) || 0;
  }
  if (espnStats['receiving_YDS']) {
    scoring.rec_yd = parseFloat(espnStats['receiving_YDS']) || 0;
  }
  if (espnStats['receiving_TD']) {
    scoring.rec_td = parseInt(espnStats['receiving_TD']) || 0;
  }
  if (espnStats['receiving_2PT']) {
    scoring.rec_2pt = parseInt(espnStats['receiving_2PT']) || 0;
  }

  // Fumbles (now prefixed with 'fumbles_')
  if (espnStats['fumbles_LOST']) {
    scoring.fum_lost = parseInt(espnStats['fumbles_LOST']) || 0;
  }
  
  // Kicker stats
  // ESPN provides FG and XP in "made/att" format (e.g., "2/2")
  if (espnStats['kicking_FG']) {
    const fgParts = espnStats['kicking_FG'].toString().split('/');
    scoring.fg_made = parseInt(fgParts[0]) || 0;
    scoring.fg_att = parseInt(fgParts[1]) || 0;
    scoring.fg_missed = scoring.fg_att - scoring.fg_made;
  }
  if (espnStats['kicking_LONG']) {
    scoring.fg_longest = parseInt(espnStats['kicking_LONG']) || 0;
  }
  if (espnStats['kicking_XP']) {
    const xpParts = espnStats['kicking_XP'].toString().split('/');
    scoring.xp_made = parseInt(xpParts[0]) || 0;
    scoring.xp_att = parseInt(xpParts[1]) || 0;
    scoring.xp_missed = scoring.xp_att - scoring.xp_made;
  }

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
                  // ESPN Format: ["C/ATT", "YDS", "AVG", "TD", "INT", "SACKS", "QBR", "RTG"]
                  // Indices:        0       1      2      3     4       5       6      7
                  const yards = parseFloat(athlete.stats[1]) || 0;
                  stats.pass_yd += yards;
                  stats.pass_td += parseFloat(athlete.stats[3]) || 0;  // Fixed: was [2], now [3]
                  stats.pass_int += parseFloat(athlete.stats[4]) || 0; // Fixed: was [3], now [4]
                }

                if (statCategory.name === 'rushing' && athlete.stats) {
                  // ESPN Format: ["CAR", "YDS", "AVG", "TD", "LONG"]
                  // Indices:        0      1      2      3     4
                  const yards = parseFloat(athlete.stats[1]) || 0;
                  stats.rush_yd += yards;
                  stats.rush_td += parseFloat(athlete.stats[3]) || 0;
                }

                if (statCategory.name === 'receiving' && athlete.stats) {
                  // ESPN Format: ["REC", "YDS", "AVG", "TD", "LONG", "TGTS"]
                  // Indices:        0      1      2      3     4       5
                  stats.rec += parseFloat(athlete.stats[0]) || 0;
                  stats.rec_yd += parseFloat(athlete.stats[1]) || 0;
                  stats.rec_td += parseFloat(athlete.stats[3]) || 0;
                }

                if (statCategory.name === 'fumbles' && athlete.stats) {
                  // ESPN Format: ["FUM", "LOST", "REC"]
                  // Indices:        0      1      2
                  stats.fum_lost += parseFloat(athlete.stats[1]) || 0;
                }

                if (statCategory.name === 'kicking' && athlete.stats) {
                  // ESPN Format: ["FG", "PCT", "LONG", "XP", "PTS"]
                  // Indices:        0     1      2       3     4
                  // FG and XP are in "made/att" format
                  const fgMadeAtt = athlete.stats[0] ? athlete.stats[0].split('/') : ['0', '0'];
                  const fgMade = parseInt(fgMadeAtt[0]) || 0;
                  const fgAtt = parseInt(fgMadeAtt[1]) || 0;
                  const fgMissed = fgAtt - fgMade;
                  const longest = parseInt(athlete.stats[2]) || 0;

                  const patMadeAtt = athlete.stats[3] ? athlete.stats[3].split('/') : ['0', '0'];
                  const patMade = parseInt(patMadeAtt[0]) || 0;
                  const patAtt = parseInt(patMadeAtt[1]) || 0;
                  const patMissed = patAtt - patMade;

                  // Store kicker stats
                  stats.fg_made = fgMade;
                  stats.fg_missed = fgMissed;
                  stats.fg_longest = longest;
                  stats.xp_made = patMade;
                  stats.xp_missed = patMissed;
                }
              }
            }
          }
        }

        if (foundPlayer) {
          // Also check for 2-pt conversions in drives data
          if (response.data.drives) {
            const twoPointConversions = parse2PtConversions(response.data.drives);

            // Try to match this player using ESPN ID
            // We need to get the player name from the boxscore
            let playerName = null;
            for (const team of boxscore.players) {
              if (!team.statistics) continue;
              for (const statCategory of team.statistics) {
                if (!statCategory.athletes) continue;
                for (const athlete of statCategory.athletes) {
                  if (athlete.athlete?.id?.toString() === espnId.toString()) {
                    playerName = athlete.athlete.displayName;
                    break;
                  }
                }
                if (playerName) break;
              }
              if (playerName) break;
            }

            // Try to match 2-pt conversions
            if (playerName) {
              const playerAbbrev = playerName.split(' ').map((n, i) => i === 0 ? n[0] : n).join('.');
              const possibleAbbrevs = [
                playerAbbrev,
                playerName.split(' ').map(n => n[0]).join('.'),
                playerName.split(' ')[0][0] + '.' + playerName.split(' ').slice(-1)[0]
              ];

              for (const abbrev of possibleAbbrevs) {
                if (twoPointConversions[abbrev]) {
                  stats.pass_2pt = twoPointConversions[abbrev].pass_2pt || 0;
                  stats.rush_2pt = twoPointConversions[abbrev].rush_2pt || 0;
                  stats.rec_2pt = twoPointConversions[abbrev].rec_2pt || 0;
                  break;
                }
              }
            }
          }

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

// Simple wrapper to rescore an entire week using live stats pipeline
async function processWeekScoring(weekNumber) {
  console.log(`[admin] processWeekScoring called for week ${weekNumber}`);
  // This reuses the same logic as the live stats loop:
  // - fetch scoreboard for that week
  // - fetch player/DEF stats
  // - save into scores via savePlayerScoresToDatabase
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

// Fetch defense stats from ESPN (LIVE + HISTORICAL SAFE)
async function fetchDefenseStats(teamAbbrev, weekNumber) {
  try {
    const normalizedTeam = normalizeTeamAbbr(teamAbbrev);

    for (const gameId of liveStatsCache.activeGameIds) {
      try {
        const summaryUrl =
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`;
        const summaryRes = await axios.get(summaryUrl);

        if (!summaryRes.data || !summaryRes.data.boxscore) continue;

        const competition = summaryRes.data.header?.competitions?.[0];
        if (!competition?.competitors) continue;

        let isInGame = false;
        let opponentScore = 0;
        let teamId = null;

        // Identify team + opponent
        for (const competitor of competition.competitors) {
          const espnAbbr = normalizeTeamAbbr(competitor.team?.abbreviation);

          if (espnAbbr === normalizedTeam) {
            isInGame = true;
            teamId = competitor.id;
          } else {
            opponentScore = parseInt(competitor.score) || 0;
          }
        }

        if (!isInGame || !teamId) continue;

        const stats = {
          def_sack: 0,
          def_int: 0,
          def_fum_rec: 0,
          def_td: 0,
          def_safety: 0,
          def_block: 0,
          def_ret_td: 0,
          def_pts_allowed: opponentScore
        };

        // ============================================================
        // 1. Competitor defensive statistics (authoritative)
        // ============================================================
        const compStatsUrl =
          `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${gameId}` +
          `/competitions/${gameId}/competitors/${teamId}/statistics`;

        try {
          const compRes = await axios.get(compStatsUrl);
          const compStats = compRes.data;

          if (compStats?.splits?.categories) {
            for (const category of compStats.splits.categories) {
              if (!category.stats) continue;

              for (const stat of category.stats) {
                switch (stat.name) {
                  case 'sacks':
                    stats.def_sack += Number(stat.value) || 0;
                    break;

                  case 'interceptions':
                    if (
                      category.name === 'defensive' ||
                      category.name === 'defensiveInterceptions'
                    ) {
                      stats.def_int += Number(stat.value) || 0;
                    }
                    break;

                  case 'fumblesRecovered':
                  case 'fumbleRecoveries':
                    if (
                      category.name === 'defensive' ||
                      category.name === 'defensiveInterceptions'
                    ) {
                      stats.def_fum_rec += Number(stat.value) || 0;
                    }
                    break;

                  case 'defensiveTouchdowns':
                    stats.def_td += Number(stat.value) || 0;
                    break;

                  case 'kickReturnTouchdowns':
                  case 'puntReturnTouchdowns':
                    stats.def_ret_td += Number(stat.value) || 0;
                    break;

                  case 'pointsAllowed':
                    stats.def_pts_allowed = Number(stat.value) || opponentScore;
                    break;

                  case 'safeties':
                    stats.def_safety += Number(stat.value) || 0;
                    break;

                  case 'kicksBlocked':
                    stats.def_block += Number(stat.value) || 0;
                    break;
                }
              }
            }
          }
        } catch (_) {
          // competitor stats may fail early in games
        }

        // ============================================================
        // 2. Supplement sacks from team boxscore
        // ============================================================
        const teamBox = summaryRes.data.boxscore.teams?.find(
          t => normalizeTeamAbbr(t.team?.abbreviation) === normalizedTeam
        );


        // ============================================================
        // 3. Supplement INT + TD from defensive player boxscore
        // ============================================================
        const playerBox = summaryRes.data.boxscore.players;
        if (playerBox) {
          for (const group of playerBox) {
            if (!group.team) continue;

            const groupAbbr = normalizeTeamAbbr(group.team.abbreviation);
            if (groupAbbr !== normalizedTeam) continue;
            if (!group.statistics) continue;

            for (const cat of group.statistics) {
              if (cat.name === 'interceptions' && cat.athletes) {
                for (const a of cat.athletes) {
                  const ints = parseInt(a.stats?.[0] || '0');
                  const td = parseInt(a.stats?.[2] || '0');

                  if (!isNaN(ints)) stats.def_int += ints;
                  if (!isNaN(td)) stats.def_td += td;
                }
              }
            }
          }
        }

        return stats;

      } catch (_) {
        continue;
      }
    }

    return null;

  } catch (err) {
    console.error(`Defense fetch failed for ${teamAbbrev}:`, err.message);
    return null;
  }
}

async function savePlayerScoresToDatabase(weekNumber) {
  try {
    // Get teams we're tracking from picks
    const trackedTeamsResult = await pool.query(`
      SELECT DISTINCT p.team
      FROM picks pk
      JOIN players p ON pk.player_id = p.id::text
      WHERE pk.week_number = $1 AND p.team IS NOT NULL
    `, [weekNumber]);
    const trackedTeams = new Set(trackedTeamsResult.rows.map(r => r.team?.trim()?.toUpperCase()).filter(Boolean));

    const picksResult = await pool.query(`
      SELECT pk.id as pick_id, pk.user_id, pk.player_id, pk.position, pk.multiplier
      FROM picks pk
      WHERE pk.week_number = $1
    `, [weekNumber]);

    let savedCount = 0;

    for (const pick of picksResult.rows) {
      const playerRes = await pool.query(
        'SELECT espn_id, full_name, position, team FROM players WHERE id::text = $1',
        [pick.player_id]
      );
      if (playerRes.rows.length === 0) {
        continue;
      }

      const { espn_id: espnId, full_name: playerName, position: playerPosition, team: dbTeam } = playerRes.rows[0];
      let scoring = null;

      // =====================
      // DEFENSE
      // =====================
      if (playerPosition === 'DEF') {
        const defStats = await fetchDefenseStats(pick.player_id, weekNumber);

        if (defStats) {
          scoring = defStats;
        } else if (liveStatsCache.activeTeams.has(pick.player_id)) {
          scoring = {};
        } else {
          continue;
        }
      }

      // =====================
      // PLAYER (INCLUDING K)
      // =====================
      else {
        let playerStats = null;
        let resolvedEspnId = espnId;
        let playerTeam = null;

        // Cache lookup by ESPN ID
        if (espnId) {
          const cached = liveStatsCache.playerStats.get(espnId);
          if (cached) {
            playerStats = convertESPNStatsToScoring(cached.stats);
            playerTeam = cached.team;
          }
        }

        // Name-based cache lookup
        if (!playerStats) {
          const normalized = normalizePlayerName(playerName);

          for (const [athleteId, cached] of liveStatsCache.playerStats) {
            const cachedNormalized = normalizePlayerName(cached.athleteName);

            if (
              normalized.firstName === cachedNormalized.firstName &&
              normalized.lastName === cachedNormalized.lastName
            ) {
              if (!espnId) {
                await pool.query(
                  'UPDATE players SET espn_id = $1 WHERE id::text = $2',
                  [athleteId, pick.player_id]
                );
                resolvedEspnId = athleteId;
              }

              playerStats = convertESPNStatsToScoring(cached.stats);
              playerTeam = cached.team;
              break;
            }
          }
        }

        // ESPN fallback
        if (!playerStats && resolvedEspnId) {
          const fetched = await fetchPlayerStats(resolvedEspnId, weekNumber);
          if (fetched) {
            playerStats = fetched;

            const cached = liveStatsCache.playerStats.get(resolvedEspnId);
            if (cached?.team) {
              playerTeam = cached.team;
            }
          }
        }

        // Final scoring decision
        if (playerStats) {
          scoring = playerStats;
        } else {
          const rawTeam = playerTeam || dbTeam;
          const teamToCheck = rawTeam?.trim()?.toUpperCase();
          const isTracked = teamToCheck && trackedTeams.has(teamToCheck);
          if (isTracked) {
            scoring = {};
          } else {
            continue;
          }
        }
      }

      // =====================
      // KICKER ZERO FILL
      // =====================
      if (playerPosition === 'K' && Object.keys(scoring).length === 0) {
        scoring = {
          fg_made: 0,
          xp_made: 0
        };
      }

      const basePoints = await calculateFantasyPoints(scoring);
      const multiplier = pick.multiplier || 1;
      const finalPoints = basePoints * multiplier;

      await pool.query(`
        INSERT INTO scores (
          id, user_id, player_id, week_number,
          points, base_points, multiplier, final_points,
          stats_json, updated_at
        )
        VALUES (
          gen_random_uuid(), $1, $2, $3,
          $4, $4, $5, $6,
          $7, NOW()
        )
        ON CONFLICT (user_id, player_id, week_number) DO UPDATE SET
          points = $4,
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

    console.log(`Scores persisted`, { week: weekNumber, score_count: savedCount });
    return savedCount;
  } catch (err) {
    console.error('Error persisting scores:', { week: weekNumber, error: err.message });
    return 0;
  }
}

// Fetch scoreboard to get active games
async function fetchScoreboard(weekNumber) {
  try {
    const now = Date.now();

    // Check cache (include week in cache key)
    const cacheKey = `week_${weekNumber}`;
    if (
      liveStatsCache.lastScoreboardUpdate &&
      liveStatsCache.currentCachedWeek === weekNumber &&
      (now - liveStatsCache.lastScoreboardUpdate) < SCOREBOARD_CACHE_MS
    ) {
      console.log('Scoreboard cache hit', { cachedGames: liveStatsCache.activeGameIds.size, cacheAgeMs: now - liveStatsCache.lastScoreboardUpdate });
      return Array.from(liveStatsCache.activeGameIds);
    }

    const url = getESPNScoreboardUrl(weekNumber);
    console.log('Fetching fresh scoreboard', { url });
    const response = await axios.get(url);

    // CRITICAL: Clear stale caches when week changes to prevent cross-week stat leakage
    if (liveStatsCache.currentCachedWeek !== weekNumber) {
      liveStatsCache.playerStats.clear();
      liveStatsCache.games.clear();
      liveStatsCache.lastGameUpdates.clear();

      // IMPORTANT: lock cache to this week
      liveStatsCache.currentCachedWeek = weekNumber;
    }

    const activeGames = [];

    if (response.data && response.data.events) {
      for (const event of response.data.events) {
        const gameId = event.id;
        const status = event.status?.type?.state;

        // Only track in-progress or recently completed games
        if (status === 'in' || status === 'post') {
          activeGames.push(gameId);

          liveStatsCache.games.set(gameId, {
            id: gameId,
            name: event.name,
            shortName: event.shortName,
            status: status,
            homeTeam: event.competitions?.[0]?.competitors?.find(
              c => c.homeAway === 'home'
            )?.team?.abbreviation,
            awayTeam: event.competitions?.[0]?.competitors?.find(
              c => c.homeAway === 'away'
            )?.team?.abbreviation
          });
        }
      }
    }

    liveStatsCache.activeGameIds = new Set(activeGames);
    console.log('Fresh scoreboard fetched', { activeGames: activeGames.length, totalEvents: response.data?.events?.length || 0 });

    // FIX: derive activeTeams from active games
    liveStatsCache.activeTeams = new Set(
      Array.from(liveStatsCache.games.values())
        .flatMap(g => [g.homeTeam, g.awayTeam])
        .filter(Boolean)
    );

    liveStatsCache.currentCachedWeek = weekNumber;
    // Only cache timestamp when games found - prevents stale empty cache blocking live game detection
    if (activeGames.length > 0) {
      liveStatsCache.lastScoreboardUpdate = now;
    }

    return activeGames;
  } catch (err) {
    console.error('Error fetching scoreboard:', err.message);
    return [];
  }
}

// Helper: Parse 2-pt conversions from drives data
function parse2PtConversions(drivesData) {
  const conversions = {}; // Map of player name -> { pass_2pt, rush_2pt, rec_2pt }

  if (!drivesData || !drivesData.previous) return conversions;

  for (const drive of drivesData.previous) {
    if (!drive.plays) continue;

    for (const play of drive.plays) {
      // Check for 2-pt conversion attempt
      if (!play.pointAfterAttempt || play.pointAfterAttempt.value !== 2) continue;

      const text = play.text || '';
      const succeeded = text.includes('ATTEMPT SUCCEEDS');

      if (!succeeded) continue; // Only count successful conversions

      // Parse the play text to determine passer/rusher/receiver
      // Format examples:
      // "TWO-POINT CONVERSION ATTEMPT. J.Allen pass to D.Knox is complete. ATTEMPT SUCCEEDS."
      // "TWO-POINT CONVERSION ATTEMPT. J.Allen rush up the middle. ATTEMPT SUCCEEDS."

      const conversionMatch = text.match(/TWO-POINT CONVERSION ATTEMPT\.\s+([A-Z]\.[A-Za-z]+)\s+(pass|rush)/i);

      if (conversionMatch) {
        const playerAbbrev = conversionMatch[1]; // e.g., "J.Allen"
        const actionType = conversionMatch[2].toLowerCase(); // "pass" or "rush"

        // Initialize player entry
        if (!conversions[playerAbbrev]) {
          conversions[playerAbbrev] = { pass_2pt: 0, rush_2pt: 0, rec_2pt: 0 };
        }

        if (actionType === 'pass') {
          conversions[playerAbbrev].pass_2pt += 1;

          // Also credit the receiver
          const receiverMatch = text.match(/pass (?:to|short|left|right|middle)?\s*(?:to)?\s*([A-Z]\.[A-Za-z]+)/i);
          if (receiverMatch) {
            const receiverAbbrev = receiverMatch[1];
            if (receiverAbbrev !== playerAbbrev) {
              if (!conversions[receiverAbbrev]) {
                conversions[receiverAbbrev] = { pass_2pt: 0, rush_2pt: 0, rec_2pt: 0 };
              }
              conversions[receiverAbbrev].rec_2pt += 1;
            }
          }
        } else if (actionType === 'rush') {
          conversions[playerAbbrev].rush_2pt += 1;
        }
      }
    }
  }

  return conversions;
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

    const response = await axios.get(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`
    );

    if (response.data && response.data.boxscore) {
      const playerStats = parsePlayerStatsFromSummary(response.data.boxscore);

      // Parse 2-pt conversions from drives data
      const twoPointConversions = parse2PtConversions(response.data.drives);

      // Update cache
      for (const stat of playerStats) {
        // Check if this player has 2-pt conversions
        const playerName = stat.athleteName;
        const playerAbbrev = playerName.split(' ').map((n, i) => i === 0 ? n[0] : n).join('.');

        // Try multiple abbreviation formats
        const possibleAbbrevs = [
          playerAbbrev, // "J.Allen"
          playerName.split(' ').map(n => n[0]).join('.'), // "J.A." for "Josh Allen"
          playerName.split(' ')[0][0] + '.' + playerName.split(' ').slice(-1)[0] // "J.Allen"
        ];

        // Add 2-pt conversion stats if found
        for (const abbrev of possibleAbbrevs) {
          if (twoPointConversions[abbrev]) {
            if (!stat.stats) stat.stats = {};

            // Add prefixed 2-pt conversion stats
            if (twoPointConversions[abbrev].pass_2pt > 0) {
              stat.stats['passing_2PT'] = twoPointConversions[abbrev].pass_2pt.toString();
            }
            if (twoPointConversions[abbrev].rush_2pt > 0) {
              stat.stats['rushing_2PT'] = twoPointConversions[abbrev].rush_2pt.toString();
            }
            if (twoPointConversions[abbrev].rec_2pt > 0) {
              stat.stats['receiving_2PT'] = twoPointConversions[abbrev].rec_2pt.toString();
            }
            break;
          }
        }

        liveStatsCache.playerStats.set(stat.athleteId, {
          ...stat,
          gameId: gameId,
          updatedAt: now
        });
      }

      liveStatsCache.lastGameUpdates.set(gameId, now);
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

    return result.rows.map(r => r.team);
  } catch (err) {
    console.error('Error getting active teams:', err);
    return [];
  }
}

// Main live stats update function
async function updateLiveStats(weekNumber) {
  const startTime = Date.now();
  try {
    console.log(`Scoring job started`, { week: weekNumber });

    // Step 1: Get active games for this specific week
    const activeGameIds = await fetchScoreboard(weekNumber);
    if (activeGameIds.length === 0) {
      console.log('No active games found', { week: weekNumber });
      return { success: true, message: 'No active games', gamesUpdated: 0 };
    }

    // Step 2: Get teams we care about
    const activeTeams = await getActiveTeamsForWeek(weekNumber);

    // Step 3: Filter games to only those with our teams
    const relevantGames = [];
    for (const gameId of activeGameIds) {
      const gameInfo = liveStatsCache.games.get(gameId);
      if (gameInfo &&
          (activeTeams.includes(gameInfo.homeTeam) || activeTeams.includes(gameInfo.awayTeam))) {
        relevantGames.push(gameId);
      }
    }

    // Step 4: Fetch summaries for relevant games
    let gamesUpdated = 0;
    for (const gameId of relevantGames) {
      const updated = await fetchGameSummary(gameId);
      if (updated) gamesUpdated++;

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Step 5: Save scores to database
    const scoreCount = await savePlayerScoresToDatabase(weekNumber);

    const durationMs = Date.now() - startTime;
    console.log(`Scoring job completed successfully`, { week: weekNumber, scores_written: scoreCount, duration_ms: durationMs });

    return {
      success: true,
      message: `Updated ${gamesUpdated} games`,
      gamesUpdated: gamesUpdated,
      totalActiveGames: activeGameIds.length,
      relevantGames: relevantGames.length
    };
  } catch (err) {
    console.error('Scoring job failed', { week: weekNumber, error: err.message, stack: err.stack });
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

    // Kicker stats
    if (
      stats.fg_made !== undefined ||
      stats.xp_made !== undefined ||
      stats.xp_missed !== undefined
    ) {
      const fgMade = stats.fg_made || 0;
      const fgLongest = Number(stats.fg_longest) || 0;

      if (fgLongest >= 50 && fgMade > 0) {
        points += 5;
        points += (fgMade - 1) * 3;
      } else if (fgLongest >= 40 && fgMade > 0) {
        points += 4;
        points += (fgMade - 1) * 3;
      } else {
        points += fgMade * 3;
      }

      points += (stats.xp_made || 0) * (rules.pat_made || 1);
      points += (stats.fg_missed || 0) * (rules.fg_missed || -2);
      points += (stats.xp_missed || 0) * (rules.pat_missed || -1);
    }

    // Defense stats
    if (stats.def_sack !== undefined) {
      points += (stats.def_sack || 0) * (rules.def_sack || 1);
      points += (stats.def_int || 0) * (rules.def_int || 2);
      points += (stats.def_fum_rec || 0) * (rules.def_fum_rec || 2);
      points += (stats.def_td || 0) * (rules.def_td || 6);
      points += (stats.def_safety || 0) * (rules.def_safety || 2);
      points += (stats.def_block || 0) * (rules.def_block || 4);
      points += (stats.def_ret_td || 0) * (rules.def_ret_td || 6);

      const ptsAllowed = stats.def_pts_allowed || 0;
      if (ptsAllowed === 0) points += 20;
      else if (ptsAllowed <= 6) points += 15;
      else if (ptsAllowed <= 13) points += 10;
      else if (ptsAllowed <= 20) points += 5;
      else if (ptsAllowed <= 27) points += 0;
      else if (ptsAllowed <= 34) points += -1;
      else points += -4;
    }

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

// Admin auth routes (no protection)
app.use('/api/admin/auth', adminAuthRoutes);

// Admin protection middleware
app.use('/api/admin', requireAdmin);

// Admin diagnostics routes (protected by requireAdmin above)
app.use('/api/admin/diagnostics', adminDiagnosticsRoutes);

// Admin trends routes (protected by requireAdmin above)
app.use('/api/admin/trends', adminTrendsRoutes);

// Update week active status (lock/unlock)
app.post('/api/admin/update-week-status', async (req, res) => {
  try {
    const { is_week_active } = req.body;

    if (typeof is_week_active !== 'boolean') {
      return res.status(400).json({ success: false, error: 'is_week_active must be a boolean' });
    }

    const result = await pool.query(
      'UPDATE game_settings SET is_week_active = $1 RETURNING *',
      [is_week_active]
    );

    console.log(`Week lock status updated: is_week_active = ${is_week_active}`);

    res.json({ success: true, message: is_week_active ? 'Week unlocked' : 'Week locked' });
  } catch (err) {
    console.error('Error updating week status:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Verify week lock status - provides authoritative confirmation for admin verification
app.get('/api/admin/verify-lock-status', async (req, res) => {
  try {
    const gameStateResult = await pool.query(
      `SELECT
        is_week_active,
        current_playoff_week,
        playoff_start_week,
        updated_at
       FROM game_settings LIMIT 1`
    );

    if (gameStateResult.rows.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Game settings not found'
      });
    }

    const { is_week_active, current_playoff_week, playoff_start_week, updated_at } = gameStateResult.rows[0];
    const effectiveNflWeek = current_playoff_week > 0
      ? playoff_start_week + current_playoff_week - 1
      : null;

    // Test that a picks write would actually be blocked
    const lockEnforced = !is_week_active;

    res.json({
      success: true,
      verification: {
        isLocked: lockEnforced,
        isWeekActive: is_week_active,
        currentPlayoffWeek: current_playoff_week,
        effectiveNflWeek: effectiveNflWeek,
        lastUpdated: updated_at,
        message: lockEnforced
          ? 'Week is LOCKED. All pick modifications will be rejected by the API.'
          : 'Week is UNLOCKED. Users can currently modify picks.'
      }
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

    for (const player of playersResult.rows) {
      const sleeperData = sleeperPlayers[player.sleeper_id];

      if (sleeperData && sleeperData.espn_id) {
        const imageUrl = getPlayerImageUrl(player.sleeper_id, player.position);
        await pool.query(
          'UPDATE players SET espn_id = $1, image_url = $2 WHERE id = $3',
          [sleeperData.espn_id.toString(), imageUrl, player.id]
        );
        console.log(`Updated ${player.full_name}: ESPN ID = ${sleeperData.espn_id}`);
        updated++;
      } else {
        console.log(`No ESPN ID found for ${player.full_name} (${player.sleeper_id})`);
        notFound++;
      }
    }

    console.log(`ESPN ID sync complete: ${updated} updated, ${notFound} not found`);

    res.json({
      success: true,
      message: `Synced ESPN IDs: ${updated} updated, ${notFound} not found`,
      updated,
      notFound
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
    const actualWeekNumber = await resolveActualWeekNumber(weekNumber, pool, 'LiveScores');
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
// MULTIPLIER & PLAYER REPLACEMENT ENDPOINTS
// ==============================================

// Admin: Preview week transition - READ-ONLY, returns ESPN data for confirmation
// This endpoint does NOT mutate any state. It only fetches and returns preview data.
app.get('/api/admin/preview-week-transition', async (req, res) => {
  try {
    // Get current game state
    const gameStateResult = await pool.query(
      'SELECT current_playoff_week, playoff_start_week, is_week_active FROM game_settings LIMIT 1'
    );

    if (gameStateResult.rows.length === 0) {
      return res.status(500).json({ error: 'Game settings not found' });
    }

    const { current_playoff_week, playoff_start_week, is_week_active } = gameStateResult.rows[0];

    // Validate preconditions (same as transition endpoint)
    if (is_week_active) {
      return res.status(400).json({
        error: 'Week must be locked before previewing transition. Set is_week_active = false first.',
        currentState: { is_week_active, current_playoff_week }
      });
    }

    if (current_playoff_week >= 4) {
      return res.status(400).json({
        error: 'Cannot advance beyond Super Bowl (playoff week 4)',
        currentState: { current_playoff_week }
      });
    }

    // Derive target week
    const fromPlayoffWeek = current_playoff_week;
    const toPlayoffWeek = current_playoff_week + 1;
    const toWeek = playoff_start_week + toPlayoffWeek - 1;  // NFL week number

    // Fetch ESPN data (read-only external call)
    let scoreboardResponse;
    try {
      scoreboardResponse = await axios.get(getESPNScoreboardUrl(toWeek));
    } catch (espnErr) {
      console.error('[admin] Preview: ESPN API call failed:', espnErr.message);
      return res.status(502).json({
        error: 'Failed to fetch ESPN scoreboard data',
        details: espnErr.message
      });
    }

    const activeTeams = new Set();
    let eventCount = 0;

    if (scoreboardResponse.data && scoreboardResponse.data.events) {
      eventCount = scoreboardResponse.data.events.length;
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

    const activeTeamsArray = Array.from(activeTeams).sort();

    // Return preview data (no mutations)
    res.json({
      success: true,
      preview: {
        fromPlayoffWeek,
        toPlayoffWeek,
        nflWeek: toWeek,
        eventCount,
        activeTeams: activeTeamsArray,
        teamCount: activeTeamsArray.length
      }
    });

  } catch (err) {
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
    // NOTE: fromWeek and toWeek are now IGNORED from client - derived from DB state

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

    // ========================================
    // STEP 1: Validate preconditions (no transaction yet)
    // ========================================

    // Verify user is admin
    const userCheck = await client.query(
      'SELECT is_admin FROM users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0 || !userCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get current game state - this is the SINGLE SOURCE OF TRUTH
    const gameStateResult = await client.query(
      'SELECT current_playoff_week, playoff_start_week, is_week_active FROM game_settings LIMIT 1'
    );

    if (gameStateResult.rows.length === 0) {
      return res.status(500).json({ error: 'Game settings not found' });
    }

    const { current_playoff_week, playoff_start_week, is_week_active } = gameStateResult.rows[0];

    // PRECONDITION 1: Week must be locked
    if (is_week_active) {
      return res.status(400).json({
        error: 'Week must be locked before advancing. Set is_week_active = false first.',
        currentState: { is_week_active, current_playoff_week }
      });
    }

    // PRECONDITION 2: Cannot advance beyond Super Bowl (playoff week 4)
    if (current_playoff_week >= 4) {
      return res.status(400).json({
        error: 'Cannot advance beyond Super Bowl (playoff week 4)',
        currentState: { current_playoff_week }
      });
    }

    // Derive weeks deterministically from DB state
    const fromPlayoffWeek = current_playoff_week;
    const toPlayoffWeek = current_playoff_week + 1;
    const fromWeek = playoff_start_week + fromPlayoffWeek - 1;  // NFL week number
    const toWeek = playoff_start_week + toPlayoffWeek - 1;      // NFL week number

    console.log(`[admin] Processing week transition: Playoff ${fromPlayoffWeek} -> ${toPlayoffWeek} (NFL ${fromWeek} -> ${toWeek})`);

    // ========================================
    // STEP 2: Fetch ESPN data BEFORE transaction (external call)
    // ========================================

    let scoreboardResponse;
    try {
      scoreboardResponse = await axios.get(getESPNScoreboardUrl(toWeek));
    } catch (espnErr) {
      console.error('[admin] ESPN API call failed:', espnErr.message);
      return res.status(502).json({
        error: 'Failed to fetch ESPN scoreboard data',
        details: espnErr.message
      });
    }

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

    // PRECONDITION 3: ESPN must return valid game data
    // Expected team counts: Wild Card=12, Divisional=8, Conference=4, Super Bowl=2
    const expectedTeamCounts = { 1: 12, 2: 8, 3: 4, 4: 2 };
    const expectedCount = expectedTeamCounts[toPlayoffWeek];

    if (activeTeams.size === 0) {
      return res.status(400).json({
        error: `ESPN returned no active teams for NFL week ${toWeek}. Cannot proceed with empty data.`,
        espnUrl: getESPNScoreboardUrl(toWeek)
      });
    }

    if (expectedCount && activeTeams.size !== expectedCount) {
      console.warn(`[admin] WARNING: Expected ${expectedCount} teams for playoff week ${toPlayoffWeek}, got ${activeTeams.size}`);
      // Log warning but don't block - playoff schedule can vary
    }

    console.log(`[admin] Active teams for NFL week ${toWeek}:`, Array.from(activeTeams));

    // ========================================
    // STEP 3: Begin transaction for all mutations
    // ========================================

    await client.query('BEGIN');

    try {
      // Get all picks from the current week
      const picksResult = await client.query(`
        SELECT pk.id, pk.user_id, pk.player_id, pk.position, pk.multiplier, pk.consecutive_weeks, p.team, p.full_name
        FROM picks pk
        JOIN players p ON pk.player_id = p.id
        WHERE pk.week_number = $1
      `, [fromWeek]);

      let advancedCount = 0;
      let eliminatedCount = 0;
      const eliminated = [];
      const activeTeamsArray = Array.from(activeTeams);

      // Process each pick
      for (const pick of picksResult.rows) {
        const playerTeam = pick.team;
        const isActive = activeTeams.has(playerTeam);

        if (isActive) {
          // Player's team is still active - increment multiplier
          const newMultiplier = (pick.multiplier || 1) + 1;
          const newConsecutiveWeeks = (pick.consecutive_weeks || 1) + 1;

          // Create new pick for next week with incremented multiplier
          await client.query(`
            INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
            VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, false, NOW())
            ON CONFLICT (user_id, player_id, week_number) DO UPDATE SET
              multiplier = $5,
              consecutive_weeks = $6
          `, [pick.user_id, pick.player_id, toWeek, pick.position, newMultiplier, newConsecutiveWeeks]);

          advancedCount++;
        } else {
          // Player's team is eliminated
          eliminated.push({
            userId: pick.user_id,
            playerId: pick.player_id,
            playerName: pick.full_name,
            position: pick.position,
            team: playerTeam
          });
          eliminatedCount++;
        }
      }

      // Update game_settings atomically: active_teams AND current_playoff_week
      await client.query(
        'UPDATE game_settings SET active_teams = $1, current_playoff_week = $2',
        [activeTeamsArray, toPlayoffWeek]
      );

      // Commit transaction
      await client.query('COMMIT');

      console.log(`[admin] Week transition COMMITTED: ${advancedCount} advanced, ${eliminatedCount} eliminated`);
      console.log(`[admin] game_settings updated: current_playoff_week = ${toPlayoffWeek}, active_teams = [${activeTeamsArray.join(', ')}]`);

      res.json({
        success: true,
        fromPlayoffWeek,
        toPlayoffWeek,
        fromWeek,
        toWeek,
        activeTeams: activeTeamsArray,
        advancedCount,
        eliminatedCount,
        eliminated,
        newState: {
          current_playoff_week: toPlayoffWeek,
          effective_nfl_week: toWeek
        }
      });

    } catch (txErr) {
      // Rollback on ANY error within transaction
      await client.query('ROLLBACK');
      console.error('[admin] Week transition ROLLED BACK:', txErr.message);
      throw txErr;
    }

  } catch (err) {
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
    const scoreboardResponse = await axios.get(getESPNScoreboardUrl(weekNumber));

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

    // Get user's picks from PREVIOUS week
    const prevWeek = parseInt(weekNumber) - 1;
    const picksResult = await pool.query(`
      SELECT pk.id, pk.user_id, pk.player_id, pk.position, pk.multiplier, p.team, p.full_name
      FROM picks pk
      JOIN players p ON pk.player_id = p.id
      WHERE pk.user_id = $1 AND pk.week_number = $2
    `, [userId, prevWeek]);

    const eliminated = [];

    for (const pick of picksResult.rows) {
      const playerTeam = pick.team;
      const isActive = activeTeams.has(playerTeam);

      if (!isActive) {
        eliminated.push({
          pickId: pick.id,
          playerId: pick.player_id,
          playerName: pick.full_name,
          position: pick.position,
          team: playerTeam,
          multiplier: pick.multiplier
        });
      }
    }

    res.json({
      weekNumber: parseInt(weekNumber),
      previousWeek: prevWeek,
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
    const { userId, oldPlayerId, newPlayerId, position, weekNumber } = req.body;

    if (!userId || !oldPlayerId || !newPlayerId || !position || !weekNumber) {
      return res.status(400).json({
        error: 'userId, oldPlayerId, newPlayerId, position, and weekNumber required'
      });
    }

    // Server-side week derivation for playoffs (same as pick submission)
    const gameStateResult = await pool.query(
      'SELECT current_playoff_week, playoff_start_week, is_week_active FROM game_settings LIMIT 1'
    );
    const { current_playoff_week, playoff_start_week, is_week_active } = gameStateResult.rows[0] || {};

    // Week lockout check - block modifications when week is locked
    if (!is_week_active) {
      return res.status(403).json({
        error: 'Picks are locked for this week. The submission window has closed.'
      });
    }

    const effectiveWeekNumber = current_playoff_week > 0
      ? playoff_start_week + current_playoff_week - 1
      : weekNumber;

    // Verify the old player's team is actually eliminated
    const scoreboardResponse = await axios.get(getESPNScoreboardUrl(effectiveWeekNumber));

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

    // Check old player's team
    const oldPlayerResult = await pool.query(
      'SELECT team, full_name FROM players WHERE id = $1',
      [oldPlayerId]
    );

    if (oldPlayerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Old player not found' });
    }

    const oldPlayerTeam = oldPlayerResult.rows[0].team;
    if (activeTeams.has(oldPlayerTeam)) {
      return res.status(400).json({
        error: `Cannot replace ${oldPlayerResult.rows[0].full_name} - their team (${oldPlayerTeam}) is still active`
      });
    }

    // Get new player info
    const newPlayerResult = await pool.query(
      'SELECT team, full_name, position FROM players WHERE id = $1',
      [newPlayerId]
    );

    if (newPlayerResult.rows.length === 0) {
      return res.status(404).json({ error: 'New player not found' });
    }

    // Validate new player's team is selectable (uses DB-backed active_teams with caching)
    const selectableResult = await getSelectableTeams(pool);
    if (selectableResult.error) {
      console.error(`[swap] ${selectableResult.error}: active_teams not set for playoff week ${selectableResult.currentPlayoffWeek}`);
      return res.status(500).json({ error: 'Server configuration error. Please contact support.' });
    }
    const normalizedNewTeam = normalizeTeamAbbr(newPlayerResult.rows[0].team);
    if (!selectableResult.teams.includes(normalizedNewTeam)) {
      return res.status(400).json({
        error: `${newPlayerResult.rows[0].full_name}'s team (${newPlayerResult.rows[0].team}) has been eliminated. Only players from active teams are selectable.`
      });
    }

    // Validate position limit
    const positionLimit = await pool.query(
      'SELECT required_count FROM position_requirements WHERE position = $1',
      [position]
    );

    const maxPicks = positionLimit.rows[0]?.required_count || 2;

    // Check current pick count for this position (excluding the old player)
    const currentCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM picks
      WHERE user_id = $1
        AND week_number = $2
        AND position = $3
        AND player_id != $4
    `, [userId, effectiveWeekNumber, position, oldPlayerId]);

    if (parseInt(currentCount.rows[0].count) >= maxPicks) {
      return res.status(400).json({
        error: `Position limit exceeded for ${position}. Maximum allowed: ${maxPicks}`
      });
    }

    // Delete old pick if it exists for this week
    await pool.query(
      'DELETE FROM picks WHERE user_id = $1 AND player_id = $2 AND week_number = $3',
      [userId, oldPlayerId, effectiveWeekNumber]
    );

    // Check for multiplier/consecutive_weeks carry from immediately previous playoff week
    // If player was rostered in previous week, increment their multiplier and consecutive_weeks
    let preservedMultiplier = 1;
    let preservedConsecutiveWeeks = 1;
    if (current_playoff_week > 1) {
      const previousWeekNumber = effectiveWeekNumber - 1;
      const prevPickResult = await pool.query(
        'SELECT multiplier, consecutive_weeks FROM picks WHERE user_id = $1 AND player_id = $2 AND week_number = $3',
        [userId, newPlayerId, previousWeekNumber]
      );
      if (prevPickResult.rows.length > 0) {
        // Carry forward: current week = previous week + 1
        preservedMultiplier = (prevPickResult.rows[0].multiplier || 1) + 1;
        preservedConsecutiveWeeks = (prevPickResult.rows[0].consecutive_weeks || 1) + 1;
        console.log(`[swap] Carrying multiplier ${preservedMultiplier} (prev ${prevPickResult.rows[0].multiplier}) and consecutive_weeks ${preservedConsecutiveWeeks} for player ${newPlayerId}`);
      }
    }

    // Create new pick with carried values (or 1/1 if not found in previous week)
    const newPickResult = await pool.query(`
      INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, false, NOW())
      ON CONFLICT (user_id, player_id, week_number) DO UPDATE SET
        position = $4,
        multiplier = $5,
        consecutive_weeks = $6
      RETURNING *
    `, [userId, newPlayerId, effectiveWeekNumber, position, preservedMultiplier, preservedConsecutiveWeeks]);

    // Log the swap to player_swaps table
    await pool.query(`
      INSERT INTO player_swaps (user_id, old_player_id, new_player_id, position, week_number, swapped_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [userId, oldPlayerId, newPlayerId, position, effectiveWeekNumber]);

    console.log(`[swap] User ${userId} replaced ${oldPlayerResult.rows[0].full_name} with ${newPlayerResult.rows[0].full_name} for week ${effectiveWeekNumber}`);

    res.json({
      success: true,
      oldPlayer: {
        id: oldPlayerId,
        name: oldPlayerResult.rows[0].full_name,
        team: oldPlayerTeam
      },
      newPlayer: {
        id: newPlayerId,
        name: newPlayerResult.rows[0].full_name,
        team: newPlayerResult.rows[0].team
      },
      pick: newPickResult.rows[0]
    });

  } catch (err) {
    console.error('Error replacing player:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================================
// USER REGISTRATION / LOGIN
// ==============================================

// Restricted states (fantasy sports prohibited or heavily restricted)
const RESTRICTED_STATES = ['NV', 'HI', 'ID', 'MT', 'WA'];

// Helper: Log signup attempt for compliance auditing
async function logSignupAttempt(appleId, email, name, attemptedState, ipState, blocked, blockedReason = null) {
  try {
    await pool.query(
      `INSERT INTO signup_attempts
        (apple_id, email, name, attempted_state, ip_state_verified, blocked, blocked_reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [appleId, email, name, attemptedState, ipState, blocked, blockedReason]
    );
  } catch (err) {
    console.error('[COMPLIANCE] Error logging signup attempt:', err);
    // Don't fail signup if logging fails
  }
}

// Helper: Get IP state from request
function getIPState(req) {
  try {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0].trim() : req.connection.remoteAddress;

    // Handle localhost/private IPs
    if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      console.log('[COMPLIANCE] Local/private IP detected, skipping geolocation');
      return null;
    }

    const geo = geoip.lookup(ip);
    const state = geo?.region || null;

    if (state) {
      console.log(`[COMPLIANCE] IP ${ip} → State: ${state}`);
    } else {
      console.log(`[COMPLIANCE] IP ${ip} → State: unknown`);
    }

    return state;
  } catch (err) {
    console.error('[COMPLIANCE] Error in IP geolocation:', err);
    return null;
  }
}

app.post('/api/users', authLimiter, async (req, res) => {
  try {
    const { apple_id, email, name, state, eligibility_certified, tos_version } = req.body;

    console.log('POST /api/users - Received:', { apple_id, email, name, state, eligibility_certified });

    if (!apple_id) {
      return res.status(400).json({ error: 'apple_id is required' });
    }

    // Try to find existing user first (allow returning users)
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

    // NEW USER SIGNUP - Compliance checks required
    if (!state || !eligibility_certified) {
      return res.status(400).json({
        error: 'State and eligibility certification are required for new users'
      });
    }

    // Get IP-based state for audit trail
    const ipState = getIPState(req);

    // Check if state is restricted
    if (RESTRICTED_STATES.includes(state.toUpperCase())) {
      console.log(`[COMPLIANCE] Blocking signup from restricted state: ${state}`);

      // Log blocked attempt
      await logSignupAttempt(apple_id, email, name, state.toUpperCase(), ipState, true, 'Restricted state');

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
    // Username = email prefix (before @), never full email for privacy
    let generatedUsername = email ? email.split('@')[0] : null;
    if (!generatedUsername) {
      generatedUsername = 'User_' + Math.random().toString(36).substring(2, 10);
    }

    const insert = await pool.query(
      `INSERT INTO users (
        id, apple_id, email, name, username,
        state, ip_state_verified, state_certification_date,
        eligibility_confirmed_at, age_verified, tos_version,
        created_at, updated_at, paid
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3, $4,
        $5, $6, NOW(),
        NOW(), true, $7,
        NOW(), NOW(), true
      )
      RETURNING *`,
      [
        apple_id,
        email || null,
        name || null,
        generatedUsername,
        state.toUpperCase(),
        ipState,
        tos_version || '2025-12-12'
      ]
    );

    // Log successful signup attempt
    await logSignupAttempt(apple_id, email, name, state.toUpperCase(), ipState, false, null);

    console.log(`[COMPLIANCE] Created new user: ${insert.rows[0].id} (State: ${state})`);
    res.json(insert.rows[0]);
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
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Get IP-based state for audit trail
    const ipState = getIPState(req);

    // Check if state is restricted
    if (RESTRICTED_STATES.includes(state.toUpperCase())) {
      console.log(`[COMPLIANCE] Blocking signup from restricted state: ${state}`);

      // Log blocked attempt
      await logSignupAttempt(null, email, name, state.toUpperCase(), ipState, true, 'Restricted state');

      return res.status(403).json({
        error: 'Fantasy contests are not available in your state'
      });
    }

    // Log mismatch if IP state differs from claimed state
    if (ipState && state.toUpperCase() !== ipState) {
      console.warn(`[COMPLIANCE] State mismatch - User claimed: ${state}, IP shows: ${ipState}`);
    }

    // Hash password
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Generate username = email prefix (before @), never full email for privacy
    let generatedUsername = email ? email.split('@')[0] : null;
    if (!generatedUsername) {
      generatedUsername = 'User_' + Math.random().toString(36).substring(2, 10);
    }

    // Create new user
    const insert = await pool.query(
      `INSERT INTO users (
        id, email, password_hash, name, username, auth_method,
        state, ip_state_verified, state_certification_date,
        eligibility_confirmed_at, age_verified, tos_version,
        created_at, updated_at, paid
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3, $4, 'email',
        $5, $6, NOW(),
        NOW(), true, $7,
        NOW(), NOW(), true
      )
      RETURNING *`,
      [
        email.toLowerCase(),
        password_hash,
        name || null,
        generatedUsername,
        state.toUpperCase(),
        ipState,
        tos_version || '2025-12-12'
      ]
    );

    // Log successful signup
    await logSignupAttempt(null, email, name, state.toUpperCase(), ipState, false, null);

    console.log(`[AUTH] Created new email user: ${insert.rows[0].id} (State: ${state})`);

    // Return user (without password_hash)
    const user = insert.rows[0];
    delete user.password_hash;
    res.json(user);
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
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 LIMIT 1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Check if user has password_hash (might be Apple Sign In user)
    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account uses Sign in with Apple. Please use Apple Sign In.' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);

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

// Update user profile (username, email, phone)
app.put('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, email, phone, name } = req.body;

    console.log('PUT /api/users/:userId - Updating user:', { userId, username, email, phone, name });

    // Verify user exists
    const userCheck = await pool.query(
      'SELECT id FROM users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check username uniqueness if username is being updated
    if (username) {
      const usernameCheck = await pool.query(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [username, userId]
      );

      if (usernameCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Username already taken' });
      }

      // Validate username format (alphanumeric, underscore, dash, 3-30 chars)
      const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/;
      if (!usernameRegex.test(username)) {
        return res.status(400).json({
          error: 'Username must be 3-30 characters and contain only letters, numbers, underscores, and dashes'
        });
      }
    }

    // Build dynamic update query based on provided fields
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (username !== undefined) {
      updates.push(`username = $${paramCount}`);
      values.push(username);
      paramCount++;
    }

    if (email !== undefined) {
      updates.push(`email = $${paramCount}`);
      values.push(email);
      paramCount++;
    }

    if (phone !== undefined) {
      updates.push(`phone = $${paramCount}`);
      values.push(phone);
      paramCount++;
    }

    if (name !== undefined) {
      updates.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }

    // Always update the updated_at timestamp
    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) {
      // Only updated_at would be updated, nothing else provided
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Add userId as the last parameter for WHERE clause
    values.push(userId);

    const query = `
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    console.log('User updated successfully:', result.rows[0].id);

    // Remove password_hash from response (iOS User model doesn't have this field)
    const user = result.rows[0];
    delete user.password_hash;

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

    const result = await pool.query(
      `UPDATE users
        SET tos_accepted_at = NOW(),
            tos_version = $1,
            updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [tos_version || '2025-12-12', userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`[COMPLIANCE] User ${userId} accepted TOS version ${tos_version}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error accepting TOS:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================================
// ACCOUNT DELETION ENDPOINT
// ==============================================

// Shared helper for deleting a user and all related data
// Accepts a client from pool.connect() - caller is responsible for BEGIN/COMMIT/ROLLBACK
async function deleteUserById(client, userId) {
  // Delete in order: picks, player_swaps, scores, then user
  await client.query('DELETE FROM picks WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM player_swaps WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM scores WHERE user_id = $1', [userId]);
  const result = await client.query('DELETE FROM users WHERE id = $1 RETURNING *', [userId]);
  return result;
}

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

    await deleteUserById(client, userId);
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
  try {
    const limit = parseInt(req.query.limit) || 200;
    const offset = parseInt(req.query.offset) || 0;
    const position = req.query.position;

    const now = Date.now();

    // Return cached data if fresh and no specific filters
    if (!position && offset === 0 &&
        playersCache.lastUpdate &&
        (now - playersCache.lastUpdate) < PLAYERS_CACHE_MS &&
        playersCache.data.length > 0) {
      console.log(`Returning ${playersCache.data.length} cached players`);
      return res.json({
        players: playersCache.data.slice(0, limit),
        total: playersCache.data.length,
        limit: limit,
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

    // Filter to only selectable teams
    let query = `
      SELECT id, sleeper_id, full_name, first_name, last_name, position, team,
              number, status, injury_status, is_active, available, image_url
      FROM players
      WHERE is_active = true
        AND available = true
        AND team = ANY($1)
        AND position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
        AND (position = 'DEF' OR (espn_id IS NOT NULL AND espn_id != ''))`;

    const params = [selectableTeams];

    if (position) {
      query += ` AND position = $${params.length + 1}`;
      params.push(position);
    }

    query += ` ORDER BY position, team, full_name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count (filtered to selectable teams)
    const countQuery = `
      SELECT COUNT(*) as total
      FROM players
      WHERE is_active = true
        AND available = true
        AND team = ANY($1)
        AND position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
        AND (position = 'DEF' OR (espn_id IS NOT NULL AND espn_id != ''))
      ${position ? `AND position = $2` : ''}
    `;
    const countParams = position ? [selectableTeams, position] : [selectableTeams];
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    // Update cache if fetching all
    if (!position && offset === 0) {
      playersCache.data = result.rows;
      playersCache.lastUpdate = now;
      console.log(`Cached ${result.rows.length} players`);
    }

    res.json({
      players: result.rows,
      total: total,
      limit: limit,
      offset: offset
    });
  } catch (err) {
    console.error('Error fetching players:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================================
// V2 PICKS API - MUST BE DEFINED BEFORE /:userId ROUTES
// ==============================================
// These routes must come BEFORE /api/picks/:userId to prevent
// "v2" from being captured as a userId parameter

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
    // Remap playoff week index (1-4) to NFL week (19-22)
    let effectiveWeek;
    if (weekNumber !== undefined) {
      effectiveWeek = await resolveActualWeekNumber(weekNumber, pool, 'PicksV2');
      if (!effectiveWeek) {
        return res.status(400).json({ error: 'Invalid weekNumber' });
      }
    } else {
      // Default to server's effective week (already returns NFL week)
      effectiveWeek = await getEffectiveWeekNumber();
    }

    // Get picks with player info
    const picksResult = await pool.query(`
      SELECT
        pk.id AS pick_id,
        pk.player_id,
        pk.position,
        pk.multiplier,
        pk.locked,
        pk.consecutive_weeks,
        p.full_name,
        p.team,
        p.sleeper_id,
        p.image_url,
        COALESCE(s.final_points, 0) AS final_points
      FROM picks pk
      JOIN players p
        ON pk.player_id = p.id
      LEFT JOIN scores s
        ON s.player_id = pk.player_id
      AND s.user_id = pk.user_id
      AND s.week_number = pk.week_number
      WHERE pk.user_id = $1
        AND pk.week_number = $2
      ORDER BY
        CASE pk.position
          WHEN 'QB' THEN 1
          WHEN 'RB' THEN 2
          WHEN 'WR' THEN 3
          WHEN 'TE' THEN 4
          WHEN 'K' THEN 5
          WHEN 'DEF' THEN 6
          ELSE 7
        END;
    `, [userId, effectiveWeek]);

    // Get position limits
    const settingsResult = await pool.query(
      `SELECT qb_limit, rb_limit, wr_limit, te_limit, k_limit, def_limit FROM game_settings LIMIT 1`
    );
    const settings = settingsResult.rows[0] || {};

    res.json({
      userId,
      weekNumber: effectiveWeek,
      picks: picksResult.rows,
      positionLimits: {
        QB: settings.qb_limit || 1,
        RB: settings.rb_limit || 2,
        WR: settings.wr_limit || 2,
        TE: settings.te_limit || 1,
        K: settings.k_limit || 1,
        DEF: settings.def_limit || 1
      }
    });
  } catch (err) {
    console.error('Error in GET /api/picks/v2:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/picks/v2 - Operation-based lineup management
app.post('/api/picks/v2', async (req, res) => {
  try {
    const { userId, weekNumber, ops } = req.body;

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

    if (!ops || !Array.isArray(ops) || ops.length === 0) {
      return res.status(400).json({ error: 'ops array is required and must not be empty' });
    }

    // User validation
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Week lockout check
    const gameStateResult = await pool.query(
      'SELECT current_playoff_week, playoff_start_week, is_week_active FROM game_settings LIMIT 1'
    );
    const { current_playoff_week, is_week_active } = gameStateResult.rows[0] || {};
    if (!is_week_active) {
      return res.status(403).json({
        error: 'Picks are locked for this week. The submission window has closed.'
      });
    }

    // Server is the single source of truth for active week
    const effectiveWeek = await getEffectiveWeekNumber();

    // Guard: reject if client sent a mismatched week (prevents future-week writes)
    if (weekNumber && parseInt(weekNumber, 10) !== effectiveWeek) {
      return res.status(409).json({
        error: 'Week mismatch. The active playoff week has changed. Please refresh.',
        serverWeek: effectiveWeek,
        clientWeek: parseInt(weekNumber, 10)
      });
    }

    // Get selectable teams (uses DB-backed active_teams with caching)
    const selectableResult = await getSelectableTeams(pool);
    if (selectableResult.error) {
      console.error(`[picks/v2] ${selectableResult.error}: active_teams not set for playoff week ${selectableResult.currentPlayoffWeek}`);
      return res.status(500).json({ error: 'Server configuration error. Please contact support.' });
    }
    const selectableTeams = selectableResult.teams;

    // Build proposed operations with position info
    const proposedOps = [];
    for (const op of ops) {
      if (op.action === 'add') {
        // Get player info including team
        const playerResult = await pool.query('SELECT position, team FROM players WHERE id = $1', [op.playerId]);
        if (playerResult.rows.length === 0) {
          return res.status(400).json({ error: `Player ${op.playerId} not found` });
        }

        // Validate player's team is selectable
        const normalizedTeam = normalizeTeamAbbr(playerResult.rows[0].team);
        if (!selectableTeams.includes(normalizedTeam)) {
          return res.status(400).json({
            error: `Player ${op.playerId}'s team (${playerResult.rows[0].team}) has been eliminated. Only players from active teams are selectable.`
          });
        }

        proposedOps.push({ action: 'add', position: playerResult.rows[0].position, playerId: op.playerId });
      } else if (op.action === 'remove') {
        // Get pick position AND player_id (needed for swap detection)
        const pickResult = await pool.query('SELECT position, player_id FROM picks WHERE id = $1', [op.pickId]);
        if (pickResult.rows.length === 0) {
          return res.status(400).json({ error: `Pick ${op.pickId} not found` });
        }
        proposedOps.push({ action: 'remove', position: pickResult.rows[0].position, pickId: op.pickId, playerId: pickResult.rows[0].player_id });
      }
    }

    // Validate position limits
    const validation = await validatePositionCounts(userId, effectiveWeek, proposedOps);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Position limit exceeded',
        details: validation.errors
      });
    }

    // Execute operations within a transaction (for atomicity and swap logging)
    const dbClient = await pool.connect();
    const results = [];

    try {
      await dbClient.query('BEGIN');

      // Track removals by position for swap detection
      const removalsByPosition = new Map(); // position → { playerId, pickId }

      for (const op of proposedOps) {
        if (op.action === 'add') {
          // Check for multiplier/consecutive_weeks carry from immediately previous playoff week
          let preservedMultiplier = 1;
          let preservedConsecutiveWeeks = 1;
          if (current_playoff_week > 1) {
            const previousWeekNumber = effectiveWeek - 1;
            const prevPickResult = await dbClient.query(
              'SELECT multiplier, consecutive_weeks FROM picks WHERE user_id = $1 AND player_id = $2 AND week_number = $3',
              [userId, op.playerId, previousWeekNumber]
            );
            if (prevPickResult.rows.length > 0) {
              // Carry forward: current week = previous week + 1
              preservedMultiplier = (prevPickResult.rows[0].multiplier || 1) + 1;
              preservedConsecutiveWeeks = (prevPickResult.rows[0].consecutive_weeks || 1) + 1;
              console.log(`[picks/v2] Carrying multiplier ${preservedMultiplier} (prev ${prevPickResult.rows[0].multiplier}) and consecutive_weeks ${preservedConsecutiveWeeks} for player ${op.playerId}`);
            }
          }

          const insertResult = await dbClient.query(`
            INSERT INTO picks (user_id, player_id, position, week_number, multiplier, consecutive_weeks, locked)
            VALUES ($1, $2, $3, $4, $5, $6, false)
            RETURNING *
          `, [userId, op.playerId, op.position, effectiveWeek, preservedMultiplier, preservedConsecutiveWeeks]);
          results.push({ action: 'add', success: true, pick: insertResult.rows[0] });

          // Check if this add corresponds to a removal at the same position (swap detection)
          const removal = removalsByPosition.get(op.position);
          if (removal && removal.playerId !== op.playerId) {
            // This is a swap: log to player_swaps
            await dbClient.query(`
              INSERT INTO player_swaps (user_id, old_player_id, new_player_id, position, week_number, swapped_at)
              VALUES ($1, $2, $3, $4, $5, NOW())
            `, [userId, removal.playerId, op.playerId, op.position, effectiveWeek]);
            console.log(`[picks/v2] Logged swap: user ${userId} replaced ${removal.playerId} with ${op.playerId} at ${op.position} for week ${effectiveWeek}`);
          }
        } else if (op.action === 'remove') {
          await dbClient.query('DELETE FROM picks WHERE id = $1 AND user_id = $2', [op.pickId, userId]);
          results.push({ action: 'remove', success: true, pickId: op.pickId });

          // Track this removal for swap detection
          removalsByPosition.set(op.position, { playerId: op.playerId, pickId: op.pickId });
        }
      }

      await dbClient.query('COMMIT');
    } catch (txErr) {
      await dbClient.query('ROLLBACK');
      throw txErr;
    } finally {
      dbClient.release();
    }

    // Return updated position counts
    res.json({
      success: true,
      weekNumber: effectiveWeek,
      operations: results,
      positionCounts: validation.counts
    });
  } catch (err) {
    console.error('Error in POST /api/picks/v2:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================================
// LEGACY PICKS ROUTES (v1) - Keep for backward compatibility
// ==============================================

// Get user's picks
app.get('/api/picks/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Fetch playoff_start_week for display field derivation
    const settingsResult = await pool.query(
      'SELECT playoff_start_week FROM game_settings LIMIT 1'
    );
    const playoffStartWeek = settingsResult.rows[0]?.playoff_start_week || 19;

    const result = await pool.query(`
      SELECT pk.*, p.full_name, p.position, p.team
      FROM picks pk
      JOIN players p ON pk.player_id = p.id
      WHERE pk.user_id = $1
      ORDER BY pk.week_number, pk.position
    `, [userId]);

    // Add display fields derived at response time
    const picksWithDisplayFields = result.rows.map(pick => {
      const isPlayoff = pick.week_number >= playoffStartWeek;
      const playoffWeek = isPlayoff ? pick.week_number - playoffStartWeek + 1 : null;
      return {
        ...pick,
        is_playoff: isPlayoff,
        playoff_week: playoffWeek,
        display_week: isPlayoff ? `Playoff Week ${playoffWeek}` : `Week ${pick.week_number}`
      };
    });

    res.json(picksWithDisplayFields);
  } catch (err) {
    console.error('Error fetching picks:', err);
    res.status(500).json({ error: err.message });
  }
});

// Alternative route for picks (handles /api/picks/user/:userId)
app.get('/api/picks/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Fetch playoff_start_week for display field derivation
    const settingsResult = await pool.query(
      'SELECT playoff_start_week FROM game_settings LIMIT 1'
    );
    const playoffStartWeek = settingsResult.rows[0]?.playoff_start_week || 19;

    const result = await pool.query(`
      SELECT pk.*, p.full_name, p.position, p.team, p.sleeper_id, p.image_url
      FROM picks pk
      JOIN players p ON pk.player_id = p.id
      WHERE pk.user_id = $1
      ORDER BY pk.week_number, pk.position
    `, [userId]);

    // Add display fields derived at response time
    const picksWithDisplayFields = result.rows.map(pick => {
      const isPlayoff = pick.week_number >= playoffStartWeek;
      const playoffWeek = isPlayoff ? pick.week_number - playoffStartWeek + 1 : null;
      return {
        ...pick,
        is_playoff: isPlayoff,
        playoff_week: playoffWeek,
        display_week: isPlayoff ? `Playoff Week ${playoffWeek}` : `Week ${pick.week_number}`
      };
    });

    res.json(picksWithDisplayFields);
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

    // Fetch playoff_start_week for display field derivation
    const settingsResult = await pool.query(
      'SELECT playoff_start_week FROM game_settings LIMIT 1'
    );
    const playoffStartWeek = settingsResult.rows[0]?.playoff_start_week || 19;

    const result = await pool.query(
      `SELECT p.*, pl.full_name, pl.position as player_position, pl.team, pl.sleeper_id, pl.image_url
        FROM picks p
        LEFT JOIN players pl ON p.player_id = pl.id
        WHERE p.user_id = $1
        ORDER BY p.week_number, p.position`,
      [userId]
    );

    // Add display fields derived at response time
    const picksWithDisplayFields = result.rows.map(pick => {
      const isPlayoff = pick.week_number >= playoffStartWeek;
      const playoffWeek = isPlayoff ? pick.week_number - playoffStartWeek + 1 : null;
      return {
        ...pick,
        is_playoff: isPlayoff,
        playoff_week: playoffWeek,
        display_week: isPlayoff ? `Playoff Week ${playoffWeek}` : `Week ${pick.week_number}`
      };
    });

    res.json(picksWithDisplayFields);
  } catch (err) {
    console.error('Error getting picks:', err);
    res.status(500).json({ error: err.message });
  }
});

// Submit picks (supports single pick or batch)
app.post('/api/picks', async (req, res) => {
  try {
    const { userId, playerId, weekNumber, position, multiplier, picks } = req.body;

    // User validation
    const userCheck = await pool.query(
      'SELECT id FROM users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Server-side week derivation for playoffs
    // During playoffs, ignore client weekNumber and derive from game state
    // This prevents misconfiguration bugs where picks land on wrong week
    const gameStateResult = await pool.query(
      'SELECT current_playoff_week, playoff_start_week, is_week_active FROM game_settings LIMIT 1'
    );
    const { current_playoff_week, playoff_start_week, is_week_active } = gameStateResult.rows[0] || {};

    // Week lockout check - block picks when week is locked
    if (!is_week_active) {
      return res.status(403).json({
        error: 'Picks are locked for this week. The submission window has closed.'
      });
    }

    // Server is the single source of truth for active week (never trust client weekNumber)
    // If in playoff mode, compute NFL week from playoff round
    // playoff_week 1 = Wild Card = week 19, playoff_week 2 = Divisional = week 20, etc.
    const effectiveWeekNumber = current_playoff_week > 0
      ? playoff_start_week + current_playoff_week - 1
      : (playoff_start_week > 0 ? playoff_start_week : 1);

    // Guard: reject if client sent a mismatched week (prevents future-week writes)
    if (weekNumber && parseInt(weekNumber, 10) !== effectiveWeekNumber) {
      return res.status(409).json({
        error: 'Week mismatch. The active playoff week has changed. Please refresh.',
        serverWeek: effectiveWeekNumber,
        clientWeek: parseInt(weekNumber, 10)
      });
    }

    // Get selectable teams (uses DB-backed active_teams with caching)
    const selectableResult = await getSelectableTeams(pool);
    if (selectableResult.error) {
      console.error(`[picks] ${selectableResult.error}: active_teams not set for playoff week ${selectableResult.currentPlayoffWeek}`);
      return res.status(500).json({ error: 'Server configuration error. Please contact support.' });
    }
    const selectableTeams = selectableResult.teams;

    // Support batch submission
    if (picks && Array.isArray(picks)) {
      const results = [];

      for (const pick of picks) {
        // Validate player's team is selectable
        const playerTeamCheck = await pool.query(
          'SELECT team FROM players WHERE id = $1',
          [pick.playerId]
        );
        if (playerTeamCheck.rows.length === 0) {
          return res.status(404).json({ error: `Player not found: ${pick.playerId}` });
        }
        const normalizedTeam = normalizeTeamAbbr(playerTeamCheck.rows[0].team);
        if (!selectableTeams.includes(normalizedTeam)) {
          return res.status(400).json({
            error: `Player ${pick.playerId}'s team (${playerTeamCheck.rows[0].team}) has been eliminated. Only players from active teams are selectable.`
          });
        }

        // Validate position limit before inserting - read from game_settings
        const settingsResult = await pool.query(
          `SELECT qb_limit, rb_limit, wr_limit, te_limit, k_limit, def_limit FROM game_settings LIMIT 1`
        );

        const settings = settingsResult.rows[0] || {};
        const positionToLimit = {
          'QB': settings.qb_limit,
          'RB': settings.rb_limit,
          'WR': settings.wr_limit,
          'TE': settings.te_limit,
          'K': settings.k_limit,
          'DEF': settings.def_limit
        };

        const maxPicks = positionToLimit[pick.position] || 2;

        // Check current pick count for this position (excluding the current player if updating)
        const currentCount = await pool.query(`
          SELECT COUNT(*) as count
          FROM picks
          WHERE user_id = $1
            AND week_number = $2
            AND position = $3
            AND player_id != $4
        `, [userId, effectiveWeekNumber, pick.position, pick.playerId]);

        if (parseInt(currentCount.rows[0].count) >= maxPicks) {
          return res.status(400).json({
            error: `Position limit exceeded for ${pick.position}. Maximum allowed: ${maxPicks}`
          });
        }

        // Check for multiplier/consecutive_weeks carry from immediately previous playoff week
        let preservedMultiplier = 1;
        let preservedConsecutiveWeeks = 1;
        if (current_playoff_week > 1) {
          const previousWeekNumber = effectiveWeekNumber - 1;
          const prevPickResult = await pool.query(
            'SELECT multiplier, consecutive_weeks FROM picks WHERE user_id = $1 AND player_id = $2 AND week_number = $3',
            [userId, pick.playerId, previousWeekNumber]
          );
          if (prevPickResult.rows.length > 0) {
            // Carry forward: current week = previous week + 1
            preservedMultiplier = (prevPickResult.rows[0].multiplier || 1) + 1;
            preservedConsecutiveWeeks = (prevPickResult.rows[0].consecutive_weeks || 1) + 1;
            console.log(`[picks] Carrying multiplier ${preservedMultiplier} (prev ${prevPickResult.rows[0].multiplier}) and consecutive_weeks ${preservedConsecutiveWeeks} for player ${pick.playerId}`);
          }
        }

        const result = await pool.query(`
          INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, false, NOW())
          ON CONFLICT (user_id, player_id, week_number)
          DO UPDATE SET
            position = $4,
            multiplier = $5,
            consecutive_weeks = $6,
            created_at = NOW()
          RETURNING *
        `, [userId, pick.playerId, effectiveWeekNumber, pick.position, preservedMultiplier, preservedConsecutiveWeeks]);

        results.push(result.rows[0]);
      }

      return res.json({ success: true, picks: results });
    }

    // Single pick submission with UPSERT
    // Validate player's team is selectable
    const playerTeamCheck = await pool.query(
      'SELECT team FROM players WHERE id = $1',
      [playerId]
    );
    if (playerTeamCheck.rows.length === 0) {
      return res.status(404).json({ error: `Player not found: ${playerId}` });
    }
    const normalizedTeam = normalizeTeamAbbr(playerTeamCheck.rows[0].team);
    if (!selectableTeams.includes(normalizedTeam)) {
      return res.status(400).json({
        error: `Player ${playerId}'s team (${playerTeamCheck.rows[0].team}) has been eliminated. Only players from active teams are selectable.`
      });
    }

    // Validate position limit before inserting - read from game_settings
    const settingsResult = await pool.query(
      `SELECT qb_limit, rb_limit, wr_limit, te_limit, k_limit, def_limit FROM game_settings LIMIT 1`
    );

    const settings = settingsResult.rows[0] || {};
    const positionToLimit = {
      'QB': settings.qb_limit,
      'RB': settings.rb_limit,
      'WR': settings.wr_limit,
      'TE': settings.te_limit,
      'K': settings.k_limit,
      'DEF': settings.def_limit
    };

    const maxPicks = positionToLimit[position] || 2;

    // Check current pick count for this position (excluding the current player if updating)
    const currentCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM picks
      WHERE user_id = $1
        AND week_number = $2
        AND position = $3
        AND player_id != $4
    `, [userId, effectiveWeekNumber, position, playerId]);

    if (parseInt(currentCount.rows[0].count) >= maxPicks) {
      return res.status(400).json({
        error: `Position limit exceeded for ${position}. Maximum allowed: ${maxPicks}`
      });
    }

    // Check for multiplier/consecutive_weeks carry from immediately previous playoff week
    let preservedMultiplier = 1;
    let preservedConsecutiveWeeks = 1;
    if (current_playoff_week > 1) {
      const previousWeekNumber = effectiveWeekNumber - 1;
      const prevPickResult = await pool.query(
        'SELECT multiplier, consecutive_weeks FROM picks WHERE user_id = $1 AND player_id = $2 AND week_number = $3',
        [userId, playerId, previousWeekNumber]
      );
      if (prevPickResult.rows.length > 0) {
        // Carry forward: current week = previous week + 1
        preservedMultiplier = (prevPickResult.rows[0].multiplier || 1) + 1;
        preservedConsecutiveWeeks = (prevPickResult.rows[0].consecutive_weeks || 1) + 1;
        console.log(`[picks] Carrying multiplier ${preservedMultiplier} (prev ${prevPickResult.rows[0].multiplier}) and consecutive_weeks ${preservedConsecutiveWeeks} for player ${playerId}`);
      }
    }

    const result = await pool.query(`
      INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, false, NOW())
      ON CONFLICT (user_id, player_id, week_number)
      DO UPDATE SET
        position = $4,
        multiplier = $5,
        consecutive_weeks = $6,
        created_at = NOW()
      RETURNING *
    `, [userId, playerId, effectiveWeekNumber, position, preservedMultiplier, preservedConsecutiveWeeks]);

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

    // Week lockout check - block deletions when week is locked
    const gameStateResult = await pool.query(
      'SELECT is_week_active FROM game_settings LIMIT 1'
    );
    const { is_week_active } = gameStateResult.rows[0] || {};
    if (!is_week_active) {
      return res.status(403).json({
        error: 'Picks are locked for this week. The submission window has closed.'
      });
    }

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

// Get user's picks with scores for a specific week (for leaderboard quick view)
app.get('/api/users/:userId/picks/:weekNumber', async (req, res) => {
  try {
    const { userId, weekNumber } = req.params;

    // Remap playoff week index (1-4) to NFL week (19-22)
    const actualWeekNumber = await resolveActualWeekNumber(weekNumber, pool, 'UserPicks');
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

async function startLiveStatsPolling() {
  // Register the job with diagnostics service
  jobsService.registerJob('live-stats-polling', {
    interval_ms: LIVE_STATS_INTERVAL_MS,
    description: 'Polls ESPN for live game stats and updates scores'
  });

  // Get current playoff week and derive NFL week number
  // FIX: Use NFL week numbers (19-22) for scoring, not playoff round (1-4)
  const configResult = await pool.query(
    'SELECT current_playoff_week, playoff_start_week FROM game_settings LIMIT 1'
  );
  const { current_playoff_week, playoff_start_week } = configResult.rows[0] || {};
  const currentWeek = current_playoff_week > 0
    ? playoff_start_week + current_playoff_week - 1
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
    const response = await axios.get(getESPNScoreboardUrl(weekNumber));

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
    if (includePicks === 'true' && actualWeekNumber) {
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
  if (current_playoff_week > 0 && playoff_start_week > 0) {
    return playoff_start_week + current_playoff_week - 1;
  }

  // Fall back to playoff_start_week if set
  if (playoff_start_week > 0) {
    return playoff_start_week;
  }

  // Final fallback: return 1 (never return 0, null, or undefined)
  return 1;
}

// Helper: Validate position counts for v2 API
async function validatePositionCounts(userId, weekNumber, proposedOps = []) {
  // Get current position limits from game_settings
  const settingsResult = await pool.query(
    `SELECT qb_limit, rb_limit, wr_limit, te_limit, k_limit, def_limit FROM game_settings LIMIT 1`
  );
  const settings = settingsResult.rows[0] || {};
  const limits = {
    'QB': settings.qb_limit || 1,
    'RB': settings.rb_limit || 2,
    'WR': settings.wr_limit || 2,
    'TE': settings.te_limit || 1,
    'K': settings.k_limit || 1,
    'DEF': settings.def_limit || 1
  };

  // Get current pick counts by position
  const currentPicks = await pool.query(`
    SELECT position, COUNT(*) as count
    FROM picks
    WHERE user_id = $1 AND week_number = $2
    GROUP BY position
  `, [userId, weekNumber]);

  const counts = {};
  for (const row of currentPicks.rows) {
    counts[row.position] = parseInt(row.count, 10);
  }

  // Apply proposed operations
  for (const op of proposedOps) {
    const pos = op.position;
    if (!counts[pos]) counts[pos] = 0;

    if (op.action === 'add') {
      counts[pos]++;
    } else if (op.action === 'remove') {
      counts[pos]--;
    }
  }

  // Validate against limits
  const errors = [];
  for (const [pos, count] of Object.entries(counts)) {
    if (count > limits[pos]) {
      errors.push(`${pos}: ${count} exceeds limit of ${limits[pos]}`);
    }
    if (count < 0) {
      errors.push(`${pos}: cannot have negative count`);
    }
  }

  return { valid: errors.length === 0, errors, counts, limits };
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
    const client = getClientCapabilities(req);
    // Note: We allow this endpoint even for legacy clients for diagnostic purposes
    // but new clients should send tos_required_flag capability

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Get user's TOS status
    const userResult = await pool.query(
      'SELECT tos_accepted_at, tos_version FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Get current TOS version from terms
    let currentTermsVersion = null;
    try {
      const termsResult = await pool.query(`
        SELECT updated_at FROM rules_content WHERE section = 'terms_of_service'
      `);
      if (termsResult.rows.length > 0) {
        currentTermsVersion = termsResult.rows[0].updated_at.toISOString().split('T')[0];
      }
    } catch (termsErr) {
      console.warn('[flags] Could not fetch current TOS version:', termsErr.message);
      // Fail open - don't block if we can't determine version
    }

    // Determine if TOS is required
    let requiresTos = false;
    if (!user.tos_accepted_at) {
      requiresTos = true;
    } else if (currentTermsVersion && user.tos_version !== currentTermsVersion) {
      requiresTos = true;
    }

    res.json({
      requires_tos: requiresTos,
      tos_version_required: currentTermsVersion,
      tos_accepted_at: user.tos_accepted_at,
      tos_version_accepted: user.tos_version
    });
  } catch (err) {
    console.error('Error in GET /api/me/flags:', err);
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

// Export for testing (does not affect production behavior)
module.exports = { app, pool, calculateFantasyPoints };
