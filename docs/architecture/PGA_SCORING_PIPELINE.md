# PGA Scoring Pipeline (v1)

This document defines the architecture and execution flow for PGA scoring within the Playoff Challenge platform.

The system separates **event scoring** from **entry aggregation** to ensure deterministic scoring, replay safety, and operational debuggability.

---

## Architecture Overview

```
Provider Data
    ↓
ESPN Leaderboard API
    ↓
pgaEspnIngestion (ingestion strategy)
    ↓
handleScoringIngestion()
    ↓
pgaStandardScoring.scoreRound()
    ↓
golfer_event_scores
    ↓
pgaEntryAggregation (future phase)
    ↓
Contest Leaderboard
```

---

## Design Principles

### 1. Golfer-Level Scoring

The SCORING phase produces **golfer-level fantasy scores only**.

It must NOT:

- map golfers to users
- query entry_rosters
- compute entry totals
- write to golfer_scores

This ensures scoring is **independent of contest entries**.

Entry aggregation occurs later.

---

### 2. Deterministic Replay

Scoring must be idempotent.

Repeated ingestion of the same leaderboard snapshot must produce the same database state.

This is enforced via:

```sql
UNIQUE (contest_instance_id, golfer_id, round_number)
ON CONFLICT DO UPDATE
```

---

## Data Flow

### 1. Provider Ingestion

**Source:**

ESPN Leaderboard API

**Structure parsed:**

```
events
└── competitions
    └── competitors
        └── linescores
```

Each competitor contains hole-level scoring data.

---

### 2. Golfer Mapping

Provider IDs must be mapped to internal golfer IDs.

**Query:**

```sql
SELECT id, espn_id
FROM players
WHERE espn_id = ANY($1)
```

**Result:**

ESPN Player ID → Internal Golfer ID

Golfers not present in the `players` table are skipped.

---

### 3. Round Detection

Current round is determined using:

`linescore.period`

**Algorithm:**

```
currentRound = max(linescore.period)
```

---

### 4. Hole Extraction

Each hole must be normalized into the scoring engine format:

```javascript
{
  hole_number,
  par,
  strokes
}
```

**Example:**

```javascript
{
  hole_number: 7,
  par: 4,
  strokes: 3
}
```

Only holes with valid numeric strokes are included.

---

### 5. Scoring Engine

Scoring is delegated to:

`services/scoring/strategies/pgaStandardScoring.js`

**Invocation:**

```javascript
pgaStandardScoring.scoreRound({
  normalizedRoundPayload,
  templateRules
})
```

**Inputs:**

```javascript
normalizedRoundPayload = {
  event_id,
  round_number,
  golfers,
  is_final_round
}
```

Each golfer contains:

```javascript
{
  golfer_id,
  holes[],
  position
}
```

---

## Database Storage

Scores are written to:

`golfer_event_scores`

**Schema:**

```sql
CREATE TABLE golfer_event_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_instance_id uuid NOT NULL,
  golfer_id text NOT NULL,
  round_number integer NOT NULL,
  hole_points integer NOT NULL,
  bonus_points integer NOT NULL,
  finish_bonus integer NOT NULL,
  total_points integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contest_instance_id, golfer_id, round_number)
);
```

---

## Upsert Strategy

Scores are written using **batch insert with conflict resolution**.

```sql
INSERT INTO golfer_event_scores (…)
VALUES (…)
ON CONFLICT (contest_instance_id, golfer_id, round_number)
DO UPDATE SET
  hole_points = EXCLUDED.hole_points,
  bonus_points = EXCLUDED.bonus_points,
  finish_bonus = EXCLUDED.finish_bonus,
  total_points = EXCLUDED.total_points;
```

This ensures:

- idempotent re-ingestion
- deterministic scoring
- single-query write performance

---

## Performance Characteristics

Batch insert is used instead of N queries.

**1 query per scoring batch**

Instead of:

**N queries per golfer**

This is required for real-time scoring updates during tournaments.

---

## Debugging Queries

**Verify scoring activity:**

```sql
SELECT
  round_number,
  COUNT(*) golfers_scored,
  MAX(total_points) best_score
FROM golfer_event_scores
GROUP BY round_number
ORDER BY round_number DESC;
```

**Expected output:**

```
round_number | golfers_scored | best_score
1            | 72             | 28
```

---

## Future Phase

Entry aggregation is handled by:

`pgaEntryAggregation`

Aggregation will:

```
entry_rosters
JOIN golfer_event_scores
GROUP BY entry
ORDER BY total_points DESC
```

This produces the final contest leaderboard.

---

## Summary

The PGA scoring pipeline separates responsibilities into three layers:

```
Provider ingestion
↓
Golfer scoring
↓
Entry aggregation
```

This architecture guarantees:

- deterministic replay
- idempotent ingestion
- scalable scoring updates
- auditable settlement
