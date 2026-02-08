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

// Contest fixtures (new data contracts)
const TEST_CONTEST_IDS = {
  freeContest: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  paidContest: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  privateContest: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  lockedContest: 'ffffffff-ffff-ffff-ffff-ffffffffffff'
};

const contests = {
  free: {
    contest_id: TEST_CONTEST_IDS.freeContest,
    contest_type: 'playoff_challenge',
    league_name: 'Free League',
    entry_fee_cents: 0,
    max_entries: 100,
    current_entries: 25,
    state: 'open',
    join_link: null,
    is_private: false,
    created_at: new Date('2024-01-01T00:00:00Z'),
    starts_at: new Date('2024-01-06T00:00:00Z')
  },

  paid: {
    contest_id: TEST_CONTEST_IDS.paidContest,
    contest_type: 'playoff_challenge',
    league_name: 'Paid League',
    entry_fee_cents: 2500,
    max_entries: 50,
    current_entries: 10,
    state: 'open',
    join_link: null,
    is_private: false,
    created_at: new Date('2024-01-01T00:00:00Z'),
    starts_at: new Date('2024-01-06T00:00:00Z')
  },

  private: {
    contest_id: TEST_CONTEST_IDS.privateContest,
    contest_type: 'playoff_challenge',
    league_name: 'Private League',
    entry_fee_cents: 1000,
    max_entries: 20,
    current_entries: 5,
    state: 'open',
    join_link: 'https://app.playoff.com/join/abc123',
    is_private: true,
    created_at: new Date('2024-01-01T00:00:00Z'),
    starts_at: new Date('2024-01-06T00:00:00Z')
  },

  locked: {
    contest_id: TEST_CONTEST_IDS.lockedContest,
    contest_type: 'playoff_challenge',
    league_name: 'Locked League',
    entry_fee_cents: 0,
    max_entries: 100,
    current_entries: 100,
    state: 'locked',
    join_link: null,
    is_private: false,
    created_at: new Date('2024-01-01T00:00:00Z'),
    starts_at: new Date('2024-01-06T00:00:00Z')
  },

  marchMadness: {
    contest_id: 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
    contest_type: 'march_madness',
    league_name: 'March Madness Pool',
    entry_fee_cents: 5000,
    max_entries: 64,
    current_entries: 32,
    state: 'open',
    join_link: null,
    is_private: false,
    created_at: new Date('2024-03-01T00:00:00Z'),
    starts_at: new Date('2024-03-19T00:00:00Z')
  }
};

// Contest state enum values
const contestStates = ['draft', 'open', 'locked', 'active', 'scoring', 'finalized', 'cancelled'];

// Payment fixtures
const TEST_PAYMENT_IDS = {
  pendingPayment: 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  completedPayment: 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
  failedPayment: 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'
};

const payments = {
  pending: {
    payment_id: TEST_PAYMENT_IDS.pendingPayment,
    user_id: TEST_IDS.users.validUser,
    contest_id: TEST_CONTEST_IDS.paidContest,
    amount_cents: 2500,
    payment_status: 'pending',
    stripe_session_id: 'cs_test_abc123',
    stripe_payment_intent_id: null,
    created_at: new Date('2024-01-05T00:00:00Z'),
    updated_at: new Date('2024-01-05T00:00:00Z')
  },

  completed: {
    payment_id: TEST_PAYMENT_IDS.completedPayment,
    user_id: TEST_IDS.users.paidUser,
    contest_id: TEST_CONTEST_IDS.paidContest,
    amount_cents: 2500,
    payment_status: 'paid',
    stripe_session_id: 'cs_test_def456',
    stripe_payment_intent_id: 'pi_test_def456',
    created_at: new Date('2024-01-05T00:00:00Z'),
    updated_at: new Date('2024-01-05T01:00:00Z')
  },

  failed: {
    payment_id: TEST_PAYMENT_IDS.failedPayment,
    user_id: TEST_IDS.users.validUser,
    contest_id: TEST_CONTEST_IDS.paidContest,
    amount_cents: 2500,
    payment_status: 'failed',
    stripe_session_id: 'cs_test_ghi789',
    stripe_payment_intent_id: null,
    failure_reason: 'card_declined',
    created_at: new Date('2024-01-05T00:00:00Z'),
    updated_at: new Date('2024-01-05T00:30:00Z')
  }
};

// Valid payment status transitions
const paymentStatusTransitions = {
  pending: ['paid', 'failed', 'cancelled'],
  paid: ['refunded'],
  failed: ['pending'],
  cancelled: [],
  refunded: []
};

// Rules fixtures
const TEST_RULESET_ID = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';

