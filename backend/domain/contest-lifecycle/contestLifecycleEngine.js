// contestLifecycleEngine.js

const {
  computeNextStatus,
  isTerminal,
} = require('./contestLifecycleTransitions');

const { insertLifecycleEvent } = require('./lifecycleOutbox');

async function applyLifecycleTransition(pool, contestId, now = new Date()) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const selectResult = await client.query(
      `
      SELECT id, status, start_time, end_time
      FROM contest_instances
      WHERE id = $1
      FOR UPDATE
      `,
      [contestId]
    );

    if (selectResult.rows.length === 0) {
      await client.query('COMMIT');
      return { changed: false };
    }

    const row = selectResult.rows[0];

    if (isTerminal(row.status)) {
      await client.query('COMMIT');
      return { changed: false };
    }

    const nextStatus = computeNextStatus(row, now);

    if (!nextStatus) {
      await client.query('COMMIT');
      return { changed: false };
    }

    const updateResult = await client.query(
      `
      UPDATE contest_instances
      SET status = $2,
          updated_at = NOW()
      WHERE id = $1
        AND status = $3
      `,
      [contestId, nextStatus, row.status]
    );

    if (updateResult.rowCount === 0) {
      // Race detected — another transition happened
      await client.query('COMMIT');
      return { changed: false };
    }

    await client.query(
      `
      INSERT INTO admin_contest_audit (
        contest_instance_id,
        from_status,
        to_status,
        reason,
        source
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        contestId,
        row.status,
        nextStatus,
        'SYSTEM_LIFECYCLE_TRANSITION',
        'SYSTEM',
      ]
    );

    // Emit lifecycle event when transitioning to COMPLETED
    if (nextStatus === 'COMPLETED') {
      await insertLifecycleEvent(client, {
        contestInstanceId: contestId,
        eventType: 'CONTEST_COMPLETED',
        payload: {
          from_status: row.status,
          to_status: nextStatus,
          transitioned_at: now.toISOString(),
          engine_version: 'v1',
        },
      });
    }

    await client.query('COMMIT');

    return {
      changed: true,
      fromStatus: row.status,
      toStatus: nextStatus,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  applyLifecycleTransition,
};
