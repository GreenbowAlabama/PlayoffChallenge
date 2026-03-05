/**
 * Ingestion Strategy Resolver Unit Tests
 *
 * Tests for resolveStrategyKey and extractEspnEventId functions
 */

'use strict';

describe('Ingestion Strategy Resolver', () => {
  const { resolveStrategyKey, extractEspnEventId } = require('../../services/ingestionStrategyResolver');

  describe('resolveStrategyKey', () => {
    it('should resolve pga_espn for espn_pga_ prefix', () => {
      const key = resolveStrategyKey('espn_pga_401811937');
      expect(key).toBe('pga_espn');
    });

    it('should resolve nfl_espn for espn_nfl_ prefix', () => {
      const key = resolveStrategyKey('espn_nfl_34567890');
      expect(key).toBe('nfl_espn');
    });

    it('should throw error for invalid format', () => {
      expect(() => {
        resolveStrategyKey('invalid_format');
      }).toThrow(/Unrecognized provider_tournament_id format/);
    });

    it('should throw error for missing provider_tournament_id', () => {
      expect(() => {
        resolveStrategyKey(null);
      }).toThrow(/provider_tournament_id is required/);
    });

    it('should throw error for empty string', () => {
      expect(() => {
        resolveStrategyKey('');
      }).toThrow(/provider_tournament_id is required/);
    });

    it('should throw error for non-string input', () => {
      expect(() => {
        resolveStrategyKey(123);
      }).toThrow(/provider_tournament_id is required/);
    });

    it('should throw error for other provider prefixes', () => {
      expect(() => {
        resolveStrategyKey('mlb_espn_401811937');
      }).toThrow(/Unrecognized provider_tournament_id format/);
    });
  });

  describe('extractEspnEventId', () => {
    it('should extract numeric event ID from espn_pga_ format', () => {
      const eventId = extractEspnEventId('espn_pga_401811937');
      expect(eventId).toBe('401811937');
    });

    it('should extract numeric event ID from espn_nfl_ format', () => {
      const eventId = extractEspnEventId('espn_nfl_34567890');
      expect(eventId).toBe('34567890');
    });

    it('should return null for invalid format', () => {
      const eventId = extractEspnEventId('espn_pga_abc');
      expect(eventId).toBeNull();
    });

    it('should return null for missing underscore', () => {
      const eventId = extractEspnEventId('espn_pga_');
      expect(eventId).toBeNull();
    });

    it('should return null for non-numeric event ID', () => {
      const eventId = extractEspnEventId('espn_pga_notanumber');
      expect(eventId).toBeNull();
    });

    it('should return null for null input', () => {
      const eventId = extractEspnEventId(null);
      expect(eventId).toBeNull();
    });

    it('should return null for undefined input', () => {
      const eventId = extractEspnEventId(undefined);
      expect(eventId).toBeNull();
    });

    it('should return null for non-string input', () => {
      const eventId = extractEspnEventId(123);
      expect(eventId).toBeNull();
    });
  });
});
