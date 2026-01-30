/**
 * Test Fixtures
 *
 * Provides reusable test data for consistent test scenarios.
 * All IDs use deterministic UUIDs for predictable test behavior.
 */

// Deterministic UUIDs for test entities
const TEST_IDS = {
  users: {
    validUser: '11111111-1111-1111-1111-111111111111',
    paidUser: '22222222-2222-2222-2222-222222222222',
    adminUser: '33333333-3333-3333-3333-333333333333',
    nonExistent: '00000000-0000-0000-0000-000000000000'
  },
  players: {
    qb1: '44444444-4444-4444-4444-444444444444',
    rb1: '55555555-5555-5555-5555-555555555555',
    wr1: '66666666-6666-6666-6666-666666666666',
    te1: '77777777-7777-7777-7777-777777777777',
    k1: '88888888-8888-8888-8888-888888888888',
    def1: '99999999-9999-9999-9999-999999999999'
  },
  picks: {
    pick1: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    pick2: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  }
};

// User fixtures
const users = {
  valid: {
    id: TEST_IDS.users.validUser,
    email: 'testuser@example.com',
    username: 'TestUser',
    password_hash: '$2b$10$dummy.hash.for.testing.only',
    is_paid: false,
    is_admin: false,
    auth_provider: 'email',
    created_at: new Date('2024-01-01T00:00:00Z'),
    tos_accepted_at: new Date('2024-01-01T00:00:00Z'),
    tos_version: 1
  },

  paid: {
    id: TEST_IDS.users.paidUser,
    email: 'paiduser@example.com',
    username: 'PaidUser',
    password_hash: '$2b$10$dummy.hash.for.testing.only',
    is_paid: true,
    is_admin: false,
    auth_provider: 'email',
    created_at: new Date('2024-01-01T00:00:00Z'),
    tos_accepted_at: new Date('2024-01-01T00:00:00Z'),
    tos_version: 1
  },

  admin: {
    id: TEST_IDS.users.adminUser,
    email: 'admin@example.com',
    username: 'AdminUser',
    password_hash: '$2b$10$dummy.hash.for.testing.only',
    is_paid: true,
    is_admin: true,
    auth_provider: 'apple',
    created_at: new Date('2024-01-01T00:00:00Z'),
    tos_accepted_at: new Date('2024-01-01T00:00:00Z'),
    tos_version: 1
  }
};

// Player fixtures
const players = {
  qb: {
    id: TEST_IDS.players.qb1,
    sleeper_id: '1234',
    espn_id: 4567,
    full_name: 'Patrick Mahomes',
    first_name: 'Patrick',
    last_name: 'Mahomes',
    position: 'QB',
    team: 'KC',
    status: 'Active',
    image_url: 'https://sleepercdn.com/content/nfl/players/1234.jpg'
  },

  rb: {
    id: TEST_IDS.players.rb1,
    sleeper_id: '2345',
    espn_id: 5678,
    full_name: 'Derrick Henry',
    first_name: 'Derrick',
    last_name: 'Henry',
    position: 'RB',
    team: 'BAL',
    status: 'Active',
    image_url: 'https://sleepercdn.com/content/nfl/players/2345.jpg'
  },

  wr: {
    id: TEST_IDS.players.wr1,
    sleeper_id: '3456',
    espn_id: 6789,
    full_name: 'CeeDee Lamb',
    first_name: 'CeeDee',
    last_name: 'Lamb',
    position: 'WR',
    team: 'DAL',
    status: 'Active',
    image_url: 'https://sleepercdn.com/content/nfl/players/3456.jpg'
  },

  te: {
    id: TEST_IDS.players.te1,
    sleeper_id: '4567',
    espn_id: 7890,
    full_name: 'Travis Kelce',
    first_name: 'Travis',
    last_name: 'Kelce',
    position: 'TE',
    team: 'KC',
    status: 'Active',
    image_url: 'https://sleepercdn.com/content/nfl/players/4567.jpg'
  },

  k: {
    id: TEST_IDS.players.k1,
    sleeper_id: '5678',
    espn_id: 8901,
    full_name: 'Harrison Butker',
    first_name: 'Harrison',
    last_name: 'Butker',
    position: 'K',
    team: 'KC',
    status: 'Active',
    image_url: 'https://sleepercdn.com/content/nfl/players/5678.jpg'
  },

  def: {
    id: TEST_IDS.players.def1,
    sleeper_id: '6789',
    espn_id: 9012,
    full_name: 'Buffalo Bills',
    first_name: 'Buffalo',
    last_name: 'Bills',
    position: 'DEF',
    team: 'BUF',
    status: 'Active',
    image_url: null
  }
};

