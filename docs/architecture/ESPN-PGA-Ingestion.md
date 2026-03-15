# ESPN PGA Ingestion Strategy

**Status:** AUTHORITATIVE (Updated March 14, 2026)
**Version:** 1.1
**Purpose:** Document the authoritative ESPN API endpoints and data ingestion logic for PGA player field discovery.

---

## Executive Summary

The PGA ingestion system fetches tournament participant data from ESPN's public API.

**Key Discovery (March 14, 2026):**

The ESPN **leaderboard endpoint** returns empty competitor arrays even during live tournaments.

The **scoreboard endpoint** is the reliable data source and is now the **authoritative, exclusive source** for PGA player field ingestion.

---

## Authoritative Data Source

### Scoreboard Endpoint (✅ AUTHORITATIVE)

**URL:** `https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard`

**Response Structure:**
```json
{
  "events": [
    {
      "id": "401811937",
      "name": "The Players Championship",
      "startDate": "2026-03-12T07:00Z",
      "endDate": "2026-03-15T23:00Z",
      "competitions": [
        {
          "competitors": [
            {
              "id": "12345",
              "athlete": {
                "id": "12345",
                "displayName": "Rory McIlroy",
                "fullName": "Rory McIlroy",
                "firstName": "Rory",
                "lastName": "McIlroy",
                "headshot": {
                  "href": "https://a.espncdn.com/..."
                }
              },
              "status": "active",
              "displayOrder": 1
            },
            ...
          ]
        }
      ]
    },
    ...
  ]
}
```

**Key Properties:**
- `events[]` — Array of all active/upcoming tournaments
- `events[].id` — ESPN event ID (string, e.g., "401811937")
- `events[].competitions[0].competitors[]` — Array of participating golfers
- `competitor.athlete.id` — Unique ESPN athlete/golfer ID
- `competitor.athlete.displayName` — Golfer name for display
- `competitor.athlete.headshot.href` — Golfer photo URL

**Reliability:**
- ✅ Returns data during pre-tournament (no competitors yet)
- ✅ Returns data during live tournament (~120+ competitors)
- ✅ Returns data post-tournament (final standings)
- ✅ Consistently populated for all tournament states

---

### Leaderboard Endpoint (❌ DEPRECATED - DO NOT USE)

**URL:** `https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?event={eventId}`

**Issue:** Returns empty `competitors` array even during live tournaments.

**Observed Example:**
```
GET /leaderboard?event=401811937  (during live tournament)
Response: { events: [{ competitors: [] }] }  ← EMPTY!

Same event in scoreboard:
GET /scoreboard
Response: { events: [{ id: "401811937", competitors: [~120 objects] }] }  ← POPULATED!
```

**Status:** This endpoint is unreliable for PGA. Do not use.

---

## Ingestion Pipeline

### Overview

The ingestion pipeline consists of three critical phases:

```
PLAYER_POOL Phase
(fetch field, generate player units)
       ↓
FIELD_BUILD Phase
(construct contest field)
       ↓
SCORING Phase ⭐ CRITICAL
(fetch leaderboard, generate scores)
       ↓
Settlement Pipeline
```

---

### Phase 1: PLAYER_POOL

**Status:** Adapter-generated via `getWorkUnits()`

**Execution:**
- Fetches tournament field from ESPN scoreboard via `espnPgaPlayerService.fetchTournamentField()`
- Validates minimum competitor count (≥10 golfers)
- Generates one work unit per golfer
- Returns empty scores (no scoring data in SCHEDULED status)

**Database Operations:**
- Upserts each golfer to `players` table (ON CONFLICT DO UPDATE)
- Records external_player_id in ingestion_runs for FIELD_BUILD phase scope

**Invariants Enforced:**
- Competitor count must be ≥ 10 (prevents undersized fields)
- External IDs must be present (prevents incomplete golfer records)

**Example Output:**
```
Work units generated: 144 (one per golfer in field)
```

---

### Phase 2: FIELD_BUILD

**Status:** Adapter-generated via `getWorkUnits()`

