# Admin Operational Towers

**Status:** Operational control centers for platform administration

---

## Leaderboard Tower

### Location
Operations → Leaderboards

### Purpose
Operational inspection of live tournament leaderboards and fantasy scoring results.

### Primary Use Cases
- Verify scoring engine output
- Validate provider data ingestion
- Inspect leaderboard snapshots
- Diagnose scoring discrepancies
- Support dispute resolution

### PGA Leaderboard

**Endpoint**
```
GET /api/admin/pga/leaderboard-debug
```

**Displays**

| Player | Position | Total Strokes | Fantasy Score |
|--------|----------|---------------|---------------|

**Source Data**
- Leaderboard snapshots (`event_data_snapshots.payload`)
- Golfer scores aggregation (`golfer_scores.total_points`)

**Purpose**
This tower allows operators to verify that the fantasy scoring pipeline is functioning correctly during live tournaments.
