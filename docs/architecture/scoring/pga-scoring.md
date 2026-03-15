# PGA Scoring Architecture

**Status:** AUTHORITATIVE
**Last Updated:** 2026-03-15
**Owner:** Architecture

---

## Purpose

This document defines how PGA scoring is computed and surfaced through the leaderboard service.

Scoring involves merging data from three independent sources into a unified leaderboard view.

---

## Leaderboard Data Composition

The PGA leaderboard is composed from three distinct data domains that are merged in application logic rather than SQL joins.

### Data Sources

**1. Tournament State** — `event_data_snapshots.payload`

Contains:
- Competitor list (from ESPN leaderboard API)
- Stroke data (hole-by-hole round scores)
- Tournament metadata (participant count, round info)

Example structure:
```json
{
  "competitors": [
    {
      "athlete": { "id": "10030" },
      "linescores": [
        {
          "period": 1,
          "linescores": [
            { "period": 1, "value": 4 },
            { "period": 2, "value": 3 }
          ]
        }
      ]
    }
  ]
}
```

**2. Fantasy Scoring** — `golfer_event_scores`

Contains:
- Round-by-round point calculations
- Aggregated by golfer and contest
- Computed from stroke data using scoring rules

Example:
```
golfer_id: espn_10030
round_number: 1
hole_points: 15
bonus_points: 2
finish_bonus: 0
total_points: 17
```

**3. Player Identity** — `players`

Contains:
- ESPN athlete ID (`id` field, normalized to `espn_<id>`)
- Player name (`full_name`)
- Photo URLs
- Other metadata

---

## Leaderboard Service Pipeline

```
ESPN Ingestion (external API)
  ↓
event_data_snapshots (immutable tournament snapshots)
  ↓
pgaLeaderboardDebugService (application layer)
  ├─ Query 1: Snapshot fetch
  ├─ Extract competitors from payload
  ├─ Normalize golfer IDs to espn_<id> format
  │
  ├─ Query 2: Scores + Names (single combined query)
  │   ├─ golfer_event_scores (fantasy scores)
  │   └─ players (player names)
  │
  ├─ Application Merge
  │   ├─ For each competitor in snapshot:
  │   │   ├─ Extract golfer_id
  │   │   ├─ Compute total_strokes from linescores
  │   │   ├─ Look up fantasy_score from query results
  │   │   └─ Look up player_name from query results
  │
  ├─ Ranking
  │   ├─ Sort by total_strokes (ascending)
  │   ├─ Assign position numbers
  │   └─ Move DNS (0 strokes) to bottom
  │
  └─ API Response
      └─ WebAdmin Leaderboard Display
```

---

## Why Three Independent Sources?

### Separation of Concerns

**Tournament Data (Snapshots)**
- Authoritative for stroke counts
- Immutable historical record
- JSON structure, external provider format
- Updated during live play

**Scoring Data (Relational)**
- Computed fantasy points
- Deterministic calculations
- Normalized player identities
- Updated in batches during scoring phases

**Player Identity (Relational)**
- ESPN athlete metadata
- Display names and photos
- Static reference data
- Updated on player changes

### Why Not Join Them in SQL?

Combining these domains in a single SQL query would:

1. **Mix data types** — JSON snapshot data cannot be efficiently joined to relational scoring tables without unnesting or subqueries
2. **Create unnecessary complexity** — The snapshot payload must be parsed in application logic anyway
3. **Increase query cost** — Aggregation (SUM) and LEFT JOINs create overhead
4. **Break domain boundaries** — Tournament state and scoring calculations should remain separate

### Merge in Application

By keeping queries separate and merging in application logic:

✅ **Cleaner architecture** — Each component has single responsibility
✅ **Better performance** — No complex SQL aggregations on snapshot data
✅ **Easier debugging** — Data sources are explicit and traceable
✅ **Testable** — Application merge logic can be unit tested independently

---

## Stroke Calculation

Strokes are computed from ESPN snapshot data, never stored as a field.

**Source:**
```
competitor.linescores[].linescores[].value
```

**Algorithm:**
```javascript
let totalStrokes = 0;

// Optimization: use competitor.total if provided
if (typeof competitor.total === 'number') {
  totalStrokes = competitor.total;
} else {
  // Compute from hole-by-hole data
  for (const round of competitor.linescores) {
    for (const hole of round.linescores) {
      if (typeof hole.value === 'number') {
        totalStrokes += hole.value;
      }
    }
  }
}
```

**Why compute instead of store?**
- Strokes change during live play
- Snapshots are immutable (audit trail)
- Computation ensures accuracy from authoritative source
- Reduces data duplication

---

## Query Efficiency

The leaderboard service uses **two queries** (plus contest lookup):

**Query 1: Snapshot Fetch**
```sql
SELECT payload FROM event_data_snapshots
WHERE contest_instance_id = $1
ORDER BY ingested_at DESC LIMIT 1
```

**Query 2: Scores + Names (Combined)**
```sql
SELECT
  ges.golfer_id,
  COALESCE(SUM(ges.total_points), 0) AS fantasy_score,
  p.full_name AS player_name
FROM golfer_event_scores ges
LEFT JOIN players p ON p.id = ges.golfer_id
WHERE ges.contest_instance_id = $1
  AND ges.golfer_id = ANY($2)
GROUP BY ges.golfer_id, p.full_name
```

This replaces four separate queries (snapshot, players, golfer_event_scores without aggregation, fantasy scores) with two efficient queries.

---

## Related Documentation

- **ESPN PGA Payload Contract:** `docs/architecture/providers/espn_pga_payload.md`
- **Golfer ID Normalization:** `docs/architecture/scoring/golfer_identity.md`
- **Lifecycle Execution Map:** `docs/governance/LIFECYCLE_EXECUTION_MAP.md`
- **Leaderboard Service:** `backend/services/pgaLeaderboardDebugService.js`

---

## Governance

**Frozen Aspects:**
- Data source separation (tournament vs scoring domains)
- Espn_<id> normalization requirement
- Stroke calculation from linescores structure

**Status:** Architecture Lock Active — changes require architect approval

---
