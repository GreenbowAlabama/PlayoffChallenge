/**
 * ESPN PGA Player Service Tests
 *
 * Tests the service that fetches and normalizes golfers from ESPN.
 */

const espnPgaPlayerService = require('../../services/ingestion/espn/espnPgaPlayerService');

// Mock axios for ESPN API calls
jest.mock('axios');
const axios = require('axios');

describe('ESPN PGA Player Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchGolfers', () => {
    it('should fetch golfers from ESPN and normalize them', async () => {
      const mockEspnResponse = {
        data: {
          athletes: [
            {
              id: '12345',
              displayName: 'Rory McIlroy',
              shortName: 'R. McIlroy',
              headshot: {
                href: 'https://a.espncdn.com/media/golf/players/12345.jpg'
              }
            },
            {
              id: '67890',
              displayName: 'Jon Rahm',
              shortName: 'J. Rahm',
              headshot: {
                href: 'https://a.espncdn.com/media/golf/players/67890.jpg'
              }
            }
          ]
        }
      };

      axios.get.mockResolvedValue(mockEspnResponse);

      const result = await espnPgaPlayerService.fetchGolfers();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        external_id: '12345',
        name: 'Rory McIlroy',
        short_name: 'R. McIlroy',
        image_url: 'https://a.espncdn.com/media/golf/players/12345.jpg',
        sport: 'GOLF',
        position: 'G'
      });
      expect(result[1]).toEqual({
        external_id: '67890',
        name: 'Jon Rahm',
        short_name: 'J. Rahm',
        image_url: 'https://a.espncdn.com/media/golf/players/67890.jpg',
        sport: 'GOLF',
        position: 'G'
      });
    });

    it('should handle missing headshot gracefully', async () => {
      const mockEspnResponse = {
        data: {
          athletes: [
            {
              id: '12345',
              displayName: 'Rory McIlroy',
              shortName: 'R. McIlroy',
              headshot: null
            }
          ]
        }
      };

      axios.get.mockResolvedValue(mockEspnResponse);

      const result = await espnPgaPlayerService.fetchGolfers();

      expect(result).toHaveLength(1);
      expect(result[0].image_url).toBeNull();
    });

    it('should call ESPN API with correct endpoint', async () => {
      const mockEspnResponse = {
        data: {
          athletes: []
        }
      };

      axios.get.mockResolvedValue(mockEspnResponse);

      await espnPgaPlayerService.fetchGolfers();

      expect(axios.get).toHaveBeenCalledWith(
        'https://site.web.api.espn.com/apis/v2/sports/golf/pga/athletes',
        expect.any(Object)
      );
    });

    it('should throw on ESPN API error', async () => {
      axios.get.mockRejectedValue(new Error('API Error'));

      await expect(espnPgaPlayerService.fetchGolfers()).rejects.toThrow(
        'API Error'
      );
    });

    it('should return empty array when no athletes in response', async () => {
      const mockEspnResponse = {
        data: {
          athletes: []
        }
      };

      axios.get.mockResolvedValue(mockEspnResponse);

      const result = await espnPgaPlayerService.fetchGolfers();

      expect(result).toEqual([]);
    });
  });

  describe('normalizeGolfer', () => {
    it('should normalize a single golfer object', () => {
      const espnAthlete = {
        id: '12345',
        displayName: 'Tiger Woods',
        shortName: 'T. Woods',
        headshot: {
          href: 'https://example.com/tiger.jpg'
        }
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized).toEqual({
        external_id: '12345',
        name: 'Tiger Woods',
        short_name: 'T. Woods',
        image_url: 'https://example.com/tiger.jpg',
        sport: 'GOLF',
        position: 'G'
      });
    });

    it('should handle null headshot', () => {
      const espnAthlete = {
        id: '99999',
        displayName: 'Unknown Golfer',
        shortName: 'U. Golfer',
        headshot: null
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized.image_url).toBeNull();
      expect(normalized.external_id).toBe('99999');
    });
  });
});
