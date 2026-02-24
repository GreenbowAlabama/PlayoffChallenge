/**
 * NFL ESPN Ingestion Adapter
 *
 * Implements the ingestion adapter interface for NFL data sourced from ESPN.
 * All NFL-specific logic lives here — platform orchestration (ingestionService)
 * has zero knowledge of ESPN, weeks, or scoring rules.
 *
 * Adapter interface (required by ingestionService):
 *   validateConfig()
 *   getWorkUnits(ctx)
 *   computeIngestionKey(contestInstanceId, unit)
 *   ingestWorkUnit(ctx, unit)   → returns normalizedScores array
 *   upsertScores(ctx, normalizedScores)
 *
 * Additional exports used by server.js for leaderboard gating:
 *   getESPNScoreboardUrl(weekNumber)
 */

'use strict';

const axios = require('axios');
const gameStateService = require('../../gameStateService');
const scoringService = require('../../scoringService');

// ─── In-module cache (was module-global in server.js) ─────────────────────────

const liveStatsCache = {
  games: new Map(),
  playerStats: new Map(),
  lastScoreboardUpdate: null,
  lastGameUpdates: new Map(),
  activeGameIds: new Set(),
  activeTeams: new Set(),
  currentCachedWeek: null
};

const SCOREBOARD_CACHE_MS = 10 * 60 * 1000; // 10 minutes
const GAME_SUMMARY_CACHE_MS = 90 * 1000;    // 90 seconds

// ─── ESPN URL helpers ──────────────────────────────────────────────────────────

/**
 * Build ESPN scoreboard URL with correct season type for playoffs.
 * Weeks 19+ are playoff weeks (seasontype=3).
 * Regular season weeks use seasontype=2.
 *
 * Exported for use by leaderboard gating in server.js.
 */
