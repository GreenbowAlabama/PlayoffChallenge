const { createMockPool, mockQueryResponses } = require('./tests/mocks/mockPool');

const mockPool = createMockPool();
const TEST_CONTEST_ID = 'test-id-123';
const scheduledContest = { id: TEST_CONTEST_ID, status: 'SCHEDULED' };

// Setup like the test does
mockPool.setQueryResponse(
  /SELECT \* FROM contest_instances WHERE id[\s\S]*FOR UPDATE/,
  mockQueryResponses.single(scheduledContest)
);

// Try a plain SELECT like the service does on line 544
const testAsync = async () => {
  const result = await mockPool.query(
    'SELECT * FROM contest_instances WHERE id = $1',
    [TEST_CONTEST_ID]
  );
  console.log('Plain SELECT result:', result);
  
  // Try a FOR UPDATE SELECT
  const result2 = await mockPool.query(
    'SELECT * FROM contest_instances WHERE id = $1 FOR UPDATE',
    [TEST_CONTEST_ID]
  );
  console.log('FOR UPDATE SELECT result:', result2);
};

testAsync().catch(console.error);
