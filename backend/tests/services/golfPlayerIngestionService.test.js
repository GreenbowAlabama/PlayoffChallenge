/**
 * Golf Player Ingestion Service Tests
 *
 * Tests the orchestration of fetching golfers from ESPN and persisting to database.
 */

const golfPlayerIngestionService = require('../../services/ingestion/golfPlayerIngestionService');
const espnPgaPlayerService = require('../../services/ingestion/espn/espnPgaPlayerService');
const golfPlayerRepository = require('../../repositories/golfPlayerRepository');
const { getPoolForTest } = require('../mocks/testAppFactory');

jest.mock('../../services/ingestion/espn/espnPgaPlayerService');
jest.mock('../../repositories/golfPlayerRepository');

describe('Golf Player Ingestion Service', () => {
  let pool;

  beforeAll(async () => {
    pool = getPoolForTest();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ingestGolfPlayers', () => {
    it('should fetch golfers and persist them', async () => {
      const mockGolfers = [
        {
          external_id: 'espn_12345',
          name: 'Rory McIlroy',
          short_name: 'R. McIlroy',
          image_url: 'https://example.com/rory.jpg',
          sport: 'GOLF',
          position: 'G'
        },
        {
          external_id: 'espn_67890',
          name: 'Jon Rahm',
          short_name: 'J. Rahm',
          image_url: 'https://example.com/jon.jpg',
          sport: 'GOLF',
          position: 'G'
        }
      ];

      espnPgaPlayerService.fetchGolfers.mockResolvedValue(mockGolfers);
      golfPlayerRepository.upsertGolfPlayers.mockResolvedValue({
        inserted: 2,
        updated: 0
      });

      const result = await golfPlayerIngestionService.ingestGolfPlayers(pool);

      expect(result).toEqual({
        success: true,
        players_fetched: 2,
        players_inserted: 2,
        players_updated: 0
      });

      expect(espnPgaPlayerService.fetchGolfers).toHaveBeenCalled();
      expect(golfPlayerRepository.upsertGolfPlayers).toHaveBeenCalledWith(
        pool,
        mockGolfers
      );
    });

    it('should handle mixed inserts and updates', async () => {
      const mockGolfers = [
        {
          external_id: 'espn_12345',
          name: 'Rory McIlroy',
          short_name: 'R. McIlroy',
          image_url: 'https://example.com/rory.jpg',
          sport: 'GOLF',
          position: 'G'
        },
        {
          external_id: 'espn_67890',
          name: 'Jon Rahm',
          short_name: 'J. Rahm',
          image_url: 'https://example.com/jon.jpg',
          sport: 'GOLF',
          position: 'G'
        },
        {
          external_id: 'espn_99999',
          name: 'Tiger Woods',
          short_name: 'T. Woods',
          image_url: 'https://example.com/tiger.jpg',
          sport: 'GOLF',
          position: 'G'
        }
      ];

      espnPgaPlayerService.fetchGolfers.mockResolvedValue(mockGolfers);
      golfPlayerRepository.upsertGolfPlayers.mockResolvedValue({
        inserted: 2,
        updated: 1
      });

      const result = await golfPlayerIngestionService.ingestGolfPlayers(pool);

      expect(result).toEqual({
        success: true,
        players_fetched: 3,
        players_inserted: 2,
        players_updated: 1
      });
    });

    it('should handle ESPN API errors gracefully', async () => {
      espnPgaPlayerService.fetchGolfers.mockRejectedValue(
        new Error('ESPN API Error')
      );

      const result = await golfPlayerIngestionService.ingestGolfPlayers(pool);

      expect(result).toEqual({
        success: false,
        error: 'ESPN API Error',
        players_fetched: 0
      });

      expect(golfPlayerRepository.upsertGolfPlayers).not.toHaveBeenCalled();
    });

    it('should handle repository errors gracefully', async () => {
      const mockGolfers = [
        {
          external_id: 'espn_12345',
          name: 'Rory McIlroy',
          short_name: 'R. McIlroy',
          image_url: 'https://example.com/rory.jpg',
          sport: 'GOLF',
          position: 'G'
        }
      ];

      espnPgaPlayerService.fetchGolfers.mockResolvedValue(mockGolfers);
      golfPlayerRepository.upsertGolfPlayers.mockRejectedValue(
        new Error('Database Error')
      );

      const result = await golfPlayerIngestionService.ingestGolfPlayers(pool);

      expect(result).toEqual({
        success: false,
        error: 'Database Error',
        players_fetched: 1
      });
    });

    it('should log ingestion results', async () => {
      const mockGolfers = [
        {
          external_id: 'espn_12345',
          name: 'Rory McIlroy',
          short_name: 'R. McIlroy',
          image_url: 'https://example.com/rory.jpg',
          sport: 'GOLF',
          position: 'G'
        }
      ];

      espnPgaPlayerService.fetchGolfers.mockResolvedValue(mockGolfers);
      golfPlayerRepository.upsertGolfPlayers.mockResolvedValue({
        inserted: 1,
        updated: 0
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await golfPlayerIngestionService.ingestGolfPlayers(pool);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[GolfPlayerIngestion]')
      );

      consoleSpy.mockRestore();
    });
  });
});
