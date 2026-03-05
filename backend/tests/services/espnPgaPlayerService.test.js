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
    it('should fetch golfers from ESPN scoreboard and normalize them', async () => {
      const mockEspnResponse = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '12345',
                        displayName: 'Rory McIlroy',
                        headshot: {
                          href: 'https://a.espncdn.com/media/golf/players/12345.jpg'
                        }
                      }
                    },
                    {
                      athlete: {
                        id: '67890',
                        displayName: 'Jon Rahm',
                        headshot: {
                          href: 'https://a.espncdn.com/media/golf/players/67890.jpg'
                        }
                      }
                    }
                  ]
                }
              ]
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
        image_url: 'https://a.espncdn.com/media/golf/players/12345.jpg',
        sport: 'GOLF',
        position: 'G'
      });
      expect(result[1]).toEqual({
        external_id: '67890',
        name: 'Jon Rahm',
        image_url: 'https://a.espncdn.com/media/golf/players/67890.jpg',
        sport: 'GOLF',
        position: 'G'
      });
    });

    it('should handle missing headshot gracefully', async () => {
      const mockEspnResponse = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '12345',
                        displayName: 'Rory McIlroy',
                        headshot: null
                      }
                    }
                  ]
                }
              ]
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
          events: []
        }
      };

      axios.get.mockResolvedValue(mockEspnResponse);

      await espnPgaPlayerService.fetchGolfers();

      expect(axios.get).toHaveBeenCalledWith(
        'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard',
        expect.any(Object)
      );
    });

    it('should throw on ESPN API error', async () => {
      axios.get.mockRejectedValue(new Error('API Error'));

      await expect(espnPgaPlayerService.fetchGolfers()).rejects.toThrow(
        'API Error'
      );
    });

    it('should return empty array when no competitors in response', async () => {
      const mockEspnResponse = {
        data: {
          events: []
        }
      };

      axios.get.mockResolvedValue(mockEspnResponse);

      const result = await espnPgaPlayerService.fetchGolfers();

      expect(result).toEqual([]);
    });

    it('should extract competitors from multiple competitions', async () => {
      const mockEspnResponse = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '12345',
                        displayName: 'Rory McIlroy',
                        headshot: {
                          href: 'https://a.espncdn.com/media/golf/players/12345.jpg'
                        }
                      }
                    }
                  ]
                }
              ]
            },
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '67890',
                        displayName: 'Jon Rahm',
                        headshot: {
                          href: 'https://a.espncdn.com/media/golf/players/67890.jpg'
                        }
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      };

      axios.get.mockResolvedValue(mockEspnResponse);

      const result = await espnPgaPlayerService.fetchGolfers();

      expect(result).toHaveLength(2);
      expect(result[0].external_id).toBe('12345');
      expect(result[1].external_id).toBe('67890');
    });
  });

  describe('normalizeGolfer', () => {
    it('should normalize a single golfer athlete object', () => {
      const espnAthlete = {
        id: '12345',
        displayName: 'Tiger Woods',
        headshot: {
          href: 'https://example.com/tiger.jpg'
        }
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized).toEqual({
        external_id: '12345',
        name: 'Tiger Woods',
        image_url: 'https://example.com/tiger.jpg',
        sport: 'GOLF',
        position: 'G'
      });
    });

    it('should handle null headshot', () => {
      const espnAthlete = {
        id: '99999',
        displayName: 'Unknown Golfer',
        headshot: null
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized.image_url).toBeNull();
      expect(normalized.external_id).toBe('99999');
    });

    it('should handle missing headshot field', () => {
      const espnAthlete = {
        id: '88888',
        displayName: 'Another Golfer'
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized.image_url).toBeNull();
      expect(normalized.external_id).toBe('88888');
    });
  });
});