**Execution:**
- Queries ingestion_runs for completed PLAYER_POOL units
- Fetches golfers from players table (scope-limited by contest_instance_id)
- Builds field_selections with primary + alternates
- Creates PLAYER_POOL snapshot ingestion_event

**Database Operations:**
- Updates field_selections with selection_json (ON CONFLICT DO UPDATE)
- Inserts PLAYER_POOL ingestion_event (ON CONFLICT DO NOTHING)

**Invariants Enforced:**
- Primary field must contain players (prevents empty field)
- Field must be deterministically ordered (by golfer ID)

**Example Output:**
```
field_selections: 144 primary golfers
PLAYER_POOL ingestion_event: { provider_event_id, golfers }
```

---

### Phase 3: SCORING ⭐ CRITICAL

**Status:** Adapter-generated via `getWorkUnits()` (NEW: March 15, 2026)

**Execution:**
- `getWorkUnits()` calls `espnPgaApi.fetchLeaderboard({ eventId })`
- Fetches current ESPN leaderboard with competitor scores
- Generates exactly ONE SCORING work unit per polling cycle
- Work unit structure: `{ phase: 'SCORING', providerEventId, providerData }`

**Key Change (March 15, 2026):**
Previously, SCORING units were NOT guaranteed to be generated. The ingestion pipeline would complete PLAYER_POOL and FIELD_BUILD but skip SCORING, causing `handleScoringIngestion()` to never execute and scores to never populate `golfer_event_scores`.

**Now: SCORING is guaranteed.**
- SCORING unit generation is part of `getWorkUnits()`
- ESPN leaderboard is fetched during work unit generation phase
- Failure to fetch leaderboard throws error (SCORING is critical)
- Single SCORING unit per cycle ensures deterministic scoring updates

**Adapter Processing:**
- `handleScoringIngestion()` parses ESPN leaderboard
- Maps ESPN competitor IDs to database golfer IDs
- Extracts round-level hole-by-hole scores
- Calls `pgaStandardScoring.scoreRound()` for point calculation
- Returns golfer-level scores for `golfer_event_scores` table

**Database Operations:**
- Inserts event_data_snapshots (immutable scoring snapshot)
- Inserts ingestion_events (SCORING event metadata)
- Batch inserts golfer_event_scores (ON CONFLICT DO UPDATE)
- Creates compensating entries for settlement binding

**Invariants Enforced:**
- Exactly one SCORING unit per polling cycle (no duplicates)
- Leaderboard fetch must succeed (no graceful degradation for SCORING)
- Scores must be immutable snapshots (append-only ledger)

**Example Output:**
```
[SCORING] Leaderboard fetched (eventId=401811937, competitors=144)
[SCORING] Snapshot created (hash=abc123def...)
[SCORING] golfer_event_scores updated (144 golfers)
```

**Failure Handling:**
- If `fetchLeaderboard()` fails, `getWorkUnits()` throws error
- Prevents contest from progressing without scoring capability
- No silent degradation (SCORING is non-optional)

---

### Pipeline Ordering Guarantee

Work units are processed in strict order:
1. All PLAYER_POOL units (N) — players ingested
2. FIELD_BUILD unit (1) — field constructed
3. SCORING unit (1) — scores computed

This ordering ensures:
- Field exists before scoring references it
- Golfers exist before scores are computed
- Scores are computed from complete leaderboard data

---

## Ingestion Logic

### Current Implementation (Scoreboard-Only)

**File:** `/backend/services/ingestion/espn/espnPgaPlayerService.js`

**Function:** `fetchTournamentField(eventId)`

**Algorithm:**

