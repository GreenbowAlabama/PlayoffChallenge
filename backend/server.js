const express = require('express');
const { Pool } = require('pg');
const pg = require('pg');
const cors = require('cors');
const axios = require('axios');
const geoip = require('geoip-lite');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 8080;

pg.types.setTypeParser(1700, (v) => v === null ? null : parseFloat(v));

app.use(cors());
app.use(express.json());

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

// Helper: Map ESPN athlete ID to our player ID
// Priority order: 1) ESPN ID, 2) Normalized name, 3) Last name only (single match)
async function mapESPNAthleteToPlayer(athleteId, athleteName, teamAbbrev = null) {
  try {
    // 1. First try exact ESPN ID match
    let result = await pool.query(
      'SELECT id FROM players WHERE espn_id = $1 LIMIT 1',
      [athleteId.toString()]
    );

    if (result.rows.length > 0) {
      return result.rows[0].id;
    }

    // 2. Normalized name matching (handles D.J. -> DJ, suffixes like Jr/Sr/III)
    if (athleteName) {
      const normalized = normalizePlayerName(athleteName);

      // 2a. Try normalized first + last name
      result = await pool.query(
        `SELECT id FROM players
          WHERE LOWER(REPLACE(first_name, '.', '')) = $1
          AND LOWER(REPLACE(last_name, '.', '')) = $2
          LIMIT 1`,
        [normalized.firstName, normalized.lastName]
      );

      if (result.rows.length > 0) {
        // Store the ESPN ID for future lookups
        await pool.query(
          'UPDATE players SET espn_id = $1 WHERE id = $2',
          [athleteId.toString(), result.rows[0].id]
        );
        console.log(`Matched ${athleteName} via normalized name -> ${result.rows[0].id}`);
        return result.rows[0].id;
      }

      // 2b. Try last name + team (if team provided)
      if (teamAbbrev) {
        const normalizedTeam = normalizeTeamAbbr(teamAbbrev);
        result = await pool.query(
          `SELECT id FROM players
            WHERE LOWER(REPLACE(last_name, '.', '')) = $1
            AND team = $2
            LIMIT 1`,
          [normalized.lastName, normalizedTeam]
        );

        if (result.rows.length > 0) {
          await pool.query(
            'UPDATE players SET espn_id = $1 WHERE id = $2',
            [athleteId.toString(), result.rows[0].id]
          );
          console.log(`Matched ${athleteName} via last name + team -> ${result.rows[0].id}`);
          return result.rows[0].id;
        }
      }

      // 2c. Try last name only (if unique match)
      result = await pool.query(
        `SELECT id FROM players
          WHERE LOWER(REPLACE(last_name, '.', '')) = $1
          AND is_active = true`,
        [normalized.lastName]
      );

      if (result.rows.length === 1) {
        await pool.query(
          'UPDATE players SET espn_id = $1 WHERE id = $2',
          [athleteId.toString(), result.rows[0].id]
        );
        console.log(`Matched ${athleteName} via unique last name -> ${result.rows[0].id}`);
        return result.rows[0].id;
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
    fum_lost: 0
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
                  stats.pat_made = patMade;
                  stats.pat_missed = patMissed;
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
      console.log(
        'DEF BACKFILL CHECK',
        'teamAbbrev:',
        teamAbbrev,
        'normalized:',
        normalizedTeam,
        'week:',
        weekNumber
      );
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

        if (teamBox?.statistics) {
          for (const stat of teamBox.statistics) {
            if (stat.name === 'sacksYardsLost' && stat.displayValue) {
              const sacks = parseInt(stat.displayValue.split('-')[0]);
              if (!isNaN(sacks) && sacks > stats.def_sack) {
                stats.def_sack = sacks;
              }
            }
          }
        }

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

        // Optional debug once validated
        // console.log('DEF STATS RESULT', normalizedTeam, stats);

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
      const player = await pool.query('SELECT espn_id, full_name, position FROM players WHERE id::text = $1', [pick.player_id]);
      if (player.rows.length === 0) continue;

      const espnId = player.rows[0].espn_id;
      const playerName = player.rows[0].full_name;
      const position = player.rows[0].position;

      let scoring;

      // Handle defense differently (uses team abbrev as ID)
      if (position === 'DEF') {
        console.log(`Fetching defense stats for ${playerName}...`);

        const defStats = await fetchDefenseStats(pick.player_id, weekNumber);
        if (!defStats) {
          console.log(`No defense stats found for ${playerName} in week ${weekNumber}`);
          continue;
        }
        scoring = defStats;
      } else if (!espnId) {
        continue;
      } else {
        // Regular player - fetch from boxscore
        console.log(`Fetching stats for ${playerName} from boxscore...`);
        const playerStats = await fetchPlayerStats(espnId, weekNumber);

        if (!playerStats) {
          console.log(`No stats found for ${playerName} in week ${weekNumber}`);
          continue;
        }

        scoring = playerStats;
      }

      const basePoints = await calculateFantasyPoints(scoring);
      const multiplier = pick.multiplier || 1;
      const finalPoints = basePoints * multiplier;

      // Upsert to scores table
      await pool.query(`
        INSERT INTO scores (id, user_id, player_id, week_number, points, base_points, multiplier, final_points, stats_json, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $4, $5, $6, $7, NOW())
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
    const response = await axios.get(getESPNScoreboardUrl(weekNumber));

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

    console.log(`Fetching summary for game ${gameId}...`);
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

    // Kicker stats
    if (stats.fg_made !== undefined) {
      const fgMade = stats.fg_made || 0;
      const fgLongest = stats.fg_longest || 0;

      // Score based on distance (assume even distribution if we don't have individual FG distances)
      // For now, use longest to estimate: if longest >= 50, award one 50+ FG
      if (fgLongest >= 50 && fgMade > 0) {
        points += 5; // One 50+ yarder
        points += (fgMade - 1) * 3; // Rest are standard
      } else if (fgLongest >= 40 && fgMade > 0) {
        points += 4; // One 40-49 yarder
        points += (fgMade - 1) * 3; // Rest are standard
      } else {
        points += fgMade * 3; // All standard 0-39 yards
      }

      points += (stats.pat_made || 0) * (rules.pat_made || 1);
      points += (stats.fg_missed || 0) * (rules.fg_missed || -2);
      points += (stats.pat_missed || 0) * (rules.pat_missed || -1);
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

      // Points allowed scoring
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

// Run database migration to add image_url column
app.post('/api/admin/migrate-add-image-url', async (req, res) => {
  try {
    console.log('Running migration: add image_url column to players table');

    await pool.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS image_url VARCHAR(255)');

    console.log('Migration complete');
    res.json({ success: true, message: 'image_url column added successfully' });
  } catch (err) {
    console.error('Migration error:', err);
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

    // Accept both playoff weeks (1-4) and NFL weeks (1-22) for testing flexibility
    if (!current_playoff_week || current_playoff_week < 1 || current_playoff_week > 22) {
      return res.status(400).json({ success: false, error: 'current_playoff_week must be between 1 and 22' });
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

// Admin: Backfill playoff stats from historical games
app.post('/api/admin/backfill-playoff-stats', async (req, res) => {
  liveStatsCache.activeGameIds = new Set();
  try {
    const { weekNumber } = req.body;

    if (!weekNumber) {
      return res.status(400).json({ error: 'weekNumber required' });
    }

    console.log(`Backfilling playoff stats for week ${weekNumber}...`);

    // Derive playoff parameters
    const season = 2023;
    const seasontype = 3;
    const postseasonWeek = weekNumber - 18;

    // Fetch scoreboard using playoff parameters
    const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?season=${season}&seasontype=${seasontype}&week=${postseasonWeek}`;
    const scoreboardResponse = await axios.get(scoreboardUrl);

    if (!scoreboardResponse.data || !scoreboardResponse.data.events) {
      return res.json({ success: false, message: 'No games found for that week', gamesProcessed: 0 });
    }

    const games = scoreboardResponse.data.events;
    console.log(`Found ${games.length} games for week ${weekNumber}`);

    let gamesProcessed = 0;
    let playersScored = 0;
    const processedPlayerIds = new Set();

    // Process each game
    for (const game of games) {
      const gameId = game.id;
      const gameStatus = game.status?.type?.state;

      console.log(`Processing game ${gameId}: ${game.shortName} (Status: ${gameStatus})`);

      // Add gameId to cache so fetchDefenseStats can find it
      liveStatsCache.activeGameIds.add(gameId);

      // Fetch game summary with player stats
      const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`;
      const summaryResponse = await axios.get(summaryUrl);

      if (!summaryResponse.data || !summaryResponse.data.boxscore) {
        console.log(`  No boxscore data for game ${gameId}`);
        continue;
      }

      // Parse player stats from boxscore
      const playerStats = parsePlayerStatsFromSummary(summaryResponse.data.boxscore);
      console.log(`  Found stats for ${playerStats.length} players`);

      // Map each player's stats to our database and save scores
      for (const playerStat of playerStats) {
        const espnId = playerStat.athleteId;
        const playerId = await mapESPNAthleteToPlayer(espnId, playerStat.athleteName, playerStat.teamAbbrev);

        if (!playerId) {
          // Player not in our database, skip
          continue;
        }

        // Convert ESPN stats to our scoring format
        const scoringStats = convertESPNStatsToScoring(playerStat.stats);

        // Calculate fantasy points
        const points = await calculateFantasyPoints(scoringStats);

        // Find all users who picked this player for this week
        const picksResult = await pool.query(`
          SELECT user_id, multiplier
          FROM picks
          WHERE player_id = $1
            AND week_number = $2
        `, [playerId, weekNumber]);

        // Save a score for each user who picked this player
        for (const pick of picksResult.rows) {
          const multiplier = pick.multiplier || 1.0;
          const finalPoints = points * multiplier;

          await pool.query(`
            INSERT INTO scores (
              id, user_id, player_id, week_number, points, base_points, multiplier, final_points, stats_json, updated_at
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, $4, $4, $5, $6, $7, NOW()
            )
            ON CONFLICT (user_id, player_id, week_number)
            DO UPDATE SET
              points = EXCLUDED.points,
              base_points = EXCLUDED.base_points,
              multiplier = EXCLUDED.multiplier,
              final_points = EXCLUDED.final_points,
              stats_json = EXCLUDED.stats_json,
              updated_at = NOW()
          `, [
            pick.user_id,
            playerId,
            weekNumber,
            points,
            multiplier,
            finalPoints,
            JSON.stringify(scoringStats)
          ]);

          playersScored++;
        }

        processedPlayerIds.add(playerId);
      }

      // Process team defenses for this game
      const competition = summaryResponse.data.header?.competitions?.[0];
      if (competition?.competitors) {
        for (const competitor of competition.competitors) {
          const teamAbbr = normalizeTeamAbbr(competitor.team?.abbreviation);
          if (!teamAbbr) continue;

          console.log(
            'DEF MATCH CHECK',
            'raw:', competitor.team?.abbreviation,
            'normalized:', teamAbbr,
            'week:', weekNumber
          );

          // Check if anyone picked this team's defense
          const defPicksResult = await pool.query(`
            SELECT user_id, multiplier
            FROM picks
            WHERE player_id = $1 AND week_number = $2 AND position = 'DEF'
          `, [teamAbbr, weekNumber]);

          if (defPicksResult.rows.length === 0) continue;

          console.log(`  Processing DEF for ${teamAbbr} (${defPicksResult.rows.length} picks)`);

          // Fetch defense stats
          // Build DEF stats directly from this game's summary (HISTORICAL SAFE)
          const defStats = {
            def_sack: 0,
            def_int: 0,
            def_fum_rec: 0,
            def_td: 0,
            def_safety: 0,
            def_block: 0,
            def_ret_td: 0,
            def_pts_allowed: parseInt(competitor.score) || 0
          };

          // 1. Team boxscore stats
          const teamBox = summaryResponse.data.boxscore.teams?.find(
            t => normalizeTeamAbbr(t.team?.abbreviation) === teamAbbr
          );

          if (teamBox?.statistics) {
            for (const stat of teamBox.statistics) {
              if (stat.name === 'sacksYardsLost') {
                defStats.def_sack = parseInt(stat.displayValue.split('-')[0]) || 0;
              }
            }
          }

          // 2. Player boxscore defensive stats
          for (const group of summaryResponse.data.boxscore.players || []) {
            if (!group.team) continue;
            if (normalizeTeamAbbr(group.team.abbreviation) !== teamAbbr) continue;

            for (const cat of group.statistics || []) {
              if (cat.name === 'interceptions' && cat.athletes) {
                for (const a of cat.athletes) {
                  defStats.def_int += parseInt(a.stats?.[0] || '0');
                  defStats.def_td += parseInt(a.stats?.[2] || '0');
                }
              }
            }
          }
          if (!defStats) {
            console.log(`    No defense stats found for ${teamAbbr}`);
            continue;
          }

          // Calculate fantasy points
          const points = await calculateFantasyPoints(defStats);

          // Save score for each user who picked this defense
          for (const pick of defPicksResult.rows) {
            const multiplier = pick.multiplier || 1.0;
            const finalPoints = points * multiplier;

            await pool.query(`
              INSERT INTO scores (
                id, user_id, player_id, week_number, points, base_points, multiplier, final_points, stats_json, updated_at
              ) VALUES (
                gen_random_uuid(), $1, $2, $3, $4, $4, $5, $6, $7, NOW()
              )
              ON CONFLICT (user_id, player_id, week_number)
              DO UPDATE SET
                points = EXCLUDED.points,
                base_points = EXCLUDED.base_points,
                multiplier = EXCLUDED.multiplier,
                final_points = EXCLUDED.final_points,
                stats_json = EXCLUDED.stats_json,
                updated_at = NOW()
            `, [
              pick.user_id,
              teamAbbr,
              weekNumber,
              points,
              multiplier,
              finalPoints,
              JSON.stringify(defStats)
            ]);

            playersScored++;
          }

          processedPlayerIds.add(teamAbbr);
        }
      }

      gamesProcessed++;
    }

    console.log(`Backfill complete: ${gamesProcessed} games, ${playersScored} player scores saved (${processedPlayerIds.size} unique players)`);

    res.json({
      success: true,
      message: `Backfilled stats for week ${weekNumber}`,
      gamesProcessed,
      playerScoresSaved: playersScored,
      uniquePlayers: processedPlayerIds.size
    });

  } catch (err) {
    console.error('Error backfilling playoff stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Initialize scores for a week (creates 0.0 scores for all picks)
app.post('/api/admin/initialize-week-scores', async (req, res) => {
  try {
    const { weekNumber } = req.body;

    if (!weekNumber) {
      return res.status(400).json({ error: 'weekNumber required' });
    }

    console.log(`Initializing scores for week ${weekNumber}...`);

    // Get all picks for this week
    const picksResult = await pool.query(`
      SELECT pk.user_id, pk.player_id, pk.position, pk.multiplier
      FROM picks pk
      WHERE pk.week_number = $1
    `, [weekNumber]);

    let initializedCount = 0;

    for (const pick of picksResult.rows) {
      // Initialize with 0 points and empty stats
      const emptyStats = {
        pass_yd: 0, pass_td: 0, pass_int: 0,
        rush_yd: 0, rush_td: 0,
        rec: 0, rec_yd: 0, rec_td: 0,
        fum_lost: 0,
        fg_made: 0, fg_att: 0, xp_made: 0,
        def_sack: 0, def_int: 0, def_fum_rec: 0, def_td: 0, def_safety: 0, def_pa: 0
      };

      await pool.query(`
        INSERT INTO scores (id, user_id, player_id, week_number, points, base_points, multiplier, final_points, stats_json, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, 0, 0, $4, 0, $5, NOW())
        ON CONFLICT (user_id, player_id, week_number) DO UPDATE SET
          points = COALESCE(scores.points, 0),
          base_points = COALESCE(scores.base_points, 0),
          multiplier = $4,
          final_points = COALESCE(scores.final_points, 0),
          stats_json = COALESCE(scores.stats_json, $5),
          updated_at = NOW()
      `, [
        pick.user_id,
        pick.player_id,
        weekNumber,
        pick.multiplier || 1,
        JSON.stringify(emptyStats)
      ]);

      initializedCount++;
    }

    res.json({
      success: true,
      message: `Initialized ${initializedCount} scores for week ${weekNumber}`,
      scoresInitialized: initializedCount
    });
  } catch (err) {
    console.error('Error initializing week scores:', err);
    res.status(500).json({ error: err.message });
  }
});

// NOTE:
// Historical playoff backfill via ESPN scoreboard is unreliable.
// This endpoint is NOT used in production gameplay.
// Left intentionally for future fixture-based backfills.
// Admin: Backfill playoff stats from historical games
app.post('/api/admin/backfill-playoff-stats', async (req, res) => {
  liveStatsCache.activeGameIds = new Set();
  try {
    const { weekNumber } = req.body;

    if (!weekNumber) {
      return res.status(400).json({ error: 'weekNumber required' });
    }

    console.log(`Backfilling playoff stats for week ${weekNumber}...`);

    // Derive playoff parameters dynamically
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1; // 1-12
    const season = currentMonth <= 2 ? currentYear - 1 : currentYear;
    const seasontype = 3;
    let postseasonWeek = weekNumber - 18;
    if (postseasonWeek === 4) postseasonWeek = 5;

    // Fetch scoreboard using playoff parameters
    const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?season=${season}&seasontype=${seasontype}&week=${postseasonWeek}`;

    let scoreboardResponse;
    try {
      scoreboardResponse = await axios.get(scoreboardUrl);
    } catch (espnError) {
      console.error('ESPN scoreboard error:', {
        url: scoreboardUrl,
        status: espnError.response?.status,
        data: espnError.response?.data
      });

      // Handle ESPN 500s gracefully
      if (espnError.response?.status === 500) {
        console.warn('ESPN returned 500 for playoff scoreboard, no data available');
        return res.json({
          success: false,
          message: 'ESPN returned no playoff data for this week',
          gamesProcessed: 0
        });
      }

      throw espnError;
    }

    if (!scoreboardResponse.data || !scoreboardResponse.data.events) {
      return res.json({ success: false, message: 'No games found for that week', gamesProcessed: 0 });
    }

    const games = scoreboardResponse.data.events;
    console.log(`Found ${games.length} games for week ${weekNumber}`);

    let gamesProcessed = 0;
    let playersScored = 0;
    const processedPlayerIds = new Set();

    // Process each game
    for (const game of games) {
      const gameId = game.id;
      const gameStatus = game.status?.type?.state;

      console.log(`Processing game ${gameId}: ${game.shortName} (Status: ${gameStatus})`);

      // Add gameId to cache so fetchDefenseStats can find it
      liveStatsCache.activeGameIds.add(gameId);

      // Fetch game summary with player stats
      const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`;
      const summaryResponse = await axios.get(summaryUrl);

      if (!summaryResponse.data || !summaryResponse.data.boxscore) {
        console.log(`  No boxscore data for game ${gameId}`);
        continue;
      }

      // Parse player stats from boxscore
      const playerStats = parsePlayerStatsFromSummary(summaryResponse.data.boxscore);
      console.log(`  Found stats for ${playerStats.length} players`);

      // Map each player's stats to our database and save scores
      for (const playerStat of playerStats) {
        const espnId = playerStat.athleteId;
        const playerId = await mapESPNAthleteToPlayer(espnId, playerStat.athleteName, playerStat.teamAbbrev);

        if (!playerId) {
          // Player not in our database, skip
          continue;
        }

        // Convert ESPN stats to our scoring format
        const scoringStats = convertESPNStatsToScoring(playerStat.stats);

        // Calculate fantasy points
        const points = await calculateFantasyPoints(scoringStats);

        // Find all users who picked this player for this week
        const picksResult = await pool.query(`
          SELECT user_id, multiplier
          FROM picks
          WHERE player_id = $1
            AND week_number = $2
        `, [playerId, weekNumber]);

        // Save a score for each user who picked this player
        for (const pick of picksResult.rows) {
          const multiplier = pick.multiplier || 1.0;
          const finalPoints = points * multiplier;

          await pool.query(`
            INSERT INTO scores (
              id, user_id, player_id, week_number, points, base_points, multiplier, final_points, stats_json, updated_at
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, $4, $4, $5, $6, $7, NOW()
            )
            ON CONFLICT (user_id, player_id, week_number)
            DO UPDATE SET
              points = EXCLUDED.points,
              base_points = EXCLUDED.base_points,
              multiplier = EXCLUDED.multiplier,
              final_points = EXCLUDED.final_points,
              stats_json = EXCLUDED.stats_json,
              updated_at = NOW()
          `, [
            pick.user_id,
            playerId,
            weekNumber,
            points,
            multiplier,
            finalPoints,
            JSON.stringify(scoringStats)
          ]);

          playersScored++;
        }

        processedPlayerIds.add(playerId);
      }

      // Process team defenses for this game
      const competition = summaryResponse.data.header?.competitions?.[0];
      if (competition?.competitors) {
        for (const competitor of competition.competitors) {
          const teamAbbr = normalizeTeamAbbr(competitor.team?.abbreviation);
          if (!teamAbbr) continue;

          console.log(
            'DEF MATCH CHECK',
            'raw:', competitor.team?.abbreviation,
            'normalized:', teamAbbr,
            'week:', weekNumber
          );

          // Check if anyone picked this team's defense
          const defPicksResult = await pool.query(`
            SELECT user_id, multiplier
            FROM picks
            WHERE player_id = $1 AND week_number = $2 AND position = 'DEF'
          `, [teamAbbr, weekNumber]);

          if (defPicksResult.rows.length === 0) continue;

          console.log(`  Processing DEF for ${teamAbbr} (${defPicksResult.rows.length} picks)`);

          // Fetch defense stats
          // Build DEF stats directly from this game's summary (HISTORICAL SAFE)
          const defStats = {
            def_sack: 0,
            def_int: 0,
            def_fum_rec: 0,
            def_td: 0,
            def_safety: 0,
            def_block: 0,
            def_ret_td: 0,
            def_pts_allowed: parseInt(competitor.score) || 0
          };

          // 1. Team boxscore stats
          const teamBox = summaryResponse.data.boxscore.teams?.find(
            t => normalizeTeamAbbr(t.team?.abbreviation) === teamAbbr
          );

          if (teamBox?.statistics) {
            for (const stat of teamBox.statistics) {
              if (stat.name === 'sacksYardsLost') {
                defStats.def_sack = parseInt(stat.displayValue.split('-')[0]) || 0;
              }
            }
          }

          // 2. Player boxscore defensive stats
          for (const group of summaryResponse.data.boxscore.players || []) {
            if (!group.team) continue;
            if (normalizeTeamAbbr(group.team.abbreviation) !== teamAbbr) continue;

            for (const cat of group.statistics || []) {
              if (cat.name === 'interceptions' && cat.athletes) {
                for (const a of cat.athletes) {
                  defStats.def_int += parseInt(a.stats?.[0] || '0');
                  defStats.def_td += parseInt(a.stats?.[2] || '0');
                }
              }
            }
          }
          if (!defStats) {
            console.log(`    No defense stats found for ${teamAbbr}`);
            continue;
          }

          // Calculate fantasy points
          const points = await calculateFantasyPoints(defStats);

          // Save score for each user who picked this defense
          for (const pick of defPicksResult.rows) {
            const multiplier = pick.multiplier || 1.0;
            const finalPoints = points * multiplier;

            await pool.query(`
              INSERT INTO scores (
                id, user_id, player_id, week_number, points, base_points, multiplier, final_points, stats_json, updated_at
              ) VALUES (
                gen_random_uuid(), $1, $2, $3, $4, $4, $5, $6, $7, NOW()
              )
              ON CONFLICT (user_id, player_id, week_number)
              DO UPDATE SET
                points = EXCLUDED.points,
                base_points = EXCLUDED.base_points,
                multiplier = EXCLUDED.multiplier,
                final_points = EXCLUDED.final_points,
                stats_json = EXCLUDED.stats_json,
                updated_at = NOW()
            `, [
              pick.user_id,
              teamAbbr,
              weekNumber,
              points,
              multiplier,
              finalPoints,
              JSON.stringify(defStats)
            ]);

            playersScored++;
          }

          processedPlayerIds.add(teamAbbr);
        }
      }

      gamesProcessed++;
    }

    console.log(`Backfill complete: ${gamesProcessed} games, ${playersScored} player scores saved (${processedPlayerIds.size} unique players)`);

    res.json({
      success: true,
      message: `Backfilled stats for week ${weekNumber}`,
      gamesProcessed,
      playerScoresSaved: playersScored,
      uniquePlayers: processedPlayerIds.size
    });

  } catch (err) {
    console.error('Error backfilling playoff stats:', err);
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

// Admin: Delete scores for specific teams in a week
app.delete('/api/admin/scores/teams/:weekNumber', async (req, res) => {
  try {
    const { weekNumber } = req.params;
    const { adminUserId, teams } = req.body;

    if (!adminUserId || !teams || !Array.isArray(teams)) {
      return res.status(400).json({ error: 'adminUserId and teams array required' });
    }

    // Verify requesting user is admin
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [adminUserId]);
    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Delete scores for these teams
    const result = await pool.query(
      `DELETE FROM scores
        WHERE week_number = $1
        AND player_id IN (
          SELECT id FROM players WHERE team = ANY($2)
        )
        RETURNING player_id, base_points, final_points`,
      [weekNumber, teams]
    );

    console.log(`Deleted ${result.rows.length} scores for teams ${teams.join(', ')} in week ${weekNumber}`);

    res.json({
      success: true,
      scoresDeleted: result.rows.length,
      teams: teams,
      deletedScores: result.rows
    });
  } catch (err) {
    console.error('Error deleting team scores:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Delete scores for a specific user and week
app.delete('/api/admin/scores/:userId/:weekNumber', async (req, res) => {
  try {
    const { userId, weekNumber } = req.params;
    const { adminUserId } = req.body;

    if (!adminUserId) {
      return res.status(400).json({ error: 'adminUserId required' });
    }

    // Verify requesting user is admin
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [adminUserId]);
    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Delete the scores
    const result = await pool.query(
      `DELETE FROM scores
        WHERE user_id = $1 AND week_number = $2
        RETURNING player_id, base_points, final_points`,
      [userId, weekNumber]
    );

    console.log(`Deleted ${result.rows.length} scores for user ${userId}, week ${weekNumber}`);

    res.json({
      success: true,
      scoresDeleted: result.rows.length,
      deletedScores: result.rows
    });
  } catch (err) {
    console.error('Error deleting scores:', err);
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

// Admin: Process week transition - update multipliers for advancing players
app.post('/api/admin/process-week-transition', async (req, res) => {
  try {
    const { userId, fromWeek, toWeek } = req.body;

    if (!userId || !fromWeek || !toWeek) {
      return res.status(400).json({ error: 'userId, fromWeek, and toWeek required' });
    }

    // Verify user is admin
    const userCheck = await pool.query(
      'SELECT is_admin FROM users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0 || !userCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    console.log(`[admin] Processing week transition: ${fromWeek} -> ${toWeek}`);

    // Fetch scoreboard for the NEW week to see which teams are still playing
    const scoreboardResponse = await axios.get(getESPNScoreboardUrl(toWeek));

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

    console.log(`[admin] Active teams in week ${toWeek}:`, Array.from(activeTeams));

    // Get all picks from the previous week
    const picksResult = await pool.query(`
      SELECT pk.id, pk.user_id, pk.player_id, pk.position, pk.multiplier, pk.consecutive_weeks, p.team, p.full_name
      FROM picks pk
      JOIN players p ON pk.player_id = p.id
      WHERE pk.week_number = $1
    `, [fromWeek]);

    let advancedCount = 0;
    let eliminatedCount = 0;
    const eliminated = [];

    for (const pick of picksResult.rows) {
      const playerTeam = pick.team;
      const isActive = activeTeams.has(playerTeam);

      if (isActive) {
        // Player's team is still active - increment multiplier
        const newMultiplier = (pick.multiplier || 1) + 1;
        const newConsecutiveWeeks = (pick.consecutive_weeks || 1) + 1;

        // Create new pick for next week with incremented multiplier
        await pool.query(`
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

    console.log(`[admin] Week transition complete: ${advancedCount} advanced, ${eliminatedCount} eliminated`);

    res.json({
      success: true,
      fromWeek,
      toWeek,
      activeTeams: Array.from(activeTeams),
      advancedCount,
      eliminatedCount,
      eliminated
    });

  } catch (err) {
    console.error('Error processing week transition:', err);
    res.status(500).json({ error: err.message });
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

    // Verify the old player's team is actually eliminated
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
    `, [userId, weekNumber, position, oldPlayerId]);

    if (parseInt(currentCount.rows[0].count) >= maxPicks) {
      return res.status(400).json({
        error: `Position limit exceeded for ${position}. Maximum allowed: ${maxPicks}`
      });
    }

    // Delete old pick if it exists for this week
    await pool.query(
      'DELETE FROM picks WHERE user_id = $1 AND player_id = $2 AND week_number = $3',
      [userId, oldPlayerId, weekNumber]
    );

    // Create new pick with multiplier = 1 (fresh start)
    const newPickResult = await pool.query(`
      INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, 1.0, 1, false, NOW())
      ON CONFLICT (user_id, player_id, week_number) DO UPDATE SET
        position = $4,
        multiplier = 1.0,
        consecutive_weeks = 1
      RETURNING *
    `, [userId, newPlayerId, weekNumber, position]);

    // Log the swap to player_swaps table
    await pool.query(`
      INSERT INTO player_swaps (user_id, old_player_id, new_player_id, position, week_number, swapped_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [userId, oldPlayerId, newPlayerId, position, weekNumber]);

    console.log(`[swap] User ${userId} replaced ${oldPlayerResult.rows[0].full_name} with ${newPlayerResult.rows[0].full_name} for week ${weekNumber}`);

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
    let generatedUsername = name || email;
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
        NOW(), NOW(), false
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

    // Generate username
    let generatedUsername = name || email.split('@')[0];
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
        NOW(), NOW(), false
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
    const { username, email, phone } = req.body;

    console.log('PUT /api/users/:userId - Updating user:', { userId, username, email, phone });

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
    const { adminUserId } = req.query;

    if (!adminUserId) {
      return res.status(400).json({ error: 'adminUserId is required' });
    }

    // Check admin status
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [adminUserId]);
    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

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
    const { adminUserId } = req.query;

    if (!adminUserId) {
      return res.status(400).json({ error: 'adminUserId is required' });
    }

    // Check admin status
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [adminUserId]);
    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

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

    // Filter to active players on ALL teams, top depth chart only
    const activePlayers = Object.values(allPlayers).filter(p => {
      return p.active &&
              p.team &&
              p.position &&
              ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(p.position) &&
              (p.depth_chart_order === 1 || p.depth_chart_order === 2 || p.position === 'K' || p.position === 'DEF');
    });

    console.log(`Found ${activePlayers.length} active players to sync`);

    let inserted = 0;
    let updated = 0;

    for (const player of activePlayers) {
      try {
        // Check if player already exists
        const existing = await pool.query(
          'SELECT id FROM players WHERE id = $1',
          [player.player_id || player.sleeper_id]
        );

        if (existing.rows.length > 0) {
          // Update existing player
          const imageUrl = getPlayerImageUrl(player.player_id, player.position);
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
              image_url = $10,
              is_active = true,
              available = true,
              updated_at = NOW()
            WHERE id = $11
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
            imageUrl,
            player.player_id || player.sleeper_id
          ]);
          updated++;
        } else {
          // Insert new player
          const imageUrl = getPlayerImageUrl(player.player_id, player.position);
          await pool.query(`
            INSERT INTO players (
              id, sleeper_id, espn_id, first_name, last_name, full_name,
              position, team, number, status, injury_status, image_url,
              is_active, available, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, true, NOW(), NOW())
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
            player.injury_status || null,
            imageUrl
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

    // Fetch fresh data - only available and active players
    console.log('Fetching players from database...');

    // Show all active players regardless of team
    let query = `
      SELECT id, sleeper_id, full_name, first_name, last_name, position, team,
              number, status, injury_status, is_active, available, image_url
      FROM players
      WHERE is_active = true
        AND available = true
        AND team IS NOT NULL
        AND position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
        AND (position = 'DEF' OR (espn_id IS NOT NULL AND espn_id != ''))`;

    const params = [];

    if (position) {
      query += ` AND position = $${params.length + 1}`;
      params.push(position);
    }

    query += ` ORDER BY position, team, full_name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM players
      WHERE is_active = true
        AND available = true
        AND team IS NOT NULL
        AND position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
        AND (position = 'DEF' OR (espn_id IS NOT NULL AND espn_id != ''))
      ${position ? `AND position = $1` : ''}
    `;
    const countParams = position ? [position] : [];
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
      SELECT pk.*, p.full_name, p.position, p.team, p.sleeper_id, p.image_url
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
      `SELECT p.*, pl.full_name, pl.position as player_position, pl.team, pl.sleeper_id, pl.image_url
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

    // FIX #1: Payment Enforcement - Check if user has paid before allowing pick submission
    const userCheck = await pool.query(
      'SELECT paid FROM users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!userCheck.rows[0].paid) {
      return res.status(403).json({
        error: 'Payment required to create team. Please complete payment to continue.'
      });
    }

    // Support batch submission
    if (picks && Array.isArray(picks)) {
      const results = [];

      for (const pick of picks) {
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
        `, [userId, weekNumber, pick.position, pick.playerId]);

        if (parseInt(currentCount.rows[0].count) >= maxPicks) {
          return res.status(400).json({
            error: `Position limit exceeded for ${pick.position}. Maximum allowed: ${maxPicks}`
          });
        }

        const result = await pool.query(`
          INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, COALESCE($5, 1.0), 1, false, NOW())
          ON CONFLICT (user_id, player_id, week_number)
          DO UPDATE SET
            position = $4,
            multiplier = COALESCE($5, picks.multiplier),
            created_at = NOW()
          RETURNING *
        `, [userId, pick.playerId, weekNumber, pick.position, pick.multiplier || null]);

        results.push(result.rows[0]);
      }

      return res.json({ success: true, picks: results });
    }

    // Single pick submission with UPSERT
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
    `, [userId, weekNumber, position, playerId]);

    if (parseInt(currentCount.rows[0].count) >= maxPicks) {
      return res.status(400).json({
        error: `Position limit exceeded for ${position}. Maximum allowed: ${maxPicks}`
      });
    }

    const result = await pool.query(`
      INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, COALESCE($5, 1.0), 1, false, NOW())
      ON CONFLICT (user_id, player_id, week_number)
      DO UPDATE SET
        position = $4,
        multiplier = COALESCE($5, picks.multiplier),
        created_at = NOW()
      RETURNING *
    `, [userId, playerId, weekNumber, position, multiplier || null]);

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

// Get user's picks with scores for a specific week (for leaderboard quick view)
app.get('/api/users/:userId/picks/:weekNumber', async (req, res) => {
  try {
    const { userId, weekNumber } = req.params;

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
    `, [userId, weekNumber]);

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
        phone,
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
    const { has_paid, user_id, adminUserId, hasPaid } = req.body;
    
    // Support both naming conventions
    const actualUserId = user_id || adminUserId;
    const actualHasPaid = has_paid !== undefined ? has_paid : hasPaid;
    
    if (!actualUserId) {
      return res.status(400).json({ error: 'user_id or adminUserId required in request body' });
    }
    
    // Verify requesting user is admin
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [actualUserId]);
    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Update payment status
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
    const { weekNumber, round, includePicks } = req.query;

    // Map round to week number if round is provided
    let actualWeekNumber = weekNumber;
    if (round && !weekNumber) {
      actualWeekNumber = getWeekNumberForRound(round);
      if (!actualWeekNumber) {
        return res.status(400).json({ error: `Invalid round: ${round}` });
      }
    }

    let query;
    let params = [];

    if (actualWeekNumber) {
      // Filter by specific week
      query = `
        SELECT
          u.id,
          u.username,
          u.email,
          u.name,
          u.team_name,
          u.paid as has_paid,
          COALESCE(SUM(s.final_points), 0) as total_points
        FROM users u
        LEFT JOIN scores s ON u.id = s.user_id AND s.week_number = $1
        WHERE u.paid = true
        GROUP BY u.id, u.username, u.email, u.name, u.team_name, u.paid
        ORDER BY total_points DESC
      `;
      params = [actualWeekNumber];
    } else {
      // All weeks (cumulative) - sum all playoff weeks (19-22)
      query = `
        SELECT
          u.id,
          u.username,
          u.email,
          u.name,
          u.team_name,
          u.paid as has_paid,
          COALESCE(SUM(s.final_points), 0) as total_points
        FROM users u
        LEFT JOIN scores s ON u.id = s.user_id AND s.week_number IN (19, 20, 21, 22)
        WHERE u.paid = true
        GROUP BY u.id, u.username, u.email, u.name, u.team_name, u.paid
        ORDER BY total_points DESC
      `;
    }

    const result = await pool.query(query, params);

    // If includePicks is requested, fetch picks for each user
    if (includePicks === 'true' && actualWeekNumber) {
      console.log(`DEBUG: Fetching picks for ${result.rows.length} users for week ${actualWeekNumber}`);

      // Fetch matchup map once for this week
      const matchupMap = await getWeekMatchupMap(actualWeekNumber);
      console.log(`DEBUG: Loaded ${matchupMap.size} team matchups for week ${actualWeekNumber}`);

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

          console.log(`  User ${user.name || user.username} has ${picksResult.rows.length} picks`);

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

      console.log(`DEBUG: Returning leaderboard with picks`);
      res.json(leaderboardWithPicks);
    } else {
      console.log(`DEBUG: Returning leaderboard WITHOUT picks (includePicks=${includePicks}, weekNumber=${actualWeekNumber})`);
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

// ============================================
// LEADERBOARD TEST VIEW (with small stat line)
// ============================================

// Helper to generate a very short stat summary
function shortStats(js) {
  if (!js) return '';

  const s = js;
  let parts = [];

  if (s.rush_yd > 0) parts.push(`${s.rush_yd} rush yds`);
  if (s.rush_td > 0) parts.push(`${s.rush_td} rush TD`);
  if (s.rec > 0) parts.push(`${s.rec} rec`);
  if (s.rec_yd > 0) parts.push(`${s.rec_yd} rec yds`);
  if (s.rec_td > 0) parts.push(`${s.rec_td} rec TD`);
  if (s.pass_td > 0) parts.push(`${s.pass_td} pass TD`);
  if (s.pass_yd > 0) parts.push(`${s.pass_yd} pass yds`);
  if (s.pass_int > 0) parts.push(`${s.pass_int} INT`);
  if (s.fg_made > 0) parts.push(`${s.fg_made} FG`);

  return parts.join(' • ');
}

app.get('/leaderboard-test', async (req, res) => {
  try {
    const weekResult = await pool.query('SELECT current_playoff_week FROM game_settings LIMIT 1');
    const currentWeek = weekResult.rows[0]?.current_playoff_week || 11;
    
    const query = `
      SELECT 
        u.name as user_name,
        u.username,
        u.email,
        u.paid,
        p.full_name as player_name,
        p.position,
        p.team,
        pk.week_number,
        pk.locked,
        pk.multiplier,
        COALESCE(s.base_points, 0) as base_points,
        COALESCE(s.final_points, 0) as final_points,
        s.stats_json
      FROM users u
      LEFT JOIN picks pk ON pk.user_id = u.id
      LEFT JOIN players p ON pk.player_id = p.id
      LEFT JOIN scores s ON s.user_id = u.id 
        AND s.player_id = pk.player_id 
        AND s.week_number = pk.week_number
      WHERE pk.week_number = $1
      ORDER BY u.name, u.username,
        CASE p.position
          WHEN 'QB' THEN 1
          WHEN 'RB' THEN 2
          WHEN 'WR' THEN 3
          WHEN 'TE' THEN 4
          WHEN 'K' THEN 5
          WHEN 'DEF' THEN 6
        END,
        p.full_name
    `;
    
    const result = await pool.query(query, [currentWeek]);
    
    const userStats = new Map();
    
    result.rows.forEach(row => {
      const userName = row.user_name || row.username || row.email || 'Unknown';
      
      if (!userStats.has(userName)) {
        userStats.set(userName, {
          paid: row.paid,
          picks: [],
          totalPoints: 0
        });
      }
      
      const userData = userStats.get(userName);
      userData.picks.push(row);
      userData.totalPoints += parseFloat(row.final_points) || 0;
    });
    
    const sortedUsers = Array.from(userStats.entries()).sort((a, b) => {
      return b[1].totalPoints - a[1].totalPoints;
    });
    
    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="60">
  <title>Week ${currentWeek} Leaderboard</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #1a1a1a;
      color: #fff;
    }
    h1 {
      text-align: center;
      color: #4a9eff;
      margin-bottom: 10px;
    }
    .subtitle {
      text-align: center;
      color: #888;
      margin-bottom: 30px;
    }
    .leaderboard {
      background: #2a2a2a;
      border-radius: 12px;
      overflow: hidden;
    }
    .user-row {
      border-bottom: 1px solid #3a3a0a;
      padding: 15px 20px;
      display: flex;
      align-items: center;
      cursor: pointer;
      transition: background 0.2s;
    }
    .user-row:hover {
      background: #333;
    }
    .rank {
      font-size: 24px;
      font-weight: bold;
      width: 50px;
      flex-shrink: 0;
    }
    .rank.gold { color: #ffd700; }
    .rank.silver { color: #c0c0c0; }
    .rank.bronze { color: #cd7f32; }
    .name {
      flex: 1;
      font-size: 18px;
    }
    .points {
      font-size: 24px;
      font-weight: bold;
      color: #4a9eff;
      margin-right: 10px;
    }
    .paid {
      color: #4ade80;
      margin-left: 10px;
    }
    .details {
      display: none;
      padding: 15px 20px;
      background: #222;
      border-top: 1px solid #444;
    }
    .details.show {
      display: block;
    }
    .pick-row {
      display: flex;
      padding: 8px 0;
      border-bottom: 1px solid #333;
    }
    .pick-row:last-child {
      border-bottom: none;
    }
    .position {
      width: 50px;
      font-weight: bold;
      color: #888;
    }
    .player {
      flex: 1;
    }
    .player-points {
      color: #4ade80;
      font-weight: bold;
      min-width: 80px;
      text-align: right;
    }
    .locked {
      color: #fbbf24;
      margin-left: 10px;
    }
    .stats {
      text-align: center;
      margin-top: 30px;
      padding: 20px;
      background: #2a2a2a;
      border-radius: 12px;
      color: #888;
    }
  </style>
</head>
<body>
  <h1>Week ${currentWeek} Leaderboard</h1>
  <p class="subtitle">Auto-refreshes every 60 seconds • Last updated: ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago' })} CT</p>
  
  <div class="leaderboard">
`;

    sortedUsers.forEach(([userName, userData], index) => {
      const rank = index + 1;
      let rankClass = '';
      if (rank === 1) rankClass = 'gold';
      else if (rank === 2) rankClass = 'silver';
      else if (rank === 3) rankClass = 'bronze';
      
      const paidBadge = userData.paid ? '<span class="paid">✓</span>' : '';
      
      html += `
    <div class="user-row" onclick="toggleDetails('user-${index}')">
      <div class="rank ${rankClass}">#${rank}</div>
      <div class="name">${userName}${paidBadge}</div>
      <div class="points">${userData.totalPoints.toFixed(1)}</div>
    </div>
    <div class="details" id="user-${index}">
`;

      userData.picks.forEach(pick => {
        const points = parseFloat(pick.final_points) || 0;
        const locked = pick.locked ? '<span class="locked">🔒</span>' : '';
        const statline = shortStats(pick.stats_json);

        html += `
      <div class="pick-row">
        <div class="position">${pick.position}</div>
        <div class="player">
          ${pick.player_name || 'Unknown'} (${pick.team || ''})
          ${statline ? `<div style="color:#888; font-size:12px; margin-top:2px;">${statline}</div>` : ''}
        </div>
        <div class="player-points">${points.toFixed(1)} pts${locked}</div>
      </div>
`;
      });
      
      html += `
    </div>
`;
    });
    
    const totalPicks = result.rows.length;
    const scoredPicks = result.rows.filter(r => parseFloat(r.final_points) > 0).length;
    
    html += `
  </div>
  
  <div class="stats">
    <strong>${sortedUsers.length}</strong> players • 
    <strong>${scoredPicks}/${totalPicks}</strong> picks scored
  </div>
  
  <script>
    function toggleDetails(id) {
      document.getElementById(id).classList.toggle('show');
    }
  </script>
</body>
</html>
`;
    
    res.send(html);
    
  } catch (error) {
    console.error('Error generating leaderboard:', error);
    res.status(500).send('<h1>Error loading leaderboard</h1>');
  }
});