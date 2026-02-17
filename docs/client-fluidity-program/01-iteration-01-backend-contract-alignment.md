# Client Fluidity Program
## 01: Iteration 01 - Backend Contract Alignment

**Status:** PLANNED
**Iteration:** 01
**Duration:** 2-3 weeks
**Owner:** Backend/API Team
**Depends On:** Schema review
**Blocks:** Iteration 02

---

## Purpose

Establish a lean, versioned presentation contract that provides iOS with sufficient data to render any contest type without requiring business logic on the client. This contract is the single source of truth for what iOS can render.

---

## Scope

### In Scope

1. **Contest Type Field**
   - Add `type` to all contest responses
   - Enables iOS to recognize contest category for branding/UX hints

2. **Leaderboard Endpoint**
   - New endpoint: `GET /api/contests/{id}/leaderboard`
   - Returns leaderboard data with column schema
   - Columns define rendering behavior (sort direction, precision, type)

3. **Payout Table Exposure**
   - Add `payout_table` to `GET /api/contests/{id}`
   - Array of `{ place, min_rank, max_rank, payout_amount, currency }`

4. **Roster Configuration**
   - Add `roster_config` to `GET /api/contests/{id}`
   - Includes field schema for entry validation and rendering

5. **Action Flags**
   - Add `actions` object to all contest responses
   - Flags: `can_join`, `can_edit_entry`, `is_read_only`, `is_live`, `is_closed`
   - Replaces client-side logic for determining what actions are available

6. **Idempotency Guarantee**
   - All endpoints are safe to call multiple times
   - No side effects on GET requests
   - POST/PUT requests use idempotency keys where needed

### Out of Scope

- **Contest Creation/Update UI:** Admin endpoints unchanged
- **Scoring Recomputation:** Scoring remains backend-only
- **Dynamic Layout:** No layout hints or component directives
- **Version Negotiation:** No client capability exchange
- **Caching Strategy:** Handled at infrastructure level
- **Rate Limiting:** Handled at infrastructure level

---

## Invariants

### Presentation Contract is Additive-Only
- No existing endpoint may break or change semantics
- All new fields are optional or have sensible defaults
- Legacy clients remain functional throughout transition
- Removal of deprecated endpoints only via formal deprecation cycle

### Column Schema Immutability During Contest Lifecycle
- Column schema must not change during active contest lifecycle
- Once a contest is open, column definitions are frozen
- Schema changes apply only to new contests
- Enforcement: database constraint or application guard

### Multi-Contest Scoping
- Every endpoint response must include `contest_id`
- No response assumes a single active contest
- Concurrent contests produce independent leaderboards and payouts
- Contest_id is mandatory in all writes and reads

### Deterministic Data
- Leaderboard response must be reproducible from identical inputs (no randomization permitted)
- Payout table must be deterministic (amounts are final, never recalculated mid-contest)
- Leaderboard generated_at timestamp matches the exact computation time
- Same query parameters always return identical ordered results

### No Client Logic
- Leaderboard must include all columns fully calculated by backend
- Payout amounts must be final, not formulaic
- Roster validation rules must be descriptive (informational only; server enforces on submission)

### Server as Authority
- iOS interprets `actions` flags; does not compute state
- iOS displays validation rules; does not enforce them
- iOS renders data; does not compute or replicate business logic

---

## API Specification

### 1. Contest Detail Enhanced

**Endpoint:** `GET /api/contests/{id}`

**Current Response:**
```json
{
  "id": "contest-123",
  "name": "Week 1 Challenge",
  "description": "...",
  "status": "open",
  "starts_at": "2026-02-20T00:00:00Z",
  "ends_at": "2026-02-27T23:59:59Z",
  ...
}
```

