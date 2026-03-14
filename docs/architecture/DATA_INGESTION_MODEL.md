# Data Ingestion Model

**Status:** AUTHORITATIVE
**Version:** 1.0
**Last Updated:** March 14, 2026

---

## Executive Summary

The platform uses an **event-oriented ingestion model** where each `ingestion_event` represents one complete provider payload snapshot, NOT individual database records.

This design ensures:
- Deterministic deduplication via payload hashing
- Clear snapshot boundaries for settlement
- Auditability of ingestion pipeline
- Replay safety for scoring and settlement

---

## Core Invariant: Event Granularity

### Correct: One Event Per Payload

```
ESPN API returns leaderboard with 123 golfers
           ↓
           1 ingestion_event
           (captures entire leaderboard snapshot)
           ↓
   {
     provider: 'pga_espn',
     event_type: 'scoring',
     provider_data_json: { events: [...], competitors: [...] },
     payload_hash: 'abc123...',
     validation_status: 'VALID'
   }
```

### Incorrect: One Event Per Record

```
ESPN API returns leaderboard with 123 golfers
           ↓
      123 ingestion_events
      (one per golfer) ← WRONG
           ↓
    Deduplication breaks
    Replay becomes fragile
    Snapshot boundaries lost
```

---

## Why This Matters

### Deduplication by Payload Hash

Ingestion events are deduplicated using:

```sql
UNIQUE (contest_instance_id, payload_hash)
```

**If one event per record:**
- Same leaderboard produces 123 unique hashes
- Each ingestion cycle creates 123 new events
- Deduplication fails
- Database bloats rapidly

**If one event per payload:**
- Same leaderboard produces 1 hash
- Re-ingestion skips via ON CONFLICT
- Database stays clean
- Worker can run repeatedly safely

### Settlement Binding

Settlement pipeline requires clear snapshot boundaries:

```
Contest created
    ↓
PLAYER_POOL snapshot (golfers available)
    ↓
SCORING snapshot (leaderboard after round 1)
    ↓
SCORING snapshot (leaderboard after round 2)
    ↓
SCORING snapshot (final leaderboard)
    ↓
Settlement calculated from snapshots
```

If events are fragmented per record, settlement cannot identify snapshot boundaries.

### Auditability

One event per payload provides clear audit trail:

```sql
SELECT
  event_type,
  received_at,
  payload_hash,
  validation_status
FROM ingestion_events
WHERE contest_instance_id = $1
ORDER BY received_at;
```

Result:
```
event_type | received_at | payload_hash | status
-----------+-------------+--------------+-------
player_pool| 14:00:00    | abc123...    | VALID
scoring    | 14:30:00    | def456...    | VALID
scoring    | 15:00:00    | ghi789...    | VALID
```

Clear history of what data was ingested when.

---

## Ingestion Event Structure

### Required Fields

```javascript
{
  id: UUID,                          // Unique event ID
  contest_instance_id: UUID,         // Links to contest
  provider: string,                  // 'pga_espn', 'nfl_espn', etc.
  event_type: string,                // 'player_pool', 'scoring', etc.
  provider_data_json: object,        // Full provider payload
  payload_hash: string,              // SHA256 of canonical payload
  validation_status: string,         // 'VALID', 'INVALID', etc.
  validated_at: timestamp,           // When validated
  created_at: timestamp              // When inserted
}
```

### Event Types

| event_type | provider | Payload | Phase |
|---|---|---|---|
| `player_pool` | `pga_espn` | { provider_event_id, golfers } | PLAYER_POOL |
| `scoring` | `pga_espn` | { events, competitions, competitors } | SCORING |

---

## Deduplication Mechanism

### Hash Computation

```javascript
const payload = { provider_event_id, golfers: [...] };
const canonical = canonicalizeJson(payload);  // Sort keys
const hash = sha256(JSON.stringify(canonical));
```

### Idempotency Guard

```sql
INSERT INTO ingestion_events (...)
VALUES (...)
ON CONFLICT (contest_instance_id, payload_hash) DO NOTHING;
```

**Behavior:**
- First ingestion of payload: inserted
- Second ingestion (same payload): silently skipped
- Third ingestion (different payload): inserted

**Worker Safety:**
- Worker can run every 5 seconds without side effects
- Same field snapshot → same hash → no duplicates
- Different data → different hash → captured

---

## Validation Pipeline

Ingestion events flow through validation:

```
ingestion_event created
    ↓
validation_status = 'VALID' (initially)
    ↓
[Future] settlement.validate() may change to INVALID
    ↓
Append-only: never deleted or updated
```

**Key Rule:** Events are append-only. Never UPDATE or DELETE ingestion_events.

All corrections use compensating entries (see LEDGER_ARCHITECTURE_AND_RECONCILIATION.md).

---

## Event Processing Pipeline

After an ingestion_event is created:

```
ingestion_event
    ↓
Settlement reads event
    ↓
Extract provider_data_json
    ↓
Normalize to domain model
    ↓
Calculate scores
    ↓
Persist to golfer_scores
    ↓
Update leaderboard
```

The event serves as the **immutable source of truth** for settlement.

---

## Worker Implementation Rules

When implementing ingestion:

1. **Collect all records** from provider
   ```javascript
   const golfers = await espn.fetchTournamentField(eventId);
   ```

2. **Create ONE event** with full payload
   ```javascript
   const payload = { provider_event_id, golfers };
   const hash = sha256(canonical(payload));
   await db.query(
     'INSERT INTO ingestion_events (..., payload_hash) VALUES (..., ?)',
     [hash]
   );
   ```

3. **Do NOT create per-record events**
   ```javascript
   // ❌ WRONG
   for (const golfer of golfers) {
     await db.query(
       'INSERT INTO ingestion_events (...) VALUES (...)'
     );
   }
   ```

---

## Related Documentation

- **ESPN PGA Ingestion:** `docs/architecture/ESPN-PGA-Ingestion.md`
- **Scoring Pipeline:** `docs/architecture/SCORING_PIPELINE.md`
- **Ledger Architecture:** `docs/governance/LEDGER_ARCHITECTURE_AND_RECONCILIATION.md`

---

## Governance

**Frozen:** This event granularity model is frozen under Architecture Lock.

**Rationale:** Changing event semantics would break determinism and replay guarantees.

**Worker Rule:** Do not emit ingestion_events per individual records. One event = one payload snapshot.

