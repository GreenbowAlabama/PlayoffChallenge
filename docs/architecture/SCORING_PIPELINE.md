# PGA Scoring Pipeline

---

## Scoring Orchestration

**SCORING is orchestrated by `ingestionService.runScoring()` rather than adapter work unit generation.**

The service:
1. Retrieves ESPN event ID from `tournament_configs`
2. Calls `fetchLeaderboard()` to fetch ESPN leaderboard data
3. Constructs a SCORING work unit with `{ phase: 'SCORING', providerEventId, providerData }`
4. Passes the work unit to `run()` which invokes the adapter

The adapter consumes this unit to compute golfer scores and insert them into `golfer_event_scores`.

**Implementation:**
- Service: `backend/services/ingestionService.js:runScoring()`
- API Client: `backend/services/ingestion/espn/espnPgaApi.js:fetchLeaderboard()`
- Adapter: `backend/services/ingestion/strategies/pgaEspnIngestion.js:handleScoringIngestion()`

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
PLAYER_POOL Phase
(field snapshot ingestion)
       ↓
PLAYER_POOL ingestion_event
(record full tournament field)
       ↓
SCORING Phase
(leaderboard snapshots)
       ↓
event_data_snapshots
(immutable provider data)
       ↓
Scoring engine (pga_standard_v1)
       ↓
golfer_scores
(individual player points)
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

---

## Operational Diagnostics

### Ingestion Event Pipeline Verification

To verify the ingestion pipeline is working end-to-end:

```bash
psql "$DATABASE_URL" -c "
SELECT
  event_type,
  COUNT(*) as count,
  MAX(validated_at) as latest
FROM ingestion_events
GROUP BY event_type
ORDER BY event_type;
"
```

**Expected during live PGA tournament:**

```
event_type | count | latest
-----------+-------+-------------------
player_pool | 1     | 2026-03-14 14:00:00
scoring    | 3     | 2026-03-14 15:30:00
```

**Interpretation:**

- `player_pool = 1` — Field snapshot created once (FIELD_BUILD phase)
- `scoring ≥ 1` — Leaderboard snapshots created repeatedly during tournament

### Debug: Verify PLAYER_POOL Event Exists

```bash
psql "$DATABASE_URL" -c "
SELECT
  id,
  event_type,
  provider_data_json->>'provider_event_id' as event_id,
  payload_hash,
  validation_status,
  validated_at
FROM ingestion_events
WHERE event_type = 'player_pool'
ORDER BY validated_at DESC
LIMIT 5;
"
```

### Debug: Count Golfers by PLAYER_POOL Event

```bash
psql "$DATABASE_URL" -c "
SELECT
  ie.id,
  jsonb_array_length(ie.provider_data_json->'golfers') as golfer_count,
  ie.validated_at
FROM ingestion_events ie
WHERE ie.event_type = 'player_pool'
ORDER BY ie.validated_at DESC
LIMIT 1;
"
```

Expected: `golfer_count > 50` (full PGA field)
