/**
 * Mock ESPN API
 *
 * Provides mock responses for ESPN NFL API calls.
 * Enables testing of live stats and scoring without external network calls.
 *
 * Usage:
 *   const { mockEspnScoreboard, mockEspnGameSummary } = require('./mocks/mockEspnApi');
 *   jest.mock('axios');
 *   axios.get.mockImplementation((url) => {
 *     if (url.includes('scoreboard')) return mockEspnScoreboard();
 *     if (url.includes('summary')) return mockEspnGameSummary();
 *   });
 */

/**
 * Mock ESPN Scoreboard response
 * Simulates /apis/site/v2/sports/football/nfl/scoreboard
 */
function mockEspnScoreboard(options = {}) {
  const {
    games = [],
    week = 1,
    seasonType = 3, // 3 = Playoffs
    year = 2025
  } = options;

  const defaultGames = [
    createMockGame({
      id: '401547417',
      homeTeam: { abbreviation: 'BUF', score: 31 },
      awayTeam: { abbreviation: 'DEN', score: 7 },
      status: 'STATUS_FINAL',
      statusDetail: 'Final'
    }),
    createMockGame({
      id: '401547418',
      homeTeam: { abbreviation: 'KC', score: 23 },
      awayTeam: { abbreviation: 'HOU', score: 14 },
      status: 'STATUS_IN_PROGRESS',
      statusDetail: '4th Quarter 5:30'
    })
  ];

  return {
    data: {
      leagues: [{
        calendar: [{
          label: 'Playoffs',
          entries: [{ value: `${week}` }]
        }]
      }],
      season: {
        year,
        type: seasonType
      },
      week: { number: week },
      events: games.length > 0 ? games : defaultGames
    }
  };
}

/**
 * Create a single mock game object
 */
function createMockGame(options = {}) {
  const {
    id = '401547417',
    homeTeam = { abbreviation: 'BUF', score: 0 },
    awayTeam = { abbreviation: 'DEN', score: 0 },
    status = 'STATUS_SCHEDULED',
    statusDetail = 'Scheduled',
    startDate = new Date().toISOString()
  } = options;

  return {
    id,
    date: startDate,
    status: {
      type: { name: status, state: status === 'STATUS_FINAL' ? 'post' : 'in' },
      displayClock: statusDetail
    },
    competitions: [{
      id,
      status: {
        type: { name: status },
        displayClock: statusDetail
      },
      competitors: [
        {
          homeAway: 'home',
          team: {
            abbreviation: homeTeam.abbreviation,
            displayName: `${homeTeam.abbreviation} Team`
          },
          score: `${homeTeam.score}`
        },
        {
          homeAway: 'away',
          team: {
            abbreviation: awayTeam.abbreviation,
            displayName: `${awayTeam.abbreviation} Team`
          },
          score: `${awayTeam.score}`
        }
      ]
    }]
  };
}

/**
 * Mock ESPN Game Summary response
 * Simulates /apis/site/v2/sports/football/nfl/summary?event=<gameId>
 */
function mockEspnGameSummary(options = {}) {
  const {
    gameId = '401547417',
    boxscoreAvailable = true,
    players = []
  } = options;

  const defaultPlayers = [
    createMockPlayerStats({
      id: '4567',
      name: 'Patrick Mahomes',
      position: 'QB',
      team: 'KC',
      stats: {
        passingYards: 312,
        passingTouchdowns: 3,
        interceptions: 1,
        rushingYards: 28
      }
    }),
    createMockPlayerStats({
      id: '5678',
      name: 'Derrick Henry',
      position: 'RB',
      team: 'BAL',
      stats: {
        rushingYards: 156,
        rushingTouchdowns: 2,
        receptions: 3,
        receivingYards: 24
      }
    })
  ];

  if (!boxscoreAvailable) {
    return {
      data: {
        header: { id: gameId },
        boxscore: null
      }
    };
  }

  return {
    data: {
      header: { id: gameId },
      boxscore: {
        players: players.length > 0 ? players : defaultPlayers
      }
    }
  };
}

/**
 * Create mock player stats for game summary
 */
function createMockPlayerStats(options = {}) {
  const {
    id = '4567',
    name = 'Test Player',
    position = 'QB',
    team = 'KC',
    stats = {}
  } = options;

  const {
    passingYards = 0,
    passingTouchdowns = 0,
    interceptions = 0,
    rushingYards = 0,
    rushingTouchdowns = 0,
    receptions = 0,
    receivingYards = 0,
    receivingTouchdowns = 0,
    fumblesLost = 0
  } = stats;

  return {
    team: { abbreviation: team },
    statistics: [
      {
        name: 'passing',
        athletes: position === 'QB' ? [{
          athlete: { id, displayName: name, position: { abbreviation: position } },
          stats: [
            `${passingTouchdowns}`, // TD
            `${passingYards}`, // Yards
            `${interceptions}` // INT
          ]
        }] : []
      },
      {
        name: 'rushing',
        athletes: ['QB', 'RB'].includes(position) ? [{
          athlete: { id, displayName: name, position: { abbreviation: position } },
          stats: [
            `${rushingYards}`, // Yards
            `${rushingTouchdowns}` // TD
          ]
        }] : []
      },
      {
        name: 'receiving',
        athletes: ['WR', 'RB', 'TE'].includes(position) ? [{
          athlete: { id, displayName: name, position: { abbreviation: position } },
          stats: [
            `${receptions}`, // Receptions
            `${receivingYards}`, // Yards
            `${receivingTouchdowns}` // TD
          ]
        }] : []
      },
      {
        name: 'fumbles',
        athletes: [{
          athlete: { id, displayName: name, position: { abbreviation: position } },
          stats: [`${fumblesLost}`]
        }]
      }
    ]
  };
}

/**
 * Mock Sleeper API player response
 */
function mockSleeperPlayers() {
  return {
    data: {
      '1234': {
        player_id: '1234',
        first_name: 'Patrick',
        last_name: 'Mahomes',
        position: 'QB',
        team: 'KC',
        status: 'Active'
      },
      '2345': {
        player_id: '2345',
        first_name: 'Derrick',
        last_name: 'Henry',
        position: 'RB',
        team: 'BAL',
        status: 'Active'
      },
      '3456': {
        player_id: '3456',
        first_name: 'CeeDee',
        last_name: 'Lamb',
        position: 'WR',
        team: 'DAL',
        status: 'Active'
      }
    }
  };
}

/**
 * Setup axios mock for ESPN API calls
 * Call this in beforeEach to enable mocking
 */
function setupEspnMocks(axios, customResponses = {}) {
  const {
    scoreboard = mockEspnScoreboard(),
    gameSummary = mockEspnGameSummary(),
    sleeperPlayers = mockSleeperPlayers()
  } = customResponses;

  axios.get.mockImplementation((url) => {
    if (url.includes('espn.com') && url.includes('scoreboard')) {
      return Promise.resolve(scoreboard);
    }
    if (url.includes('espn.com') && url.includes('summary')) {
      return Promise.resolve(gameSummary);
    }
    if (url.includes('sleeper')) {
      return Promise.resolve(sleeperPlayers);
    }
    return Promise.reject(new Error(`Unmocked URL: ${url}`));
  });
}

module.exports = {
  mockEspnScoreboard,
  mockEspnGameSummary,
  mockSleeperPlayers,
  createMockGame,
  createMockPlayerStats,
  setupEspnMocks
};
