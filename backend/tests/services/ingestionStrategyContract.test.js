/**
 * Ingestion Strategy Contract Tests
 *
 * Purpose:
 * Validate registry-driven template validation orchestration.
 *
 * Invariants:
 * 1. If strategy has validateConfig → called before persistence
 * 2. If validateConfig throws → no DB write
 * 3. If validateConfig passes → template persists
 * 4. If strategy exists but no validateConfig → template persists
 * 5. If strategy lookup throws → template persists (unknown strategy)
 * 6. If no ingestion_strategy_key → template persists (no enforcement)
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');

// Mock ingestionRegistry before importing service
let mockGetIngestionStrategy = jest.fn(() => null);

jest.mock('../../services/ingestionRegistry', () => ({
  getIngestionStrategy: (...args) => mockGetIngestionStrategy(...args),
  listIngestionStrategies: () => []
}));

const templateService = require('../../services/customContestTemplateService');

describe('Ingestion Strategy Contract', () => {
  let mockPool;

  const baseTemplate = {
    name: 'Test Template',
    sport: 'NFL',
    template_type: 'test_type',
    scoring_strategy_key: 'ppr',
    lock_strategy_key: 'first_game_kickoff',
    settlement_strategy_key: 'final_standings',
    default_entry_fee_cents: 1000,
    allowed_entry_fee_min_cents: 0,
    allowed_entry_fee_max_cents: 5000,
    allowed_payout_structures: [{ first: 100 }]
  };

  beforeEach(() => {
    mockPool = createMockPool();
    mockGetIngestionStrategy.mockClear();
  });

  afterEach(() => {
    mockPool.reset();
  });

  it('should call validateConfig if strategy has it', async () => {
    const validateConfig = jest.fn();
    mockGetIngestionStrategy.mockReturnValue({ validateConfig });

    const input = {
      ...baseTemplate,
      ingestion_strategy_key: 'test_strategy'
    };

    mockPool.setQueryResponse(
      /INSERT INTO contest_templates/,
      mockQueryResponses.single({ id: 'template-1', ...input })
    );

    await templateService.createTemplate(mockPool, input);

    expect(validateConfig).toHaveBeenCalledWith(input);
  });

  it('should not INSERT if validateConfig throws', async () => {
    const validateConfig = jest.fn(() => {
      throw new Error('validation failed');
    });
    mockGetIngestionStrategy.mockReturnValue({ validateConfig });

    const input = {
      ...baseTemplate,
      ingestion_strategy_key: 'test_strategy'
    };

    await expect(
      templateService.createTemplate(mockPool, input)
    ).rejects.toThrow('validation failed');

    const queries = mockPool.getQueryHistory();
    const insertAttempted = queries.some(q => q.sql.includes('INSERT INTO contest_templates'));
    expect(insertAttempted).toBe(false);
  });

  it('should INSERT if validateConfig passes', async () => {
    const validateConfig = jest.fn();
    mockGetIngestionStrategy.mockReturnValue({ validateConfig });

    const input = {
      ...baseTemplate,
      ingestion_strategy_key: 'test_strategy'
    };

    mockPool.setQueryResponse(
      /INSERT INTO contest_templates/,
      mockQueryResponses.single({ id: 'template-2', ...input })
    );

    const result = await templateService.createTemplate(mockPool, input);

    expect(result.id).toBe('template-2');
  });

  it('should INSERT if strategy exists but has no validateConfig', async () => {
    mockGetIngestionStrategy.mockReturnValue({});

    const input = {
      ...baseTemplate,
      ingestion_strategy_key: 'test_strategy'
    };

    mockPool.setQueryResponse(
      /INSERT INTO contest_templates/,
      mockQueryResponses.single({ id: 'template-3', ...input })
    );

    const result = await templateService.createTemplate(mockPool, input);

    expect(result.id).toBe('template-3');
  });

  it('should INSERT if strategy lookup throws (unknown strategy)', async () => {
    mockGetIngestionStrategy.mockImplementation(() => {
      throw new Error('Unknown ingestion strategy');
    });

    const input = {
      ...baseTemplate,
      ingestion_strategy_key: 'unknown_strategy'
    };

    mockPool.setQueryResponse(
      /INSERT INTO contest_templates/,
      mockQueryResponses.single({ id: 'template-4', ...input })
    );

    const result = await templateService.createTemplate(mockPool, input);

    expect(result.id).toBe('template-4');
  });

  it('should INSERT if no ingestion_strategy_key provided', async () => {
    const input = {
      ...baseTemplate
    };

    mockPool.setQueryResponse(
      /INSERT INTO contest_templates/,
      mockQueryResponses.single({ id: 'template-5', ...input })
    );

    const result = await templateService.createTemplate(mockPool, input);

    expect(result.id).toBe('template-5');
  });
});
