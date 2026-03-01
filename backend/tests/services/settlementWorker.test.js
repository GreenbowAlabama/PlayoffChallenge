// settlementWorker.test.js

const { createMockPool, mockQueryResponses } = require('../../tests/mocks/mockPool');
const { consumeLifecycleOutbox } = require('../../services/settlement/settlementWorker');

// Mock the settlementStrategy module
jest.mock('../../services/settlementStrategy', () => ({
  executeSettlementTx: jest.fn().mockResolvedValue({}),
}));

const { executeSettlementTx } = require('../../services/settlementStrategy');

describe('Settlement Worker', () => {
  const TEST_CONTEST_ID = 'contest-123';
  const TEST_OUTBOX_ID = 'outbox-1';
  const TEST_SNAPSHOT_ID = 'snapshot-456';
  const TEST_SNAPSHOT_HASH = 'abc123def456';

  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
    jest.clearAllMocks();
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

  function setupFinalSnapshot() {
    mockPool.setQueryResponse(
      /SELECT id, snapshot_hash[\s\S]*FROM event_data_snapshots[\s\S]*provider_final_flag/,
      mockQueryResponses.single({
        id: TEST_SNAPSHOT_ID,
        snapshot_hash: TEST_SNAPSHOT_HASH,
      })
    );
  }

  it('calls executeSettlementTx with snapshot binding for a completed contest', async () => {
    setupOutboxEvent();
    setupCompletedContest();
    setupFinalSnapshot();

    mockPool.setQueryResponse(
      /INSERT INTO settlement_consumption/,
      mockQueryResponses.single({ contest_instance_id: TEST_CONTEST_ID })
    );

    const result = await consumeLifecycleOutbox(mockPool, {});

    expect(result.processed).toBe(1);
    expect(result.settled).toBe(1);
    expect(executeSettlementTx).toHaveBeenCalledTimes(1);
    expect(executeSettlementTx).toHaveBeenCalledWith({
      client: expect.any(Object),
      contestInstanceId: TEST_CONTEST_ID,
      snapshotId: TEST_SNAPSHOT_ID,
      snapshotHash: TEST_SNAPSHOT_HASH,
    });
  });

  it('does not double-settle when already consumed', async () => {
    setupOutboxEvent();
    setupCompletedContest();
    setupFinalSnapshot();

    // Simulate ON CONFLICT DO NOTHING
    mockPool.setQueryResponse(
      /INSERT INTO settlement_consumption/,
      { rows: [], rowCount: 0 }
    );

    const result = await consumeLifecycleOutbox(mockPool, {});

    expect(result.processed).toBe(1);
    expect(result.settled).toBe(0);
    expect(executeSettlementTx).not.toHaveBeenCalled();
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

    const result = await consumeLifecycleOutbox(mockPool, {});

    expect(result.processed).toBe(0);
    expect(result.settled).toBe(0);
    expect(executeSettlementTx).not.toHaveBeenCalled();
  });

  it('throws if snapshot binding is missing', async () => {
    setupOutboxEvent();
    setupCompletedContest();

    // Mock missing snapshot
    mockPool.setQueryResponse(
      /SELECT id, snapshot_hash[\s\S]*FROM event_data_snapshots[\s\S]*provider_final_flag/,
      { rows: [], rowCount: 0 }
    );

    mockPool.setQueryResponse(
      /INSERT INTO settlement_consumption/,
      mockQueryResponses.single({ contest_instance_id: TEST_CONTEST_ID })
    );

    await expect(consumeLifecycleOutbox(mockPool, {})).rejects.toThrow(
      /SETTLEMENT_REQUIRES_FINAL_SNAPSHOT/
    );

    expect(executeSettlementTx).not.toHaveBeenCalled();
  });

  it('is safe to run twice (idempotent)', async () => {
    setupOutboxEvent();
    setupCompletedContest();
    setupFinalSnapshot();

    // First run inserts consumption row
    mockPool.setQueryResponse(
      /INSERT INTO settlement_consumption/,
      mockQueryResponses.single({ contest_instance_id: TEST_CONTEST_ID })
    );

    await consumeLifecycleOutbox(mockPool, {});

    // Reset for second run
    mockPool.reset();
    setupOutboxEvent();
    setupCompletedContest();
    setupFinalSnapshot();

    // Second run simulates conflict
    mockPool.setQueryResponse(
      /INSERT INTO settlement_consumption/,
      { rows: [], rowCount: 0 }
    );

    const result2 = await consumeLifecycleOutbox(mockPool, {});

    expect(result2.settled).toBe(0);
    // executeSettlementTx called only once (from first run)
    expect(executeSettlementTx).toHaveBeenCalledTimes(1);
  });
});
