/**
 * Custom Contest Template Service Unit Tests
 *
 * Purpose: Test template management operations in isolation
 * - Template creation with validation
 * - Template listing (active and all)
 * - Template deactivation with immutability checks
 * - In-use detection
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const templateService = require('../../services/customContestTemplateService');

// Test fixtures
const TEST_TEMPLATE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEST_TEMPLATE_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

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

const mockInactiveTemplate = {
  ...mockTemplate,
  id: TEST_TEMPLATE_ID_2,
  name: 'Inactive Template',
  is_active: false
};

const validTemplateInput = {
  name: 'New Template',
  sport: 'NFL',
  template_type: 'survivor',
  scoring_strategy_key: 'ppr',
  lock_strategy_key: 'first_game_kickoff',
  settlement_strategy_key: 'final_standings',
  default_entry_fee_cents: 5000,
  allowed_entry_fee_min_cents: 1000,
  allowed_entry_fee_max_cents: 10000,
  allowed_payout_structures: [{ first: 100 }]
};

describe('Custom Contest Template Service', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('listActiveTemplates', () => {
    it('should return only active templates', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE is_active = true/,
        mockQueryResponses.multiple([mockTemplate])
      );

      const templates = await templateService.listActiveTemplates(mockPool);
      expect(templates).toHaveLength(1);
      expect(templates[0].is_active).toBe(true);
    });

    it('should return empty array if no active templates', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE is_active = true/,
        mockQueryResponses.empty()
      );

      const templates = await templateService.listActiveTemplates(mockPool);
      expect(templates).toEqual([]);
    });
  });

  describe('listAllTemplates', () => {
    it('should return all templates including inactive', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates ORDER BY/,
        mockQueryResponses.multiple([mockTemplate, mockInactiveTemplate])
      );

      const templates = await templateService.listAllTemplates(mockPool);
      expect(templates).toHaveLength(2);
    });
  });

  describe('getTemplateById', () => {
    it('should return template if found', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.single(mockTemplate)
      );

      const template = await templateService.getTemplateById(mockPool, TEST_TEMPLATE_ID);
      expect(template).toBeDefined();
      expect(template.id).toBe(TEST_TEMPLATE_ID);
    });

    it('should return inactive template if found', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.single(mockInactiveTemplate)
      );

      const template = await templateService.getTemplateById(mockPool, TEST_TEMPLATE_ID_2);
      expect(template).toBeDefined();
      expect(template.is_active).toBe(false);
    });

    it('should return null if template not found', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.empty()
      );

      const template = await templateService.getTemplateById(mockPool, 'nonexistent-id');
      expect(template).toBeNull();
    });
  });

  describe('isTemplateInUse', () => {
    it('should return true if template has contest instances', async () => {
      mockPool.setQueryResponse(
        /SELECT EXISTS.*FROM contest_instances WHERE template_id/,
        mockQueryResponses.single({ in_use: true })
      );

      const inUse = await templateService.isTemplateInUse(mockPool, TEST_TEMPLATE_ID);
      expect(inUse).toBe(true);
    });

    it('should return false if template has no contest instances', async () => {
      mockPool.setQueryResponse(
        /SELECT EXISTS.*FROM contest_instances WHERE template_id/,
        mockQueryResponses.single({ in_use: false })
      );

      const inUse = await templateService.isTemplateInUse(mockPool, TEST_TEMPLATE_ID);
      expect(inUse).toBe(false);
    });
  });

  describe('validateTemplateInput', () => {
    it('should accept valid input', () => {
      expect(() => templateService.validateTemplateInput(validTemplateInput)).not.toThrow();
    });

    describe('name validation', () => {
      it('should reject missing name', () => {
        const input = { ...validTemplateInput, name: undefined };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('name is required');
      });

      it('should reject empty name', () => {
        const input = { ...validTemplateInput, name: '' };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('name is required');
      });

      it('should reject whitespace-only name', () => {
        const input = { ...validTemplateInput, name: '   ' };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('name is required');
      });
    });

    describe('sport validation', () => {
      it('should reject invalid sport', () => {
        const input = { ...validTemplateInput, sport: 'CRICKET' };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('sport is required and must be one of');
      });

      it('should accept valid sports', () => {
        for (const sport of templateService.VALID_SPORTS) {
          const input = { ...validTemplateInput, sport };
          expect(() => templateService.validateTemplateInput(input)).not.toThrow();
        }
      });
    });

    describe('strategy key validation', () => {
      it('should reject invalid scoring_strategy_key', () => {
        const input = { ...validTemplateInput, scoring_strategy_key: 'invalid' };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('scoring_strategy_key is required and must be one of');
      });

      it('should reject invalid lock_strategy_key', () => {
        const input = { ...validTemplateInput, lock_strategy_key: 'invalid' };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('lock_strategy_key is required and must be one of');
      });

      it('should reject invalid settlement_strategy_key', () => {
        const input = { ...validTemplateInput, settlement_strategy_key: 'invalid' };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('settlement_strategy_key is required and must be one of');
      });
    });

    describe('entry fee validation', () => {
      it('should reject negative default_entry_fee_cents', () => {
        const input = { ...validTemplateInput, default_entry_fee_cents: -100 };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('default_entry_fee_cents is required and must be a non-negative integer');
      });

      it('should reject non-integer default_entry_fee_cents', () => {
        const input = { ...validTemplateInput, default_entry_fee_cents: 25.5 };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('default_entry_fee_cents is required and must be a non-negative integer');
      });

      it('should reject min > max entry fee', () => {
        const input = {
          ...validTemplateInput,
          allowed_entry_fee_min_cents: 5000,
          allowed_entry_fee_max_cents: 1000
        };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('allowed_entry_fee_min_cents must be <= allowed_entry_fee_max_cents');
      });

      it('should reject default outside allowed range (below min)', () => {
        const input = {
          ...validTemplateInput,
          default_entry_fee_cents: 500,
          allowed_entry_fee_min_cents: 1000,
          allowed_entry_fee_max_cents: 10000
        };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('default_entry_fee_cents must be within the allowed range');
      });

      it('should reject default outside allowed range (above max)', () => {
        const input = {
          ...validTemplateInput,
          default_entry_fee_cents: 15000,
          allowed_entry_fee_min_cents: 1000,
          allowed_entry_fee_max_cents: 10000
        };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('default_entry_fee_cents must be within the allowed range');
      });

      it('should accept zero entry fees', () => {
        const input = {
          ...validTemplateInput,
          default_entry_fee_cents: 0,
          allowed_entry_fee_min_cents: 0,
          allowed_entry_fee_max_cents: 0
        };
        expect(() => templateService.validateTemplateInput(input)).not.toThrow();
      });
    });

    describe('payout structures validation', () => {
      it('should reject missing allowed_payout_structures', () => {
        const input = { ...validTemplateInput, allowed_payout_structures: undefined };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('allowed_payout_structures is required and must be a non-empty array');
      });

      it('should reject empty allowed_payout_structures', () => {
        const input = { ...validTemplateInput, allowed_payout_structures: [] };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('allowed_payout_structures is required and must be a non-empty array');
      });

      it('should reject non-array allowed_payout_structures', () => {
        const input = { ...validTemplateInput, allowed_payout_structures: { first: 100 } };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('allowed_payout_structures is required and must be a non-empty array');
      });

      it('should reject empty object in payout structures', () => {
        const input = { ...validTemplateInput, allowed_payout_structures: [{}] };
        expect(() => templateService.validateTemplateInput(input))
          .toThrow('Each payout structure must define at least one payout');
      });

      it('should accept multiple payout structures', () => {
        const input = {
          ...validTemplateInput,
          allowed_payout_structures: [
            { first: 100 },
            { first: 70, second: 30 },
            { first: 50, second: 30, third: 20 }
          ]
        };
        expect(() => templateService.validateTemplateInput(input)).not.toThrow();
      });
    });
  });

  describe('createTemplate', () => {
    it('should create template with valid input', async () => {
      mockPool.setQueryResponse(
        /INSERT INTO contest_templates/,
        mockQueryResponses.single({ ...mockTemplate, name: validTemplateInput.name })
      );

      const template = await templateService.createTemplate(mockPool, validTemplateInput);
      expect(template).toBeDefined();
      expect(template.name).toBe(validTemplateInput.name);
    });

    it('should trim name whitespace', async () => {
      mockPool.setQueryResponse(
        /INSERT INTO contest_templates/,
        mockQueryResponses.single({ ...mockTemplate, name: 'Trimmed Name' })
      );

      const input = { ...validTemplateInput, name: '  Trimmed Name  ' };
      await templateService.createTemplate(mockPool, input);

      const queryHistory = mockPool.getQueryHistory();
      const insertQuery = queryHistory.find(q => q.sql.includes('INSERT'));
      expect(insertQuery.params[0]).toBe('Trimmed Name');
    });

    it('should reject invalid input', async () => {
      const input = { ...validTemplateInput, name: '' };
      await expect(templateService.createTemplate(mockPool, input))
        .rejects.toThrow('name is required');
    });
  });

  describe('deactivateTemplate', () => {
    it('should deactivate template not in use', async () => {
      // Template exists and is active
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.single(mockTemplate)
      );

      // Not in use
      mockPool.setQueryResponse(
        /SELECT EXISTS.*FROM contest_instances WHERE template_id/,
        mockQueryResponses.single({ in_use: false })
      );

      // Update succeeds
      mockPool.setQueryResponse(
        /UPDATE contest_templates SET is_active = false/,
        mockQueryResponses.single({ ...mockTemplate, is_active: false })
      );

      const template = await templateService.deactivateTemplate(mockPool, TEST_TEMPLATE_ID);
      expect(template.is_active).toBe(false);
    });

    it('should throw NOT_FOUND if template does not exist', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.empty()
      );

      await expect(templateService.deactivateTemplate(mockPool, 'nonexistent'))
        .rejects.toMatchObject({ message: 'Template not found', code: 'NOT_FOUND' });
    });

    it('should throw ALREADY_INACTIVE if template is already inactive', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.single(mockInactiveTemplate)
      );

      await expect(templateService.deactivateTemplate(mockPool, TEST_TEMPLATE_ID_2))
        .rejects.toMatchObject({ message: 'Template is already inactive', code: 'ALREADY_INACTIVE' });
    });

    it('should throw IN_USE if template is referenced by contests', async () => {
      // Template exists and is active
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.single(mockTemplate)
      );

      // In use
      mockPool.setQueryResponse(
        /SELECT EXISTS.*FROM contest_instances WHERE template_id/,
        mockQueryResponses.single({ in_use: true })
      );

      await expect(templateService.deactivateTemplate(mockPool, TEST_TEMPLATE_ID))
        .rejects.toMatchObject({
          message: 'Template is referenced by existing contests and cannot be deactivated',
          code: 'IN_USE'
        });
    });
  });

  describe('Immutability Constraint', () => {
    it('templates cannot be modified once in use (enforced by deactivation check)', async () => {
      // Template exists
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.single(mockTemplate)
      );

      // In use by contest instances
      mockPool.setQueryResponse(
        /SELECT EXISTS.*FROM contest_instances WHERE template_id/,
        mockQueryResponses.single({ in_use: true })
      );

      // Attempt to deactivate should fail
      await expect(templateService.deactivateTemplate(mockPool, TEST_TEMPLATE_ID))
        .rejects.toThrow('Template is referenced by existing contests');
    });
  });

  describe('Constants Export', () => {
    it('should export valid strategy constants', () => {
      expect(templateService.VALID_SCORING_STRATEGIES).toContain('ppr');
      expect(templateService.VALID_LOCK_STRATEGIES).toContain('first_game_kickoff');
      expect(templateService.VALID_SETTLEMENT_STRATEGIES).toContain('final_standings');
      expect(templateService.VALID_SPORTS).toContain('NFL');
    });
  });
});
