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
  status: 'draft',
  join_token: 'dev_abc123def456',
  start_time: null,
  lock_time: null,
  settlement_time: null,
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
        expect(instance.status).toBe('draft');
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
      it('should return instance with template info', async () => {
        const instanceWithTemplate = {
          ...mockInstance,
          template_name: mockTemplate.name,
          template_sport: mockTemplate.sport,
          template_type: mockTemplate.template_type,
          scoring_strategy_key: mockTemplate.scoring_strategy_key,
          lock_strategy_key: mockTemplate.lock_strategy_key,
          settlement_strategy_key: mockTemplate.settlement_strategy_key
        };

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single(instanceWithTemplate)
        );

        const instance = await customContestService.getContestInstance(mockPool, TEST_INSTANCE_ID);
        expect(instance).toBeDefined();
        expect(instance.contest_name).toBe('Test Contest');
        expect(instance.max_entries).toBe(20);
        expect(instance.template_sport).toBe('NFL');
        expect(instance.computedJoinState).toBeDefined();
      });

      it('should return null if not found', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.empty()
        );

        const instance = await customContestService.getContestInstance(mockPool, 'nonexistent');
        expect(instance).toBeNull();
      });
    });

    describe('getContestInstanceByToken', () => {
      it('should return instance for valid token', async () => {
        const token = 'dev_abc123def456abc123def456abc123';
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.join_token/,
          mockQueryResponses.single({ ...mockInstance, join_token: token })
        );

        const instance = await customContestService.getContestInstanceByToken(mockPool, token);
        expect(instance).toBeDefined();
        expect(instance.join_token).toBe(token);
      });

      it('should return null for environment mismatch', async () => {
        const instance = await customContestService.getContestInstanceByToken(mockPool, 'prd_abc123');
        expect(instance).toBeNull();
      });

      it('should return null if not found', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.join_token/,
          mockQueryResponses.empty()
        );

        const instance = await customContestService.getContestInstanceByToken(mockPool, 'dev_notfound123');
        expect(instance).toBeNull();
      });
    });

    describe('getContestInstancesForOrganizer', () => {
      it('should return all instances for organizer', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.organizer_id/,
          mockQueryResponses.multiple([
            mockInstance,
            { ...mockInstance, id: 'instance-2', status: 'open' }
          ])
        );

        const instances = await customContestService.getContestInstancesForOrganizer(mockPool, TEST_USER_ID);
        expect(instances).toHaveLength(2);
        expect(instances[0].computedJoinState).toBeDefined();
        expect(instances[1].computedJoinState).toBeDefined();
      });

      it('should return empty array if no instances', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.organizer_id/,
          mockQueryResponses.empty()
        );

        const instances = await customContestService.getContestInstancesForOrganizer(mockPool, TEST_USER_ID);
        expect(instances).toEqual([]);
      });
    });
  });

  describe('Status Transitions', () => {
    describe('updateContestInstanceStatus', () => {
      const instanceWithTemplate = {
        ...mockInstance,
        template_name: mockTemplate.name,
        template_sport: mockTemplate.sport,
        template_type: mockTemplate.template_type
      };

      it('should allow draft -> open transition', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single({ ...instanceWithTemplate, status: 'draft' })
        );
        mockPool.setQueryResponse(
          /UPDATE contest_instances SET status/,
          mockQueryResponses.single({ ...mockInstance, status: 'open' })
        );

        const result = await customContestService.updateContestInstanceStatus(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'open'
        );
        expect(result.status).toBe('open');
      });

      it('should allow draft -> cancelled transition', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single({ ...instanceWithTemplate, status: 'draft' })
        );
        mockPool.setQueryResponse(
          /UPDATE contest_instances SET status/,
          mockQueryResponses.single({ ...mockInstance, status: 'cancelled' })
        );

        const result = await customContestService.updateContestInstanceStatus(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'cancelled'
        );
        expect(result.status).toBe('cancelled');
      });

      it('should allow open -> locked transition', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single({ ...instanceWithTemplate, status: 'open' })
        );
        mockPool.setQueryResponse(
          /UPDATE contest_instances SET status/,
          mockQueryResponses.single({ ...mockInstance, status: 'locked' })
        );

        const result = await customContestService.updateContestInstanceStatus(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'locked'
        );
        expect(result.status).toBe('locked');
      });

      it('should reject invalid status', async () => {
        await expect(
          customContestService.updateContestInstanceStatus(
            mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'invalid_status'
          )
        ).rejects.toThrow('Invalid status: invalid_status');
      });

      it('should reject if not organizer', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single({ ...instanceWithTemplate, organizer_id: 'different-user' })
        );

        await expect(
          customContestService.updateContestInstanceStatus(
            mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'open'
          )
        ).rejects.toThrow('Only the organizer can update contest status');
      });

      it('should reject if instance not found', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.empty()
        );

        await expect(
          customContestService.updateContestInstanceStatus(
            mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'open'
          )
        ).rejects.toThrow('Contest instance not found');
      });

      it('should reject invalid transition draft -> locked', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single({ ...instanceWithTemplate, status: 'draft' })
        );

        await expect(
          customContestService.updateContestInstanceStatus(
            mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'locked'
          )
        ).rejects.toThrow("Cannot transition from 'draft' to 'locked'");
      });

      it('should reject transition from settled', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single({ ...instanceWithTemplate, status: 'settled' })
        );

        await expect(
          customContestService.updateContestInstanceStatus(
            mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'open'
          )
        ).rejects.toThrow("Cannot transition from 'settled' to 'open'");
      });

      it('should reject transition from cancelled', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single({ ...instanceWithTemplate, status: 'cancelled' })
        );

        await expect(
          customContestService.updateContestInstanceStatus(
            mockPool, TEST_INSTANCE_ID, TEST_USER_ID, 'open'
          )
        ).rejects.toThrow("Cannot transition from 'cancelled' to 'open'");
      });
    });

    describe('publishContestInstance', () => {
      const instanceWithTemplate = {
        ...mockInstance,
        status: 'draft',
        join_token: 'dev_existingtoken12345678901234',
        template_name: mockTemplate.name,
        template_sport: mockTemplate.sport,
        template_type: mockTemplate.template_type,
        scoring_strategy_key: mockTemplate.scoring_strategy_key,
        lock_strategy_key: mockTemplate.lock_strategy_key,
        settlement_strategy_key: mockTemplate.settlement_strategy_key
      };

      it('should publish draft contest successfully with join_url', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single(instanceWithTemplate)
        );
        mockPool.setQueryResponse(
          /UPDATE contest_instances/,
          mockQueryResponses.single({ ...mockInstance, status: 'open', join_token: instanceWithTemplate.join_token })
        );

        const result = await customContestService.publishContestInstance(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID
        );
        expect(result.status).toBe('open');
        expect(result.join_token).toBe(instanceWithTemplate.join_token);
        expect(result.join_url).toBeDefined();
        expect(result.join_url).toContain('/join/');
        expect(result.join_url).toContain(result.join_token);
      });

      it('should be idempotent: return existing data with join_url if already open', async () => {
        const openInstance = {
          ...instanceWithTemplate,
          status: 'open',
          join_token: 'dev_originaltoken1234567890123',
          updated_at: new Date('2025-01-15T10:00:00Z')
        };

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single(openInstance)
        );

        const result = await customContestService.publishContestInstance(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID
        );

        // Should return existing data with join_url
        expect(result.status).toBe('open');
        expect(result.join_token).toBe('dev_originaltoken1234567890123');
        expect(result.updated_at).toEqual(openInstance.updated_at);
        expect(result.join_url).toBeDefined();
        expect(result.join_url).toContain('/join/dev_originaltoken1234567890123');

        // Verify no UPDATE query was made
        const queries = mockPool.getQueryHistory();
        const updateQueries = queries.filter(q => q.sql.includes('UPDATE'));
        expect(updateQueries).toHaveLength(0);
      });

      it('should not regenerate join_token on double publish', async () => {
        const originalToken = 'dev_originaltoken1234567890123';
        const openInstance = {
          ...instanceWithTemplate,
          status: 'open',
          join_token: originalToken
        };

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single(openInstance)
        );

        // First "publish" call (contest is already open)
        const result1 = await customContestService.publishContestInstance(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID
        );
        expect(result1.join_token).toBe(originalToken);

        // Second "publish" call (still idempotent)
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single(openInstance)
        );
        const result2 = await customContestService.publishContestInstance(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID
        );
        expect(result2.join_token).toBe(originalToken);
      });

      it('should generate join_token if draft has none', async () => {
        const draftWithoutToken = {
          ...instanceWithTemplate,
          status: 'draft',
          join_token: null
        };

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single(draftWithoutToken)
        );
        mockPool.setQueryResponse(
          /UPDATE contest_instances/,
          mockQueryResponses.single({ ...mockInstance, status: 'open', join_token: 'dev_newgeneratedtoken12345678' })
        );

        const result = await customContestService.publishContestInstance(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID
        );
        expect(result.status).toBe('open');
        expect(result.join_token).toBeTruthy();
      });

      it('should reject if not organizer', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single({ ...instanceWithTemplate, organizer_id: 'different-user-id' })
        );

        await expect(
          customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID)
        ).rejects.toThrow('Only the organizer can publish contest');
      });

      it('should reject if contest not found', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.empty()
        );

        await expect(
          customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID)
        ).rejects.toThrow('Contest instance not found');
      });

      it('should reject publishing cancelled contest', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single({ ...instanceWithTemplate, status: 'cancelled' })
        );

        await expect(
          customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID)
        ).rejects.toThrow("Cannot transition from 'cancelled' to 'open'");
      });

      it('should reject publishing locked contest', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single({ ...instanceWithTemplate, status: 'locked' })
        );

        await expect(
          customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID)
        ).rejects.toThrow("Cannot transition from 'locked' to 'open'");
      });

      it('should reject publishing settled contest', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single({ ...instanceWithTemplate, status: 'settled' })
        );

        await expect(
          customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID)
        ).rejects.toThrow("Cannot transition from 'settled' to 'open'");
      });

      it('should handle race condition when contest modified between fetch and update', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single(instanceWithTemplate)
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
    // Enriched mock for resolveJoinToken (includes creator_display_name, entries_current)
    const resolveTokenQueryPattern = /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.join_token/;

    it('should return valid contest info with enriched fields for valid token', async () => {
      const token = 'dev_abc123def456abc123def456abc123';
      const enrichedInstance = {
        ...mockInstance,
        join_token: token,
        status: 'open',
        template_name: mockTemplate.name,
        template_sport: mockTemplate.sport,
        max_entries: 10,
        creator_display_name: 'TestOrganizer',
        entries_current: 3
      };

      mockPool.setQueryResponse(
        resolveTokenQueryPattern,
        mockQueryResponses.single(enrichedInstance)
      );

      const result = await customContestService.resolveJoinToken(mockPool, token);
      expect(result.valid).toBe(true);
      expect(result.contest).toBeDefined();
      expect(result.contest.id).toBe(TEST_INSTANCE_ID);
      expect(result.contest.template_name).toBe('NFL Playoff Challenge');
      expect(result.contest.join_url).toContain('/join/');
      expect(result.contest.join_url).toContain(token);
      // Enriched fields
      expect(result.contest.computedJoinState).toBe('JOINABLE');
      expect(result.contest.creatorName).toBe('TestOrganizer');
      expect(result.contest.entriesCurrent).toBe(3);
      expect(result.contest.maxEntries).toBe(10);
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

    it('should return CONTEST_UNAVAILABLE for cancelled contest (not EXPIRED_TOKEN)', async () => {
      const token = 'dev_cancelled123456789012345678';
      const cancelledInstance = {
        ...mockInstance,
        join_token: token,
        status: 'cancelled',
        template_name: mockTemplate.name,
        template_sport: mockTemplate.sport
      };

      mockPool.setQueryResponse(
        resolveTokenQueryPattern,
        mockQueryResponses.single(cancelledInstance)
      );

      const result = await customContestService.resolveJoinToken(mockPool, token);
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_UNAVAILABLE);
      expect(result.reason).toContain('cancelled');
      expect(result.contest.status).toBe('cancelled');
      expect(result.contest.computedJoinState).toBe('UNAVAILABLE');
    });

    it('should return CONTEST_COMPLETED for settled contest (not EXPIRED_TOKEN)', async () => {
      const token = 'dev_settled12345678901234567890';
      const settledInstance = {
        ...mockInstance,
        join_token: token,
        status: 'settled',
        template_name: mockTemplate.name,
        template_sport: mockTemplate.sport
      };

      mockPool.setQueryResponse(
        resolveTokenQueryPattern,
        mockQueryResponses.single(settledInstance)
      );

      const result = await customContestService.resolveJoinToken(mockPool, token);
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_COMPLETED);
      expect(result.reason).toContain('settled');
      expect(result.contest.computedJoinState).toBe('COMPLETED');
    });

    it('should return CONTEST_LOCKED for locked contest', async () => {
      const token = 'dev_locked12345678901234567890';
      const lockedInstance = {
        ...mockInstance,
        join_token: token,
        status: 'locked',
        lock_time: new Date().toISOString(),
        template_name: mockTemplate.name,
        template_sport: mockTemplate.sport
      };

      mockPool.setQueryResponse(
        resolveTokenQueryPattern,
        mockQueryResponses.single(lockedInstance)
      );

      const result = await customContestService.resolveJoinToken(mockPool, token);
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_LOCKED);
      expect(result.reason).toContain('locked');
      expect(result.contest.lock_time).toBeDefined();
      expect(result.contest.computedJoinState).toBe('LOCKED');
    });

    it('should return CONTEST_UNAVAILABLE for draft contest (collapsed from NOT_PUBLISHED)', async () => {
      const token = 'dev_draft1234567890123456789012';
      const draftInstance = {
        ...mockInstance,
        join_token: token,
        status: 'draft',
        template_name: mockTemplate.name,
        template_sport: mockTemplate.sport
      };

      mockPool.setQueryResponse(
        resolveTokenQueryPattern,
        mockQueryResponses.single(draftInstance)
      );

      const result = await customContestService.resolveJoinToken(mockPool, token);
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_UNAVAILABLE);
      expect(result.reason).toContain('not been published');
      expect(result.contest.id).toBe(TEST_INSTANCE_ID);
      expect(result.contest.status).toBe('draft');
      expect(result.contest.computedJoinState).toBe('UNAVAILABLE');
      // Must NOT contain joinable payload fields
      expect(result.contest.template_name).toBeUndefined();
      expect(result.contest.entry_fee_cents).toBeUndefined();
      expect(result.contest.join_url).toBeUndefined();
    });

    it('should return CONTEST_NOT_FOUND for unknown contest status (fail closed)', async () => {
      const token = 'dev_unknown123456789012345678901';
      const weirdInstance = {
        ...mockInstance,
        join_token: token,
        status: 'some_future_status',
        template_name: mockTemplate.name,
        template_sport: mockTemplate.sport
      };

      mockPool.setQueryResponse(
        resolveTokenQueryPattern,
        mockQueryResponses.single(weirdInstance)
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
      const instanceWithTemplate = {
        ...mockInstance,
        status: 'draft',
        join_token: 'dev_existingtoken12345678901234',
        template_name: mockTemplate.name,
        template_sport: mockTemplate.sport,
        template_type: mockTemplate.template_type
      };

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single(instanceWithTemplate)
      );
      // Simulate CHECK constraint violation
      mockPool.setQueryResponse(
        /UPDATE contest_instances/,
        mockQueryResponses.error('new row for relation "contest_instances" violates check constraint', '23514')
      );

      await expect(
        customContestService.publishContestInstance(mockPool, TEST_INSTANCE_ID, TEST_USER_ID)
      ).rejects.toThrow('violates check constraint');
    });

    it('should propagate unique constraint error for duplicate join_token', async () => {
      const instanceWithTemplate = {
        ...mockInstance,
        status: 'draft',
        join_token: null,
        template_name: mockTemplate.name,
        template_sport: mockTemplate.sport,
        template_type: mockTemplate.template_type
      };

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single(instanceWithTemplate)
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
      status: 'open',
      max_entries: 10,
    };

    const mockParticipant = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      contest_instance_id: TEST_INSTANCE_ID,
      user_id: TEST_USER_ID,
      joined_at: new Date().toISOString()
    };

    it('should successfully join an open contest', async () => {
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

    it('should return ALREADY_JOINED on unique constraint violation (PG 23505)', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(openInstance)
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
        mockQueryResponses.error(
          'duplicate key value violates unique constraint "contest_participants_instance_user_unique"',
          '23505'
        )
      );

      const result = await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(result.joined).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.ALREADY_JOINED);
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

    it('should return CONTEST_LOCKED for locked contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openInstance, status: 'locked' })
      );

      const result = await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(result.joined).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_LOCKED);
    });

    it('should return CONTEST_UNAVAILABLE for draft contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openInstance, status: 'draft' })
      );

      const result = await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(result.joined).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_UNAVAILABLE);
    });

    it('should return CONTEST_UNAVAILABLE for cancelled contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openInstance, status: 'cancelled' })
      );

      const result = await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(result.joined).toBe(false);
      expect(result.error_code).toBe(customContestService.JOIN_ERROR_CODES.CONTEST_UNAVAILABLE);
    });

    it('should return CONTEST_COMPLETED for settled contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openInstance, status: 'settled' })
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
    const draftInstance = {
      ...mockInstance,
      status: 'draft',
      join_token: 'dev_existingtoken12345678901234',
      template_name: mockTemplate.name,
      template_sport: mockTemplate.sport,
      template_type: mockTemplate.template_type,
      scoring_strategy_key: mockTemplate.scoring_strategy_key,
      lock_strategy_key: mockTemplate.lock_strategy_key,
      settlement_strategy_key: mockTemplate.settlement_strategy_key
    };

    it('should insert organizer as participant when publishing draft to open', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single(draftInstance)
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances/,
        mockQueryResponses.single({ ...mockInstance, status: 'open', join_token: draftInstance.join_token })
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

    it('should NOT insert participant when publish is idempotent (already open)', async () => {
      const openInstance = {
        ...draftInstance,
        status: 'open',
        join_token: 'dev_originaltoken1234567890123'
      };

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single(openInstance)
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
