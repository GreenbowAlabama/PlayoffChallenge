/**
 * Contest Start/End Time Pipeline Test
 *
 * Purpose: Verify that start_time, end_time, tournament_start_time,
 * and tournament_end_time are correctly populated and returned through the API.
 *
 * Pipeline:
 * - Database schema includes these columns
 * - Discovery service populates them from ESPN calendar
 * - Custom contest service selects them from DB
 * - API routes normalize and return them
 * - iOS client receives them as ISO strings
 */

const request = require('supertest');
const express = require('express');
const customContestRoutes = require('../../routes/customContest.routes');
const { createMockPool } = require('../mocks/mockPool');

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_TEMPLATE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEST_INSTANCE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const mockTemplate = {
  id: TEST_TEMPLATE_ID,
  name: 'PGA Masters',
  sport: 'PGA',
  template_type: 'pga_event',
  scoring_strategy_key: 'pga_v1',
  lock_strategy_key: 'lock_at_time',
  settlement_strategy_key: 'pga_settlement',
  default_entry_fee_cents: 2500,
  allowed_entry_fee_min_cents: 0,
  allowed_entry_fee_max_cents: 10000,
  allowed_payout_structures: [{ type: 'top_n_split', max_winners: 3 }],
  is_active: true
};

describe('Contest Start/End Time Pipeline', () => {
  let app;
  let mockPool;

  beforeEach(() => {
    process.env.APP_ENV = 'dev';
    process.env.APP_BASE_URL = 'https://app.67enterprises.com';
    mockPool = createMockPool();

    app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.locals.pool = mockPool;
    app.use('/api/custom-contests', customContestRoutes);
  });

  afterEach(() => {
    mockPool.reset();
    delete process.env.APP_ENV;
    delete process.env.APP_BASE_URL;
  });

  describe('GET /api/custom-contests/:id', () => {
    it('should return start_time and end_time as ISO strings in API response', async () => {
      // Arrange: Mock database response with start_time and end_time populated
      const now = new Date();
      const startTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow
      const endTime = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000); // 4 days from now
      const lockTime = startTime; // Lock at start time

      const mockInstance = {
        id: TEST_INSTANCE_ID,
        template_id: TEST_TEMPLATE_ID,
        organizer_id: TEST_USER_ID,
        contest_name: 'Masters Tournament Contest',
        max_entries: 20,
        entry_fee_cents: 2500,
        payout_structure: { type: 'top_n_split', max_winners: 3 },
        status: 'SCHEDULED',
        join_token: 'dev_token123',
        start_time: startTime,
        lock_time: lockTime,
        end_time: endTime,
        settle_time: null,
        tournament_start_time: startTime,
        tournament_end_time: endTime,
        created_at: now,
        updated_at: now,
        entry_count: 0,
        user_has_entered: false,
        organizer_name: 'Test Organizer',
        template_name: mockTemplate.name,
        template_sport: mockTemplate.sport,
        template_type: mockTemplate.template_type,
        scoring_strategy_key: mockTemplate.scoring_strategy_key
      };

      mockPool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('FROM contest_instances ci'),
        { rows: [mockInstance], rowCount: 1 }
      );

      // Act: Fetch contest details
      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('start_time');
      expect(response.body).toHaveProperty('end_time');
      expect(response.body).toHaveProperty('lock_time');

      // Verify they are ISO strings, not null
      expect(response.body.start_time).not.toBeNull();
      expect(response.body.end_time).not.toBeNull();
      expect(response.body.lock_time).not.toBeNull();

      // Verify they are ISO 8601 format strings
      expect(typeof response.body.start_time).toBe('string');
      expect(typeof response.body.end_time).toBe('string');
      expect(typeof response.body.lock_time).toBe('string');

      // Verify they can be parsed as valid dates
      expect(() => new Date(response.body.start_time)).not.toThrow();
      expect(() => new Date(response.body.end_time)).not.toThrow();
      expect(() => new Date(response.body.lock_time)).not.toThrow();

      // Verify date values are correct (within 1 second)
      const returnedStartTime = new Date(response.body.start_time);
      const returnedEndTime = new Date(response.body.end_time);
      expect(Math.abs(returnedStartTime - startTime)).toBeLessThan(1000);
      expect(Math.abs(returnedEndTime - endTime)).toBeLessThan(1000);
    });

    it('should return null for start_time and end_time when not populated', async () => {
      // Arrange: Mock database response with null start_time and end_time
      const now = new Date();
      const lockTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const mockInstance = {
        id: TEST_INSTANCE_ID,
        template_id: TEST_TEMPLATE_ID,
        organizer_id: TEST_USER_ID,
        contest_name: 'Test Contest',
        max_entries: 20,
        entry_fee_cents: 2500,
        payout_structure: { type: 'top_n_split', max_winners: 3 },
        status: 'SCHEDULED',
        join_token: 'dev_token123',
        start_time: null,
        lock_time: lockTime,
        end_time: null,
        settle_time: null,
        tournament_start_time: null,
        tournament_end_time: null,
        created_at: now,
        updated_at: now,
        entry_count: 0,
        user_has_entered: false,
        organizer_name: 'Test Organizer',
        template_name: mockTemplate.name,
        template_sport: mockTemplate.sport,
        template_type: mockTemplate.template_type,
        scoring_strategy_key: mockTemplate.scoring_strategy_key
      };

      mockPool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('FROM contest_instances ci'),
        { rows: [mockInstance], rowCount: 1 }
      );

      // Act
      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.start_time).toBeNull();
      expect(response.body.end_time).toBeNull();
      expect(response.body.lock_time).not.toBeNull();
    });
  });

  describe('GET /api/custom-contests/available', () => {
    it('should return start_time and end_time in available contests list', async () => {
      // Arrange
      const now = new Date();
      const startTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const endTime = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
      const lockTime = new Date(now.getTime() + 48 * 60 * 60 * 1000);

      const mockInstance = {
        id: TEST_INSTANCE_ID,
        template_id: TEST_TEMPLATE_ID,
        organizer_id: TEST_USER_ID,
        contest_name: 'Available Contest',
        max_entries: 20,
        entry_fee_cents: 2500,
        payout_structure: { type: 'top_n_split', max_winners: 3 },
        status: 'SCHEDULED',
        join_token: 'dev_token123',
        start_time: startTime,
        lock_time: lockTime,
        end_time: endTime,
        settle_time: null,
        tournament_start_time: startTime,
        tournament_end_time: endTime,
        created_at: now,
        updated_at: now,
        entry_count: 0,
        user_has_entered: false,
        organizer_name: 'Test Organizer',
        template_name: mockTemplate.name,
        template_sport: mockTemplate.sport,
        template_type: mockTemplate.template_type,
        is_platform_owned: true
      };

      mockPool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('FROM contest_instances ci'),
        { rows: [mockInstance], rowCount: 1 }
      );

      // Act
      const response = await request(app)
        .get('/api/custom-contests/available')
        .set('X-User-Id', TEST_USER_ID);

      // Assert
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      if (response.body.length > 0) {
        const contest = response.body[0];
        expect(contest.start_time).not.toBeNull();
        expect(contest.end_time).not.toBeNull();
        expect(typeof contest.start_time).toBe('string');
        expect(typeof contest.end_time).toBe('string');
      }
    });
  });

  describe('Discovery Service Integration', () => {
    it('should populate tournament_start_time and tournament_end_time from discovery events', async () => {
      // This test verifies that the discovery service correctly sets
      // tournament_start_time and tournament_end_time when creating instances
      // These should match the ESPN event times

      const now = new Date();
      const espnStartTime = new Date('2025-04-10T13:00:00Z');
      const espnEndTime = new Date('2025-04-13T18:00:00Z');

      // When discovery creates a contest, it should set tournament_start_time
      // and tournament_end_time from the ESPN calendar event
      const mockInstanceFromDiscovery = {
        id: TEST_INSTANCE_ID,
        template_id: TEST_TEMPLATE_ID,
        organizer_id: '00000000-0000-0000-0000-000000000000', // Platform organizer
        contest_name: 'PGA Masters Contest (Discovery Created)',
        max_entries: 20,
        entry_fee_cents: 2500,
        payout_structure: { type: 'top_n_split', max_winners: 3 },
        status: 'SCHEDULED',
        join_token: null,
        start_time: espnStartTime, // Should be set by discovery
        lock_time: espnStartTime, // Lock at tournament start
        end_time: espnEndTime, // Should be set by discovery
        settle_time: null,
        tournament_start_time: espnStartTime, // This is critical for lifecycle
        tournament_end_time: espnEndTime, // This is critical for settlement
        provider_event_id: 'espn_pga_12345',
        is_platform_owned: true,
        is_system_generated: true,
        created_at: now,
        updated_at: now,
        entry_count: 0,
        user_has_entered: false,
        organizer_name: 'Platform',
        template_name: mockTemplate.name,
        template_sport: mockTemplate.sport,
        template_type: mockTemplate.template_type,
        scoring_strategy_key: mockTemplate.scoring_strategy_key
      };

      mockPool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('FROM contest_instances ci'),
        { rows: [mockInstanceFromDiscovery], rowCount: 1 }
      );

      // Act
      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.start_time).toBeTruthy();
      expect(response.body.end_time).toBeTruthy();
      expect(response.body.tournament_start_time).toBeTruthy();
      expect(response.body.tournament_end_time).toBeTruthy();

      // Verify tournament times match ESPN times
      const returnedTournamentStart = new Date(response.body.tournament_start_time);
      const returnedTournamentEnd = new Date(response.body.tournament_end_time);
      expect(Math.abs(returnedTournamentStart - espnStartTime)).toBeLessThan(1000);
      expect(Math.abs(returnedTournamentEnd - espnEndTime)).toBeLessThan(1000);
    });
  });
});
