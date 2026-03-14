# Player Pool and Field Selections Architecture

**Status:** Governance frozen with operational enhancement (March 13, 2026)

**Purpose:** Document the field_selections system that manages player pool snapshots for contests.

---

## Overview

Field selections represent the roster of eligible players available for a contest. This system ensures:

1. **Snapshot Consistency** — Players don't change mid-contest
2. **Determinism** — Same player list across all contest replicas
3. **Idempotency** — Safe under concurrent operations
4. **Lazy Generation** — Works even if discovery ingestion timing varies

---

## Data Model

### field_selections Table

```sql
CREATE TABLE field_selections (
    id uuid PRIMARY KEY,
    contest_instance_id uuid NOT NULL REFERENCES contest_instances(id),
    tournament_config_id uuid NOT NULL REFERENCES tournament_configs(id),
    selection_json jsonb NOT NULL,  -- { "primary": [...], "alternates": [...] }
    created_at timestamp with time zone DEFAULT now()
);

CONSTRAINT field_selections_contest_instance_unique UNIQUE (contest_instance_id);
```

### Constraints

- **NOT NULL:** tournament_config_id (FK to tournament_configs)
- **UNIQUE:** One field_selections per contest_instance
- **Append-only semantics** (implicit)

### Selection JSON Structure

```json
{
  "primary": [
    {
      "player_id": "espn_12345",
      "name": "Tiger Woods",
      "image_url": "https://example.com/tiger.jpg"
    }
  ],
  "alternates": []
}
```

---

## Lifecycle

### Phase 1: Contest Publish (Immediate)

When an organizer publishes a contest:

1. `publishContestInstance()` is called
2. Function attempts to create field_selections via `ensureFieldSelectionsForGolf()`
3. This depends on tournament_configs existing (FK constraint)

**Status:** Synchronous, but may fail if discovery hasn't run

### Phase 2: Discovery Ingestion (Asynchronous)

Discovery worker creates tournament_configs:

1. Fetches provider tournament data (ESPN, etc.)
2. Creates tournament_configs row with event metadata
3. Creates field_selections with placeholder (empty primary array)

**Status:** Asynchronous, scheduled separately from publish

### Phase 3: Lazy Restoration (On First Roster Access)

When user calls `getMyEntry()`:

1. Queries field_selections
2. If missing OR primary array empty → triggers lazy creation
3. Checks if tournament_configs exists (FK safety)
4. If tournament_configs exists → generates player pool and persists
5. If tournament_configs missing → uses fallback (no persist)

**Status:** Automatic, idempotent

---

## Lazy Creation of field_selections

### Problem: Publish vs Discovery Timing Race

**Race Condition:**
```
Timeline:
  T1: User publishes contest
      publishContestInstance() → ensureFieldSelectionsForGolf()
      ↓
      Tries: INSERT INTO field_selections WHERE tournament_config_id = ?
      ✗ tournament_configs doesn't exist yet
      ✗ FK constraint fails
      ✗ INSERT returns 0 rows
      ✗ field_selections never created

  T2: (seconds to minutes later) Discovery runs
      ↓
      Creates tournament_configs row
      Creates field_selections with empty primary

  T3: User joins contest on iOS
      ↓
      Calls getMyEntry()
      ↓
      Finds NO field_selections
      ↓
      Returns empty available_players
      ↓
      MyLineup shows "No players available"
```

### Solution: Lazy Creation During Roster Access

**New Behavior:**

When `entryRosterService.getMyEntry()` is called:

```
1. Query field_selections
   ├─ If valid primary array exists → use it ✓
   │
   └─ If missing or empty primary
      ├─ Query players table (fallback)
      ├─ Get all active GOLF players
      ├─ Check if tournament_configs exists
      │  ├─ If YES
      │  │  ├─ Build selection_json
      │  │  ├─ INSERT field_selections (ON CONFLICT DO NOTHING)
      │  │  └─ Return generated player pool ✓
      │  │
      │  └─ If NO
      │     └─ Return fallback players (no persist) ✓
```

### Safety Rules

**Never Fabricate Foreign Keys**
- Only create field_selections if tournament_configs row exists
- Query first: `SELECT id FROM tournament_configs WHERE contest_instance_id = $1`
- Condition before insert: `if (tcResult.rows.length > 0)`

**Idempotency via ON CONFLICT**
- Use database-level conflict handling
- `ON CONFLICT DO NOTHING` prevents duplicates under concurrency
- Multiple concurrent requests will race safely

**Error Resilience**
- Wrap in try/catch
- Log warnings, don't throw
- Fallback to players table if insert fails
- Lazy creation is optimization, not critical path

### Implementation Location

**File:** `/backend/services/entryRosterService.js`

**Function:** `getMyEntry()` (lines 348-387)

**Triggered When:**
- Field_selections doesn't exist, OR
- Field_selections exists but primary array is empty, AND
- Tournament_configs exists for this contest

---

## Operation & Visibility

### For Operators

**Observability Gaps (Phase 2 Fast Follower):**
- [ ] Web-Admin view for field_selections table
- [ ] Contest player pool snapshot status
- [ ] Tournament config binding visibility
- [ ] Lazy creation event logging

**Troubleshooting:**

If users report "no players available" in MyLineup:

1. Check Web-Admin → Contest Admin → Contest Details
2. Verify `tournament_configs` exists (discovery should have run)
3. Check `field_selections` row:
   - Should exist after first roster fetch
   - Primary array should be populated with player IDs
4. If missing: re-call getMyEntry() to trigger lazy creation

**Manual Verification:**

```sql
-- Check if field_selections exists
SELECT id, created_at, selection_json
FROM field_selections
WHERE contest_instance_id = '${contest_id}';

-- Check if primary is populated
SELECT jsonb_array_length((selection_json -> 'primary'))
FROM field_selections
WHERE contest_instance_id = '${contest_id}';

-- Check if tournament_configs exists
SELECT id FROM tournament_configs
WHERE contest_instance_id = '${contest_id}';
```

---

## Governance

**Frozen Aspects:**
- ✅ Field selections table schema
- ✅ Foreign key to tournament_configs (NOT NULL)
- ✅ Lazy creation logic in getMyEntry()
- ✅ Idempotency via ON CONFLICT

**Changeable Aspects (Phase 2):**
- Web-Admin observability (new views)
- System invariant monitoring
- Admin diagnostic tools

---

## Related Documentation

- **SYSTEM_STATUS_AND_ISSUES.md** — Resolved issue details
- **ARCHITECTURE_LOCK.md** § Schema Frozen Primitives
- **FAST_FOLLOWERS.md** § Web-Admin Observability for Player Pool
- **ESPN-PGA-Ingestion.md** — Data fetching strategy for tournament field discovery

---

## Test Coverage

**Test Suite:** `backend/tests/roster/playerPoolFallback.test.js`

**Cases:**
1. ✅ tournament_configs missing → fallback players returned, no insert
2. ✅ tournament_configs exists → lazy insert creates field_selections
3. ✅ repeated calls → idempotent via ON CONFLICT DO NOTHING
4. ✅ field_selections exists → no lazy creation triggered

**All tests passing:** 4 / 4 (instant, zero database I/O)