```javascript
async function fetchTournamentField(eventId) {
  // 1. Fetch scoreboard (authoritative source)
  const scoreboardResponse = await fetch(
    'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard'
  );

  const scoreboardEvents = scoreboardResponse.data.events;

  // 2. Find exact event by ID (strict matching, no fallback)
  const targetEvent = scoreboardEvents.find(e => e.id === eventId);

  if (!targetEvent) {
    throw new Error(`Event ${eventId} not found in scoreboard`);
  }

  // 3. Extract competitors from target event only
  let competitors = [];
  for (const competition of targetEvent.competitions || []) {
    competitors.push(...(competition.competitors || []));
  }

  // 4. Normalize golfers and return
  return competitors
    .map(competitor => normalizeGolfer(competitor))
    .filter(golfer => golfer !== null);
}
```

### Safety Rules (Enforced)

| Rule | Reason | Enforcement |
|------|--------|-------------|
| **Exact Event Matching** | Prevents cross-tournament contamination | `find(e => e.id === eventId)` — no "all events" fallback |
| **Error on Not Found** | Ensures data integrity | Throw error if event ID not found |
| **Single Fetch** | Reduces API load and latency | No leaderboard attempt → no fallback cascade |
| **Competitors-Only Extraction** | Prevents stale/incomplete data | Extract from scoreboard only; never merge with other sources |
| **Normalization Filter** | Guards against missing data | Filter out golfers with missing athlete.id or displayName |

---

## Data Normalization

### Golfer Normalization

**Input:** ESPN competitor object
```json
{
  "id": "12345",
  "athlete": {
    "id": "12345",
    "displayName": "Rory McIlroy",
    "headshot": { "href": "https://a.espncdn.com/..." }
  }
}
```

**Output:** Normalized player object
```json
{
  "external_id": "12345",
  "name": "Rory McIlroy",
  "image_url": "https://a.espncdn.com/i/headshots/golf/players/full/12345.png",
  "sport": "GOLF",
  "position": "G"
}
```

**Normalization Rules:**
- `external_id` ← `athlete.id` (required, no default)
- `name` ← `athlete.displayName` or `athlete.firstName + lastName` (required, no default)
- `image_url` ← Deterministic ESPN format: `https://a.espncdn.com/i/headshots/golf/players/full/{athleteId}.png`
- `sport` ← Always "GOLF"
- `position` ← Always "G"

**Filtering:**
- Golfers without athlete.id are silently filtered
- Golfers without displayName/firstName are silently filtered
- Missing headshot does not filter (image URL is deterministic)

---

## PLAYER_POOL Snapshot Event

### Purpose

After all golfers are ingested and the tournament field is built, the system emits ONE ingestion_event representing the complete field snapshot. This snapshot is critical for:

- **Deterministic Settlement** — Settlement pipeline depends on immutable field snapshots
- **Auditability** — Full record of which golfers were available for which contest
- **Replay Safety** — Scoring and settlement can be replayed from snapshot
- **Append-Only Ledger** — Maintains immutable ingestion record per contest

### Event Contract

**Location in Code:**
```
backend/services/ingestion/strategies/pgaEspnIngestion.js
handleFieldBuildIngestion() → lines 611-665
```

**Event Type:**
```
event_type = 'player_pool'
provider   = 'pga_espn'
```

**Payload Schema:**
```json
{
  "provider_event_id": "espn_pga_401811937",
  "golfers": [
    {
      "external_id": "12345",
      "name": "Scottie Scheffler"
    },
    {
      "external_id": "12346",
      "name": "Rory McIlroy"
    },
    ...
  ]
}
```

**Idempotency:**
- Uses `ON CONFLICT (contest_instance_id, payload_hash) DO NOTHING`
- Same field snapshot produces same payload_hash
- Re-ingestion of identical field produces no duplicate event
- Safe for worker to run repeatedly

### Event Granularity Invariant

**Correct Ingestion Event Semantics:**

One ingestion_event represents ONE provider payload snapshot, NOT individual records.

| ❌ Incorrect | ✅ Correct |
|---|---|
| Create 123 ingestion_events (one per golfer) | Create 1 ingestion_event (full field) |
| Event per database record | Event per API payload snapshot |
| Denormalized, fragile | Normalized, auditable |

This invariant ensures:
- Deduplication by payload hash works correctly
- Settlement pipeline has clear snapshot boundaries
- Replay/determinism is achievable

