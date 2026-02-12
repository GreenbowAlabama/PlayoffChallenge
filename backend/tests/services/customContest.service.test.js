/**
 * Custom Contest Service Unit Tests
 *
 * Purpose: Test contest instance lifecycle in isolation
 * - Template lookup and validation
 * - Contest instance creation with template constraints
 * - Join token generation and validation
 * - Status transitions
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const customContestService = require('../../services/customContestService');

// Test fixtures
const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_TEMPLATE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEST_INSTANCE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const mockTemplate = {
  id: TEST_TEMPLATE_ID,
  name: 'NFL Playoff Challenge',
  sport: 'NFL',
  template_type: 'playoff_challenge',
  scoring_strategy_key: 'ppr',
  lock_strategy_key: 'first_game_kickoff',
  settlement_strategy_key: 'final_standings',
  default_entry_fee_cents: 2500,
  allowed_entry_fee_min_cents: 0,
  allowed_entry_fee_max_cents: 10000,
  allowed_payout_structures: [
    { first: 70, second: 20, third: 10 },
    { first: 100 }
  ],
  is_active: true,
  created_at: new Date(),
  updated_at: new Date()
};

const mockInstance = {
  id: TEST_INSTANCE_ID,
  template_id: TEST_TEMPLATE_ID,
  organizer_id: TEST_USER_ID,
  contest_name: 'Test Contest',
  max_entries: 20,
  entry_fee_cents: 2500,
  payout_structure: { first: 70, second: 20, third: 10 },
  status: 'SCHEDULED',
  join_token: null,
  start_time: null,
  lock_time: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour from now (required for SCHEDULED)
  settle_time: null,
  created_at: new Date(),
  updated_at: new Date()
};

describe('Custom Contest Service Unit Tests', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
    process.env.APP_ENV = 'dev';
    process.env.JOIN_BASE_URL = 'https://test.example.com';
  });

  afterEach(() => {
    mockPool.reset();
    delete process.env.APP_ENV;
    delete process.env.JOIN_BASE_URL;
  });

  describe('Token Functions', () => {
    describe('generateJoinToken', () => {
      it('should generate a token with environment prefix', () => {
        const token = customContestService.generateJoinToken();
        expect(token).toMatch(/^dev_[a-f0-9]{32}$/);
      });

      it('should respect APP_ENV setting', () => {
        process.env.APP_ENV = 'prd';
        const token = customContestService.generateJoinToken();
        expect(token).toMatch(/^prd_[a-f0-9]{32}$/);
      });

      it('should throw for invalid APP_ENV (no silent fallback)', () => {
        process.env.APP_ENV = 'invalid';
        expect(() => customContestService.generateJoinToken()).toThrow('Invalid APP_ENV: "invalid"');
      });
    });

    describe('validateJoinToken', () => {
      it('should accept valid token for current environment', () => {
        const token = 'dev_abc123def456abc123def456abc123';
        const result = customContestService.validateJoinToken(token);
        expect(result.valid).toBe(true);
        expect(result.tokenId).toBe('abc123def456abc123def456abc123');
      });

      it('should reject token from different environment', () => {
        process.env.APP_ENV = 'dev';
        const token = 'prd_abc123def456abc123def456abc123';
        const result = customContestService.validateJoinToken(token);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Environment mismatch');
      });

      it('should reject malformed token without prefix', () => {
        const token = 'notokenprefix';
        const result = customContestService.validateJoinToken(token);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('missing environment prefix');
      });

      it('should reject token with unknown environment', () => {
        const token = 'unknown_abc123';
        const result = customContestService.validateJoinToken(token);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('unknown environment prefix');
      });

      it('should reject null/undefined token', () => {
        expect(customContestService.validateJoinToken(null).valid).toBe(false);
        expect(customContestService.validateJoinToken(undefined).valid).toBe(false);
        expect(customContestService.validateJoinToken('').valid).toBe(false);
      });
    });
  });

  describe('Template Functions', () => {
    describe('getTemplate', () => {
      it('should return template if found and active', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_templates WHERE id/,
          mockQueryResponses.single(mockTemplate)
        );

        const template = await customContestService.getTemplate(mockPool, TEST_TEMPLATE_ID);
        expect(template).toBeDefined();
        expect(template.id).toBe(TEST_TEMPLATE_ID);
        expect(template.is_active).toBe(true);
      });

      it('should return null if template not found', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_templates WHERE id/,
          mockQueryResponses.empty()
        );

        const template = await customContestService.getTemplate(mockPool, 'nonexistent-id');
        expect(template).toBeNull();
      });
    });

    describe('listActiveTemplates', () => {
      it('should return all active templates', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_templates WHERE is_active/,
          mockQueryResponses.multiple([mockTemplate, { ...mockTemplate, id: 'template-2', name: 'March Madness' }])
        );

        const templates = await customContestService.listActiveTemplates(mockPool);
        expect(templates).toHaveLength(2);
      });
    });
  });

  describe('Validation Functions', () => {
    describe('validateEntryFeeAgainstTemplate', () => {
      it('should accept fee within range', () => {
        expect(() => {
          customContestService.validateEntryFeeAgainstTemplate(2500, mockTemplate);
        }).not.toThrow();
      });

      it('should accept zero fee if minimum is zero', () => {
        expect(() => {
          customContestService.validateEntryFeeAgainstTemplate(0, mockTemplate);
        }).not.toThrow();
      });

      it('should reject fee below minimum', () => {
        const strictTemplate = { ...mockTemplate, allowed_entry_fee_min_cents: 1000 };
        expect(() => {
          customContestService.validateEntryFeeAgainstTemplate(500, strictTemplate);
        }).toThrow('entry_fee_cents must be at least 1000');
      });

      it('should reject fee above maximum', () => {
        expect(() => {
          customContestService.validateEntryFeeAgainstTemplate(20000, mockTemplate);
        }).toThrow('entry_fee_cents must be at most 10000');
      });

      it('should reject non-integer fee', () => {
        expect(() => {
          customContestService.validateEntryFeeAgainstTemplate(25.50, mockTemplate);
        }).toThrow('entry_fee_cents must be an integer');
      });

      it('should reject negative fee', () => {
        expect(() => {
          customContestService.validateEntryFeeAgainstTemplate(-100, mockTemplate);
        }).toThrow('entry_fee_cents must be a non-negative integer');
      });
    });

    describe('validatePayoutStructureAgainstTemplate', () => {
      it('should accept payout structure that matches allowed', () => {
        expect(() => {
          customContestService.validatePayoutStructureAgainstTemplate(
            { first: 70, second: 20, third: 10 },
            mockTemplate
          );
        }).not.toThrow();
      });

      it('should accept winner-take-all if allowed', () => {
        expect(() => {
          customContestService.validatePayoutStructureAgainstTemplate(
            { first: 100 },
            mockTemplate
          );
        }).not.toThrow();
      });

      it('should reject payout structure not in allowed list', () => {
        expect(() => {
          customContestService.validatePayoutStructureAgainstTemplate(
            { first: 50, second: 50 },
            mockTemplate
          );
        }).toThrow('payout_structure must match one of the allowed structures');
      });

      it('should reject null payout structure', () => {
        expect(() => {
          customContestService.validatePayoutStructureAgainstTemplate(null, mockTemplate);
        }).toThrow('payout_structure is required');
      });

      it('should reject if template has no allowed structures', () => {
        const badTemplate = { ...mockTemplate, allowed_payout_structures: null };
        expect(() => {
          customContestService.validatePayoutStructureAgainstTemplate(
            { first: 100 },
            badTemplate
          );
        }).toThrow('Template has no allowed payout structures defined');
      });
    });
  });

  describe('Contest Instance Lifecycle', () => {
    describe('createContestInstance', () => {
      beforeEach(() => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_templates WHERE id/,
          mockQueryResponses.single(mockTemplate)
        );
      });

      it('should create instance with valid input (no join_token until publish)', async () => {
        // Draft instances have no join_token - it's set at publish time
        const draftInstance = { ...mockInstance, join_token: null };
        mockPool.setQueryResponse(
          /INSERT INTO contest_instances/,
          mockQueryResponses.single(draftInstance)
        );

        const instance = await customContestService.createContestInstance(mockPool, TEST_USER_ID, {
          template_id: TEST_TEMPLATE_ID,
          contest_name: 'Test Contest',
          entry_fee_cents: 2500,
          payout_structure: { first: 70, second: 20, third: 10 }
        });

        expect(instance).toBeDefined();
        expect(instance.id).toBe(TEST_INSTANCE_ID);
        expect(instance.status).toBe('SCHEDULED');
        // join_token and join_url are only set at publish time, not creation
        expect(instance.join_token).toBeNull();
      });

      it('should reject missing template_id', async () => {
        await expect(
          customContestService.createContestInstance(mockPool, TEST_USER_ID, {
            entry_fee_cents: 2500,
            payout_structure: { first: 100 }
          })
        ).rejects.toThrow('template_id is required');
      });

      it('should reject missing entry_fee_cents', async () => {
        await expect(
          customContestService.createContestInstance(mockPool, TEST_USER_ID, {
            template_id: TEST_TEMPLATE_ID,
            payout_structure: { first: 100 }
          })
        ).rejects.toThrow('entry_fee_cents is required');
      });

      it('should reject missing payout_structure', async () => {
        await expect(
          customContestService.createContestInstance(mockPool, TEST_USER_ID, {
            template_id: TEST_TEMPLATE_ID,
            entry_fee_cents: 2500
          })
        ).rejects.toThrow('payout_structure is required');
      });

      it('should reject if template not found', async () => {
        // Override the beforeEach mock to return empty
        mockPool.reset();
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_templates WHERE id/,
          mockQueryResponses.empty()
        );

        await expect(
          customContestService.createContestInstance(mockPool, TEST_USER_ID, {
            template_id: 'nonexistent',
            entry_fee_cents: 2500,
            payout_structure: { first: 100 }
          })
        ).rejects.toThrow('Template not found or inactive');
      });

      it('should reject entry fee outside template range', async () => {
        await expect(
          customContestService.createContestInstance(mockPool, TEST_USER_ID, {
            template_id: TEST_TEMPLATE_ID,
            entry_fee_cents: 50000,
            payout_structure: { first: 100 }
          })
        ).rejects.toThrow('entry_fee_cents must be at most 10000');
      });

      it('should reject invalid payout structure', async () => {
        await expect(
          customContestService.createContestInstance(mockPool, TEST_USER_ID, {
            template_id: TEST_TEMPLATE_ID,
            entry_fee_cents: 2500,
            payout_structure: { first: 50, second: 50 }
          })
        ).rejects.toThrow('payout_structure must match one of the allowed structures');
      });
    });

    describe('getContestInstance', () => {
      it('should return mapped instance with derived fields for SCHEDULED contest (not joined)', async () => {
        const mockDbRow = {
          ...mockInstance,
          status: 'SCHEDULED',
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour from now
          settle_time: null,
          entry_count: 5, // from DB query
          user_has_entered: false, // from DB query
          organizer_name: 'Test Organizer'
        };

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(mockDbRow)
        );
        mockPool.setQueryResponse( // For advanceContestLifecycleIfNeeded - status check
          /SELECT status FROM contest_instances WHERE id = \$1/, // Mock the minimal query needed by advanceContestLifecycleIfNeeded
          mockQueryResponses.single({ status: mockDbRow.status })
        );

        const instance = await customContestService.getContestInstance(mockPool, TEST_INSTANCE_ID, 'some-other-user-id');

        expect(instance).toBeDefined();
        expect(instance.id).toBe(mockDbRow.id);
        expect(instance.contest_name).toBe(mockDbRow.contest_name);
        expect(instance.entry_fee_cents).toBe(mockDbRow.entry_fee_cents);

        // Derived fields
        expect(instance.status).toBe('SCHEDULED');
        expect(instance.is_locked).toBe(false);
        expect(instance.is_live).toBe(false);
        expect(instance.is_settled).toBe(false);
        expect(instance.entry_count).toBe(5);
        expect(instance.user_has_entered).toBe(false);
        expect(instance.time_until_lock).toBeGreaterThanOrEqual(3599); // allow for slight time variance
        expect(instance.time_until_lock).toBeLessThanOrEqual(3601);
        expect('standings' in instance).toBe(false); // Should be omitted

        // Fields no longer returned by this service call directly (removed from SELECT)
        expect(instance).not.toHaveProperty('template_name');
        expect(instance).not.toHaveProperty('template_sport');
        expect(instance).not.toHaveProperty('computedJoinState');
      });

      it('should return mapped instance with derived fields for LIVE contest (joined)', async () => {
        const MOCK_LIVE_STANDINGS = [{ user_id: TEST_USER_ID, user_display_name: 'TestUser', total_score: 100, rank: 1 }];
        const mockDbRow = {
          ...mockInstance,
          status: 'LIVE',
          lock_time: new Date(Date.now() - 3600 * 1000).toISOString(), // 1 hour ago
          settle_time: null,
          entry_count: 15,
          user_has_entered: true,
          organizer_name: 'Test Organizer'
        };

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(mockDbRow)
        );
        mockPool.setQueryResponse( // For advanceContestLifecycleIfNeeded - status check
          /SELECT status FROM contest_instances WHERE id = \$1/,
          mockQueryResponses.single({ status: mockDbRow.status })
        );
        // Mock _getLiveStandings
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_participants cp[\s\S]*LEFT JOIN picks p[\s\S]*LEFT JOIN scores s[\s\S]*LEFT JOIN users u[\s\S]*WHERE cp\.contest_instance_id = \$1/,
          mockQueryResponses.multiple(MOCK_LIVE_STANDINGS) // Expect this to be called
        );

        const instance = await customContestService.getContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);

        expect(instance).toBeDefined();
        expect(instance.status).toBe('LIVE');
        expect(instance.is_locked).toBe(true);
        expect(instance.is_live).toBe(true);
        expect(instance.is_settled).toBe(false);
        expect(instance.entry_count).toBe(15);
        expect(instance.user_has_entered).toBe(true);
        expect(instance.time_until_lock).toBeNull();
        expect(instance.standings).toEqual(MOCK_LIVE_STANDINGS);
      });

      it('should return mapped instance with derived fields for COMPLETE contest', async () => {
        const MOCK_COMPLETE_STANDINGS = [{ user_id: TEST_USER_ID, user_display_name: 'TestUser', total_score: 100, rank: 1 }];
        const mockDbRow = {
          ...mockInstance,
          status: 'COMPLETE',
          lock_time: new Date(Date.now() - 3600 * 1000).toISOString(),
          settle_time: new Date(Date.now() - 1000).toISOString(), // Just settled
          entry_count: 15,
          user_has_entered: false,
          organizer_name: 'Test Organizer',
          standings: MOCK_COMPLETE_STANDINGS // Include standings for COMPLETE status
        };

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(mockDbRow)
        );
        mockPool.setQueryResponse( // For advanceContestLifecycleIfNeeded - status check
          /SELECT status FROM contest_instances WHERE id = \$1/,
          mockQueryResponses.single({ status: mockDbRow.status })
        );
        // Mock _getCompleteStandings
        mockPool.setQueryResponse(
          /SELECT results FROM settlement_records WHERE contest_instance_id = \$1/,
          mockQueryResponses.single({
            results: { rankings: [{ user_id: TEST_USER_ID, score: 100, rank: 1 }], payouts: [] }
          })
        );
        mockPool.setQueryResponse( // For _getCompleteStandings user lookup
          /SELECT id, COALESCE\(username, name, 'Unknown'\) AS user_display_name FROM users WHERE id = ANY\(\$1::uuid\[\]\)/,
          mockQueryResponses.multiple([{ id: TEST_USER_ID, user_display_name: 'TestUser' }])
        );

        const instance = await customContestService.getContestInstance(mockPool, TEST_INSTANCE_ID, 'some-other-user-id');

        expect(instance).toBeDefined();
        expect(instance.status).toBe('COMPLETE');
        expect(instance.is_locked).toBe(true);
        expect(instance.is_live).toBe(false);
        expect(instance.is_settled).toBe(true);
        expect(instance.entry_count).toBe(15);
        expect(instance.user_has_entered).toBe(false);
        expect(instance.time_until_lock).toBeNull();
        expect(instance.standings).toEqual(MOCK_COMPLETE_STANDINGS);
      });

      it('should return null if not found', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.empty()
        );

        const instance = await customContestService.getContestInstance(mockPool, 'nonexistent');
        expect(instance).toBeNull();
      });
    });

    describe('getContestInstanceByToken', () => {
      it('should return mapped instance with derived fields for valid token', async () => {
        const token = 'dev_abc123def456abc123def456abc123';
        const mockDbRow = {
          ...mockInstance,
          join_token: token,
          status: 'SCHEDULED',
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour from now
          settle_time: null,
          entry_count: 5,
          user_has_entered: false,
          organizer_name: 'Test Organizer'
        };

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.join_token/,
          mockQueryResponses.single(mockDbRow)
        );

        const instance = await customContestService.getContestInstanceByToken(mockPool, token);
        expect(instance).toBeDefined();
        expect(instance.id).toBe(mockDbRow.id);
        expect(instance.join_token).toBe(token);

        // Derived fields
        expect(instance.status).toBe('SCHEDULED');
        expect(instance.is_locked).toBe(false);
        expect(instance.is_live).toBe(false);
        expect(instance.is_settled).toBe(false);
        expect(instance.entry_count).toBe(5);
        expect(instance.user_has_entered).toBe(false);
        expect(instance.time_until_lock).toBeGreaterThanOrEqual(3599);
        expect(instance.time_until_lock).toBeLessThanOrEqual(3601);

        // Fields no longer returned by this service call directly (removed from SELECT)
        expect(instance).not.toHaveProperty('template_name');
        expect(instance).not.toHaveProperty('template_sport');
        expect(instance).not.toHaveProperty('computedJoinState');
      });

      it('should return null for environment mismatch', async () => {
        const instance = await customContestService.getContestInstanceByToken(mockPool, 'prd_abc123');
        expect(instance).toBeNull();
      });

      it('should return null if not found', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.join_token/,
          mockQueryResponses.empty()
        );

        const instance = await customContestService.getContestInstanceByToken(mockPool, 'dev_notfound123');
        expect(instance).toBeNull();
      });
    });

    describe('getContestInstancesForOrganizer', () => {
      it('should return all instances for organizer', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.organizer_id/,
          mockQueryResponses.multiple([
            { ...mockInstance, entry_count: 5, user_has_entered: false, organizer_name: 'Test Organizer' },
            { ...mockInstance, id: 'instance-2', status: 'SCHEDULED', entry_count: 10, user_has_entered: false, organizer_name: 'Test Organizer' }
          ])
        );

        const instances = await customContestService.getContestInstancesForOrganizer(mockPool, TEST_USER_ID);
        expect(instances).toHaveLength(2);
        expect(instances[0].status).toBeDefined();
        expect(instances[0].entry_count).toBeGreaterThanOrEqual(0);
      });

      it('should return empty array if no instances', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.organizer_id/,
          mockQueryResponses.empty()
        );

        const instances = await customContestService.getContestInstancesForOrganizer(mockPool, TEST_USER_ID);
        expect(instances).toEqual([]);
      });
    });
  });

  describe('Status Transitions', () => {
    describe('updateContestInstanceStatus', () => {
      it('should allow SCHEDULED -> LOCKED transition', async () => {
        const mockDbRow = {
          ...mockInstance,
          status: 'SCHEDULED',
          entry_count: 5,
          user_has_entered: false,
          organizer_name: 'Test Organizer'
        };
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(mockDbRow)
        );
        mockPool.setQueryResponse(
          /SELECT status FROM contest_instances WHERE id = \$1/,
          mockQueryResponses.single({ status: 'SCHEDULED' })
        );
        mockPool.setQueryResponse(
          /UPDATE contest_instances SET status/,
          mockQueryResponses.single({ ...mockInstance, status: 'LOCKED' })
        );

        const result = await customContestService.updateContestInstanceStatus(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'LOCKED'
        );
        expect(result.status).toBe('LOCKED');
      });

      it('should allow SCHEDULED -> CANCELLED transition', async () => {
        const mockDbRow = {
          ...mockInstance,
          status: 'SCHEDULED',
          entry_count: 5,
          user_has_entered: false,
          organizer_name: 'Test Organizer'
        };
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(mockDbRow)
        );
        mockPool.setQueryResponse(
          /SELECT status FROM contest_instances WHERE id = \$1/,
          mockQueryResponses.single({ status: 'SCHEDULED' })
        );
        mockPool.setQueryResponse(
          /UPDATE contest_instances SET status/,
          mockQueryResponses.single({ ...mockInstance, status: 'CANCELLED' })
        );

        const result = await customContestService.updateContestInstanceStatus(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'CANCELLED'
        );
        expect(result.status).toBe('CANCELLED');
      });

      it('should reject invalid status', async () => {
        await expect(
          customContestService.updateContestInstanceStatus(
            mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'invalid_status'
          )
        ).rejects.toThrow('Invalid status: invalid_status');
      });

      it('should reject if not organizer', async () => {
        const mockDbRow = {
          ...mockInstance,
          status: 'SCHEDULED',
          organizer_id: 'different-user',
          entry_count: 5,
          user_has_entered: false,
          organizer_name: 'Different User'
        };
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(mockDbRow)
        );

        await expect(
          customContestService.updateContestInstanceStatus(
            mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'LOCKED'
          )
        ).rejects.toThrow('Only the organizer can update contest status');
      });

      it('should reject if instance not found', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.empty()
        );

        await expect(
          customContestService.updateContestInstanceStatus(
            mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'LOCKED'
          )
        ).rejects.toThrow('Contest instance not found');
      });

      it('should reject invalid transition SCHEDULED -> COMPLETE', async () => {
        const mockDbRow = {
          ...mockInstance,
          status: 'SCHEDULED',
          entry_count: 5,
          user_has_entered: false,
          organizer_name: 'Test Organizer'
        };
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(mockDbRow)
        );

        await expect(
          customContestService.updateContestInstanceStatus(
            mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'COMPLETE'
          )
        ).rejects.toThrow("Cannot transition from 'SCHEDULED' to 'COMPLETE'");
      });

      it('should reject transition from COMPLETE', async () => {
        const mockDbRow = {
          ...mockInstance,
          status: 'COMPLETE',
          entry_count: 5,
          user_has_entered: false,
          organizer_name: 'Test Organizer'
        };
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(mockDbRow)
        );
        mockPool.setQueryResponse(
          /SELECT results FROM settlement_records WHERE contest_instance_id = \$1/,
          mockQueryResponses.single({
            results: { rankings: [], payouts: [] }
          })
        );

        await expect(
          customContestService.updateContestInstanceStatus(
            mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'SCHEDULED'
          )
        ).rejects.toThrow("Cannot transition from 'COMPLETE' to 'SCHEDULED'");
      });

      it('should reject transition from CANCELLED', async () => {
        const mockDbRow = {
          ...mockInstance,
          status: 'CANCELLED',
          entry_count: 5,
          user_has_entered: false,
          organizer_name: 'Test Organizer'
        };
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(mockDbRow)
        );

        await expect(
          customContestService.updateContestInstanceStatus(
            mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'SCHEDULED'
          )
        ).rejects.toThrow("Cannot transition from 'CANCELLED' to 'SCHEDULED'");
      });
    });

    describe('publishContestInstance', () => {
      it('should publish SCHEDULED contest successfully with join_url', async () => {
        const mockDbRow = {
          ...mockInstance,
          status: 'SCHEDULED',
          join_token: null,
          entry_count: 0,
          user_has_entered: false,
          organizer_name: 'Test Organizer'
        };
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(mockDbRow)
        );
        mockPool.setQueryResponse(
          /UPDATE contest_instances/,
          mockQueryResponses.single({ ...mockInstance, status: 'SCHEDULED', join_token: 'dev_mockedtoken123' })
        );
        mockPool.setQueryResponse(
          /INSERT INTO contest_participants/,
          mockQueryResponses.single({})
        );

        const result = await customContestService.publishContestInstance(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID
        );
        expect(result.status).toBe('SCHEDULED');
        expect(result.join_token).toBe('dev_mockedtoken123');
        expect(result.join_url).toBeDefined();
        expect(result.join_url).toContain('/join/');
        expect(result.join_url).toContain(result.join_token);
      });

      it('should be idempotent: return existing data with join_url if already published', async () => {
        const scheduledInstance = {
          ...mockInstance,
          status: 'SCHEDULED',
          join_token: 'dev_originaltoken1234567890123',
          updated_at: new Date('2025-01-15T10:00:00Z'),
          entry_count: 5,
          user_has_entered: false,
          organizer_name: 'Test Organizer'
        };

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(scheduledInstance)
        );

        const result = await customContestService.publishContestInstance(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID
        );

        // Should return existing data with join_url
        expect(result.status).toBe('SCHEDULED');
        expect(result.join_token).toBe('dev_originaltoken1234567890123');
        expect(result.updated_at).toEqual(scheduledInstance.updated_at);
        expect(result.join_url).toBeDefined();
        expect(result.join_url).toContain('/join/dev_originaltoken1234567890123');

        // Verify no UPDATE query was made
        const queries = mockPool.getQueryHistory();
        const updateQueries = queries.filter(q => q.sql.includes('UPDATE'));
        expect(updateQueries).toHaveLength(0);
      });

      it('should not regenerate join_token on double publish', async () => {
        const originalToken = 'dev_originaltoken1234567890123';
        const scheduledInstance = {
          ...mockInstance,
          status: 'SCHEDULED',
          join_token: originalToken,
          entry_count: 5,
          user_has_entered: false,
          organizer_name: 'Test Organizer'
        };

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(scheduledInstance)
        );

        // First "publish" call (contest is already published)
        const result1 = await customContestService.publishContestInstance(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID
        );
        expect(result1.join_token).toBe(originalToken);

        // Second "publish" call (still idempotent)
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(scheduledInstance)
        );
        const result2 = await customContestService.publishContestInstance(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID
        );
        expect(result2.join_token).toBe(originalToken);
      });

      it('should generate join_token if SCHEDULED has none', async () => {
        const scheduledWithoutToken = {
          ...mockInstance,
          status: 'SCHEDULED',
          join_token: null,
          entry_count: 0,
          user_has_entered: false,
          organizer_name: 'Test Organizer'
        };

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(scheduledWithoutToken)
        );
        mockPool.setQueryResponse(
          /UPDATE contest_instances/,
          mockQueryResponses.single({ ...mockInstance, status: 'SCHEDULED', join_token: 'dev_newgeneratedtoken12345678' })
        );
        mockPool.setQueryResponse(
          /INSERT INTO contest_participants/,
          mockQueryResponses.single({})
        );

        const result = await customContestService.publishContestInstance(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID
        );
        expect(result.status).toBe('SCHEDULED');
        expect(result.join_token).toBeTruthy();
      });

      it('should reject if not organizer', async () => {
        const mockDbRow = {
          ...mockInstance,
          status: 'SCHEDULED',
          organizer_id: 'different-user-id',
          entry_count: 0,
          user_has_entered: false,
          organizer_name: 'Different User'
        };
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(mockDbRow)
        );

        await expect(
          customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID)
        ).rejects.toThrow('Only the organizer can publish contest');
      });

      it('should reject if contest not found', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.empty()
        );

        await expect(
          customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID)
        ).rejects.toThrow('Contest instance not found');
      });

      it('should reject publishing CANCELLED contest', async () => {
        const mockDbRow = {
          ...mockInstance,
          status: 'CANCELLED',
          entry_count: 0,
          user_has_entered: false,
          organizer_name: 'Test Organizer'
        };
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(mockDbRow)
        );

        await expect(
          customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID)
        ).rejects.toThrow("Only 'SCHEDULED' contests can be published");
      });

      it('should reject publishing LOCKED contest', async () => {
        const mockDbRow = {
          ...mockInstance,
          status: 'LOCKED',
          entry_count: 0,
          user_has_entered: false,
          organizer_name: 'Test Organizer'
        };
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(mockDbRow)
        );

        await expect(
          customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID)
        ).rejects.toThrow("Only 'SCHEDULED' contests can be published");
      });

      it('should reject publishing COMPLETE contest', async () => {
        const mockDbRow = {
          ...mockInstance,
          status: 'COMPLETE',
          entry_count: 0,
          user_has_entered: false,
          organizer_name: 'Test Organizer'
        };
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(mockDbRow)
        );
        mockPool.setQueryResponse(
          /SELECT results FROM settlement_records WHERE contest_instance_id = \$1/,
          mockQueryResponses.single({
            results: { rankings: [], payouts: [] }
          })
        );

        await expect(
          customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID)
        ).rejects.toThrow("Only 'SCHEDULED' contests can be published");
      });

      it('should handle race condition when contest modified between fetch and update', async () => {
        const mockDbRow = {
          ...mockInstance,
          status: 'SCHEDULED',
          join_token: null,
          entry_count: 0,
          user_has_entered: false,
          organizer_name: 'Test Organizer'
        };
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
          mockQueryResponses.single(mockDbRow)
        );
        // Simulate race: UPDATE returns no rows (contest was modified/deleted)
        mockPool.setQueryResponse(
          /UPDATE contest_instances/,
          mockQueryResponses.empty()
        );

        await expect(
          customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID)
        ).rejects.toThrow('Contest was modified by another operation');
      });
    });
  });

  describe('resolveJoinToken', () => {
    // Enriched mock for resolveJoinToken (includes organizer_name, entries_current, template fields)
    const resolveTokenQueryPattern = /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.join_token/;

          it('should return valid contest info with enriched fields for valid token', async () => {
          const token = 'dev_abc123def456abc123def456abc123';
          const enrichedInstance = {
            ...mockInstance,
            join_token: token,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600 * 1000).toISOString(),
            organizer_name: 'TestOrganizer',
            entry_count: 3,
            user_has_entered: false,
            max_entries: 10
          };
      mockPool.setQueryResponse(
        resolveTokenQueryPattern,
        mockQueryResponses.single(enrichedInstance)
      );
      mockPool.setQueryResponse( // For advanceContestLifecycleIfNeeded - status check
        /SELECT status FROM contest_instances WHERE id = \$1/,
        mockQueryResponses.single({ status: enrichedInstance.status })
      );

      const result = await customContestService.resolveJoinToken(mockPool, token);
      expect(result.valid).toBe(true);
      expect(result.contest).toBeDefined();
      expect(result.contest.id).toBe(TEST_INSTANCE_ID);

      expect(result.contest.join_url).toContain('/join/');
      expect(result.contest.join_url).toContain(token);
      // Derived fields from mapper
      expect(result.contest.entry_count).toBe(3);
      expect(result.contest.max_entries).toBe(10);
    });

    it('should return CONTEST_ENV_MISMATCH for environment mismatch', async () => {
      const result = await customContestService.resolveJoinToken(mockPool, 'prd_abc123');
      expect(result.valid).toBe(false);
      expect(result.environment_mismatch).toBe(true);
      expect(result.token_environment).toBe('prd');
      expect(result.current_environment).toBe('dev');
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_ENV_MISMATCH);
    });

    it('should return CONTEST_UNAVAILABLE for malformed token', async () => {
      const result = await customContestService.resolveJoinToken(mockPool, 'notavalidtoken');
      expect(result.valid).toBe(false);
      expect(result.environment_mismatch).toBe(false);
      expect(result.reason).toContain('missing environment prefix');
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_UNAVAILABLE);
    });

    it('should return CONTEST_NOT_FOUND if contest not found', async () => {
      mockPool.setQueryResponse(
        resolveTokenQueryPattern,
        mockQueryResponses.empty()
      );

      const result = await customContestService.resolveJoinToken(mockPool, 'dev_notfound123456');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Contest not found');
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_NOT_FOUND);
    });

    it('should return CONTEST_UNAVAILABLE for CANCELLED contest (not EXPIRED_TOKEN)', async () => {
      const token = 'dev_cancelled123456789012345678';
      const cancelledInstance = {
        ...mockInstance,
        join_token: token,
        status: 'CANCELLED',
        entry_count: 2,
        user_has_entered: false,
        organizer_name: 'TestOrganizer'
      };

      mockPool.setQueryResponse(
        resolveTokenQueryPattern,
        mockQueryResponses.single(cancelledInstance)
      );
      mockPool.setQueryResponse( // For advanceContestLifecycleIfNeeded - status check
        /SELECT status FROM contest_instances WHERE id = \$1/,
        mockQueryResponses.single({ status: cancelledInstance.status })
      );

      const result = await customContestService.resolveJoinToken(mockPool, token);
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_UNAVAILABLE);

    });

    it('should return CONTEST_COMPLETED for COMPLETE contest (not EXPIRED_TOKEN)', async () => {
      const token = 'dev_settled12345678901234567890';
      const MOCK_STANDINGS = [{ user_id: TEST_USER_ID, user_display_name: 'TestUser', total_score: 100, rank: 1 }];
      const completedInstance = {
        ...mockInstance,
        join_token: token,
        status: 'COMPLETE',
        settle_time: new Date(Date.now() - 1000).toISOString(),
        entry_count: 8,
        user_has_entered: false,
        organizer_name: 'TestOrganizer',
        standings: MOCK_STANDINGS // Required by mapper for COMPLETE status
      };

      mockPool.setQueryResponse(
        resolveTokenQueryPattern,
        mockQueryResponses.single(completedInstance)
      );
      mockPool.setQueryResponse( // For advanceContestLifecycleIfNeeded - status check
        /SELECT status FROM contest_instances WHERE id = \$1/,
        mockQueryResponses.single({ status: completedInstance.status })
      );
      // Mock _getCompleteStandings
      mockPool.setQueryResponse(
        /SELECT results FROM settlement_records WHERE contest_instance_id = \$1/,
        mockQueryResponses.single({
          results: { rankings: [{ user_id: TEST_USER_ID, score: 100, rank: 1 }], payouts: [] }
        })
      );
      mockPool.setQueryResponse( // For _getCompleteStandings user lookup
        /SELECT id, COALESCE\(username, name, 'Unknown'\) AS user_display_name FROM users WHERE id = ANY\(\$1::uuid\[\]\)/,
        mockQueryResponses.multiple([{ id: TEST_USER_ID, user_display_name: 'TestUser' }])
      );

      const result = await customContestService.resolveJoinToken(mockPool, token);
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_COMPLETED);
      expect(result.reason).toContain('settled');
    });

    it('should return CONTEST_LOCKED for locked contest', async () => {
      const token = 'dev_locked12345678901234567890';
      const lockedInstance = {
        ...mockInstance,
        join_token: token,
        status: 'LOCKED',
        lock_time: new Date().toISOString(),
        entry_count: 5,
        user_has_entered: false,
        organizer_name: 'TestOrganizer'
      };

      mockPool.setQueryResponse(
        resolveTokenQueryPattern,
        mockQueryResponses.single(lockedInstance)
      );
      mockPool.setQueryResponse( // For advanceContestLifecycleIfNeeded - status check
        /SELECT status FROM contest_instances WHERE id = \$1/,
        mockQueryResponses.single({ status: lockedInstance.status })
      );

      const result = await customContestService.resolveJoinToken(mockPool, token);
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_LOCKED);

    });



    it('should return CONTEST_NOT_FOUND for unknown contest status (fail closed)', async () => {
      const token = 'dev_unknown123456789012345678901';
      const weirdInstance = {
        ...mockInstance,
        join_token: token,
        status: 'some_future_status',
        entry_count: 1,
        user_has_entered: false,
        organizer_name: 'TestOrganizer'
      };

      mockPool.setQueryResponse(
        resolveTokenQueryPattern,
        mockQueryResponses.single(weirdInstance)
      );
      mockPool.setQueryResponse( // For advanceContestLifecycleIfNeeded - status check
        /SELECT status FROM contest_instances WHERE id = \$1/,
        mockQueryResponses.single({ status: weirdInstance.status })
      );

      const result = await customContestService.resolveJoinToken(mockPool, token);
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_NOT_FOUND);
    });

    it('should make zero DB queries for malformed token', async () => {
      mockPool.reset();
      await customContestService.resolveJoinToken(mockPool, 'notavalidtoken');
      const queries = mockPool.getQueryHistory();
      expect(queries).toHaveLength(0);
    });

    it('should make zero DB queries for environment mismatch', async () => {
      mockPool.reset();
      await customContestService.resolveJoinToken(mockPool, 'prd_abc123');
      const queries = mockPool.getQueryHistory();
      expect(queries).toHaveLength(0);
    });

    it('should make zero DB queries for null token', async () => {
      mockPool.reset();
      await customContestService.resolveJoinToken(mockPool, null);
      const queries = mockPool.getQueryHistory();
      expect(queries).toHaveLength(0);
    });

    it('should return correct error codes for all short-circuit paths', async () => {
      // Malformed → CONTEST_UNAVAILABLE
      const malformed = await customContestService.resolveJoinToken(mockPool, 'notokenprefix');
      expect(malformed.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_UNAVAILABLE);

      // Unknown prefix → CONTEST_UNAVAILABLE
      const unknownPrefix = await customContestService.resolveJoinToken(mockPool, 'xyz_abc123');
      expect(unknownPrefix.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_UNAVAILABLE);

      // Env mismatch → CONTEST_ENV_MISMATCH
      const envMismatch = await customContestService.resolveJoinToken(mockPool, 'prd_abc123');
      expect(envMismatch.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_ENV_MISMATCH);
    });
  });

  describe('generateJoinUrl', () => {
    beforeEach(() => {
      process.env.JOIN_BASE_URL = 'https://app.playoffchallenge.com';
    });

    afterEach(() => {
      delete process.env.JOIN_BASE_URL;
    });

    it('should generate full join URL from token', () => {
      const url = customContestService.generateJoinUrl('dev_abc123def456');
      expect(url).toBe('https://app.playoffchallenge.com/join/dev_abc123def456');
    });

    it('should use custom JOIN_BASE_URL', () => {
      process.env.JOIN_BASE_URL = 'https://staging.example.com';
      // Need to re-require to pick up new env var
      jest.resetModules();
      const freshService = require('../../services/customContestService');
      const url = freshService.generateJoinUrl('stg_xyz789');
      expect(url).toBe('https://staging.example.com/join/stg_xyz789');
    });
  });

  describe('JOIN_ERROR_CODES', () => {
    it('should export all expected error codes (two-tier taxonomy)', () => {
      expect(customContestService.JOIN_ERROR_CODES).toBeDefined();
      // State errors
      expect(customContestService.JOIN_ERROR_CODES.CONTEST_LOCKED).toBe('CONTEST_LOCKED');
      expect(customContestService.JOIN_ERROR_CODES.CONTEST_COMPLETED).toBe('CONTEST_COMPLETED');
      expect(customContestService.JOIN_ERROR_CODES.CONTEST_UNAVAILABLE).toBe('CONTEST_UNAVAILABLE');
      expect(customContestService.JOIN_ERROR_CODES.CONTEST_NOT_FOUND).toBe('CONTEST_NOT_FOUND');
      expect(customContestService.JOIN_ERROR_CODES.CONTEST_ENV_MISMATCH).toBe('CONTEST_ENV_MISMATCH');
      // Join-action errors
      expect(customContestService.JOIN_ERROR_CODES.ALREADY_JOINED).toBe('ALREADY_JOINED');
      expect(customContestService.JOIN_ERROR_CODES.CONTEST_FULL).toBe('CONTEST_FULL');
    });

    it('should NOT export removed legacy error codes', () => {
      expect(customContestService.JOIN_ERROR_CODES.EXPIRED_TOKEN).toBeUndefined();
      expect(customContestService.JOIN_ERROR_CODES.INVALID_TOKEN).toBeUndefined();
      expect(customContestService.JOIN_ERROR_CODES.NOT_FOUND).toBeUndefined();
      expect(customContestService.JOIN_ERROR_CODES.NOT_PUBLISHED).toBeUndefined();
      expect(customContestService.JOIN_ERROR_CODES.ENVIRONMENT_MISMATCH).toBeUndefined();
    });
  });

  describe('Database Constraint Handling', () => {
    /**
     * Tests for graceful handling of database constraint violations.
     *
     * Database has CHECK constraint: join_token IS NOT NULL when status != 'draft'
     * Application code should prevent these scenarios, but if they occur,
     * errors should be surfaced clearly.
     */

    it('should propagate database constraint error on publish', async () => {
      const mockDbRow = {
        ...mockInstance,
        status: 'SCHEDULED',
        join_token: null,
        entry_count: 0,
        user_has_entered: false,
        organizer_name: 'Test Organizer'
      };

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single(mockDbRow)
      );
      // Simulate CHECK constraint violation
      mockPool.setQueryResponse(
        /UPDATE contest_instances/,
        mockQueryResponses.error('UNIQUE-ERROR: new row for relation "contest_instances" violates check constraint', '23514')
      );

      await expect(
        customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID)
      ).rejects.toThrow('UNIQUE-ERROR: new row for relation "contest_instances" violates check constraint');
    });

    it('should propagate unique constraint error for duplicate join_token', async () => {
      const mockDbRow = {
        ...mockInstance,
        status: 'SCHEDULED',
        join_token: null,
        entry_count: 0,
        user_has_entered: false,
        organizer_name: 'Test Organizer'
      };

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single(mockDbRow)
      );
      // Simulate unique constraint violation (extremely unlikely but possible)
      mockPool.setQueryResponse(
        /UPDATE contest_instances/,
        mockQueryResponses.error('duplicate key value violates unique constraint "contest_instances_join_token_key"', '23505')
      );

      await expect(
        customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID)
      ).rejects.toThrow('duplicate key value');
    });
  });

  // ==========================================================
  // PARTICIPANT ENFORCEMENT (Step 5)
  // ==========================================================

  describe('joinContest', () => {
    const openInstance = {
      id: TEST_INSTANCE_ID,
      status: 'SCHEDULED',
      join_token: 'dev_some_token',
      max_entries: 10,
    };

    const mockParticipant = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      contest_instance_id: TEST_INSTANCE_ID,
      user_id: TEST_USER_ID,
      joined_at: new Date().toISOString()
    };

    it('should successfully join a SCHEDULED contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(openInstance)
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
        mockQueryResponses.single(mockParticipant)
      );

      const result = await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(result.joined).toBe(true);
      expect(result.participant).toBeDefined();
      expect(result.participant.contest_instance_id).toBe(TEST_INSTANCE_ID);
      expect(result.participant.user_id).toBe(TEST_USER_ID);
    });

    it('should allow join when max_entries is NULL (unlimited capacity)', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openInstance, max_entries: null })
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
        mockQueryResponses.single(mockParticipant)
      );

      const result = await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(result.joined).toBe(true);
    });

    it('should return joined=true when user already participant (pre-check path)', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(openInstance)
      );
      // Pre-check finds user already participant
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_participants[\s\S]*WHERE[\s\S]*contest_instance_id[\s\S]*=[\s\S]*AND[\s\S]*user_id[\s\S]*=/,
        mockQueryResponses.single(mockParticipant)
      );

      const result = await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(result.joined).toBe(true);
      expect(result.participant).toBeDefined();
      expect(result.participant.contest_instance_id).toBe(TEST_INSTANCE_ID);
      expect(result.participant.user_id).toBe(TEST_USER_ID);
    });

    it('should return CONTEST_FULL when capacity CTE returns 0 rows', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openInstance, max_entries: 5 })
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
        mockQueryResponses.empty()
      );

      const result = await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(result.joined).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_FULL);
    });

    it('should return CONTEST_NOT_FOUND when contest does not exist', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.empty()
      );

      const result = await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(result.joined).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_NOT_FOUND);
    });

    it('should return CONTEST_LOCKED for LOCKED contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openInstance, status: 'LOCKED' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
        mockQueryResponses.single({}) // Simulate successful insert to proceed to status check
      );

      const result = await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(result.joined).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_LOCKED);
    });



    it('should return CONTEST_UNAVAILABLE for CANCELLED contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openInstance, status: 'CANCELLED' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
        mockQueryResponses.single({}) // Simulate successful insert to proceed to status check
      );

      const result = await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(result.joined).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_UNAVAILABLE);
    });

    it('should return CONTEST_COMPLETED for COMPLETE contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openInstance, status: 'COMPLETE' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
        mockQueryResponses.single({}) // Simulate successful insert to proceed to status check
      );

      const result = await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(result.joined).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_COMPLETED);
    });

    it('should use a transaction (pool.connect)', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(openInstance)
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
        mockQueryResponses.single(mockParticipant)
      );

      await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(mockPool.connect).toHaveBeenCalled();
    });

    it('should ROLLBACK transaction on unexpected error', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.error('connection lost', 'XX000')
      );

      await expect(
        customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID)
      ).rejects.toThrow();

      const queries = mockPool.getQueryHistory();
      const rollbackQueries = queries.filter(q => q.sql === 'ROLLBACK');
      expect(rollbackQueries.length).toBeGreaterThan(0);
    });
  });

  describe('Organizer auto-join on publish', () => {
    it('should insert organizer as participant when publishing a SCHEDULED contest', async () => {
      const draftInstance = {
        ...mockInstance,
        status: 'SCHEDULED',
        join_token: null,
        entry_count: 0,
        user_has_entered: false,
        organizer_name: 'Test Organizer'
      };
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single(draftInstance)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances/,
        mockQueryResponses.single({ ...mockInstance, status: 'SCHEDULED', join_token: 'dev_generatedtoken12345678901234' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
        mockQueryResponses.single({
          id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          contest_instance_id: TEST_INSTANCE_ID,
          user_id: TEST_USER_ID,
          joined_at: new Date().toISOString()
        })
      );

      await customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);

      const queries = mockPool.getQueryHistory();
      const participantInserts = queries.filter(q =>
        /INSERT[\s\S]*contest_participants/.test(q.sql)
      );
      expect(participantInserts).toHaveLength(1);
    });

    it('should NOT insert participant when publish is idempotent (already published)', async () => {
      const scheduledInstance = {
        ...mockInstance,
        status: 'SCHEDULED',
        join_token: 'dev_originaltoken1234567890123',
        entry_count: 5,
        user_has_entered: false,
        organizer_name: 'Test Organizer'
      };

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single(scheduledInstance)
      );

      await customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);

      const queries = mockPool.getQueryHistory();
      const participantInserts = queries.filter(q =>
        /INSERT[\s\S]*contest_participants/.test(q.sql)
      );
      expect(participantInserts).toHaveLength(0);
    });
  });
});