**Enhanced Response (REQUIRED ADDITIONS):**
```json
{
  "id": "contest-123",
  "contest_id": "contest-123",
  "type": "daily-fantasy",
  "name": "Week 1 Challenge",
  "description": "...",
  "status": "open",
  "starts_at": "2026-02-20T00:00:00Z",
  "ends_at": "2026-02-27T23:59:59Z",
  "organizer_id": "user-456",
  "entry_fee": 10.00,
  "currency": "USD",
  "max_entries": 50,
  "current_entries": 23,

  "actions": {
    "can_join": true,
    "can_edit_entry": false,
    "is_read_only": false,
    "is_live": false,
    "is_closed": false,
    "is_scoring": false,
    "is_scored": false
  },

  "payout_table": [
    {
      "place": 1,
      "min_rank": 1,
      "max_rank": 1,
      "payout_amount": 100.00,
      "payout_percent": null,
      "currency": "USD"
    },
    {
      "place": 2,
      "min_rank": 2,
      "max_rank": 2,
      "payout_amount": 50.00,
      "payout_percent": null,
      "currency": "USD"
    },
    {
      "place": 3,
      "min_rank": 3,
      "max_rank": 10,
      "payout_amount": 20.00,
      "payout_percent": null,
      "currency": "USD"
    }
  ],

  "roster_config": {
    "max_entries_per_user": 1,
    "entry_fields": [
      {
        "id": "primary_pick",
        "name": "Primary Pick",
        "type": "player_selection",
        "required": true,
        "constraints": {
          "min_selections": 1,
          "max_selections": 1,
          "allowed_positions": ["PG", "SG", "SF"]
        }
      },
      {
        "id": "flex_picks",
        "name": "Flex Picks",
        "type": "player_selection",
        "required": true,
        "constraints": {
          "min_selections": 2,
          "max_selections": 2,
          "allowed_positions": ["PF", "C"]
        }
      }
    ],
    "validation_rules": [
      {
        "id": "total_salary",
        "rule_type": "max_total",
        "field": "player_salary",
        "max_value": 50000,
        "error_message": "Total salary cannot exceed $50,000"
      }
    ]
  }
}
```

**Schema Impact:**
- No schema changes required; fields already exist in contest_instances
- Expose existing data only

**Failure Modes:**
- `404 Not Found` if contest_id invalid
- `403 Forbidden` if user lacks access
- Leaderboard not yet computed: `is_scored: false, is_scoring: false`

---

### 2. Leaderboard Endpoint

**Endpoint:** `GET /api/contests/{id}/leaderboard`

**Query Parameters:**
```
?page=1                    # Optional, default 1
&per_page=25               # Optional, default 25
&user_id=user-123          # Optional, highlight user row
&columns=score,rank,payout # Optional, comma-separated list (default: all)
```

**Response:**
```json
{
  "contest_id": "contest-123",
  "contest_type": "daily-fantasy",
  "leaderboard_state": "scored",
  "generated_at": "2026-02-20T14:30:00Z",

  "column_schema": [
    {
      "id": "rank",
      "name": "Rank",
      "type": "ordinal",
      "sortable": false,
      "precision": null,
      "currency": null,
      "hint": "Display as 1st, 2nd, 3rd, etc."
    },
    {
      "id": "user_name",
      "name": "Player",
      "type": "string",
      "sortable": false,
      "precision": null,
      "currency": null,
      "hint": null
    },
    {
      "id": "score",
      "name": "Score",
      "type": "numeric",
      "sortable": true,
      "sort_direction": "descending",
      "precision": 2,
      "currency": null,
      "hint": null
    },
    {
      "id": "payout",
      "name": "Winnings",
      "type": "currency",
      "sortable": true,
      "sort_direction": "descending",
      "precision": 2,
      "currency": "USD",
      "hint": null
    }
  ],

  "rows": [
    {
      "rank": 1,
      "user_id": "user-001",
      "user_name": "Alice Chen",
      "score": 145.5,
      "payout": 100.00,
      "is_current_user": false,
      "entry_id": "entry-001"
    },
    {
      "rank": 2,
      "user_id": "user-002",
      "user_name": "Bob Smith",
      "score": 142.0,
      "payout": 50.00,
      "is_current_user": false,
      "entry_id": "entry-002"
    },
    {
      "rank": 3,
      "user_id": "user-456",
      "user_name": "Charlie Tran",
      "score": 138.25,
      "payout": 20.00,
      "is_current_user": true,
      "entry_id": "entry-003"
    }
  ],

  "pagination": {
    "page": 1,
    "per_page": 25,
    "total_rows": 23,
    "total_pages": 1
  }
}
```

**Column Types and Rendering:**
- `ordinal`: Render as rank (1st, 2nd, 3rd, ...)
- `string`: Render as text
- `numeric`: Render with precision decimal places
- `currency`: Render with currency symbol
- `percentage`: Render as percentage
- `date`: Render as ISO date

**Schema Impact:**
- No schema changes required
- Query leaderboard_cache or compute on read

**Failure Modes:**
- `404 Not Found` if contest_id invalid
- `202 Accepted` if leaderboard not yet generated (contest not scored)
- Include `retry_after` header if still computing

