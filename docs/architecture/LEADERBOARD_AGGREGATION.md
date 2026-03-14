# Leaderboard Aggregation (PGA v1)

This document defines how contest leaderboards are generated from golfer-level scoring.

Leaderboard computation is intentionally separated from the scoring phase.

The system architecture follows:

```
Provider Ingestion
↓
Golfer Scoring
↓
golfer_event_scores
↓
Entry Aggregation
↓
Contest Leaderboard
```

This separation guarantees deterministic scoring, replay safety, and scalable leaderboard computation.

---

## Design Principles

### 1. Scoring and Aggregation Are Separate

The scoring pipeline produces **golfer-level scores only**.

**Table:**

`golfer_event_scores`

Leaderboard computation occurs later by combining:

- `entry_rosters`
- `golfer_event_scores`

This ensures scoring remains independent from contest entries.

---

### 2. Deterministic Aggregation

Leaderboard results must be deterministic.

Given:

- entry_rosters
- golfer_event_scores

The leaderboard query must always produce the same result.

No business logic exists in the application layer.

All aggregation occurs in SQL.

---

## Core Tables

### golfer_event_scores

Stores fantasy scoring per golfer per round.

**Schema:**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| contest_instance_id | uuid | Foreign key |
| golfer_id | text | Player ID |
| round_number | integer | Tournament round |
| hole_points | integer | Points from hole scoring |
| bonus_points | integer | Streak/bogey-free bonuses |
| finish_bonus | integer | Leaderboard position bonus |
| total_points | integer | Sum of above |
| created_at | timestamptz | Ingestion timestamp |

**Constraint:**

```sql
UNIQUE (contest_instance_id, golfer_id, round_number)
```

---

### entry_rosters

Defines the golfers selected by each contest entry.

**Example structure:**

| Column | Type | Notes |
|--------|------|-------|
| entry_id | uuid | Primary key |
| contest_instance_id | uuid | Foreign key |
| user_id | uuid | Entry creator |
| player_ids | text[] | Array of golfer IDs |

Each entry selects multiple golfers.

---

## Leaderboard Aggregation

The leaderboard is computed by joining:

- `entry_rosters`
- `golfer_event_scores`

Then summing the golfer scores for each entry.

---

## Single Query Leaderboard

The leaderboard can be computed using a single SQL query:

```sql
SELECT
  er.entry_id,
  er.user_id,
  er.contest_instance_id,
  SUM(ges.total_points) AS entry_total_points,
  COUNT(ges.golfer_id) AS golfers_scored
FROM entry_rosters er
JOIN golfer_event_scores ges
  ON ges.golfer_id = ANY(er.player_ids)
  AND ges.contest_instance_id = er.contest_instance_id
WHERE er.contest_instance_id = $1
GROUP BY
  er.entry_id,
  er.user_id,
  er.contest_instance_id
ORDER BY entry_total_points DESC;
```

---

## Query Explanation

### Golfer Match

```sql
ges.golfer_id = ANY(er.player_ids)
```

This matches golfer scores to roster selections.

---

### Contest Isolation

```sql
ges.contest_instance_id = er.contest_instance_id
```

Prevents cross-contest scoring contamination.

---

### Entry Score

```sql
SUM(ges.total_points)
```

Calculates the entry's total fantasy score.

---

### Ordering

```sql
ORDER BY entry_total_points DESC
```

Produces the contest leaderboard.

---

## Example Output

| entry_id | user_id | entry_total_points | golfers_scored |
|----------|---------|-------------------|----------------|
| E102 | U12 | 104 | 6 |
| E220 | U55 | 101 | 6 |
| E340 | U71 | 98 | 6 |

---

## Performance Characteristics

This query runs in:

```
O(entries × golfers)
```

However with proper indexing the query performs extremely well.

**Recommended indexes:**

```sql
CREATE INDEX idx_golfer_scores_contest
  ON golfer_event_scores (contest_instance_id);

CREATE INDEX idx_entry_rosters_contest
  ON entry_rosters (contest_instance_id);
```

These indexes allow PostgreSQL to efficiently join the tables.

---

## Real-Time Leaderboard Updates

Because scoring writes are idempotent and round-based, the leaderboard query can run:

- after each scoring ingestion
- on API request
- via cached leaderboard service

No additional aggregation tables are required.

---

## Debug Query

To validate leaderboard aggregation manually:

```sql
SELECT
  er.entry_id,
  SUM(ges.total_points) AS score
FROM entry_rosters er
JOIN golfer_event_scores ges
  ON ges.golfer_id = ANY(er.player_ids)
WHERE er.contest_instance_id = 'CONTEST_ID'
GROUP BY er.entry_id
ORDER BY score DESC;
```

---

## Future Enhancements

Possible improvements:

- leaderboard materialized views
- incremental leaderboard caching
- websocket live leaderboard updates
- tie-break logic (round score, finishing position)

These enhancements do not change the core aggregation model.

---

## Summary

Leaderboard computation is intentionally simple:

```
entry_rosters
+
golfer_event_scores
↓
contest leaderboard
```

This design ensures:

- deterministic results
- simple debugging
- high performance
- scalable tournament updates

---

## Architect Note

Your final architecture is now **clean and scalable**:

```
ESPN
↓
Ingestion
↓
Scoring Engine
↓
golfer_event_scores
↓
Leaderboard SQL
↓
API
```

This is **exactly how production DFS systems separate scoring from entry computation**.
