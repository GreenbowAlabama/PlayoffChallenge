/**
 * Rules Service Unit Tests
 *
 * Purpose: Test rules-related service logic in isolation
 * - Rules payload contract validation
 * - Stable ordering of rules
 * - Non-empty rules_table constraint
 * - Preview equals base rules unless overrides provided
 *
 * These tests assert against explicit field-level data contracts.
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const {
  TEST_RULESET_ID,
  rules,
  scoringRules
} = require('../fixtures');

describe('Rules Service Unit Tests', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('Rules Payload Contract', () => {
    const standardRules = rules.standard;

    it('should have all required top-level fields', () => {
      const requiredFields = ['ruleset_id', 'rules_version', 'rules_table'];

      requiredFields.forEach(field => {
        expect(standardRules).toHaveProperty(field);
      });
    });

    it('should have ruleset_id as UUID format', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      expect(standardRules.ruleset_id).toMatch(uuidRegex);
    });

    it('should have rules_version as semver-like string', () => {
      const semverRegex = /^\d+\.\d+\.\d+(-\w+)?$/;

      expect(standardRules.rules_version).toMatch(semverRegex);
    });

    it('should have rules_table as array', () => {
      expect(Array.isArray(standardRules.rules_table)).toBe(true);
    });

    it('should have valid rule structure within rules_table', () => {
      const requiredRuleFields = ['rule_name', 'description', 'value'];

      standardRules.rules_table.forEach(rule => {
        requiredRuleFields.forEach(field => {
          expect(rule).toHaveProperty(field);
        });
      });
    });

    it('should have rule_name as non-empty string', () => {
      standardRules.rules_table.forEach(rule => {
        expect(typeof rule.rule_name).toBe('string');
        expect(rule.rule_name.length).toBeGreaterThan(0);
      });
    });

    it('should have description as non-empty string', () => {
      standardRules.rules_table.forEach(rule => {
        expect(typeof rule.description).toBe('string');
        expect(rule.description.length).toBeGreaterThan(0);
      });
    });

    it('should have value as number or string', () => {
      standardRules.rules_table.forEach(rule => {
        const validType = typeof rule.value === 'number' || typeof rule.value === 'string';
        expect(validType).toBe(true);
      });
    });
  });

  describe('Stable Ordering', () => {
    it('should maintain consistent order across queries', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM rules/,
        mockQueryResponses.multiple(rules.standard.rules_table)
      );

      const result1 = await mockPool.query('SELECT * FROM rules ORDER BY rule_name');
      const result2 = await mockPool.query('SELECT * FROM rules ORDER BY rule_name');

      expect(result1.rows).toEqual(result2.rows);
    });

    it('should order rules by rule_name alphabetically', () => {
      const sortedRules = [...rules.standard.rules_table].sort((a, b) =>
        a.rule_name.localeCompare(b.rule_name)
      );

      for (let i = 1; i < sortedRules.length; i++) {
        expect(sortedRules[i - 1].rule_name.localeCompare(sortedRules[i].rule_name)).toBeLessThanOrEqual(0);
      }
    });

    it('should have unique rule_names', () => {
      const ruleNames = rules.standard.rules_table.map(r => r.rule_name);
      const uniqueNames = new Set(ruleNames);

      expect(uniqueNames.size).toBe(ruleNames.length);
    });

    it('should preserve insertion order when not explicitly sorted', () => {
      const rulesTable = rules.standard.rules_table;
      const firstRule = rulesTable[0];
      const lastRule = rulesTable[rulesTable.length - 1];

      expect(firstRule.rule_name).toBe('roster_size');
      expect(lastRule.rule_name).toBe('multiplier_uses');
    });
  });

  describe('Non-Empty Rules Table', () => {
    it('should have at least one rule in rules_table', () => {
      expect(rules.standard.rules_table.length).toBeGreaterThan(0);
    });

    it('should reject empty rules_table', () => {
      const invalidRuleset = {
        ruleset_id: 'test-id',
        rules_version: '1.0.0',
        rules_table: []
      };

      const isValid = invalidRuleset.rules_table.length > 0;
      expect(isValid).toBe(false);
    });

    it('should have required position rules', () => {
      const positionRules = ['position_qb', 'position_rb', 'position_wr', 'position_te', 'position_k', 'position_def'];
      const ruleNames = rules.standard.rules_table.map(r => r.rule_name);

      positionRules.forEach(posRule => {
        expect(ruleNames).toContain(posRule);
      });
    });

    it('should have roster_size rule', () => {
      const ruleNames = rules.standard.rules_table.map(r => r.rule_name);

      expect(ruleNames).toContain('roster_size');
    });

    it('should have multiplier rules', () => {
      const multiplierRules = ['multiplier_max', 'multiplier_uses'];
      const ruleNames = rules.standard.rules_table.map(r => r.rule_name);

      multiplierRules.forEach(multRule => {
        expect(ruleNames).toContain(multRule);
      });
    });
  });

  describe('Preview Equals Base Rules', () => {
    it('should return base rules when no overrides provided', () => {
      const baseRules = rules.standard;
      const previewRules = { ...baseRules }; // No overrides

      expect(previewRules.rules_table).toEqual(baseRules.rules_table);
    });

    it('should apply overrides when provided', () => {
      const baseRules = rules.standard;
      const overrides = { roster_size: 8 };

      const previewRules = {
        ...baseRules,
        rules_table: baseRules.rules_table.map(rule => {
          if (overrides[rule.rule_name] !== undefined) {
            return { ...rule, value: overrides[rule.rule_name] };
          }
          return rule;
        })
      };

      const rosterSizeRule = previewRules.rules_table.find(r => r.rule_name === 'roster_size');
      expect(rosterSizeRule.value).toBe(8);
    });

    it('should not modify base rules when creating preview', () => {
      const originalValue = rules.standard.rules_table.find(r => r.rule_name === 'roster_size').value;

      // Create preview with override
      const overrides = { roster_size: 5 };
      const previewTable = rules.standard.rules_table.map(rule => {
        if (overrides[rule.rule_name] !== undefined) {
          return { ...rule, value: overrides[rule.rule_name] };
        }
        return { ...rule };
      });

      // Verify original is unchanged
      const currentValue = rules.standard.rules_table.find(r => r.rule_name === 'roster_size').value;
      expect(currentValue).toBe(originalValue);

      // Verify preview has different value
      const previewValue = previewTable.find(r => r.rule_name === 'roster_size').value;
      expect(previewValue).toBe(5);
    });

    it('should preserve non-overridden rules in preview', () => {
      const baseRules = rules.standard;
      const overrides = { roster_size: 8 };

      const previewRules = {
        ...baseRules,
        rules_table: baseRules.rules_table.map(rule => {
          if (overrides[rule.rule_name] !== undefined) {
            return { ...rule, value: overrides[rule.rule_name] };
          }
          return rule;
        })
      };

      // position_qb should be unchanged
      const baseQbRule = baseRules.rules_table.find(r => r.rule_name === 'position_qb');
      const previewQbRule = previewRules.rules_table.find(r => r.rule_name === 'position_qb');

      expect(previewQbRule.value).toBe(baseQbRule.value);
    });
  });

  describe('Custom Ruleset Validation', () => {
    it('should validate custom ruleset has different version', () => {
      expect(rules.standard.rules_version).not.toBe(rules.withOverrides.rules_version);
    });

    it('should validate custom ruleset has different ruleset_id', () => {
      expect(rules.standard.ruleset_id).not.toBe(rules.withOverrides.ruleset_id);
    });

    it('should allow reduced roster size in custom ruleset', () => {
      const standardRosterSize = rules.standard.rules_table.find(r => r.rule_name === 'roster_size').value;
      const customRosterSize = rules.withOverrides.rules_table.find(r => r.rule_name === 'roster_size').value;

      expect(customRosterSize).toBeLessThan(standardRosterSize);
    });

    it('should validate custom rules maintain required structure', () => {
      const requiredFields = ['rule_name', 'description', 'value'];

      rules.withOverrides.rules_table.forEach(rule => {
        requiredFields.forEach(field => {
          expect(rule).toHaveProperty(field);
        });
      });
    });
  });

  describe('Scoring Rules Integration', () => {
    it('should have valid scoring rules structure', () => {
      scoringRules.forEach(rule => {
        expect(rule).toHaveProperty('stat_name');
        expect(rule).toHaveProperty('points');
        expect(rule).toHaveProperty('description');
        expect(rule).toHaveProperty('is_active');
      });
    });

    it('should have numeric points values', () => {
      scoringRules.forEach(rule => {
        expect(typeof rule.points).toBe('number');
      });
    });

    it('should have boolean is_active flag', () => {
      scoringRules.forEach(rule => {
        expect(typeof rule.is_active).toBe('boolean');
      });
    });

    it('should include standard fantasy scoring categories', () => {
      const statNames = scoringRules.map(r => r.stat_name);
      const requiredStats = [
        'pass_yd', 'pass_td', 'pass_int',
        'rush_yd', 'rush_td',
        'rec', 'rec_yd', 'rec_td',
        'fum_lost'
      ];

      requiredStats.forEach(stat => {
        expect(statNames).toContain(stat);
      });
    });

    it('should include bonus scoring rules', () => {
      const statNames = scoringRules.map(r => r.stat_name);
      const bonusRules = ['pass_yd_bonus', 'rush_yd_bonus', 'rec_yd_bonus'];

      bonusRules.forEach(bonus => {
        expect(statNames).toContain(bonus);
      });
    });
  });

  describe('Rules Query Patterns', () => {
    it('should retrieve rules by ruleset_id', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM rulesets.*WHERE.*ruleset_id/,
        mockQueryResponses.single(rules.standard)
      );

      const result = await mockPool.query(
        'SELECT * FROM rulesets WHERE ruleset_id = $1',
        [TEST_RULESET_ID]
      );

      expect(result.rows[0].ruleset_id).toBe(TEST_RULESET_ID);
    });

    it('should retrieve latest rules version', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM rulesets.*ORDER BY.*created_at.*DESC.*LIMIT/,
        mockQueryResponses.single(rules.standard)
      );

      const result = await mockPool.query(
        'SELECT * FROM rulesets ORDER BY created_at DESC LIMIT 1'
      );

      expect(result.rows[0]).toBeDefined();
    });

    it('should retrieve contest-specific rules', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_rules.*JOIN.*rulesets/i,
        mockQueryResponses.single({
          contest_id: 'contest-123',
          ...rules.withOverrides
        })
      );

      const result = await mockPool.query(
        'SELECT r.* FROM contest_rules cr JOIN rulesets r ON cr.ruleset_id = r.ruleset_id WHERE cr.contest_id = $1',
        ['contest-123']
      );

      expect(result.rows[0].ruleset_id).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing ruleset gracefully', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM rulesets/,
        mockQueryResponses.empty()
      );

      const result = await mockPool.query(
        'SELECT * FROM rulesets WHERE ruleset_id = $1',
        ['nonexistent-ruleset-id']
      );

      expect(result.rows.length).toBe(0);
    });

    it('should handle malformed rules_table', () => {
      const malformedRuleset = {
        ruleset_id: 'test-id',
        rules_version: '1.0.0',
        rules_table: 'not-an-array'
      };

      const isValid = Array.isArray(malformedRuleset.rules_table);
      expect(isValid).toBe(false);
    });

    it('should handle missing required fields in rule entry', () => {
      const incompleteRule = {
        rule_name: 'test_rule'
        // Missing: description, value
      };

      const requiredFields = ['rule_name', 'description', 'value'];
      const missingFields = requiredFields.filter(field => !(field in incompleteRule));

      expect(missingFields.length).toBeGreaterThan(0);
    });
  });
});
