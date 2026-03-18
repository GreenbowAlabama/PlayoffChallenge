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

## PGA Roster Scoring Layer

**Location:** `backend/services/scoring/pgaRosterScoringService.js`

**Purpose:** Aggregates golfer event scores into user roster scores for leaderboard display.

**Input Tables:**
- `entry_rosters` (user roster selections)
- `golfer_event_scores` (ESPN-ingested golfer scores per round)

**Output Table:**
- `golfer_scores` (user-level rostered player scores)

**Execution Trigger:**
Automatically invoked from the PGA ingestion strategy (`pgaEspnIngestion.js`) immediately after `golfer_event_scores` are written during the SCORING phase.

**Function Signature:**
```javascript
async function scoreContestRosters(contestInstanceId, client)
```

**Characteristics:**
- Set-based SQL JOIN (no loops)
- Idempotent UPSERT semantics
- Transaction-safe (uses same database client as ingestion)
- Scales to any user count without performance degradation

**Implementation Detail:**
Joins `entry_rosters.player_ids` (array) with `golfer_event_scores.golfer_id` using PostgreSQL's `ANY()` operator, then UPSERTs results into `golfer_scores` with conflict resolution on `(contest_instance_id, user_id, golfer_id, round_number)`.

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
golfer_event_scores
(individual golfer points per round)
       ↓
pgaRosterScoringService.scoreContestRosters()
(aggregate golfers into user rosters)
       ↓
golfer_scores
(user-level rostered player scores)
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

---

## PGA ESPN Scoring — Verified Behavior

This section documents verified behavior for PGA ESPN scoring based on production runs (verified March 18, 2026).

### Deterministic Leaderboard Event Filtering

The `fetchLeaderboard()` function implements deterministic event filtering:

**Before fix:** Function ignored `eventId` parameter and returned all events from ESPN scoreboard, causing silent cross-tournament scoring.

**After fix:** Function now:
1. Fetches ESPN scoreboard (all events)
2. Finds event by exact ID match
3. Returns ONLY the requested event (or empty array)
4. No fallback to `events[0]`

**Why:** Prevents silent data corruption from scoring wrong tournament.

### SCORING Phase Work Unit Requirements

For the SCORING phase to bypass deduplication and execute every cycle, the work unit MUST include:

```javascript
{
  phase: 'SCORING',           // ← REQUIRED
  providerEventId: 'espn_pga_401811938',
  providerData: { events: [...] }
}
```

**Without `phase: 'SCORING'`:** Work unit skipped as duplicate (idempotency guard)

**With `phase: 'SCORING'`:** Work unit always executes (scores update continuously)

### Pre-Scoring State

Before tournament scoring begins, the system reaches a valid steady state:

- ✅ PLAYER_POOL ingestion complete (competitors in database)
- ✅ Zero rows in `golfer_event_scores` (scoring not yet available)
- ✅ Log message: `[SCORING] No scoring data yet (tournament likely not started)`
- ✅ This is NOT an error condition

**Duration:** 1-2 hours before tournament start, depending on ESPN event activation.

### Idempotent Score Writes

All score writes use idempotent upserts:

```sql
INSERT INTO golfer_event_scores (...)
VALUES (...)
ON CONFLICT (contest_instance_id, golfer_id, round_number)
DO UPDATE SET total_points = EXCLUDED.total_points;
```

**Guarantee:** Re-running SCORING phase with same leaderboard produces identical `golfer_event_scores`.

**Safety:** Worker can retry without duplicate scoring.
