/**
 * Deduplication and Payload Hashing Tests
 *
 * Tests for:
 * - Deterministic payload hashing for deduplication
 * - Canonical JSON transformation (stable ordering)
 * - Detection of duplicate payloads
 */

const crypto = require('crypto');
const ingestionValidator = require('../../services/ingestionService/ingestionValidator');

describe('Payload Hashing and Deduplication', () => {
  describe('Canonical JSON transformation', () => {
    it('should sort object keys alphabetically for determinism', () => {
      const obj1 = { z: 1, a: 2, m: 3 };
      const obj2 = { a: 2, m: 3, z: 1 };

      const canonical1 = ingestionValidator.canonicalizeJson(obj1);
      const canonical2 = ingestionValidator.canonicalizeJson(obj2);

      const json1 = JSON.stringify(canonical1);
      const json2 = JSON.stringify(canonical2);

      expect(json1).toBe(json2);
      expect(json1).toBe('{"a":2,"m":3,"z":1}');
    });

    it('should preserve array order while sorting nested objects', () => {
      const obj = {
        items: [
          { z: 1, a: 2 },
          { y: 3, b: 4 }
        ]
      };

      const canonical = ingestionValidator.canonicalizeJson(obj);
      const json = JSON.stringify(canonical);

      // Arrays maintain order, but object keys within are sorted
      expect(json).toContain('"items":[{"a":2,"z":1},{"b":4,"y":3}]');
    });

    it('should handle deeply nested objects', () => {
      const obj = {
        outer: {
          z: {
            b: 1,
            a: 2
          },
          a: 3
        }
      };

      const canonical = ingestionValidator.canonicalizeJson(obj);
      const json = JSON.stringify(canonical);

      expect(json).toMatch(/"a":3/);
      expect(json).toMatch(/"a":2,"b":1/);
    });

    it('should handle null and undefined values', () => {
      const obj = {
        a: null,
        b: undefined,
        c: 'value'
      };

      const canonical = ingestionValidator.canonicalizeJson(obj);

      expect(canonical.a).toBeNull();
      expect(canonical.b).toBeUndefined();
      expect(canonical.c).toBe('value');
    });

    it('should handle primitives unchanged', () => {
      expect(ingestionValidator.canonicalizeJson(123)).toBe(123);
      expect(ingestionValidator.canonicalizeJson('string')).toBe('string');
      expect(ingestionValidator.canonicalizeJson(true)).toBe(true);
      expect(ingestionValidator.canonicalizeJson(null)).toBe(null);
    });
  });

  describe('Payload hash computation', () => {
    it('should compute consistent hash from same data', () => {
      const payload = {
        player_id: 'player123',
        round_number: 1,
        strokes: 72
      };

      const hash1 = computePayloadHash(payload);
      const hash2 = computePayloadHash(payload);

      expect(hash1).toBe(hash2);
    });

    it('should compute same hash regardless of input key order', () => {
      const payload1 = {
        player_id: 'player123',
        round_number: 1,
        strokes: 72
      };
      const payload2 = {
        strokes: 72,
        player_id: 'player123',
        round_number: 1
      };

      const hash1 = computePayloadHash(payload1);
      const hash2 = computePayloadHash(payload2);

      expect(hash1).toBe(hash2);
    });

    it('should compute different hash for different data', () => {
      const payload1 = {
        player_id: 'player123',
        strokes: 72
      };
      const payload2 = {
        player_id: 'player123',
        strokes: 73 // Different value
      };

      const hash1 = computePayloadHash(payload1);
      const hash2 = computePayloadHash(payload2);

      expect(hash1).not.toBe(hash2);
    });

    it('should be immune to deep property reordering', () => {
      const payload1 = {
        round: 1,
        player: {
          name: 'John',
          id: 'p123'
        }
      };
      const payload2 = {
        player: {
          id: 'p123',
          name: 'John'
        },
        round: 1
      };

      const hash1 = computePayloadHash(payload1);
      const hash2 = computePayloadHash(payload2);

      expect(hash1).toBe(hash2);
    });

    it('should produce SHA-256 hash (64-char hex string)', () => {
      const payload = { test: 'data' };
      const hash = computePayloadHash(payload);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('Deduplication logic', () => {
    it('should detect duplicate payloads by hash', () => {
      const payload = {
        player_id: 'player123',
        round_number: 1,
        strokes: 72
      };

      const hash1 = computePayloadHash(payload);
      const hash2 = computePayloadHash(payload);

      // Same payload should produce same hash
      expect(hash1).toBe(hash2);
    });

    it('should distinguish minor differences', () => {
      const payload1 = {
        player_id: 'player123',
        round_number: 1,
        strokes: 72,
        status: 'active'
      };
      const payload2 = {
        player_id: 'player123',
        round_number: 1,
        strokes: 72
        // Missing status field
      };

      const hash1 = computePayloadHash(payload1);
      const hash2 = computePayloadHash(payload2);

      expect(hash1).not.toBe(hash2);
    });

    it('should distinguish extra whitespace or formatting', () => {
      const payload1 = { text: 'hello world' };
      const payload2 = { text: 'hello  world' }; // Extra space

      const hash1 = computePayloadHash(payload1);
      const hash2 = computePayloadHash(payload2);

      expect(hash1).not.toBe(hash2);
    });
  });
});

/**
 * Helper: compute payload hash using canonical JSON
 * @param {Object} payload - Data to hash
 * @returns {string} SHA-256 hash (hex)
 */
function computePayloadHash(payload) {
  const canonical = ingestionValidator.canonicalizeJson(payload);
  const json = JSON.stringify(canonical);
  return crypto.createHash('sha256').update(json).digest('hex');
}
