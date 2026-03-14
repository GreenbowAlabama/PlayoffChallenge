# PGA Scoring Pipeline

---

## PGA Leaderboard Diagnostics

The system exposes an operational diagnostic endpoint allowing administrators to verify scoring correctness during live tournaments.

### Diagnostic Endpoint
```
GET /api/admin/pga/leaderboard-debug
```

### Pipeline Flow

```
Provider Feed (ESPN)
       ↓
Snapshot ingestion (event_data_snapshots)
       ↓
Scoring engine (pga_standard_v1)
       ↓
Score persistence (golfer_scores)
       ↓
Leaderboard aggregation
```

### Aggregation Logic

```sql
SELECT
  golfer_id,
  SUM(total_points) AS fantasy_score
FROM golfer_scores
WHERE contest_instance_id = $1
GROUP BY golfer_id
```

### Purpose

This endpoint is used to confirm that fantasy scoring calculations align with the official leaderboard during live tournament play.

### Verification Checklist

- [ ] Leaderboard positions match provider data
- [ ] Total strokes calculated correctly from holes
- [ ] Fantasy scores reasonable for position
- [ ] No missing golfers in snapshot
- [ ] Cumulative scoring correct across rounds
