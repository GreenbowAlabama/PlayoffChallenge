# Admin API Documentation

**Status:** Operational Admin APIs for customer service and technical support operations

---

## PGA Diagnostics

### Path
```
GET /api/admin/pga/leaderboard-debug
```

### Purpose
Operational diagnostic endpoint used to validate PGA scoring pipeline integrity.

This endpoint merges:
- `event_data_snapshots` leaderboard payload
- `golfer_scores` fantasy scoring records

to produce a deterministic leaderboard containing both raw strokes and computed fantasy scores.

### Response Schema
Matches OpenAPI schema `PgaLeaderboardEntry`.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `golfer_id` | string | Unique golfer identifier |
| `player_name` | string | Display name |
| `position` | number | Leaderboard position |
| `total_strokes` | number | Raw strokes calculated from snapshot holes |
| `fantasy_score` | number | Cumulative fantasy points |

### Data Sources

**Leaderboard Data**
- Table: `event_data_snapshots`
- Field: `payload`

**Fantasy Scores**
- Table: `golfer_scores`
- Field: `total_points`

### Aggregation Rule

```sql
fantasy_score = SUM(total_points)
GROUP BY golfer_id
```

Scores are cumulative across all rounds for the contest.

### Constraints

This endpoint is **strictly read-only**.

It performs:
- ❌ No writes
- ❌ No settlement interaction
- ❌ No ledger interaction
- ❌ No lifecycle mutation

Used exclusively for operational verification.
