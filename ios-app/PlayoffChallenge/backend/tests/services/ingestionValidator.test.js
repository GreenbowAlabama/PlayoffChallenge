/**
 * Ingestion Validator Tests
 *
 * Tests for strict validation of provider data.
 * Covers:
 * - Type strictness (no coercion of floats, strings, NaN, Infinity)
 * - Required fields validation
 * - Player/participant validation
 * - Range validation
 * - Explicit error codes with field paths
 * - Pure function behavior (no side effects)
 */

const { INGESTION_ERROR_CODES } = require('../../services/ingestionService/errorCodes');
const ingestionValidator = require('../../services/ingestionService/ingestionValidator');

describe('Ingestion Validator', () => {
  const validator = ingestionValidator;

  describe('Type strictness: rejecting floats', () => {
    it('should reject float when integer expected', () => {
      const data = {
        player_id: 'player123',
        round_number: 1,
        strokes: 72.5 // Float - should be integer
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' }
      };

      const result = validator.validate(data, schema, []);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: INGESTION_ERROR_CODES.INVALID_DATA_TYPE,
            field: 'strokes',
            message: expect.stringContaining('float')
          })
        ])
      );
    });

    it('should reject NaN value', () => {
      const data = {
        player_id: 'player123',
        round_number: 1,
        strokes: NaN
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' }
      };

      const result = validator.validate(data, schema, []);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: INGESTION_ERROR_CODES.INVALID_DATA_TYPE,
            field: 'strokes'
          })
        ])
      );
    });

    it('should reject Infinity value', () => {
      const data = {
        player_id: 'player123',
        round_number: 1,
        strokes: Infinity
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' }
      };

      const result = validator.validate(data, schema, []);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: INGESTION_ERROR_CODES.INVALID_DATA_TYPE,
            field: 'strokes'
          })
        ])
      );
    });
  });

  describe('Type strictness: rejecting numeric strings', () => {
    it('should reject numeric string when integer expected', () => {
      const data = {
        player_id: 'player123',
        round_number: '1', // String - should be integer
        strokes: 72
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { round_number: 'integer' }
      };

      const result = validator.validate(data, schema, []);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: INGESTION_ERROR_CODES.NUMERIC_STRING_NOT_ALLOWED,
            field: 'round_number'
          })
        ])
      );
    });

    it('should reject numeric string for score field', () => {
      const data = {
        player_id: 'player123',
        round_number: 1,
        strokes: '72' // String - should be integer
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' }
      };

      const result = validator.validate(data, schema, []);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: INGESTION_ERROR_CODES.NUMERIC_STRING_NOT_ALLOWED,
            field: 'strokes'
          })
        ])
      );
    });
  });

  describe('Required field validation', () => {
    it('should reject missing required field', () => {
      const data = {
        player_id: 'player123',
        round_number: 1
        // Missing strokes
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' }
      };

      const result = validator.validate(data, schema, []);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: INGESTION_ERROR_CODES.MISSING_REQUIRED_FIELD,
            field: 'strokes'
          })
        ])
      );
    });

    it('should reject null required field', () => {
      const data = {
        player_id: 'player123',
        round_number: 1,
        strokes: null
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' }
      };

      const result = validator.validate(data, schema, []);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: INGESTION_ERROR_CODES.MISSING_REQUIRED_FIELD,
            field: 'strokes'
          })
        ])
      );
    });

    it('should reject undefined required field', () => {
      const data = {
        player_id: 'player123',
        round_number: 1,
        strokes: undefined
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' }
      };

      const result = validator.validate(data, schema, []);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: INGESTION_ERROR_CODES.MISSING_REQUIRED_FIELD,
            field: 'strokes'
          })
        ])
      );
    });
  });

  describe('Player/participant validation', () => {
    it('should reject unknown player_id', () => {
      const data = {
        player_id: 'unknown_player',
        round_number: 1,
        strokes: 72
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' }
      };
      const participants = [
        { id: 'player123', name: 'John Doe' },
        { id: 'player456', name: 'Jane Smith' }
      ];

      const result = validator.validate(data, schema, participants);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: INGESTION_ERROR_CODES.INVALID_PLAYER_ID,
            player_id: 'unknown_player'
          })
        ])
      );
    });

    it('should accept known player_id', () => {
      const data = {
        player_id: 'player123',
        round_number: 1,
        strokes: 72
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' }
      };
      const participants = [
        { id: 'player123', name: 'John Doe' },
        { id: 'player456', name: 'Jane Smith' }
      ];

      const result = validator.validate(data, schema, participants);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });

  describe('Range validation', () => {
    it('should reject round number > configured max', () => {
      const data = {
        player_id: 'player123',
        round_number: 5, // Max is 4
        strokes: 72
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' },
        round_max: 4
      };

      const result = validator.validate(data, schema, []);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: INGESTION_ERROR_CODES.INVALID_ROUND_NUMBER,
            field: 'round_number'
          })
        ])
      );
    });

    it('should accept round number within range', () => {
      const data = {
        player_id: 'player123',
        round_number: 4,
        strokes: 72
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' },
        round_max: 4
      };
      const participants = [
        { id: 'player123', name: 'John Doe' }
      ];

      const result = validator.validate(data, schema, participants);

      expect(result.valid).toBe(true);
    });

    it('should reject negative score', () => {
      const data = {
        player_id: 'player123',
        round_number: 1,
        strokes: -1
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' },
        strokes_range: { min: 0, max: 200 }
      };

      const result = validator.validate(data, schema, []);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: INGESTION_ERROR_CODES.OUT_OF_RANGE_SCORE,
            field: 'strokes'
          })
        ])
      );
    });

    it('should reject score above max', () => {
      const data = {
        player_id: 'player123',
        round_number: 1,
        strokes: 250
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' },
        strokes_range: { min: 0, max: 200 }
      };

      const result = validator.validate(data, schema, []);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: INGESTION_ERROR_CODES.OUT_OF_RANGE_SCORE,
            field: 'strokes'
          })
        ])
      );
    });
  });

  describe('Multiple errors collected', () => {
    it('should collect all validation errors without stopping early', () => {
      const data = {
        player_id: 'unknown',
        round_number: 5, // Out of range
        strokes: 72.5 // Float
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' },
        round_max: 4,
        strokes_range: { min: 0, max: 200 }
      };
      const participants = [
        { id: 'player123', name: 'John Doe' }
      ];

      const result = validator.validate(data, schema, participants);

      expect(result.valid).toBe(false);
      // Should collect all 3 errors
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: INGESTION_ERROR_CODES.INVALID_PLAYER_ID }),
          expect.objectContaining({ code: INGESTION_ERROR_CODES.INVALID_ROUND_NUMBER }),
          expect.objectContaining({ code: INGESTION_ERROR_CODES.INVALID_DATA_TYPE })
        ])
      );
    });
  });

  describe('Valid data acceptance', () => {
    it('should accept valid data without modification', () => {
      const data = {
        player_id: 'player123',
        round_number: 3,
        strokes: 72,
        status: 'cut' // Optional field
      };
      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' },
        round_max: 4,
        strokes_range: { min: 0, max: 200 }
      };
      const participants = [
        { id: 'player123', name: 'John Doe' }
      ];

      const result = validator.validate(data, schema, participants);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      // Data should not be modified
      expect(result.data).toEqual(data);
    });
  });

  describe('Pure function behavior', () => {
    it('should not modify input data', () => {
      const data = {
        player_id: 'player123',
        round_number: 1,
        strokes: 72
      };
      const originalData = JSON.parse(JSON.stringify(data));

      const schema = {
        required_fields: ['player_id', 'round_number', 'strokes'],
        field_types: { strokes: 'integer' }
      };

      validator.validate(data, schema, []);

      expect(data).toEqual(originalData);
    });

    it('should not have side effects', () => {
      const data = { player_id: 'player123', strokes: 72 };
      const schema = { required_fields: ['strokes'] };

      const result1 = validator.validate(data, schema, []);
      const result2 = validator.validate(data, schema, []);

      // Same input should always produce identical output
      expect(result1).toEqual(result2);
    });
  });
});