---

### 3. Payout Visibility

**Already Exposed In:** `GET /api/contests/{id}` (see section 1)

**Consistency Requirements:**
- Payout table in contest detail must match payouts in leaderboard rows
- No divergence between `contest.payout_table` and actual payouts awarded
- Payout amounts are final and deterministic

---

### 4. Roster Configuration Schema

**Already Exposed In:** `GET /api/contests/{id}` (see section 1)

**Field Type Definitions:**
```
player_selection: Single or multiple player picker with constraints
entry_text: Free text input (questions, player names, etc.)
team_selection: Team picker
performance_prediction: Score/stat prediction
pick_order: Ranked list of selections
```

**Constraint Schema:**
```json
{
  "min_selections": 1,           // Minimum required
  "max_selections": 3,           // Maximum allowed
  "allowed_positions": [],       // Restrict by position (sport-specific)
  "allowed_teams": [],           // Restrict by team
  "min_salary_total": 0,         // Min combined salary
  "max_salary_total": 50000,     // Max combined salary
  "unique_teams": false,         // No duplicate teams
  "unique_players": true         // No duplicate players
}
```

**Validation Rules:**
```json
{
  "id": "rule-123",
  "rule_type": "max_total",      // max_total, min_total, unique, range
  "field": "player_salary",
  "max_value": 50000,
  "error_message": "Total salary cannot exceed $50,000"
}
```

---

### 5. Action Flags

**Requirement: All action flags are derived from the contest lifecycle state machine.**

**Always Present In:**
- `GET /api/contests/{id}` (contest detail)
- `GET /api/contests` (contest list)
- `GET /api/custom-contests/join/:token` (join token resolution)

**Flag Definitions (Fully Computed Server-Side, Never Inferred Client-Side):**

| Flag | Derivation Rule | TRUE Condition | FALSE Condition |
|------|-----------------|---|---|
| `can_join` | Status + capacity + user state | status=open AND capacity>0 AND user not already member | status≠open OR capacity=0 OR user already member |
| `can_edit_entry` | Status + deadline | status=open AND now<entry_deadline | status≠open OR now≥entry_deadline |
| `is_read_only` | Lifecycle phase | status=archived OR is_demo=true | status≠archived AND is_demo≠true |
| `is_live` | Leaderboard state | leaderboard_state=computing | leaderboard_state≠computing |
| `is_closed` | Status + deadline | status=closed OR entry_deadline_passed | status=open AND entry_deadline not passed |
| `is_scoring` | Leaderboard state machine | leaderboard_state IN (pending, computing) | leaderboard_state IN (computed, error) |
| `is_scored` | Leaderboard state machine | leaderboard_state=computed | leaderboard_state≠computed |

**Enforcement Rules:**
- Flags are read-only from iOS perspective
- No iOS code may compute or predict state
- All flags computed in single query or deterministic code path
- Documentation must specify exact SQL or logic for each flag
- Code review must verify flag derivation before closure

---

## Closure Gate: Binary, Enforceable Definition of Done

**Iteration 01 MUST close when ALL of the following conditions are met:**

### Data Contract Completeness
- [ ] `GET /api/contests/{id}` returns: `type`, `actions`, `payout_table`, `roster_config`
- [ ] `GET /api/contests/{id}/leaderboard` endpoint implemented and functional
- [ ] All endpoints include `contest_id` in response
- [ ] Payout table matches leaderboard payouts exactly (reconciliation test passes)
- [ ] Roster config schema fully describes all validation rules
- [ ] No breaking changes to existing endpoints (backward compatibility verified)

### Determinism & Correctness
- [ ] Leaderboard response is reproducible: identical query parameters always return identical results
- [ ] Payout table contains only final amounts (no formulas, no randomization)
- [ ] Column schema is immutable during active contest lifecycle
- [ ] Action flags are derived from state machine (no inferred computation)
- [ ] All responses are idempotent on GET; safe to retry
- [ ] Currency and precision consistent across all endpoints

### Action Flags Enforcement
- [ ] Each action flag has documented derivation rule (SQL or logic)
- [ ] Flag derivation verified in code review
- [ ] Flags transition correctly as contest state changes
- [ ] No iOS code can compute or predict action flag values

