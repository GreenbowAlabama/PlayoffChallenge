'use strict';

const { computeIngestionKey } = require('../../services/ingestion/strategies/pgaEspnIngestion');

describe('computeIngestionKey', () => {
  const contestInstanceId = 'test-contest-123';

  describe('with providerData (SCORING phase)', () => {
    it('should compute deterministic key using providerData', () => {
      const unit = {
        providerEventId: 'espn-2024-masters',
        providerData: {
          events: [
            {
              competitions: [
                {
                  competitors: [
                    {
                      id: 'player-1',
                      linescores: [
                        {
                          period: 1,
                          linescores: Array(18).fill({ value: 4, period: 1 })
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      };

      const key = computeIngestionKey(contestInstanceId, unit);
      expect(key).toMatch(/^pga_espn:test-contest-123:[a-f0-9]{64}$/);
    });

    it('should produce same key for identical payloads (idempotent)', () => {
      const unit = {
        providerEventId: 'espn-2024-masters',
        providerData: {
          events: [
            {
              competitions: [
                {
                  competitors: [
                    {
                      id: 'player-1',
                      linescores: [
                        {
                          period: 1,
                          linescores: Array(18).fill({ value: 4, period: 1 })
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      };

      const key1 = computeIngestionKey(contestInstanceId, unit);
      const key2 = computeIngestionKey(contestInstanceId, unit);
      expect(key1).toEqual(key2);
    });
  });

  describe('without providerData (PLAYER_POOL phase)', () => {
    it('should use playerId fallback when providerData missing', () => {
      const unit = {
        providerEventId: null,
        providerData: null,
        playerId: 'player-123'
      };

      const key = computeIngestionKey(contestInstanceId, unit);
      expect(key).toBe('player_pool:player-123');
    });

    it('should use externalPlayerId fallback when providerData and playerId missing', () => {
      const unit = {
        providerEventId: null,
        providerData: null,
        externalPlayerId: 'espn-player-456'
      };

      const key = computeIngestionKey(contestInstanceId, unit);
      expect(key).toBe('player_pool:espn-player-456');
    });

    it('should prefer playerId over externalPlayerId when both present', () => {
      const unit = {
        providerEventId: null,
        providerData: null,
        playerId: 'player-123',
        externalPlayerId: 'espn-player-456'
      };

      const key = computeIngestionKey(contestInstanceId, unit);
      expect(key).toBe('player_pool:player-123');
    });

    it('should throw error when no identifiers present', () => {
      const unit = {
        providerEventId: null,
        providerData: null
      };

      expect(() => {
        computeIngestionKey(contestInstanceId, unit);
      }).toThrow('Cannot compute ingestion key: missing providerData and player identifier');
    });

    it('should produce stable key for same playerId (idempotent)', () => {
      const unit = {
        providerEventId: null,
        providerData: null,
        playerId: 'player-789'
      };

      const key1 = computeIngestionKey(contestInstanceId, unit);
      const key2 = computeIngestionKey(contestInstanceId, unit);
      expect(key1).toEqual(key2);
    });
  });

  describe('validation', () => {
    it('should require contestInstanceId', () => {
      const unit = {
        providerEventId: 'espn-event',
        providerData: { events: [] }
      };

      expect(() => {
        computeIngestionKey(null, unit);
      }).toThrow('contestInstanceId is required');
    });

    it('should require unit', () => {
      expect(() => {
        computeIngestionKey(contestInstanceId, null);
      }).toThrow('unit is required');
    });

    it('should require providerEventId', () => {
      const unit = {
        providerData: { events: [] }
      };

      expect(() => {
        computeIngestionKey(contestInstanceId, unit);
      }).toThrow('unit.providerEventId is required');
    });
  });
});
