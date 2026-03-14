# Contest Rules Validator Service

## Purpose
Validates contest-specific roster and player constraints for golf tournaments.

## Non-Negotiable Constraints
- **Pure validation only**: No database writes, no side effects
- **Contest-agnostic at the platform layer**: Only enforces roster_size, duplicates, and player existence
- **Deterministic**: Same inputs → same validation result, always
- **Fail-loud**: All validation errors reported together, never silently passes invalid data
- **No tier logic**: Validation is unaware of tier-based handicapping
- **Iteration 01 scope only**: Only these three constraints

## Public Interface

### `validateRoster(roster, config, validatedField) → { valid: boolean, errors: string[] }`
Validates a player roster against tournament constraints.

**Parameters:**
- `roster`: Array of player_ids submitted by user
- `config`: Tournament configuration (must contain roster_size)
- `validatedField`: Array of validated field participant objects

**Returns:** Object with `valid` boolean and `errors` array.
- If valid: `{ valid: true, errors: [] }`
- If invalid: `{ valid: false, errors: ['error1', 'error2', ...] }`

**Never throws.** All validation errors collected and reported.

**Constraints checked (Iteration 01):**
1. Roster size is between 0 and config.roster_size (inclusive)
2. No duplicate player_ids in roster
3. Each player_id exists in validatedField

## ROSTER SUBMISSION RULE

Roster submissions are allowed to be partial. Valid roster sizes:

```
0 <= player_ids.length <= roster_size
```

**Examples:**
- `[]` — Empty roster (0 players)
- `['p1']` — Single player (partial)
- `['p1', 'p2', 'p3']` — Three players (partial)
- `['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']` — Full roster (7 players)

**Invalid:**
- `['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']` — Exceeds roster_size (8 > 7)

**Additional constraints still enforced:**
- No duplicate player_ids
- All players must exist in contest field
- Contest must be SCHEDULED
- Contest must not be past lock_time
- User must be a contest participant

## ARCHITECTURAL RATIONALE

Incremental roster persistence enables clients (iOS/web) to save lineup progress while users build their roster. This prevents data loss and improves UX during lineup construction.

## Test Coverage (Merge Blockers)
- validateRoster accepts partial roster with 1 player
- validateRoster accepts partial roster with 3 players
- validateRoster accepts empty roster (0 players)
- validateRoster rejects roster exceeding max size
- validateRoster rejects roster with duplicates
- validateRoster rejects roster with unknown players
- validateRoster accepts valid full roster
- Sentinel test: no tier logic referenced
