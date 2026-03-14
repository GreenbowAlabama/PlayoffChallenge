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
