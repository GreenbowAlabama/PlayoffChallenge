/**
 * Golf Engine Service Tests
 *
 * Comprehensive tests for golfEngine service ensuring:
 * - Config validation catches all missing required fields
 * - Deterministic field selection
 * - Deterministic stroke play scoring
 * - Fail-loud on missing leaderboard fields
 * - No silent failures
 */

const golfEngine = require('../../services/golfEngine');
const { validateConfig } = require('../../services/golfEngine/validateConfig');
const { selectField } = require('../../services/golfEngine/selectField');
const { applyStrokePlayScoring } = require('../../services/golfEngine/applyStrokePlayScoring');

describe('Golf Engine - validateConfig', () => {
  describe('Required field validation', () => {
    const validBaseConfig = {
      provider_event_id: 'event-123',
      ingestion_endpoint: 'https://example.com/api',
      event_start_date: new Date(),
      event_end_date: new Date(),
      round_count: 4,
      leaderboard_schema_version: 1,
      field_source: 'provider_sync'
    };

    it('rejects missing provider_event_id', () => {
      const config = { ...validBaseConfig, provider_event_id: undefined };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('provider_event_id'))).toBe(true);
    });

    it('rejects missing ingestion_endpoint', () => {
      const config = { ...validBaseConfig, ingestion_endpoint: undefined };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('ingestion_endpoint'))).toBe(true);
    });

    it('rejects missing event_start_date', () => {
      const config = { ...validBaseConfig, event_start_date: undefined };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('event_start_date'))).toBe(true);
    });

    it('rejects missing event_end_date', () => {
      const config = { ...validBaseConfig, event_end_date: undefined };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('event_end_date'))).toBe(true);
    });

    it('rejects missing round_count', () => {
      const config = { ...validBaseConfig, round_count: undefined };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('round_count'))).toBe(true);
    });

    it('rejects missing leaderboard_schema_version', () => {
      const config = { ...validBaseConfig, leaderboard_schema_version: undefined };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('leaderboard_schema_version'))).toBe(true);
    });

    it('rejects missing field_source', () => {
      const config = { ...validBaseConfig, field_source: undefined };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('field_source'))).toBe(true);
    });
  });

  describe('cut_after_round validation', () => {
    const validBaseConfig = {
      provider_event_id: 'event-123',
      ingestion_endpoint: 'https://example.com/api',
      event_start_date: new Date(),
      event_end_date: new Date(),
      round_count: 4,
      leaderboard_schema_version: 1,
      field_source: 'provider_sync'
    };

    it('accepts valid cut_after_round within range', () => {
      const config = { ...validBaseConfig, cut_after_round: 2 };
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts cut_after_round equal to round_count', () => {
      const config = { ...validBaseConfig, cut_after_round: 4 };
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('accepts no cut_after_round (undefined)', () => {
      const config = { ...validBaseConfig, cut_after_round: undefined };
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('accepts no cut_after_round (null)', () => {
      const config = { ...validBaseConfig, cut_after_round: null };
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('rejects cut_after_round less than 1', () => {
      const config = { ...validBaseConfig, cut_after_round: 0 };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('cut_after_round'))).toBe(true);
    });

    it('rejects cut_after_round greater than round_count', () => {
      const config = { ...validBaseConfig, cut_after_round: 5 };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('cut_after_round'))).toBe(true);
    });

    it('rejects non-numeric cut_after_round', () => {
      const config = { ...validBaseConfig, cut_after_round: 'two' };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('cut_after_round'))).toBe(true);
    });
  });

  describe('leaderboard_schema_version validation', () => {
    const validBaseConfig = {
      provider_event_id: 'event-123',
      ingestion_endpoint: 'https://example.com/api',
      event_start_date: new Date(),
      event_end_date: new Date(),
      round_count: 4,
      field_source: 'provider_sync'
    };

    it('accepts supported schema version 1', () => {
      const config = { ...validBaseConfig, leaderboard_schema_version: 1 };
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('rejects unsupported schema version 2', () => {
      const config = { ...validBaseConfig, leaderboard_schema_version: 2 };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unsupported') && e.includes('schema'))).toBe(true);
    });

    it('rejects non-numeric schema version', () => {
      const config = { ...validBaseConfig, leaderboard_schema_version: '1' };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('leaderboard_schema_version'))).toBe(true);
    });
  });

  describe('field_source validation', () => {
    const validBaseConfig = {
      provider_event_id: 'event-123',
      ingestion_endpoint: 'https://example.com/api',
      event_start_date: new Date(),
      event_end_date: new Date(),
      round_count: 4,
      leaderboard_schema_version: 1
    };

    it('accepts provider_sync', () => {
      const config = { ...validBaseConfig, field_source: 'provider_sync' };
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('accepts static_import', () => {
      const config = { ...validBaseConfig, field_source: 'static_import' };
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('rejects invalid field_source', () => {
      const config = { ...validBaseConfig, field_source: 'invalid_source' };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('field_source'))).toBe(true);
    });
  });

  describe('Multiple errors reporting', () => {
    it('collects all validation errors', () => {
      const result = validateConfig({
        // All fields missing/invalid
        provider_event_id: undefined,
        event_start_date: undefined,
        round_count: -1,
        leaderboard_schema_version: 5
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });
});

describe('Golf Engine - selectField', () => {
  const validConfig = {
    provider_event_id: 'event-123',
    ingestion_endpoint: 'https://example.com/api',
    event_start_date: new Date(),
    event_end_date: new Date(),
    round_count: 4,
    leaderboard_schema_version: 1,
    field_source: 'provider_sync'
  };

  describe('Determinism', () => {
    it('same input produces identical output on repeated calls', () => {
      const participants = [
        { player_id: 'player-3', name: 'Alice' },
        { player_id: 'player-1', name: 'Bob' },
        { player_id: 'player-2', name: 'Charlie' }
      ];

      const result1 = selectField(validConfig, participants);
      const result2 = selectField(validConfig, participants);
      const result3 = selectField(validConfig, participants);

      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
    });

    it('maintains consistent ordering by player_id', () => {
      const participants = [
        { player_id: 'player-3', name: 'Alice' },
        { player_id: 'player-1', name: 'Bob' },
        { player_id: 'player-2', name: 'Charlie' }
      ];

      const result = selectField(validConfig, participants);

      expect(result.primary).toHaveLength(3);
      expect(result.primary[0].player_id).toBe('player-1');
      expect(result.primary[1].player_id).toBe('player-2');
      expect(result.primary[2].player_id).toBe('player-3');
    });

    it('different participant orders produce same result', () => {
      const set1 = [
        { player_id: 'player-3', name: 'Alice' },
        { player_id: 'player-1', name: 'Bob' },
        { player_id: 'player-2', name: 'Charlie' }
      ];

      const set2 = [
        { player_id: 'player-1', name: 'Bob' },
        { player_id: 'player-3', name: 'Alice' },
        { player_id: 'player-2', name: 'Charlie' }
      ];

      const result1 = selectField(validConfig, set1);
      const result2 = selectField(validConfig, set2);

      expect(result1.primary).toEqual(result2.primary);
    });
  });

  describe('Error handling', () => {
    it('throws on invalid config', () => {
      const invalidConfig = { ...validConfig, leaderboard_schema_version: 99 };
      const participants = [{ player_id: 'p1' }];

      expect(() => selectField(invalidConfig, participants)).toThrow();
    });

    it('throws if participants not an array', () => {
      expect(() => selectField(validConfig, { player_id: 'p1' })).toThrow('Participants must be an array');
    });

    it('throws if participant missing player_id', () => {
      const participants = [
        { player_id: 'p1' },
        { name: 'No ID' }
      ];

      expect(() => selectField(validConfig, participants)).toThrow();
    });

    it('handles empty participants array', () => {
      const result = selectField(validConfig, []);
      expect(result).toEqual({ primary: [], alternates: [] });
    });
  });
});

describe('Golf Engine - applyStrokePlayScoring', () => {
  const validConfig = {
    provider_event_id: 'event-123',
    ingestion_endpoint: 'https://example.com/api',
    event_start_date: new Date(),
    event_end_date: new Date(),
    round_count: 4,
    leaderboard_schema_version: 1,
    field_source: 'provider_sync'
  };

  describe('Determinism', () => {
    it('same leaderboard produces identical scores on repeated calls', () => {
      const leaderboard = [
        { player_id: 'p3', total_strokes: 280 },
        { player_id: 'p1', total_strokes: 270 },
        { player_id: 'p2', total_strokes: 275 }
      ];

      const result1 = applyStrokePlayScoring(validConfig, leaderboard, {});
      const result2 = applyStrokePlayScoring(validConfig, leaderboard, {});
      const result3 = applyStrokePlayScoring(validConfig, leaderboard, {});

      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
    });

    it('produces deterministic ordering in scores object', () => {
      const leaderboard = [
        { player_id: 'p3', total_strokes: 280 },
        { player_id: 'p1', total_strokes: 270 },
        { player_id: 'p2', total_strokes: 275 }
      ];

      const result = applyStrokePlayScoring(validConfig, leaderboard, {});
      const keys = Object.keys(result.scores);

      // Keys should be in sorted order
      expect(keys).toEqual(['p1', 'p2', 'p3']);
    });

    it('different leaderboard order produces same scores mapping', () => {
      const lb1 = [
        { player_id: 'p3', total_strokes: 280 },
        { player_id: 'p1', total_strokes: 270 },
        { player_id: 'p2', total_strokes: 275 }
      ];

      const lb2 = [
        { player_id: 'p1', total_strokes: 270 },
        { player_id: 'p2', total_strokes: 275 },
        { player_id: 'p3', total_strokes: 280 }
      ];

      const result1 = applyStrokePlayScoring(validConfig, lb1, {});
      const result2 = applyStrokePlayScoring(validConfig, lb2, {});

      expect(result1.scores).toEqual(result2.scores);
    });
  });

  describe('Scoring rules', () => {
    it('uses total_strokes as score', () => {
      const leaderboard = [
        { player_id: 'p1', total_strokes: 270 }
      ];

      const result = applyStrokePlayScoring(validConfig, leaderboard, {});
      expect(result.scores.p1).toBe(270);
    });

    it('floors floating point scores to integers', () => {
      const leaderboard = [
        { player_id: 'p1', total_strokes: 270.7 },
        { player_id: 'p2', total_strokes: 275.2 }
      ];

      const result = applyStrokePlayScoring(validConfig, leaderboard, {});
      expect(result.scores.p1).toBe(270);
      expect(result.scores.p2).toBe(275);
      expect(typeof result.scores.p1).toBe('number');
    });
  });

  describe('Missing leaderboard fields', () => {
    it('throws if player_id missing', () => {
      const leaderboard = [
        { total_strokes: 270 }
      ];

      expect(() => applyStrokePlayScoring(validConfig, leaderboard, {})).toThrow('player_id');
    });

    it('throws if total_strokes missing', () => {
      const leaderboard = [
        { player_id: 'p1' }
      ];

      expect(() => applyStrokePlayScoring(validConfig, leaderboard, {})).toThrow('total_strokes');
    });

    it('throws if total_strokes is null', () => {
      const leaderboard = [
        { player_id: 'p1', total_strokes: null }
      ];

      expect(() => applyStrokePlayScoring(validConfig, leaderboard, {})).toThrow('invalid total_strokes');
    });

    it('throws if total_strokes is negative', () => {
      const leaderboard = [
        { player_id: 'p1', total_strokes: -5 }
      ];

      expect(() => applyStrokePlayScoring(validConfig, leaderboard, {})).toThrow('invalid total_strokes');
    });

    it('includes context about which player has missing field', () => {
      const leaderboard = [
        { player_id: 'problem-player', total_strokes: undefined }
      ];

      expect(() => applyStrokePlayScoring(validConfig, leaderboard, {})).toThrow('problem-player');
    });
  });

  describe('Error handling', () => {
    it('throws on invalid config', () => {
      const invalidConfig = { ...validConfig, leaderboard_schema_version: 99 };
      const leaderboard = [{ player_id: 'p1', total_strokes: 270 }];

      expect(() => applyStrokePlayScoring(invalidConfig, leaderboard, {})).toThrow();
    });

    it('throws if leaderboard not an array', () => {
      expect(() => applyStrokePlayScoring(validConfig, { player_id: 'p1', total_strokes: 270 }, {}))
        .toThrow('Leaderboard must be an array');
    });

    it('handles empty leaderboard', () => {
      const result = applyStrokePlayScoring(validConfig, [], {});
      expect(result.scores).toEqual({});
    });
  });

  describe('Sentinel test - no tier logic', () => {
    it('does not reference handicap, tier, or adjustment functions', () => {
      const source = require('fs').readFileSync(
        require('path').resolve(__dirname, '../../services/golfEngine/applyStrokePlayScoring.js'),
        'utf8'
      );

      expect(source).not.toMatch(/handicap/i);
      expect(source).not.toMatch(/tier/i);
      expect(source).not.toMatch(/adjustment/i);
    });
  });
});

describe('Golf Engine - Module exports', () => {
  it('exports validateConfig function', () => {
    expect(typeof golfEngine.validateConfig).toBe('function');
  });

  it('exports selectField function', () => {
    expect(typeof golfEngine.selectField).toBe('function');
  });

  it('exports applyStrokePlayScoring function', () => {
    expect(typeof golfEngine.applyStrokePlayScoring).toBe('function');
  });
});
