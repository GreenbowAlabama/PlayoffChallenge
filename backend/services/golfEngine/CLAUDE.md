# Golf Engine Service

## Purpose
Config-driven tournament orchestration for stroke-play golf contests.

## Non-Negotiable Constraints
- **Pure functions only**: No database writes, no side effects, no state mutation
- **Deterministic**: Same inputs → same outputs, always. Explicit ordering by player_id breaks ties
- **Fail-loud**: Invalid configs return explicit error lists; missing leaderboard fields throw with context
- **No silent failures**: All validation must report every error; all scoring must validate all required fields
- **No tier logic**: This service knows nothing about tier-based handicapping
- **No plugin system**: Scoring rules are hardcoded for stroke play only
- **No provider adapter layer**: Tournament configs are the source of truth

## Public Interface

### `validateConfig(config) → { valid: boolean, errors: string[] }`
Validates tournament configuration structure and required fields.

**Returns:** Object with `valid` boolean and `errors` array.
- If valid: `{ valid: true, errors: [] }`
- If invalid: `{ valid: false, errors: ['error1', 'error2', ...] }`

**Never throws.** All errors are collected and reported.

### `selectField(config, participants) → { primary: [], alternates: [] }`
Deterministically selects primary field and alternates based on config.

**Returns:** Object with `primary` and `alternates` arrays of participant objects.
- Primary field is ordered and deterministic
- Alternates are ordered and deterministic
- Same config + same participants → same output always

**Throws:** Explicit error if config invalid, participants missing required fields.

### `applyStrokePlayScoring(config, leaderboard, results) → { scores: {} }`
Applies stroke-play scoring rules to leaderboard results.

**Returns:** Object with `scores` mapping player_id → score.
- Each score is an integer (strokes count)
- Deterministic ordering on ties

**Throws:** Explicit error with code and message if:
- Config invalid
- Leaderboard missing required fields
- Results incomplete
- Player in results not in validated field

## Schema Versions
- `leaderboard_schema_version`: Must be specified in config
- Iteration 01: Version 1 only
- Unknown versions are rejected

## Determinism Requirements
- All arrays sorted by player_id before processing or returning
- No floating point; all scores are integers
- Ties resolved by lowest player_id first
- No UUID randomization; use provided player_ids
- Same config hash + same participants hash → same output always

## Test Coverage (Merge Blockers)
- validateConfig rejects each missing required field
- validateConfig rejects invalid cut_after_round
- validateConfig rejects unsupported leaderboard_schema_version
- selectField determinism: same input → identical output
- applyStrokePlayScoring determinism: replay test passes
- applyStrokePlayScoring throws on missing leaderboard fields
- Sentinel test: no tier logic referenced
