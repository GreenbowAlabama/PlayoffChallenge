// settlementWorker.js

const { executeSettlementTx } = require('../settlementStrategy');

/**
 * IMPORTANT:
 * This worker consumes lifecycle_outbox events.
 * It must be safe to run multiple times.
 * It must never double-settle a contest.
 *
 * Assumptions:
 * - lifecycle_outbox contains CONTEST_COMPLETED events
 * - settlement_consumption enforces idempotency
 * - Snapshot binding is fetched from event_data_snapshots with provider_final_flag = true
 * - executeSettlementTx owns the transaction boundary
 */

async function consumeLifecycleOutbox(
  pool,
  {
    batchSize = 25,
    settlementHandler, // async function({ contestInstanceId, client }) — DEPRECATED; use executeSettlementTx directly
  }
) {
  if (!settlementHandler && !executeSettlementTx) {
    throw new Error('settlementHandler or executeSettlementTx is required');
  }

  // Fetch batch of completion events (ordered for determinism)
  const outboxResult = await pool.query(
    `
    SELECT id, contest_instance_id, event_type, payload
    FROM lifecycle_outbox
    WHERE event_type = 'CONTEST_COMPLETED'
    ORDER BY created_at ASC
    LIMIT $1
    `,
    [batchSize]
  );

  let processed = 0;
  let settled = 0;

  for (const event of outboxResult.rows) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Lock contest row
      const contestResult = await client.query(
        `
        SELECT id, status
        FROM contest_instances
        WHERE id = $1
        FOR UPDATE
        `,
        [event.contest_instance_id]
      );

      if (contestResult.rows.length === 0) {
        await client.query('COMMIT');
        continue;
      }

      const contest = contestResult.rows[0];

      if (contest.status !== 'COMPLETED') {
        // Defensive guard — only settle completed contests
        await client.query('COMMIT');
        continue;
      }

      // Idempotency barrier
      const consumptionInsert = await client.query(
        `
        INSERT INTO settlement_consumption (
          contest_instance_id,
          consumed_outbox_id
        )
        VALUES ($1, $2)
        ON CONFLICT (contest_instance_id)
        DO NOTHING
        RETURNING contest_instance_id
        `,
        [contest.id, event.id]
      );

      if (consumptionInsert.rowCount === 0) {
        // Already consumed
        await client.query('COMMIT');
        processed += 1;
        continue;
      }

      // Fetch snapshot binding (PGA v1 Section 4.1 compliant)
      // Must have provider_final_flag = true for deterministic settlement
      const snapshotResult = await client.query(
        `
        SELECT id, snapshot_hash
        FROM event_data_snapshots
        WHERE contest_instance_id = $1
          AND provider_final_flag = true
        ORDER BY ingested_at DESC, id DESC
        LIMIT 1
        `,
        [contest.id]
      );

      const snapshotRow = snapshotResult.rows[0];

      if (!snapshotRow) {
        throw new Error(
          `SETTLEMENT_REQUIRES_FINAL_SNAPSHOT: No FINAL event_data_snapshot found for contest ${contest.id}. ` +
          `Settlement requires provider_final_flag = true snapshot before execution.`
        );
      }

      const snapshotId = snapshotRow.id;
      const snapshotHash = snapshotRow.snapshot_hash;

      // Execute settlement transaction (owns transaction boundary; do NOT call executeSettlement wrapper)
      await executeSettlementTx({
        client,
        contestInstanceId: contest.id,
        snapshotId,
        snapshotHash,
      });

      await client.query('COMMIT');

      processed += 1;
      settled += 1;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    processed,
    settled,
  };
}

module.exports = {
  consumeLifecycleOutbox,
};
