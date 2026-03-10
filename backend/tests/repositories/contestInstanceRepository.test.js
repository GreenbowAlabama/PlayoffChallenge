/**
 * Contest Instance Repository Tests
 *
 * Unit tests for getExistingContestInstance() with mocked query results.
 * Verifies idempotency key: (provider_event_id, template_id, entry_fee_cents)
 *
 * No database writes. No table cleanup. Pure mocks.
 */

const { getExistingContestInstance } = require('../../repositories/contestInstanceRepository');

describe('contestInstanceRepository', () => {
  describe('getExistingContestInstance', () => {
    let mockClient;

    beforeEach(() => {
      mockClient = {
        query: jest.fn()
      };
    });

    describe('Test 1 — existing contest found', () => {
      it('should return { id, join_token } when contest exists with matching (provider_event_id, template_id, entry_fee_cents)', async () => {
        const provider_event_id = 'espn_pga_event_1';
        const template_id = 'tpl-001';
        const entry_fee_cents = 5000;
        const mockRow = { id: 'contest-abc-123', join_token: 'stg_token123' };

        // Mock: contest exists with join_token
        mockClient.query.mockResolvedValueOnce({
          rows: [mockRow]
        });

        const result = await getExistingContestInstance(
          mockClient,
          provider_event_id,
          template_id,
          entry_fee_cents
        );

        expect(result).toEqual(mockRow);
        expect(result.id).toBe('contest-abc-123');
        expect(result.join_token).toBe('stg_token123');
        expect(mockClient.query).toHaveBeenCalledWith(
          `SELECT id, join_token
     FROM contest_instances
     WHERE provider_event_id = $1
       AND template_id = $2
       AND entry_fee_cents = $3
       AND is_platform_owned = true
     LIMIT 1`,
          [provider_event_id, template_id, entry_fee_cents]
        );
      });

      it('should include join_token in result for repair operations', async () => {
        const mockRow = { id: 'contest-xyz', join_token: null };

        mockClient.query.mockResolvedValueOnce({ rows: [mockRow] });

        const result = await getExistingContestInstance(mockClient, 'evt', 'tpl', 5000);

        expect(result.join_token).toBeNull();
      });
    });

    describe('Test 2 — different entry_fee_cents', () => {
      it('should return null when different entry_fee_cents (no existing contest)', async () => {
        const provider_event_id = 'espn_pga_event_1';
        const template_id = 'tpl-001';
        const entry_fee_1 = 5000; // $50
        const entry_fee_2 = 10000; // $100

        // First call: contest exists for $50 fee
        mockClient.query.mockResolvedValueOnce({
          rows: [{ id: 'contest-50-dollars', join_token: 'token50' }]
        });

        const result1 = await getExistingContestInstance(
          mockClient,
          provider_event_id,
          template_id,
          entry_fee_1
        );
        expect(result1).not.toBeNull();

        // Second call: different fee tier ($100) does NOT exist
        mockClient.query.mockResolvedValueOnce({
          rows: []
        });

        const result2 = await getExistingContestInstance(
          mockClient,
          provider_event_id,
          template_id,
          entry_fee_2
        );
        expect(result2).toBeNull();

        // Verify two separate queries were made
        expect(mockClient.query).toHaveBeenCalledTimes(2);
        expect(mockClient.query.mock.calls[0][1]).toEqual([
          provider_event_id,
          template_id,
          entry_fee_1
        ]);
        expect(mockClient.query.mock.calls[1][1]).toEqual([
          provider_event_id,
          template_id,
          entry_fee_2
        ]);
      });
    });

    describe('Test 3 — cancelled contest still counts as existing', () => {
      it('should return { id, join_token } when cancelled contest exists (no status filtering)', async () => {
        const provider_event_id = 'espn_pga_event_1';
        const template_id = 'tpl-001';
        const entry_fee_cents = 5000;
        const mockRow = { id: 'contest-cancelled-xyz', join_token: 'token-cancelled' };

        // Mock: contest exists with CANCELLED status
        // Note: Query has NO status filtering, so CANCELLED rows are found
        mockClient.query.mockResolvedValueOnce({
          rows: [mockRow]
        });

        const result = await getExistingContestInstance(
          mockClient,
          provider_event_id,
          template_id,
          entry_fee_cents
        );

        expect(result).toEqual(mockRow);

        // Verify query has NO status filter (cancelled contests count)
        const queryCall = mockClient.query.mock.calls[0];
        const sqlText = queryCall[0];
        expect(sqlText).not.toMatch(/status/i);
        expect(sqlText).toMatch(/is_platform_owned = true/);
      });
    });

    describe('edge cases', () => {
      it('should return null when no contest exists', async () => {
        const provider_event_id = 'espn_pga_nonexistent';
        const template_id = 'tpl-999';
        const entry_fee_cents = 999;

        mockClient.query.mockResolvedValueOnce({
          rows: []
        });

        const result = await getExistingContestInstance(
          mockClient,
          provider_event_id,
          template_id,
          entry_fee_cents
        );

        expect(result).toBeNull();
      });

      it('should pass parameters in correct order to query', async () => {
        const provider_event_id = 'test_event';
        const template_id = 'test_template';
        const entry_fee_cents = 12345;

        mockClient.query.mockResolvedValueOnce({ rows: [] });

        await getExistingContestInstance(
          mockClient,
          provider_event_id,
          template_id,
          entry_fee_cents
        );

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.any(String),
          [provider_event_id, template_id, entry_fee_cents]
        );
      });

      it('should accept transaction client, not pool', async () => {
        const transactionClient = { query: jest.fn() };
        transactionClient.query.mockResolvedValueOnce({ rows: [] });

        await getExistingContestInstance(transactionClient, 'evt', 'tpl', 5000);

        expect(transactionClient.query).toHaveBeenCalled();
      });
    });
  });
});