const rules = {
  standard: {
    ruleset_id: TEST_RULESET_ID,
    rules_version: '1.0.0',
    rules_table: [
      { rule_name: 'roster_size', description: 'Maximum players per roster', value: 10 },
      { rule_name: 'position_qb', description: 'Required QB slots', value: 1 },
      { rule_name: 'position_rb', description: 'Required RB slots', value: 2 },
      { rule_name: 'position_wr', description: 'Required WR slots', value: 2 },
      { rule_name: 'position_te', description: 'Required TE slots', value: 1 },
      { rule_name: 'position_flex', description: 'FLEX slots (RB/WR/TE)', value: 2 },
      { rule_name: 'position_k', description: 'Required K slots', value: 1 },
      { rule_name: 'position_def', description: 'Required DEF slots', value: 1 },
      { rule_name: 'multiplier_max', description: 'Maximum multiplier value', value: 3 },
      { rule_name: 'multiplier_uses', description: 'Multiplier uses per contest', value: 4 }
    ]
  },

  withOverrides: {
    ruleset_id: 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5',
    rules_version: '1.0.0-custom',
    rules_table: [
      { rule_name: 'roster_size', description: 'Maximum players per roster', value: 8 },
      { rule_name: 'position_qb', description: 'Required QB slots', value: 1 },
      { rule_name: 'position_rb', description: 'Required RB slots', value: 1 },
      { rule_name: 'position_wr', description: 'Required WR slots', value: 2 },
      { rule_name: 'position_te', description: 'Required TE slots', value: 1 },
      { rule_name: 'position_flex', description: 'FLEX slots (RB/WR/TE)', value: 1 },
      { rule_name: 'position_k', description: 'Required K slots', value: 1 },
      { rule_name: 'position_def', description: 'Required DEF slots', value: 1 }
    ]
  }
};

// Audit log fixtures
const auditLogs = {
  contestStateChange: {
    audit_id: 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6',
    actor_user_id: TEST_IDS.users.adminUser,
    action: 'contest_state_override',
    target_type: 'contest',
    target_id: TEST_CONTEST_IDS.lockedContest,
    reason: 'Emergency unlock requested by support ticket #12345',
    metadata: { previous_state: 'locked', new_state: 'open' },
    created_at: new Date('2024-01-06T12:00:00Z')
  },

  scoringRecompute: {
    audit_id: 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
    actor_user_id: TEST_IDS.users.adminUser,
    action: 'scoring_recompute',
    target_type: 'contest',
    target_id: TEST_CONTEST_IDS.freeContest,
    reason: 'Score correction after ESPN data fix',
    metadata: { affected_users: 25, score_changes: 12 },
    created_at: new Date('2024-01-07T14:30:00Z')
  },

  userSuspension: {
    audit_id: 'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8',
    actor_user_id: TEST_IDS.users.adminUser,
    action: 'user_suspension',
    target_type: 'user',
    target_id: TEST_IDS.users.validUser,
    reason: 'Terms of service violation - multiple accounts',
    metadata: { suspension_duration_days: 7 },
    created_at: new Date('2024-01-08T09:00:00Z')
  }
};

// Leaderboard fixtures
const leaderboardEntries = [
  {
    user_id: TEST_IDS.users.paidUser,
    username: 'PaidUser',
    total_points: 156.5,
    rank: 1
  },
  {
    user_id: TEST_IDS.users.validUser,
    username: 'TestUser',
    total_points: 142.0,
    rank: 2
  },
  {
    user_id: TEST_IDS.users.adminUser,
    username: 'AdminUser',
    total_points: 128.75,
    rank: 3
  }
];

// Team view fixtures (for My Team / Team Preview)
const teamViewPayloads = {
  myTeam: {
    contest_id: TEST_CONTEST_IDS.freeContest,
    contest_name: 'Free League',
    teams: [
      {
        team_name: 'Kansas City Chiefs',
        team_rank: 1,
        team_score: 45.5,
        players: [
          {
            player_id: TEST_IDS.players.qb1,
            player_number: 15,
            position: 'QB',
            team_name: 'KC',
            points: 24.48
          },
          {
            player_id: TEST_IDS.players.te1,
            player_number: 87,
            position: 'TE',
            team_name: 'KC',
            points: 21.02
          }
        ]
      },
      {
        team_name: 'Baltimore Ravens',
        team_rank: 2,
        team_score: 33.0,
        players: [
          {
            player_id: TEST_IDS.players.rb1,
            player_number: 22,
            position: 'RB',
            team_name: 'BAL',
            points: 33.0
          }
        ]
      }
    ]
  },

  teamPreview: {
    contest_id: TEST_CONTEST_IDS.freeContest,
    contest_name: 'Free League',
    user_id: TEST_IDS.users.paidUser,
    username: 'PaidUser',
    teams: [
      {
        team_name: 'Buffalo Bills',
        team_rank: 3,
        team_score: 28.5,
        players: [
          {
            player_id: TEST_IDS.players.def1,
            player_number: null,
            position: 'DEF',
            team_name: 'BUF',
            points: 28.5
          }
        ]
      }
    ]
  }
};

// Stripe webhook fixtures
const stripeWebhooks = {
  checkoutCompleted: {
    id: 'evt_test_checkout_completed',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_def456',
        payment_intent: 'pi_test_def456',
        payment_status: 'paid',
        metadata: {
          user_id: TEST_IDS.users.validUser,
          contest_id: TEST_CONTEST_IDS.paidContest
        }
      }
    }
  },

  paymentFailed: {
    id: 'evt_test_payment_failed',
    type: 'payment_intent.payment_failed',
    data: {
      object: {
        id: 'pi_test_failed',
        last_payment_error: {
          code: 'card_declined',
          message: 'Your card was declined.'
        },
        metadata: {
          user_id: TEST_IDS.users.validUser,
          contest_id: TEST_CONTEST_IDS.paidContest
        }
      }
    }
  }
};

module.exports = {
  TEST_IDS,
  users,
  players,
  picks,
  scores,
  statPayloads,
  gameSettings,
  scoringRules,
  // New exports
  TEST_CONTEST_IDS,
  contests,
  contestStates,
  TEST_PAYMENT_IDS,
  payments,
  paymentStatusTransitions,
  TEST_RULESET_ID,
  rules,
  auditLogs,
  leaderboardEntries,
  teamViewPayloads,
  stripeWebhooks
};
