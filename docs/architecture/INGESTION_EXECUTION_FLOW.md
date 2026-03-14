# Ingestion Execution Flow (Platform v1)

This document defines the full lifecycle of sports event processing within the Playoff Challenge platform.

It explains how external sports data flows from discovery to final settlement.

The system is designed around deterministic ingestion phases and immutable snapshots to ensure replay safety and auditability.

---

## High Level Lifecycle

```
External Provider
↓
Discovery Service
↓
Work Unit Generation
↓
Ingestion Strategy
↓
Snapshot Persistence
↓
Scoring Engine
↓
Aggregation Layer
↓
Contest Leaderboard
↓
Settlement
```

Each stage has a single responsibility and does not overlap with the others.

---

## Phase 1 — Event Discovery

The Discovery Service identifies upcoming sports events and creates contest instances.

**Sources:**

- ESPN APIs
- Scheduled discovery jobs

**Discovery determines:**

- upcoming tournaments
- event start times
- event identifiers
- contest templates

**Output:**

`contest_instances`

Each contest instance references a provider event ID.

**Example:**

```
provider_event_id = espn_pga_401811938
```

Discovery is responsible for ensuring contests exist before ingestion begins.

---

## Phase 2 — Work Unit Generation

Each contest instance produces ingestion work units.

Work units represent atomic pieces of ingestion work.

**Example phases:**

- PLAYER_POOL
- FIELD_BUILD
- SCORING

Each work unit contains:

```javascript
{
  phase,
  providerEventId,
  providerData
}
```

The ingestion engine processes work units sequentially.

---

## Phase 3 — Provider Ingestion

Each work unit is executed by a sport-specific ingestion strategy.

**Example:**

`pgaEspnIngestion.js`

**Responsibilities:**

- fetch provider data
- normalize provider structures
- prepare scoring payloads

No scoring occurs in this stage.

The goal is only to translate provider data into internal format.

---

## Phase 4 — Snapshot Persistence

Before scoring, the provider payload is stored as an immutable snapshot.

**Tables involved:**

- `event_data_snapshots`
- `ingestion_events`

**Purpose:**

- auditability
- replay capability
- deterministic settlement

Snapshots ensure the platform can reconstruct scoring at any point in time.

**Example snapshot metadata:**

| Field | Example |
|-------|---------|
| event_id | espn_pga_401811938 |
| snapshot_type | tournament_data |
| payload_hash | abc123def456... |
| created_at | 2026-03-14T12:00:00Z |

---

## Phase 5 — Scoring Engine

After snapshot persistence, scoring logic executes.

**Example:**

`handleScoringIngestion()`

**This phase:**

- parses leaderboard data
- extracts hole scores
- determines round number
- maps provider players to internal golfer IDs

Normalized payload is passed to:

`pgaStandardScoring.scoreRound()`

Scoring output is golfer-level fantasy scoring.

---

## Phase 6 — Score Persistence

Scoring results are written to the scoring table.

**Table:**

`golfer_event_scores`

**Structure:**

| Column | Type |
|--------|------|
| contest_instance_id | uuid |
| golfer_id | text |
| round_number | integer |
| hole_points | integer |
| bonus_points | integer |
| finish_bonus | integer |
| total_points | integer |

Scores are written using idempotent upserts:

```sql
ON CONFLICT (contest_instance_id, golfer_id, round_number)
DO UPDATE
```

This guarantees deterministic replay of scoring.

---

## Phase 7 — Entry Aggregation

After golfer scores are written, entry totals are computed.

Aggregation combines:

- `entry_rosters`
- `golfer_event_scores`

Aggregation occurs through a single SQL query.

**Example logic:**

```sql
SUM(ges.total_points)
GROUP BY entry_id
ORDER BY entry_total_points DESC
```

This produces the contest leaderboard.

---

## Phase 8 — Leaderboard Generation

Leaderboard results represent the current standings for a contest.

Leaderboard queries join:

- `entry_rosters`
- `golfer_event_scores`
- `users`

The result provides:

- entry rank
- entry score
- user information
- scoring breakdown

Leaderboard generation is stateless and computed dynamically.

---

## Phase 9 — Contest Settlement

Once an event is finalized, settlement occurs.

**Settlement requires:**

- final leaderboard
- payout structure
- contest entry fees

**Settlement produces:**

- `payout_jobs`
- `payout_transfers`
- `ledger_entries`

These records ensure financial correctness.

---

## Execution Timeline

A typical contest lifecycle looks like this:

| Time | Event |
|------|-------|
| T-7 days | Discovery creates contest instance |
| T-1 hour | PLAYER_POOL ingestion |
| T-0 | Tournament begins |
| During tournament | SCORING ingestion runs repeatedly |
| After final round | Final scoring snapshot |
| T+24 hours | Settlement and payouts |

---

## Deterministic Replay

The system is designed so that scoring can always be reproduced.

**Replay steps:**

```
Load snapshot
↓
Re-run scoring engine
↓
Rebuild golfer_event_scores
↓
Recompute leaderboard
```

This ensures auditability for financial contests.

---

## Failure Recovery

If ingestion fails:

- work unit can be retried
- snapshot remains intact
- scoring is idempotent

This allows safe recovery without corrupting contest state.

---

## Summary

The platform processes sports events through a deterministic ingestion pipeline:

```
Discovery
↓
Work Units
↓
Ingestion
↓
Snapshot
↓
Scoring
↓
Aggregation
↓
Leaderboard
↓
Settlement
```

Each stage is isolated and replayable.

This architecture ensures:

- deterministic scoring
- audit-safe financial settlement
- scalable tournament processing
- debuggable ingestion lifecycle
