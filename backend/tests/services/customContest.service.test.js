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
  });

  afterEach(() => {
    mockPool.reset();
    delete process.env.APP_ENV;
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

      it('should default to dev for invalid APP_ENV', () => {
        process.env.APP_ENV = 'invalid';
        const token = customContestService.generateJoinToken();
        expect(token).toMatch(/^dev_[a-f0-9]{32}$/);
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

      it('should create instance with valid input', async () => {
        mockPool.setQueryResponse(
          /INSERT INTO contest_instances/,
          mockQueryResponses.single(mockInstance)
        );

        const instance = await customContestService.createContestInstance(mockPool, TEST_USER_ID, {
          template_id: TEST_TEMPLATE_ID,
          entry_fee_cents: 2500,
          payout_structure: { first: 70, second: 20, third: 10 }
        });

        expect(instance).toBeDefined();
        expect(instance.id).toBe(TEST_INSTANCE_ID);
        expect(instance.status).toBe('draft');
        expect(instance.join_token).toBeDefined();
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
        expect(instance.template_name).toBe('NFL Playoff Challenge');
        expect(instance.template_sport).toBe('NFL');
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
      it('should publish draft contest', async () => {
        const instanceWithTemplate = {
          ...mockInstance,
          status: 'draft',
          template_name: mockTemplate.name,
          template_sport: mockTemplate.sport,
          template_type: mockTemplate.template_type
        };

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
          mockQueryResponses.single(instanceWithTemplate)
        );
        mockPool.setQueryResponse(
          /UPDATE contest_instances SET status/,
          mockQueryResponses.single({ ...mockInstance, status: 'open' })
        );

        const result = await customContestService.publishContestInstance(
          mockPool, TEST_INSTANCE_ID, TEST_USER_ID
        );
        expect(result.status).toBe('open');
      });
    });
  });

  describe('resolveJoinToken', () => {
    it('should return valid contest info for valid token', async () => {
      const token = 'dev_abc123def456abc123def456abc123';
      const instanceWithTemplate = {
        ...mockInstance,
        join_token: token,
        template_name: mockTemplate.name,
        template_sport: mockTemplate.sport
      };

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.join_token/,
        mockQueryResponses.single(instanceWithTemplate)
      );

      const result = await customContestService.resolveJoinToken(mockPool, token);
      expect(result.valid).toBe(true);
      expect(result.contest).toBeDefined();
      expect(result.contest.id).toBe(TEST_INSTANCE_ID);
      expect(result.contest.template_name).toBe('NFL Playoff Challenge');
    });

    it('should return invalid for environment mismatch', async () => {
      const result = await customContestService.resolveJoinToken(mockPool, 'prd_abc123');
      expect(result.valid).toBe(false);
      expect(result.environment_mismatch).toBe(true);
      expect(result.token_environment).toBe('prd');
      expect(result.current_environment).toBe('dev');
    });

    it('should return invalid for malformed token', async () => {
      const result = await customContestService.resolveJoinToken(mockPool, 'notavalidtoken');
      expect(result.valid).toBe(false);
      expect(result.environment_mismatch).toBe(false);
      expect(result.reason).toContain('missing environment prefix');
    });

    it('should return invalid if contest not found', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.join_token/,
        mockQueryResponses.empty()
      );

      const result = await customContestService.resolveJoinToken(mockPool, 'dev_notfound123456');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Contest not found');
    });
  });
});
