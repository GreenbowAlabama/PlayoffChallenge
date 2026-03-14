# Roster System
67 Enterprises – Playoff Challenge Platform

---

## Field Selections Lazy Creation (Golf)

### Problem

Golf contests could publish before discovery ingestion created `tournament_configs`.

**Result:** `field_selections` rows were not created, causing the MyLineup screen to show no players.

### Fix

`entryRosterService.getMyEntry()` now lazily creates `field_selections` if:

- `tournament_configs` exists
- `field_selections` does not exist
- `availablePlayers` is populated

**Insert uses:**

```sql
INSERT ... ON CONFLICT DO NOTHING
```

### Guarantees

- ✅ Idempotent
- ✅ Safe under concurrency
- ✅ No fabricated foreign keys
- ✅ Does not block the request path

**Fallback behavior:** Always returns player list even if persistence fails.

---

## Roster Submission Validation

### Partial Roster Support

Roster submissions support incremental persistence. Users may submit partial rosters while building their lineup.

**Valid roster sizes:**

- `[]` — Empty roster (0 players)
- `['p1']` — Single player (partial)
- `['p1', 'p2']` — Multiple players (partial)
- `['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']` — Full roster (complete)

**Range rule:** `0 <= player_ids.length <= roster_size`

### Validation Constraints

Backend validation enforces:

1. **Roster size** — Must not exceed `roster_size` limit
2. **No duplicates** — All player_ids must be unique
3. **Field membership** — All players must exist in contest field
4. **Contest state** — Contest must be SCHEDULED
5. **Lock window** — Contest must not be past lock_time
6. **Participation** — User must be an entered participant

### Validation Location

Roster validation occurs in:

```
/Users/iancarter/Documents/workspace/playoff-challenge/backend/services/ContestRulesValidator/index.js
```

Function: `validateRoster(roster, config, validatedField)`

**Returns:** `{ valid: boolean, errors: string[] }`

### Product UX Requirement

While backend allows partial rosters, the iOS/web client UX typically requires a full roster before lock_time. However, the backend enforces only the upper bound to enable incremental saving during lineup construction.

---

## PGA Picks Submission Debugging Note (2026-03-14)

### Incident Summary

During PGA lineup testing, the iOS client received HTTP 400 responses when submitting
partial rosters through:

POST /api/custom-contests/{id}/picks

Example payload:

```json
{
  "player_ids": ["espn_10054"]
}
```

However, direct requests to the backend using curl returned HTTP 200:

```bash
curl -X POST /api/custom-contests/{id}/picks
```

Result:

```json
{
  "success": true,
  "player_ids": ["espn_10054"]
}
```

This confirmed that the backend validation and roster persistence logic were functioning correctly.

### Root Cause

The failure occurred in the iOS client request construction layer.

The request body was not always being encoded correctly when the SwiftUI state changed
during the lineup selection flow.

The backend therefore received an invalid request body and returned HTTP 400.

### Resolution

Additional logging was added to APIService.submitPicks() to capture:

• playerIds received by the method
• encoded JSON request body
• backend error response body

Example debug logs:

```
[PICKS DEBUG] Received playerIds parameter: ["espn_10054"]

[PICKS DEBUG] Encoded request body:
{"player_ids":["espn_10054"]}

[PICKS ERROR] Backend returned 400: {...}
```

This confirmed that the backend endpoint worked correctly and the issue was isolated to
client-side request construction.

### Architectural Clarification

The PGA picks endpoint supports incremental roster persistence.

Valid submissions:

```
0 <= player_ids.length <= roster_size
```

Example valid requests:

```
[]
["p1"]
["p1","p2","p3"]
["p1","p2","p3","p4","p5","p6","p7"]
```

The backend only enforces the upper bound to allow lineup progress to be saved during
roster construction.

### Debugging Recommendation

When diagnosing picks submission failures:

1. Reproduce the request using curl.
2. Compare the payload sent by the client with the curl payload.
3. Log the encoded JSON request body before the network call.
4. Log the backend error response body when status != 200.

This prevents unnecessary investigation into backend validation when the issue originates
in client request construction.

---
