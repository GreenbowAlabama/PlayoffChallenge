/**
 * Ingestion Adapter Shape Contract Test
 *
 * Purpose:
 * Enforce structural interface conformance for all registered ingestion adapters.
 *
 * This test validates adapter SHAPE only:
 * - Required methods exist
 * - Methods are functions
 * - Optional methods are valid if present
 *
 * NOT tested here:
 * - Behavior or logic
 * - Return values
 * - Field validation
 * - Database operations
 * - Sport-specific constraints
 *
 * This test is sport-agnostic and scales as new adapters are registered.
 */

const ingestionRegistry = require('../../services/ingestionRegistry');

describe('Ingestion Adapter Shape Contract', () => {
  const REQUIRED_METHODS = [
    'getWorkUnits',
    'computeIngestionKey',
    'ingestWorkUnit',
    'upsertScores'
  ];

  const OPTIONAL_METHODS = [
    'validateConfig'
  ];

  it('all registered adapters conform to interface', () => {
    const strategies = ingestionRegistry.listIngestionStrategies();

    // Fail if no strategies registered
    expect(strategies.length).toBeGreaterThan(0);

    for (const strategyKey of strategies) {
      const adapter = ingestionRegistry.getIngestionStrategy(strategyKey);

      // Adapter must exist and be an object
      expect(adapter).toBeDefined();
      expect(typeof adapter).toBe('object');

      // Check required methods
      for (const methodName of REQUIRED_METHODS) {
        expect(adapter[methodName]).toBeDefined();
        expect(typeof adapter[methodName]).toBe('function');
      }

      // Check optional methods (if present, must be function)
      for (const methodName of OPTIONAL_METHODS) {
        if (adapter[methodName] !== undefined) {
          expect(typeof adapter[methodName]).toBe('function');
        }
      }
    }
  });
});