### Testing (ALL tests must pass, zero failures)
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Multi-contest isolation verified: contest A leaderboard never includes contest B data
- [ ] Pagination tested: 25 rows per page, next/previous work correctly
- [ ] User highlight in leaderboard works correctly
- [ ] Reconciliation test passes: payout_table in detail matches leaderboard payouts
- [ ] Action flag state transitions tested for all contest states

### Documentation & Specification
- [ ] Swagger/OpenAPI spec created and matches JSON examples exactly
- [ ] API spec documents all endpoints, parameters, responses
- [ ] Error codes documented with HTTP status
- [ ] Example responses in documentation match production responses
- [ ] Column type definitions documented (ordinal, numeric, currency, percentage, date, string)

### Sign-Off
- [ ] Backend Lead approval
- [ ] Code review confirms: no assumptions about single contest, no client-side logic exposure
- [ ] Platform Architecture approval
- [ ] Iteration 02 can proceed (gate opened)

---

## Explicit Boundaries (Not in Scope for Iteration 01)

**Intentionally Out of Scope:**
- Client-side scoring computation or raw player stat exposure
- Payout formulas (amounts only, fully computed by backend)
- Client-side validation enforcement (server is authority)
- Schema versioning (handle via endpoint versions if needed)
- Layout directives, component names, or UI framework references
- Performance optimization beyond straightforward queries
- Real-Time updates (WebSocket, SSE, or streaming)

---

## Explicit Authoritative Contracts

### A. Payout Authority & Tie Resolution

#### Source of Truth

- **The leaderboard.rows[].payout field is the authoritative payout value.**
- This represents the actual awarded amount per entry.
- The payout_table in contest detail is a published payout schedule (template).
- If any discrepancy exists, leaderboard.rows[].payout is correct.

#### Tie Resolution Rule

- Ties use duplicate rank assignment.
- Example: If 8 participants tie for rank 3, all receive rank = 3.
- The next participant receives rank = 11.
- Payout distribution:
  - The payout amount for that rank range is split equally among tied participants.
  - Example:
    - payout_table: rank 3-10 → $20
    - 8 participants tie at rank 3
    - Each receives payout = $20.00 (already computed and reflected in leaderboard)

#### Reconciliation Invariant

For every leaderboard row:

Find payout_table entry where:
```
row.rank >= min_rank AND row.rank <= max_rank
```

Assert:
```
abs(row.payout - payout_table.payout_amount) < 0.01
```

This invariant must pass in integration tests.

**Closure gate requirement:**
- [ ] Tie scenario test implemented
- [ ] Reconciliation test implemented

---

### B. Leaderboard State Machine (Authoritative Definition)

#### Enum

```
leaderboard_state ∈ ["pending", "computing", "computed", "error"]
```

#### Definitions

- **pending**
  - Contest exists
  - Scoring not yet executed

- **computing**
  - Background scoring job in progress
  - Leaderboard endpoint returns 202 Accepted

- **computed**
  - Scoring complete
  - Leaderboard endpoint returns 200 OK with full schema and rows

- **error**
  - Scoring failed irrecoverably
  - Leaderboard endpoint returns 200 OK with error message

#### Transition Order (Immutable)

```
pending → computing → computed
pending → computing → error
```

No backward transitions.

Terminal states:
- `computed`
- `error`

#### Mapping Requirement

Contest lifecycle status must not be used directly by iOS.
iOS behavior must be driven exclusively by leaderboard_state and actions.

**Closure gate requirement:**
- [ ] Enum implemented in backend
- [ ] Integration test validates state transitions
- [ ] Example responses updated to use "computed" (not "scored")

---

### C. Join Endpoint Idempotency Contract

#### POST /api/contests/{id}/join

Behavior is idempotent per (contest_id, user_id).

#### First Request

Response:
- HTTP 200
- Returns new entry object

#### Subsequent Identical Request

Response:
- HTTP 200 (NOT 409)
- Returns the same entry object
- entry_id identical to original
- joined_at unchanged

#### Enforcement Requirements

- Database unique constraint on (contest_id, user_id)
- On unique violation (PG error 23505):
  - Fetch existing entry
  - Return existing entry
  - No duplicate rows created

**Closure gate requirement:**
- [ ] Integration test:
  - Join once
  - Join again
  - Assert same entry_id
  - Assert joined_at unchanged
  - Assert HTTP 200 both times

---

## Sign-Off

- [ ] Backend Lead Approval
- [ ] API Contract Review
- [ ] Platform Architecture Approval
- [ ] Ready for Iteration 02
