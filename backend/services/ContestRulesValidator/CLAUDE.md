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
1. Roster size matches config.roster_size exactly
2. No duplicate player_ids in roster
3. Each player_id exists in validatedField

## Test Coverage (Merge Blockers)
- validateRoster rejects roster with wrong size
- validateRoster rejects roster with duplicates
- validateRoster rejects roster with unknown players
- validateRoster accepts valid roster
- Sentinel test: no tier logic referenced
