const { resolveTier, validateRosterTiers } = require('../../services/tierResolutionService');

describe('Tier Resolution Service', () => {
  describe('resolveTier', () => {
    it('returns null when tierDefinition is null', () => {
      const result = resolveTier(5, null);
      expect(result).toBeNull();
    });

    it('returns null when tierDefinition has no tiers', () => {
      const result = resolveTier(5, {});
      expect(result).toBeNull();
    });

    it('maps rank to correct tier', () => {
      const def = {
        tiers: [
          { id: 't1', rank_min: 1, rank_max: 5 },
          { id: 't2', rank_min: 6, rank_max: 15 },
          { id: 't3', rank_min: 16, rank_max: 30 }
        ]
      };

      expect(resolveTier(3, def)).toBe('t1');
      expect(resolveTier(10, def)).toBe('t2');
      expect(resolveTier(25, def)).toBe('t3');
    });

    it('returns null for out-of-range rank', () => {
      const def = {
        tiers: [
          { id: 't1', rank_min: 1, rank_max: 5 }
        ]
      };
      const result = resolveTier(50, def);
      expect(result).toBeNull();
    });

    it('handles boundary ranks correctly', () => {
      const def = {
        tiers: [
          { id: 't1', rank_min: 1, rank_max: 5 },
          { id: 't2', rank_min: 6, rank_max: 10 }
        ]
      };

      expect(resolveTier(1, def)).toBe('t1');  // Min boundary
      expect(resolveTier(5, def)).toBe('t1');  // Max boundary
      expect(resolveTier(6, def)).toBe('t2');  // Min boundary of next tier
      expect(resolveTier(10, def)).toBe('t2'); // Max boundary
    });
  });

  describe('validateRosterTiers', () => {
    it('passes when all tiers have required count', () => {
      const def = {
        required_per_tier: 1,
        tiers: [
          { id: 't1' },
          { id: 't2' },
          { id: 't3' }
        ]
      };
      const entries = [
        { tier_id: 't1' },
        { tier_id: 't2' },
        { tier_id: 't3' }
      ];
      const result = validateRosterTiers(entries, def);
      expect(result.valid).toBe(true);
    });

    it('fails when tier missing from roster', () => {
      const def = {
        required_per_tier: 1,
        tiers: [
          { id: 't1' },
          { id: 't2' },
          { id: 't3' }
        ]
      };
      const entries = [
        { tier_id: 't1' },
        { tier_id: 't2' }
      ];
      const result = validateRosterTiers(entries, def);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('tier_t3_count_mismatch');
    });

    it('fails when tier has duplicate player', () => {
      const def = {
        required_per_tier: 1,
        tiers: [
          { id: 't1' },
          { id: 't2' }
        ]
      };
      const entries = [
        { tier_id: 't1' },
        { tier_id: 't1' },
        { tier_id: 't2' }
      ];
      const result = validateRosterTiers(entries, def);
      expect(result.valid).toBe(false);
    });

    it('returns valid=true when tierDefinition is null (backward compat)', () => {
      const entries = [{ player_id: 'p1' }];
      const result = validateRosterTiers(entries, null);
      expect(result.valid).toBe(true);
    });

    it('returns valid=true when tierDefinition has no tiers (backward compat)', () => {
      const entries = [{ player_id: 'p1' }];
      const result = validateRosterTiers(entries, {});
      expect(result.valid).toBe(true);
    });

    it('fails when entry is missing tier_id', () => {
      const def = {
        required_per_tier: 1,
        tiers: [
          { id: 't1' }
        ]
      };
      const entries = [
        { player_id: 'p1' }  // Missing tier_id
      ];
      const result = validateRosterTiers(entries, def);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('missing_tier_assignment');
    });

    it('supports multiple required_per_tier', () => {
      const def = {
        required_per_tier: 2,
        tiers: [
          { id: 't1' },
          { id: 't2' }
        ]
      };
      const entries = [
        { tier_id: 't1' },
        { tier_id: 't1' },
        { tier_id: 't2' },
        { tier_id: 't2' }
      ];
      const result = validateRosterTiers(entries, def);
      expect(result.valid).toBe(true);
    });

    it('fails when tier count is less than required_per_tier', () => {
      const def = {
        required_per_tier: 2,
        tiers: [
          { id: 't1' },
          { id: 't2' }
        ]
      };
      const entries = [
        { tier_id: 't1' },
        { tier_id: 't1' },
        { tier_id: 't2' }  // Only 1, needs 2
      ];
      const result = validateRosterTiers(entries, def);
      expect(result.valid).toBe(false);
      expect(result.expected).toBe(2);
      expect(result.got).toBe(1);
    });
  });
});