---

## Integration Points

### Discovery Cycle

**File:** `/backend/services/discovery/discoveryService.js`

**Process:**

1. **Fetch Provider Calendar**
   - Get list of upcoming PGA tournaments

2. **For Each Event:**
   - Call `discoveryValidator.validateEvent()`
   - If valid: Create tournament_configs row
   - Call `createFieldSnapshot()` for player pool

3. **Create Field Snapshot**
   - Call `fetchTournamentField(eventId)` ← **Uses scoreboard endpoint**
   - Normalize all competitors
   - Store in field_selections

**Determinism:**
- ✅ Same event ID always returns same player pool
- ✅ Concurrent calls safe via database constraints
- ✅ Replays idempotent (same inputs → same outputs)

---

## Observability

### Logging

**Fetch Attempt:**
```
[espnPgaPlayerService] Fetching tournament field for event 401811937 from scoreboard...
```

**Success:**
```
[espnPgaPlayerService] Fetched 120 valid golfers for event 401811937 from scoreboard
```

**Failure (Event Not Found):**
```
[espnPgaPlayerService] Error fetching tournament field for event 999999999: Event 999999999 not found in scoreboard
```

### Metrics

Track:
- ESPN API response time
- Competitor count per tournament
- Normalization success rate
- Error rate (missing athlete ID, displayName)

---

## Error Handling

### Event Not Found

**Symptom:** `Event {eventId} not found in scoreboard`

**Cause:**
- Event ID is incorrect
- Tournament has been delisted from ESPN
- Scoreboard endpoint is down

**Recovery:**
- Verify event ID is correct format: `espn_pga_{id}`
- Check ESPN website to confirm tournament exists
- Retry if endpoint temporarily unavailable

### Empty Competitors

**Symptom:** Fetch succeeds, returns 0 golfers

**Possible Cause:**
- Pre-tournament (no field announced yet)
- Tournament cancelled

**Recovery:**
- Automatic retry on next discovery cycle
- Operators can manually refresh discovery

### API Timeout

**Symptom:** Request exceeds 10 second timeout

**Recovery:**
- Automatic retry with exponential backoff (handled by axios)
- Non-blocking: discovery continues with other events
- Logged as warning, cycle completes

---

## Testing

### Test Suite: `espnPgaPlayerService.test.js`

**Coverage:**

| Test | Purpose |
|------|---------|
| `should fetch golfers from ESPN scoreboard endpoint` | Verifies scoreboard endpoint is called |
| `should call ESPN scoreboard endpoint (not leaderboard)` | Ensures leaderboard NOT called |
| `should return empty array when event found but has no competitors` | Handles pre-tournament |
| `should throw if event not found in scoreboard` | Validates strict matching |
| `should filter scoreboard by eventId and not return golfers from other events` | Prevents cross-contamination |
| `should filter out competitors with missing athlete.id` | Guards data integrity |
| `should filter out competitors with missing athlete.displayName` | Guards data integrity |

**All Tests Passing:** ✅ 36/36

---

## Related Documentation

- **Discovery System:** `/docs/production-readiness/DISCOVERY_SYSTEM.md`
- **Player Pool Management:** `/docs/architecture/PLAYER_POOL_AND_FIELD_SELECTIONS.md`
- **Governance:** `/docs/governance/DISCOVERY_LIFECYCLE_BOUNDARY.md`

---

## Governance

**Frozen Aspects:**
- ✅ Scoreboard endpoint as authoritative source
- ✅ Event matching logic (exact ID, no fallback)
- ✅ Normalization rules
- ✅ Safety rules (no cross-tournament contamination)

**Status:** Architecture Lock Active — changes require architect approval

---

## Change History

### Version 1.1 (March 14, 2026)
- Updated to scoreboard-only strategy
- Removed leaderboard fallback logic
- Added strict event ID matching
- Documented ESPN leaderboard reliability issue

### Version 1.0 (Previous)
- Initial dual-endpoint strategy (leaderboard with scoreboard fallback)
