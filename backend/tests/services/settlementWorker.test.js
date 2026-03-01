// settlementWorker.test.js

const { createMockPool, mockQueryResponses } = require('../../tests/mocks/mockPool');
const { consumeLifecycleOutbox } = require('../../services/settlement/settlementWorker');

describe('Settlement Worker', () => {
  const TEST_CONTEST_ID = 'contest-123';
  const TEST_OUTBOX_ID = 'outbox-1';

  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  function setupOutboxEvent() {
    mockPool.setQueryResponse(
      /SELECT id, contest_instance_id, event_type, payload[\s\S]*FROM lifecycle_outbox/,
      {
        rows: [
          {
            id: TEST_OUTBOX_ID,
            contest_instance_id: TEST_CONTEST_ID,
            event_type: 'CONTEST_COMPLETED',
            payload: {},
          },
        ],
        rowCount: 1,
      }
    );
  }

  function setupCompletedContest() {
    mockPool.setQueryResponse(
      /SELECT id, status[\s\S]*FROM contest_instances[\s\S]*FOR UPDATE/,
      mockQueryResponses.single({
        id: TEST_CONTEST_ID,
        status: 'COMPLETED',
      })
    );
  }

  it('executes settlementHandler once for a completed contest', async () => {
    setupOutboxEvent();
    setupCompletedContest();

    mockPool.setQueryResponse(
      /INSERT INTO settlement_consumption/,
      mockQueryResponses.single({ contest_instance_id: TEST_CONTEST_ID })
    );

    const settlementHandler = jest.fn().mockResolvedValue(undefined);

    const result = await consumeLifecycleOutbox(mockPool, {
      settlementHandler,
    });

    expect(result.processed).toBe(1);
    expect(result.settled).toBe(1);
    expect(settlementHandler).toHaveBeenCalledTimes(1);
  });

  it('does not double-settle when already consumed', async () => {
    setupOutboxEvent();
    setupCompletedContest();

    // Simulate ON CONFLICT DO NOTHING
    mockPool.setQueryResponse(
      /INSERT INTO settlement_consumption/,
      { rows: [], rowCount: 0 }
    );

    const settlementHandler = jest.fn().mockResolvedValue(undefined);

    const result = await consumeLifecycleOutbox(mockPool, {
      settlementHandler,
    });

    expect(result.processed).toBe(1);
    expect(result.settled).toBe(0);
    expect(settlementHandler).not.toHaveBeenCalled();
  });

  it('skips if contest is not COMPLETED', async () => {
    setupOutboxEvent();

    mockPool.setQueryResponse(
      /SELECT id, status[\s\S]*FROM contest_instances[\s\S]*FOR UPDATE/,
      mockQueryResponses.single({
        id: TEST_CONTEST_ID,
        status: 'ACTIVE',
      })
    );

    const settlementHandler = jest.fn().mockResolvedValue(undefined);

    const result = await consumeLifecycleOutbox(mockPool, {
      settlementHandler,
    });

    expect(result.processed).toBe(0);
    expect(result.settled).toBe(0);
    expect(settlementHandler).not.toHaveBeenCalled();
  });

  it('is safe to run twice (idempotent)', async () => {
    setupOutboxEvent();
    setupCompletedContest();

    // First run inserts consumption row
    mockPool.setQueryResponse(
      /INSERT INTO settlement_consumption/,
      mockQueryResponses.single({ contest_instance_id: TEST_CONTEST_ID })
    );

    const settlementHandler = jest.fn().mockResolvedValue(undefined);

    await consumeLifecycleOutbox(mockPool, {
      settlementHandler,
    });

    // Reset for second run
    mockPool.reset();
    setupOutboxEvent();
    setupCompletedContest();

    // Second run simulates conflict
    mockPool.setQueryResponse(
      /INSERT INTO settlement_consumption/,
      { rows: [], rowCount: 0 }
    );

    const result2 = await consumeLifecycleOutbox(mockPool, {
      settlementHandler,
    });

    expect(result2.settled).toBe(0);
  });
});
