/**
 * Contest Rules Validator Service Tests
 *
 * Tests for roster validation constraints:
 * - Roster size validation
 * - Duplicate detection
 * - Player existence in validated field
 * - No tier logic (sentinel test)
 */

const { validateRoster } = require('../../services/ContestRulesValidator');

describe('Contest Rules Validator - validateRoster', () => {
  const validConfig = {
    roster_size: 4
  };

  const validField = [
    { player_id: 'p1', name: 'Player 1' },
    { player_id: 'p2', name: 'Player 2' },
    { player_id: 'p3', name: 'Player 3' },
    { player_id: 'p4', name: 'Player 4' },
    { player_id: 'p5', name: 'Player 5' }
  ];

  describe('Roster size validation', () => {
    it('accepts roster with correct size', () => {
      const roster = ['p1', 'p2', 'p3', 'p4'];
      const result = validateRoster(roster, validConfig, validField);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts roster smaller than max size (partial submission allowed)', () => {
      const roster = ['p1', 'p2', 'p3'];
      const result = validateRoster(roster, validConfig, validField);

      // Per CLAUDE.md: Partial roster submission allowed: 0 <= player_ids.length <= roster_size
      // 3 players is valid when roster_size is 4
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects roster too large', () => {
      const roster = ['p1', 'p2', 'p3', 'p4', 'p5'];
      const result = validateRoster(roster, validConfig, validField);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('size'))).toBe(true);
    });

    it('rejects when roster_size missing from config', () => {
      const roster = ['p1', 'p2', 'p3', 'p4'];
      const config = {}; // No roster_size

      const result = validateRoster(roster, config, validField);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('roster_size'))).toBe(true);
    });

    it('rejects when roster_size is not a positive number', () => {
      const roster = ['p1', 'p2'];
      const config = { roster_size: 0 };

      const result = validateRoster(roster, config, validField);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('roster_size'))).toBe(true);
    });
  });

  describe('Duplicate detection', () => {
    it('rejects roster with one duplicate', () => {
      const roster = ['p1', 'p2', 'p1', 'p3']; // p1 appears twice
      const result = validateRoster(roster, validConfig, validField);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate'))).toBe(true);
      expect(result.errors.some(e => e.includes('p1'))).toBe(true);
    });

    it('rejects roster with multiple duplicates', () => {
      const roster = ['p1', 'p2', 'p1', 'p2'];
      const result = validateRoster(roster, validConfig, validField);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate'))).toBe(true);
    });

    it('reports all duplicate player_ids', () => {
      const roster = ['p1', 'p2', 'p1', 'p2', 'p3'];
      const config = { roster_size: 5 };

      const result = validateRoster(roster, config, validField);

      expect(result.valid).toBe(false);
      const duplicateError = result.errors.find(e => e.includes('Duplicate'));
      expect(duplicateError).toMatch(/p1/);
      expect(duplicateError).toMatch(/p2/);
    });

    it('accepts roster with unique players', () => {
      const roster = ['p1', 'p2', 'p3', 'p4'];
      const result = validateRoster(roster, validConfig, validField);

      expect(result.valid).toBe(true);
    });
  });

  describe('Player existence validation', () => {
    it('rejects roster with unknown player', () => {
      const roster = ['p1', 'p2', 'p3', 'unknown'];
      const result = validateRoster(roster, validConfig, validField);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('not in contest field') || e.includes('not in validated field'))).toBe(true);
      expect(result.errors.some(e => e.includes('unknown'))).toBe(true);
    });

    it('rejects roster with multiple unknown players', () => {
      const roster = ['p1', 'unknown1', 'unknown2', 'unknown3'];
      const result = validateRoster(roster, validConfig, validField);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('not in contest field') || e.includes('not in validated field'))).toBe(true);
    });

    it('accepts all valid players', () => {
      const roster = ['p1', 'p2', 'p3', 'p4'];
      const result = validateRoster(roster, validConfig, validField);

      expect(result.valid).toBe(true);
    });

    it('validates against provided field only', () => {
      const roster = ['p1', 'p2', 'p3', 'p4'];
      const limitedField = [
        { player_id: 'p1' },
        { player_id: 'p2' }
      ];
      const config = { roster_size: 4 };

      const result = validateRoster(roster, config, limitedField);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('not in contest field') || e.includes('not in validated field'))).toBe(true);
    });
  });

  describe('Multiple constraint validation', () => {
    it('collects errors from multiple constraint violations', () => {
      // Wrong size + duplicates + unknown player
      const roster = ['p1', 'p1', 'unknown', 'extra']; // 4 players, but has duplicate and unknown
      const config = { roster_size: 3 }; // Size mismatch

      const result = validateRoster(roster, config, validField);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it('reports all errors together', () => {
      const roster = ['p1', 'p1', 'unknown'];
      const config = { roster_size: 4 };

      const result = validateRoster(roster, config, validField);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Should report size, duplicates, and unknown player
    });
  });

  describe('Input validation', () => {
    it('rejects non-array roster', () => {
      const roster = { player_ids: ['p1', 'p2'] };
      const result = validateRoster(roster, validConfig, validField);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('array'))).toBe(true);
    });

    it('rejects missing config', () => {
      const roster = ['p1', 'p2', 'p3', 'p4'];
      const result = validateRoster(roster, undefined, validField);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Config'))).toBe(true);
    });

    it('rejects non-array validatedField', () => {
      const roster = ['p1', 'p2', 'p3', 'p4'];
      const field = { players: validField };

      const result = validateRoster(roster, validConfig, field);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('array'))).toBe(true);
    });

    it('accepts empty roster when roster_size > 0 (partial submission allowed)', () => {
      const roster = [];
      const config = { roster_size: 1 };

      const result = validateRoster(roster, config, validField);

      // Per CLAUDE.md: Partial roster submission allowed: 0 <= player_ids.length <= roster_size
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('handles empty validated field', () => {
      const roster = ['p1'];
      const config = { roster_size: 1 };

      const result = validateRoster(roster, config, []);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('not in contest field') || e.includes('not in validated field'))).toBe(true);
    });
  });

  describe('INVARIANT: entry_rosters.player_ids ⊆ field_selections.primary', () => {
    it('rejects roster with espn_ format ID not in field (staging bug case)', () => {
      // Reproduces the actual bug: espn_10048 was selected but not in field_selections.primary
      const rosterWithInvalidIds = [
        'espn_10054',  // Valid - in field
        'espn_10048',  // INVALID - NOT in field
        'espn_1030',   // INVALID - NOT in field
        'espn_1037',   // INVALID - NOT in field
        'espn_10166',  // Valid - in field
        'espn_10548',  // Valid - in field
        'espn_10577'   // INVALID - NOT in field
      ];

      const pgaField = [
        { player_id: 'espn_10054' },
        { player_id: 'espn_10166' },
        { player_id: 'espn_10548' }
        // Note: espn_10048, espn_1030, espn_1037, espn_10577 are NOT in the field
      ];

      const config = { roster_size: 7 };
      const result = validateRoster(rosterWithInvalidIds, config, pgaField);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('INVARIANT VIOLATION'))).toBe(true);
      expect(result.errors.some(e => e.includes('espn_10048'))).toBe(true);
      expect(result.errors.some(e => e.includes('espn_1030'))).toBe(true);
      expect(result.errors.some(e => e.includes('espn_1037'))).toBe(true);
      expect(result.errors.some(e => e.includes('espn_10577'))).toBe(true);
    });

    it('accepts roster where all player_ids are in field_selections.primary', () => {
      const validRoster = [
        'espn_10054',
        'espn_10166',
        'espn_10548'
      ];

      const pgaField = [
        { player_id: 'espn_10054' },
        { player_id: 'espn_10166' },
        { player_id: 'espn_10548' }
      ];

      const config = { roster_size: 7 };
      const result = validateRoster(validRoster, config, pgaField);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Sentinel test - no tier logic', () => {
    it('does not reference handicap, tier, or adjustment functions', () => {
      const source = require('fs').readFileSync(
        require('path').resolve(__dirname, '../../services/ContestRulesValidator/index.js'),
        'utf8'
      );

      expect(source).not.toMatch(/handicap/i);
      expect(source).not.toMatch(/tier/i);
      expect(source).not.toMatch(/adjustment/i);
    });
  });

  describe('Valid roster cases', () => {
    it('accepts valid roster matching exactly', () => {
      const roster = ['p1', 'p2', 'p3', 'p4'];
      const result = validateRoster(roster, validConfig, validField);

      expect(result).toEqual({
        valid: true,
        errors: []
      });
    });

    it('handles roster with specific valid players', () => {
      const roster = ['p2', 'p4', 'p3', 'p1']; // Different order, all valid
      const result = validateRoster(roster, validConfig, validField);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

describe('ContestRulesValidator - Module exports', () => {
  it('exports validateRoster function', () => {
    expect(typeof validateRoster).toBe('function');
  });
});
