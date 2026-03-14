# Scoring Replay and Audit (Financial Integrity)

This document defines how the Playoff Challenge platform guarantees deterministic scoring,
auditability, and dispute resolution for contests involving real money.

Because contests involve financial transactions (entry fees, prize payouts, wallet balances),
the scoring system must support complete replay and verification of results.

The platform achieves this through immutable data snapshots and deterministic scoring.

---

## Core Principle

All contest results must be reproducible from stored data.

Given the following inputs:

- `event_data_snapshots`
- scoring rules (template configuration)
- `entry_rosters`

The system must always produce the same:

- `golfer_event_scores`
- leaderboard rankings
- contest payouts

No hidden state or non-deterministic logic is allowed.

---

## Immutable Data Snapshots

Before scoring occurs, provider payloads are stored in immutable snapshots.

**Table:**

`event_data_snapshots`

**Example structure:**

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| event_id | text | Provider event identifier |
| snapshot_type | text | PLAYER_POOL, FIELD_BUILD, SCORING |
| provider_payload | jsonb | Raw provider response |
| payload_hash | text | SHA-256 hash for verification |
| created_at | timestamptz | Snapshot timestamp |

These snapshots contain the raw provider response used for scoring.

Once stored, snapshots must never be modified.

Snapshots represent the **source of truth** for replay.

---

## Snapshot Types

The ingestion pipeline stores several snapshot types.

**Examples:**

- `PLAYER_POOL` — Tournament field definition
- `FIELD_BUILD` — Contest-specific player selections
- `SCORING` — Leaderboard data with hole scores

`SCORING` snapshots contain the leaderboard payload used to compute fantasy scores.

---

## Scoring Determinism

Scoring logic must be pure and deterministic.

**Input:**

- `normalizedRoundPayload`
- `templateRules`

**Processing occurs through:**

`pgaStandardScoring.scoreRound()`

**The scoring engine must:**

- produce identical output for identical inputs
- contain no external dependencies
- contain no time-dependent logic

---

## Score Persistence

After scoring is computed, results are written to:

`golfer_event_scores`

**Table structure:**

| Column | Type |
|--------|------|
| contest_instance_id | uuid |
| golfer_id | text |
| round_number | integer |
| hole_points | integer |
| bonus_points | integer |
| finish_bonus | integer |
| total_points | integer |

**Constraint:**

```sql
UNIQUE (contest_instance_id, golfer_id, round_number)
```

Scores are written using idempotent upserts:

```sql
ON CONFLICT DO UPDATE
```

This guarantees replay safety.

---

## Replay Procedure

Replay allows the platform to recompute scoring exactly as it occurred originally.

**Replay process:**

```
Load scoring snapshot
↓
Reconstruct normalized round payload
↓
Run scoring engine
↓
Rebuild golfer_event_scores
↓
Recompute leaderboard
```

Replay can be executed at any time for verification.

---

## Replay Example

**Example replay workflow:**

```sql
SELECT provider_payload
FROM event_data_snapshots
WHERE event_id = 'espn_pga_401811938'
  AND snapshot_type = 'SCORING'
ORDER BY created_at DESC
LIMIT 1;
```

**Replay steps:**

1. Load snapshot payload
2. Re-run scoring engine with original template rules
3. Compare output with stored `golfer_event_scores`

If outputs match, scoring is verified.

---

## Leaderboard Audit

Leaderboards are generated dynamically using:

- `entry_rosters`
- `golfer_event_scores`

**Query example:**

```sql
SELECT
  er.entry_id,
  SUM(ges.total_points) AS entry_score
FROM entry_rosters er
JOIN golfer_event_scores ges
  ON ges.golfer_id = ANY(er.player_ids)
WHERE er.contest_instance_id = $1
GROUP BY er.entry_id
ORDER BY entry_score DESC;
```

Because both tables are deterministic inputs,
leaderboards are reproducible.

---

## Financial Settlement Verification

Contest payouts depend on final leaderboard results.

**Settlement must verify:**

- leaderboard ranking
- payout structure
- entry fees collected

**Settlement produces:**

- `payout_jobs`
- `payout_transfers`
- `ledger_entries`

Ledger entries represent the financial system of record.

**Example ledger events:**

- `contest_entry_fee`
- `contest_prize_payout`
- `wallet_deposit`
- `wallet_withdrawal`

---

## Dispute Resolution

When a user disputes contest results, the system must be able to:

1. Retrieve the scoring snapshot used
2. Replay the scoring engine
3. Recompute leaderboard totals
4. Compare replay results with stored leaderboard

If results match, the contest outcome is verified.

If discrepancies exist, investigation begins.

---

## Failure Recovery

If ingestion or scoring fails mid-process:

- snapshots remain intact
- scoring can be replayed
- leaderboard can be rebuilt

Because writes are idempotent, replay will not corrupt data.

This guarantees safe recovery.

---

## Compliance Considerations

Financial contest platforms must support auditability.

The architecture satisfies key compliance requirements:

- deterministic scoring
- immutable source data
- replayable computation
- auditable financial ledger

These properties protect both users and the platform.

---

## Operational Checklist

Before contest settlement:

**Verify:**

1. Final scoring snapshot exists
2. `golfer_event_scores` matches replay results
3. leaderboard aggregation is correct
4. payout calculations match leaderboard ranking

Only after verification should settlement occur.

---

## Summary

Playoff Challenge guarantees scoring integrity through replayable architecture.

```
Provider Snapshot
↓
Deterministic Scoring
↓
golfer_event_scores
↓
Leaderboard Aggregation
↓
Financial Settlement
```

This design ensures:

- scoring determinism
- financial correctness
- dispute resolution capability
- audit-ready contest history

---

## Architect Note

With this file added, your architecture docs now form a complete governance set:

| Document | Purpose |
|----------|---------|
| `PGA_SCORING_PIPELINE.md` | How scoring works |
| `LEADERBOARD_AGGREGATION.md` | How leaderboards compute |
| `INGESTION_EXECUTION_FLOW.md` | System lifecycle |
| `SCORING_REPLAY_AND_AUDIT.md` | Financial correctness + replay |

Together these define how the entire contest system works and how it proves correctness.
