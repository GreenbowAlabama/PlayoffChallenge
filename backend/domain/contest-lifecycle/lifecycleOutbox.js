// lifecycleOutbox.js

async function insertLifecycleEvent(client, { contestInstanceId, eventType, payload }) {
  const result = await client.query(
    `
    INSERT INTO lifecycle_outbox (
      contest_instance_id,
      event_type,
      payload,
      created_at
    )
    VALUES ($1, $2, $3, NOW())
    RETURNING id, contest_instance_id, event_type, payload, created_at
    `,
    [contestInstanceId, eventType, JSON.stringify(payload)]
  );

  return result.rows[0];
}

module.exports = {
  insertLifecycleEvent,
};