function getESPNScoreboardUrl(weekNumber) {
  if (weekNumber >= 19) {
    const playoffWeek = weekNumber - 18; // Week 19 = playoff week 1
    return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=3&week=${playoffWeek}`;
  }
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${weekNumber}`;
}

// ─── Playoff week resolution ───────────────────────────────────────────────────

/**
 * Resolve actual NFL week number from iOS playoff index.
 * iOS sends playoff week indices (1-4), but backend stores NFL weeks (19-22).
 * iOS LeaderboardView picker also uses 16-19 for Wild Card through Super Bowl.
 */
async function resolveActualWeekNumber(inputWeek, dbClient, logPrefix = 'WeekRemap') {
  if (!inputWeek) return null;

  const weekNum = parseInt(inputWeek, 10);
  if (isNaN(weekNum)) return null;

  const settingsResult = await dbClient.query('SELECT playoff_start_week FROM game_settings LIMIT 1');
  const playoffStartWeek = settingsResult.rows[0]?.playoff_start_week || 19;

  if (weekNum >= 1 && weekNum <= 4) {
    const resolved = playoffStartWeek + (weekNum - 1);
    console.log(`[${logPrefix}] Week remap: received=${weekNum}, playoff_start_week=${playoffStartWeek}, resolved=${resolved}`);
    return resolved;
  } else if (weekNum >= 19) {
    console.log(`[${logPrefix}] Week passthrough: received=${weekNum}, resolved=${weekNum} (literal NFL week)`);
    return weekNum;
  } else if (weekNum >= 16 && weekNum <= 18) {
    const resolved = weekNum + 3;
    console.log(`[${logPrefix}] Week remap (iOS picker): received=${weekNum}, resolved=${resolved}`);
    return resolved;
  } else {
    console.log(`[${logPrefix}] Week WARNING: received=${weekNum}, playoff_start_week=${playoffStartWeek}, resolved=${weekNum} (unexpected range)`);
    return weekNum;
  }
}

/**
 * Fetch ESPN postseason week and extract teams, skipping Pro Bowl weeks entirely.
 *
 * PRO BOWL EXCLUSION RULE: ESPN returns the Pro Bowl under postseason week numbering
 * with "AFC" and "NFC" as team abbreviations. This data has no value for our contest
 * and must never be persisted. If a week contains ONLY Pro Bowl events, skip it.
 */
async function fetchValidPostseasonWeek(startingNflWeek, playoffStartWeek, maxWeeksToSearch = 3) {
  let currentNflWeek = startingNflWeek;
  const maxNflWeek = startingNflWeek + maxWeeksToSearch;

  while (currentNflWeek <= maxNflWeek) {
    const url = getESPNScoreboardUrl(currentNflWeek);
    console.log(`[admin] Fetching ESPN postseason data for NFL week ${currentNflWeek}: ${url}`);

    let scoreboardResponse;
    try {
      scoreboardResponse = await axios.get(url);
    } catch (espnErr) {
      throw new Error(`ESPN API call failed for week ${currentNflWeek}: ${espnErr.message}`);
    }

    const events = scoreboardResponse.data?.events || [];
    if (events.length === 0) {
      console.log(`[admin] NFL week ${currentNflWeek} has no events, advancing...`);
      currentNflWeek++;
      continue;
    }

    const realTeams = new Set();
    let realEventCount = 0;
    let proBowlEventCount = 0;

    for (const event of events) {
      const competitors = event.competitions?.[0]?.competitors || [];
      const teamAbbrs = competitors.map(c => c.team?.abbreviation).filter(Boolean);
      const isProBowlEvent = teamAbbrs.some(abbr => abbr === 'AFC' || abbr === 'NFC');

      if (isProBowlEvent) {
        proBowlEventCount++;
        console.log(`[admin] NFL week ${currentNflWeek}: Detected Pro Bowl event (AFC vs NFC)`);
      } else {
        realEventCount++;
        for (const abbr of teamAbbrs) {
          realTeams.add(abbr);
        }
      }
    }

    if (realEventCount === 0 && proBowlEventCount > 0) {
      console.log(`[admin] NFL week ${currentNflWeek} is entirely Pro Bowl (${proBowlEventCount} events). Skipping entire week.`);
      currentNflWeek++;
      continue;
    }

    const effectivePlayoffWeek = currentNflWeek - playoffStartWeek + 1;
    console.log(`[admin] Found valid playoff week: NFL week ${currentNflWeek} (playoff week ${effectivePlayoffWeek}) with ${realTeams.size} teams`);

    return {
      nflWeek: currentNflWeek,
      playoffWeek: effectivePlayoffWeek,
      activeTeams: realTeams,
      eventCount: realEventCount,
      skippedProBowlWeeks: currentNflWeek - startingNflWeek
    };
  }

  throw new Error(`No valid playoff data found in weeks ${startingNflWeek}-${maxNflWeek}. All weeks appear to be Pro Bowl or empty.`);
}

// ─── Player name normalization ─────────────────────────────────────────────────

function normalizePlayerName(name) {
  if (!name) return { firstName: '', lastName: '', normalized: '' };

  const suffixes = ['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v'];
  let normalized = name.toLowerCase().replace(/\./g, '').trim();
  let parts = normalized.split(/\s+/);

  if (parts.length > 1 && suffixes.includes(parts[parts.length - 1])) {
    parts = parts.slice(0, -1);
  }

  const firstName = parts[0] || '';
  const lastName = parts.length > 1 ? parts[parts.length - 1] : '';

  return { firstName, lastName, normalized: parts.join(' '), parts };
}

// ─── ESPN stat parsing ─────────────────────────────────────────────────────────

/**
 * Parse stats from ESPN game summary boxscore.
 * Returns an array of { athleteId, athleteName, teamAbbrev, stats } objects.
 */
function parsePlayerStatsFromSummary(boxscore) {
  if (!boxscore || !boxscore.players) return [];

  const playerStatsMap = new Map();

  for (const team of boxscore.players) {
    if (!team.statistics) continue;

    const teamAbbrev = team.team?.abbreviation || null;

    for (const statGroup of team.statistics) {
      if (!statGroup.athletes) continue;
      const categoryName = statGroup.name;

      for (const athlete of statGroup.athletes) {
        const athleteId = athlete.athlete?.id;
        const athleteName = athlete.athlete?.displayName || athlete.athlete?.shortName;

        if (!athleteId) continue;

        const athleteIdStr = athleteId.toString();

        if (!playerStatsMap.has(athleteIdStr)) {
          playerStatsMap.set(athleteIdStr, {
            athleteId: athleteIdStr,
            athleteName: athleteName || 'Unknown',
            teamAbbrev: teamAbbrev,
            stats: {}
          });
        }

        const playerEntry = playerStatsMap.get(athleteIdStr);

        if (statGroup.labels && athlete.stats) {
          for (let i = 0; i < statGroup.labels.length; i++) {
            const label = statGroup.labels[i];
            const value = athlete.stats[i];

            if (label && value) {
              const prefixedLabel = `${categoryName}_${label}`;
              playerEntry.stats[prefixedLabel] = value;
            }
          }
        }
      }
    }
  }

  return Array.from(playerStatsMap.values());
}

/**
 * Convert ESPN prefixed stats to our scoring format.
 */
function convertESPNStatsToScoring(espnStats) {
  const scoring = {
    pass_yd: 0, pass_td: 0, pass_int: 0, pass_2pt: 0,
    rush_yd: 0, rush_td: 0, rush_2pt: 0,
    rec: 0, rec_yd: 0, rec_td: 0, rec_2pt: 0,
    fum_lost: 0,
    fg_made: 0, fg_att: 0, fg_longest: 0, fg_missed: 0,
    xp_made: 0, xp_att: 0, xp_missed: 0
  };

  if (!espnStats) return scoring;

  if (espnStats['passing_YDS']) scoring.pass_yd = parseFloat(espnStats['passing_YDS']) || 0;
  if (espnStats['passing_TD'])  scoring.pass_td = parseInt(espnStats['passing_TD']) || 0;
  if (espnStats['passing_INT']) scoring.pass_int = parseInt(espnStats['passing_INT']) || 0;
  if (espnStats['passing_2PT']) scoring.pass_2pt = parseInt(espnStats['passing_2PT']) || 0;

  if (espnStats['rushing_YDS']) scoring.rush_yd = parseFloat(espnStats['rushing_YDS']) || 0;
  if (espnStats['rushing_TD'])  scoring.rush_td = parseInt(espnStats['rushing_TD']) || 0;
  if (espnStats['rushing_2PT']) scoring.rush_2pt = parseInt(espnStats['rushing_2PT']) || 0;

  if (espnStats['receiving_REC']) scoring.rec = parseInt(espnStats['receiving_REC']) || 0;
  if (espnStats['receiving_YDS']) scoring.rec_yd = parseFloat(espnStats['receiving_YDS']) || 0;
  if (espnStats['receiving_TD'])  scoring.rec_td = parseInt(espnStats['receiving_TD']) || 0;
  if (espnStats['receiving_2PT']) scoring.rec_2pt = parseInt(espnStats['receiving_2PT']) || 0;

  if (espnStats['fumbles_LOST']) scoring.fum_lost = parseInt(espnStats['fumbles_LOST']) || 0;

  if (espnStats['kicking_FG']) {
    const fgParts = espnStats['kicking_FG'].toString().split('/');
    scoring.fg_made = parseInt(fgParts[0]) || 0;
    scoring.fg_att  = parseInt(fgParts[1]) || 0;
    scoring.fg_missed = scoring.fg_att - scoring.fg_made;
  }
  if (espnStats['kicking_LONG']) scoring.fg_longest = parseInt(espnStats['kicking_LONG']) || 0;
  if (espnStats['kicking_XP']) {
    const xpParts = espnStats['kicking_XP'].toString().split('/');
    scoring.xp_made = parseInt(xpParts[0]) || 0;
    scoring.xp_att  = parseInt(xpParts[1]) || 0;
    scoring.xp_missed = scoring.xp_att - scoring.xp_made;
  }

  return scoring;
}

/**
 * Parse 2-pt conversions from drives data.
 * Returns map of player abbreviation → { pass_2pt, rush_2pt, rec_2pt }.
 */
function parse2PtConversions(drivesData) {
  const conversions = {};

  if (!drivesData || !drivesData.previous) return conversions;

  for (const drive of drivesData.previous) {
    if (!drive.plays) continue;

    for (const play of drive.plays) {
      if (!play.pointAfterAttempt || play.pointAfterAttempt.value !== 2) continue;

      const text = play.text || '';
      const succeeded = text.includes('ATTEMPT SUCCEEDS');
      if (!succeeded) continue;

      const conversionMatch = text.match(/TWO-POINT CONVERSION ATTEMPT\.\s+([A-Z]\.[A-Za-z]+)\s+(pass|rush)/i);

      if (conversionMatch) {
        const playerAbbrev = conversionMatch[1];
        const actionType = conversionMatch[2].toLowerCase();

        if (!conversions[playerAbbrev]) {
          conversions[playerAbbrev] = { pass_2pt: 0, rush_2pt: 0, rec_2pt: 0 };
        }

        if (actionType === 'pass') {
          conversions[playerAbbrev].pass_2pt += 1;

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

// ─── ESPN data fetching ────────────────────────────────────────────────────────

/**
 * Fetch scoreboard to populate liveStatsCache with active game IDs and teams.
 */
async function fetchScoreboard(weekNumber) {
  try {
    const now = Date.now();

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

    if (liveStatsCache.currentCachedWeek !== weekNumber) {
      liveStatsCache.playerStats.clear();
      liveStatsCache.games.clear();
      liveStatsCache.lastGameUpdates.clear();
      liveStatsCache.currentCachedWeek = weekNumber;
    }

    const activeGames = [];

    if (response.data && response.data.events) {
      for (const event of response.data.events) {
        const gameId = event.id;
        const status = event.status?.type?.state;

        if (status === 'in' || status === 'post') {
          activeGames.push(gameId);

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
    liveStatsCache.activeTeams = new Set(
      Array.from(liveStatsCache.games.values())
        .flatMap(g => [g.homeTeam, g.awayTeam])
        .filter(Boolean)
    );
    liveStatsCache.currentCachedWeek = weekNumber;

    if (activeGames.length > 0) {
      liveStatsCache.lastScoreboardUpdate = now;
    }

    console.log('Fresh scoreboard fetched', { activeGames: activeGames.length, totalEvents: response.data?.events?.length || 0 });
    return activeGames;
  } catch (err) {
    console.error('Error fetching scoreboard:', err.message);
    return [];
  }
}

/**
 * Fetch and cache game summary for a specific game.
 * Populates liveStatsCache.playerStats.
 * Returns true if updated, false if cache hit or error.
 */
async function fetchGameSummary(gameId) {
  try {
    const now = Date.now();
    const lastUpdate = liveStatsCache.lastGameUpdates.get(gameId);

    if (lastUpdate && (now - lastUpdate) < GAME_SUMMARY_CACHE_MS) {
      return false;
    }

    const response = await axios.get(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`
    );

    if (response.data && response.data.boxscore) {
      const playerStats = parsePlayerStatsFromSummary(response.data.boxscore);
      const twoPointConversions = parse2PtConversions(response.data.drives);

      for (const stat of playerStats) {
        const playerName = stat.athleteName;
        const playerAbbrev = playerName.split(' ').map((n, i) => i === 0 ? n[0] : n).join('.');

        const possibleAbbrevs = [
          playerAbbrev,
          playerName.split(' ').map(n => n[0]).join('.'),
          playerName.split(' ')[0][0] + '.' + playerName.split(' ').slice(-1)[0]
        ];

        for (const abbrev of possibleAbbrevs) {
          if (twoPointConversions[abbrev]) {
            if (!stat.stats) stat.stats = {};
            if (twoPointConversions[abbrev].pass_2pt > 0) stat.stats['passing_2PT'] = twoPointConversions[abbrev].pass_2pt.toString();
            if (twoPointConversions[abbrev].rush_2pt > 0) stat.stats['rushing_2PT'] = twoPointConversions[abbrev].rush_2pt.toString();
            if (twoPointConversions[abbrev].rec_2pt > 0)  stat.stats['receiving_2PT'] = twoPointConversions[abbrev].rec_2pt.toString();
            break;
          }
        }

        liveStatsCache.playerStats.set(stat.athleteId, { ...stat, gameId, updatedAt: now });
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

/**
 * Fetch individual player stats from ESPN boxscore.
 * Falls back to live game cache when available.
 */
async function fetchPlayerStats(espnId, weekNumber) {
  try {
    for (const gameId of liveStatsCache.activeGameIds) {
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`;
        const response = await axios.get(url);

        if (!response.data || !response.data.boxscore) continue;

        const boxscore = response.data.boxscore;
        if (!boxscore.players) continue;

        const stats = {
          pass_yd: 0, pass_td: 0, pass_int: 0, pass_2pt: 0,
          rush_yd: 0, rush_td: 0, rush_2pt: 0,
          rec: 0, rec_yd: 0, rec_td: 0, rec_2pt: 0,
          fum_lost: 0
        };

        let foundPlayer = false;
        const categoriesSeen = new Set();

        for (const team of boxscore.players) {
          if (!team.statistics) continue;
          for (const statCategory of team.statistics) {
            if (!statCategory.athletes) continue;
            for (const athlete of statCategory.athletes) {
              const athleteId = athlete.athlete?.id?.toString();
              if (athleteId === espnId.toString()) {
                foundPlayer = true;
                categoriesSeen.add(statCategory.name);
              }
            }
          }
        }

        const skipPassing = categoriesSeen.has('receiving');

        for (const team of boxscore.players) {
          if (!team.statistics) continue;
          for (const statCategory of team.statistics) {
            if (!statCategory.athletes) continue;
            for (const athlete of statCategory.athletes) {
              const athleteId = athlete.athlete?.id?.toString();
              if (athleteId !== espnId.toString()) continue;

              if (statCategory.name === 'passing' && skipPassing) continue;

              if (statCategory.name === 'passing' && athlete.stats) {
                // ESPN Format: ["C/ATT", "YDS", "AVG", "TD", "INT", "SACKS", "QBR", "RTG"]
                const yards = parseFloat(athlete.stats[1]) || 0;
                stats.pass_yd += yards;
                stats.pass_td += parseFloat(athlete.stats[3]) || 0;
                stats.pass_int += parseFloat(athlete.stats[4]) || 0;
              }

              if (statCategory.name === 'rushing' && athlete.stats) {
                // ESPN Format: ["CAR", "YDS", "AVG", "TD", "LONG"]
                stats.rush_yd += parseFloat(athlete.stats[1]) || 0;
                stats.rush_td += parseFloat(athlete.stats[3]) || 0;
              }

              if (statCategory.name === 'receiving' && athlete.stats) {
                // ESPN Format: ["REC", "YDS", "AVG", "TD", "LONG", "TGTS"]
                stats.rec    += parseFloat(athlete.stats[0]) || 0;
                stats.rec_yd += parseFloat(athlete.stats[1]) || 0;
                stats.rec_td += parseFloat(athlete.stats[3]) || 0;
              }

              if (statCategory.name === 'fumbles' && athlete.stats) {
                // ESPN Format: ["FUM", "LOST", "REC"]
                stats.fum_lost += parseFloat(athlete.stats[1]) || 0;
              }

              if (statCategory.name === 'kicking' && athlete.stats) {
                // ESPN Format: ["FG", "PCT", "LONG", "XP", "PTS"]
                const fgMadeAtt = athlete.stats[0] ? athlete.stats[0].split('/') : ['0', '0'];
                const fgMade = parseInt(fgMadeAtt[0]) || 0;
                const fgAtt  = parseInt(fgMadeAtt[1]) || 0;
                const longest = parseInt(athlete.stats[2]) || 0;
                const patMadeAtt = athlete.stats[3] ? athlete.stats[3].split('/') : ['0', '0'];
                const patMade = parseInt(patMadeAtt[0]) || 0;
                const patAtt  = parseInt(patMadeAtt[1]) || 0;

                stats.fg_made    = fgMade;
                stats.fg_missed  = fgAtt - fgMade;
                stats.fg_longest = longest;
                stats.xp_made    = patMade;
                stats.xp_missed  = patAtt - patMade;
              }
            }
          }
        }

        if (foundPlayer) {
          if (response.data.drives) {
            const twoPointConversions = parse2PtConversions(response.data.drives);
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
                  stats.rec_2pt  = twoPointConversions[abbrev].rec_2pt  || 0;
                  break;
                }
              }
            }
          }

          return stats;
        }
      } catch (_err) {
        continue;
      }
    }

    return null;
  } catch (err) {
    console.error(`Error fetching player stats for ESPN ID ${espnId}:`, err.message);
    return null;
  }
}

/**
 * Fetch defense stats from ESPN (LIVE + HISTORICAL SAFE).
 */
async function fetchDefenseStats(teamAbbrev) {
  try {
    const normalizedTeam = gameStateService.normalizeTeamAbbr(teamAbbrev);

    for (const gameId of liveStatsCache.activeGameIds) {
      try {
        const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`;
        const summaryRes = await axios.get(summaryUrl);

        if (!summaryRes.data || !summaryRes.data.boxscore) continue;

        const competition = summaryRes.data.header?.competitions?.[0];
        if (!competition?.competitors) continue;

        let isInGame = false;
        let opponentScore = 0;
        let teamId = null;

        for (const competitor of competition.competitors) {
          const espnAbbr = gameStateService.normalizeTeamAbbr(competitor.team?.abbreviation);
          if (espnAbbr === normalizedTeam) {
            isInGame = true;
            teamId = competitor.id;
          } else {
            opponentScore = parseInt(competitor.score) || 0;
          }
        }

        if (!isInGame || !teamId) continue;

        const stats = {
          def_sack: 0, def_int: 0, def_fum_rec: 0,
          def_td: 0, def_safety: 0, def_block: 0,
          def_ret_td: 0, def_pts_allowed: opponentScore
        };

        // ── 1. Competitor defensive statistics (authoritative) ───────────────
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
                    if (category.name === 'defensive' || category.name === 'defensiveInterceptions') {
                      stats.def_int += Number(stat.value) || 0;
                    }
                    break;
                  case 'fumblesRecovered':
                  case 'fumbleRecoveries':
                    if (category.name === 'defensive' || category.name === 'defensiveInterceptions') {
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

        // ── 3. Supplement INT + TD from defensive player boxscore ────────────
        const playerBox = summaryRes.data.boxscore.players;
        if (playerBox) {
          for (const group of playerBox) {
            if (!group.team) continue;
            const groupAbbr = gameStateService.normalizeTeamAbbr(group.team.abbreviation);
            if (groupAbbr !== normalizedTeam) continue;
            if (!group.statistics) continue;

            for (const cat of group.statistics) {
              if (cat.name === 'interceptions' && cat.athletes) {
                for (const a of cat.athletes) {
                  const ints = parseInt(a.stats?.[0] || '0');
                  const td   = parseInt(a.stats?.[2] || '0');
                  if (!isNaN(ints)) stats.def_int += ints;
                  if (!isNaN(td))   stats.def_td  += td;
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

// ─── Adapter interface ─────────────────────────────────────────────────────────

/**
 * Validate adapter config.
 * V1: no-op (ESPN public API requires no key).
 */
function validateConfig() {
  // ESPN public API — no credentials needed for V1
}

/**
 * Get ingestion work units for this contest.
 * Returns [{weekNumber}] based on current game_settings.
 * Returns [] if no active playoff week is configured.
 */
async function getWorkUnits(ctx) {
  const result = await ctx.dbClient.query(
    'SELECT current_playoff_week, playoff_start_week FROM game_settings LIMIT 1'
  );
  const { current_playoff_week, playoff_start_week } = result.rows[0] || {};

  if (!current_playoff_week || current_playoff_week <= 0) return [];

  const weekNumber = playoff_start_week + Math.min(current_playoff_week - 1, 3);
  return [{ weekNumber }];
}

/**
 * Compute an idempotency key for a (contestInstanceId, workUnit) pair.
 * Key is unique per contest + week.
 * ingestionService uses this to prevent duplicate concurrent runs.
 */
function computeIngestionKey(contestInstanceId, unit) {
  return `nfl_espn:${contestInstanceId}:week:${unit.weekNumber}`;
}

/**
 * Ingest one work unit: fetch ESPN data and compute normalized scores.
 *
 * Does NOT write to the DB — that is upsertScores's responsibility.
 * Returns an array of normalized score objects.
 */
async function ingestWorkUnit(ctx, unit) {
  const { weekNumber } = unit;
  const dbProxy = { query: (...args) => ctx.dbClient.query(...args) };

  // Step 1: Fetch scoreboard (populates liveStatsCache)
  const activeGameIds = await fetchScoreboard(weekNumber);
  if (activeGameIds.length === 0) {
    console.log('No active games found', { week: weekNumber });
    return [];
  }

  // Step 2: Get teams we care about
  const activeTeams = await gameStateService.getActiveTeamsForWeek(dbProxy, weekNumber);

  // Step 3: Fetch game summaries for relevant games only
  for (const gameId of activeGameIds) {
    const gameInfo = liveStatsCache.games.get(gameId);
    if (gameInfo &&
        (activeTeams.includes(gameInfo.homeTeam) || activeTeams.includes(gameInfo.awayTeam))) {
      await fetchGameSummary(gameId);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Step 4: Query picks and compute scores
  const trackedTeamsResult = await ctx.dbClient.query(`
    SELECT DISTINCT p.team
    FROM picks pk
    JOIN players p ON pk.player_id = p.id::text
    WHERE pk.week_number = $1 AND p.team IS NOT NULL
  `, [weekNumber]);
  const trackedTeams = new Set(
    trackedTeamsResult.rows.map(r => r.team?.trim()?.toUpperCase()).filter(Boolean)
  );

  const picksResult = await ctx.dbClient.query(`
    SELECT pk.id as pick_id, pk.user_id, pk.player_id, pk.position, pk.multiplier
    FROM picks pk
    WHERE pk.week_number = $1
  `, [weekNumber]);

  const normalizedScores = [];
  const scoringStrategyKey = ctx.template.scoring_strategy_key;

  for (const pick of picksResult.rows) {
    const playerRes = await ctx.dbClient.query(
      'SELECT espn_id, full_name, position, team FROM players WHERE id::text = $1',
      [pick.player_id]
    );
    if (playerRes.rows.length === 0) continue;

    const { espn_id: espnId, full_name: playerName, position: playerPosition, team: dbTeam } = playerRes.rows[0];
    let scoring = null;

    // ── Defense ───────────────────────────────────────────────────────────────
    if (playerPosition === 'DEF') {
      const defStats = await fetchDefenseStats(pick.player_id);
      if (defStats) {
        scoring = defStats;
      } else if (liveStatsCache.activeTeams.has(pick.player_id)) {
        scoring = {};
      } else {
        continue;
      }
    }

    // ── Skill players (including K) ────────────────────────────────────────────
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

      // Name-based cache lookup with team matching for safe hydration
      if (!playerStats) {
        const normalized = normalizePlayerName(playerName);
        const normalizedDbTeam = gameStateService.normalizeTeamAbbr(dbTeam);

        for (const [athleteId, cached] of liveStatsCache.playerStats) {
          const cachedNormalized = normalizePlayerName(cached.athleteName);
          const normalizedCachedTeam = gameStateService.normalizeTeamAbbr(cached.team);

          const nameMatches = normalized.firstName === cachedNormalized.firstName &&
                              normalized.lastName  === cachedNormalized.lastName;
          const teamMatches = normalizedDbTeam && normalizedCachedTeam &&
                              normalizedDbTeam === normalizedCachedTeam;

          if (nameMatches && teamMatches) {
            if (!espnId) {
              await ctx.dbClient.query(
                'UPDATE players SET espn_id = $1 WHERE id::text = $2',
                [athleteId, pick.player_id]
              );
              resolvedEspnId = athleteId;
              console.log(`[lazy-hydration] Assigned ESPN ID ${athleteId} to player ${playerName} (${dbTeam})`);
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
          if (cached?.team) playerTeam = cached.team;
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

    // ── Kicker zero fill ───────────────────────────────────────────────────────
    if (playerPosition === 'K' && Object.keys(scoring).length === 0) {
      scoring = { fg_made: 0, xp_made: 0 };
    }

    const basePoints = await scoringService.calculateFantasyPoints(dbProxy, scoring, scoringStrategyKey);
    const multiplier = pick.multiplier || 1;
    const finalPoints = basePoints * multiplier;

    normalizedScores.push({
      user_id:     pick.user_id,
      player_id:   pick.player_id,
      week_number: weekNumber,
      base_points: basePoints,
      multiplier:  multiplier,
      final_points: finalPoints,
      stats:       scoring
    });
  }

  console.log(`Scores computed`, { week: weekNumber, score_count: normalizedScores.length });
  return normalizedScores;
}

/**
 * Persist normalized scores to the scores table.
 * Uses ON CONFLICT to update existing records (live re-scoring safe).
 */
async function upsertScores(ctx, normalizedScores) {
  let savedCount = 0;

  for (const score of normalizedScores) {
    await ctx.dbClient.query(`
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
        points       = $4,
        base_points  = $4,
        multiplier   = $5,
        final_points = $6,
        stats_json   = $7,
        updated_at   = NOW()
    `, [
      score.user_id,
      score.player_id,
      score.week_number,
      score.base_points,
      score.multiplier,
      score.final_points,
      JSON.stringify(score.stats)
    ]);
    savedCount++;
  }

  console.log('Scores persisted', { week: normalizedScores[0]?.week_number, score_count: savedCount });
  return savedCount;
}

// ─── Exports ───────────────────────────────────────────────────────────────────

/**
 * Read-only access to a player's cached stats (from liveStatsCache).
 * Used by live stats display endpoints in server.js.
 */
function getCachedPlayerStats(espnId) {
  if (!espnId) return null;
  return liveStatsCache.playerStats.get(espnId.toString()) || null;
}

/**
 * Read-only snapshot of liveStatsCache for admin diagnostics.
 */
function getCacheStatus() {
  return {
    activeGames: Array.from(liveStatsCache.games.values()),
    cachedPlayerCount: liveStatsCache.playerStats.size,
    lastScoreboardUpdate: liveStatsCache.lastScoreboardUpdate
      ? new Date(liveStatsCache.lastScoreboardUpdate).toISOString()
      : null,
    gameUpdateTimes: Array.from(liveStatsCache.lastGameUpdates.entries()).map(([gameId, time]) => ({
      gameId,
      lastUpdate: new Date(time).toISOString()
    }))
  };
}

module.exports = {
  // Adapter interface (required by ingestionService)
  validateConfig,
  getWorkUnits,
  computeIngestionKey,
  ingestWorkUnit,
  upsertScores,

  // Additional exports for route handlers in server.js
  getESPNScoreboardUrl,
  fetchValidPostseasonWeek,
  resolveActualWeekNumber,
  convertESPNStatsToScoring,
  getCachedPlayerStats,
  getCacheStatus
};