// Pick fixtures
const picks = {
  week1: {
    id: TEST_IDS.picks.pick1,
    user_id: TEST_IDS.users.validUser,
    player_id: TEST_IDS.players.qb1,
    week_number: 19,
    multiplier: 1,
    created_at: new Date('2024-01-06T00:00:00Z')
  },

  week1WithMultiplier: {
    id: TEST_IDS.picks.pick2,
    user_id: TEST_IDS.users.validUser,
    player_id: TEST_IDS.players.rb1,
    week_number: 19,
    multiplier: 2,
    created_at: new Date('2024-01-06T00:00:00Z')
  }
};

// Score fixtures
const scores = {
  qbGame: {
    player_id: TEST_IDS.players.qb1,
    week_number: 19,
    pass_yd: 312,
    pass_td: 3,
    pass_int: 1,
    rush_yd: 28,
    rush_td: 0,
    fantasy_points: 24.48
  },

  rbGame: {
    player_id: TEST_IDS.players.rb1,
    week_number: 19,
    rush_yd: 156,
    rush_td: 2,
    rec: 3,
    rec_yd: 24,
    fantasy_points: 33.0
  }
};

// Stat payloads for scoring tests
const statPayloads = {
  qbBasic: {
    pass_yd: 300,
    pass_td: 3,
    pass_int: 1
  },

  qbBonusGame: {
    pass_yd: 420,
    pass_td: 4,
    pass_int: 0
  },

  rbBasic: {
    rush_yd: 120,
    rush_td: 2,
    rec: 3,
    rec_yd: 25
  },

  rbBonusGame: {
    rush_yd: 165,
    rush_td: 2,
    rec: 2,
    rec_yd: 18
  },

  wrPPR: {
    rec: 10,
    rec_yd: 142,
    rec_td: 1
  },

  kickerBasic: {
    fg_made: 2,
    fg_longest: 45,
    xp_made: 3,
    fg_missed: 0,
    xp_missed: 0
  },

  defenseShutout: {
    def_sack: 4,
    def_int: 2,
    def_fum_rec: 1,
    def_pts_allowed: 0
  },

  defenseAverage: {
    def_sack: 2,
    def_int: 1,
    def_pts_allowed: 17
  }
};

// Game settings fixtures
const gameSettings = {
  wildcardActive: {
    current_week: 19,
    current_playoff_week: 1,
    is_week_active: true,
    active_teams: ['BUF', 'KC', 'DET', 'PHI', 'BAL', 'HOU', 'LAR', 'TB', 'PIT', 'DEN', 'GB', 'WAS', 'MIN', 'LAC']
  },

  wildcardLocked: {
    current_week: 19,
    current_playoff_week: 1,
    is_week_active: false,
    active_teams: ['BUF', 'KC', 'DET', 'PHI', 'BAL', 'HOU', 'LAR', 'TB', 'PIT', 'DEN', 'GB', 'WAS', 'MIN', 'LAC']
  },

  divisionalActive: {
    current_week: 20,
    current_playoff_week: 2,
    is_week_active: true,
    active_teams: ['BUF', 'KC', 'DET', 'PHI', 'BAL', 'HOU', 'LAR', 'GB']
  }
};

// Scoring rules fixture (matches database schema)
const scoringRules = [
  { id: 1, stat_name: 'pass_yd', points: 0.04, description: 'Passing Yards', is_active: true },
  { id: 2, stat_name: 'pass_td', points: 4, description: 'Passing TD', is_active: true },
  { id: 3, stat_name: 'pass_int', points: -2, description: 'Interception', is_active: true },
  { id: 4, stat_name: 'pass_2pt', points: 2, description: 'Passing 2PT', is_active: true },
  { id: 5, stat_name: 'rush_yd', points: 0.1, description: 'Rushing Yards', is_active: true },
  { id: 6, stat_name: 'rush_td', points: 6, description: 'Rushing TD', is_active: true },
  { id: 7, stat_name: 'rush_2pt', points: 2, description: 'Rushing 2PT', is_active: true },
  { id: 8, stat_name: 'rec', points: 1, description: 'Reception (PPR)', is_active: true },
  { id: 9, stat_name: 'rec_yd', points: 0.1, description: 'Receiving Yards', is_active: true },
  { id: 10, stat_name: 'rec_td', points: 6, description: 'Receiving TD', is_active: true },
  { id: 11, stat_name: 'rec_2pt', points: 2, description: 'Receiving 2PT', is_active: true },
  { id: 12, stat_name: 'fum_lost', points: -2, description: 'Fumble Lost', is_active: true },
  { id: 13, stat_name: 'pass_yd_bonus', points: 3, description: '400+ Passing Yards Bonus', is_active: true },
  { id: 14, stat_name: 'rush_yd_bonus', points: 3, description: '150+ Rushing Yards Bonus', is_active: true },
  { id: 15, stat_name: 'rec_yd_bonus', points: 3, description: '150+ Receiving Yards Bonus', is_active: true }
];

module.exports = {
  TEST_IDS,
  users,
  players,
  picks,
  scores,
  statPayloads,
  gameSettings,
  scoringRules
};
