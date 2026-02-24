# Iteration 01 – Masters Config-Driven Golf Engine

## Objective

Establish a fully config-driven golf tournament engine that can execute any Masters-format tournament without code changes.

The engine must:
- Accept tournament configuration as data (field, stroke-play cumulative scoring configuration, stage definitions, cutline rules)
- Execute deterministic field selection (qualifiers, alternates)
- Apply stroke-play cumulative scoring without branching logic
- Support multiple concurrent tournaments with identical engine
- Enable tournament configuration to be published without deployments

---

## Architectural Constraints

### No Sport-Agnostic Platform
- This iteration solves for golf, not "any sport"
- Do not build abstraction layers for hypothetical future sports
- Golf-specific terminology (course, par, strokes) is acceptable in contracts
- When we add another sport, that sport gets its own engine; we do not refactor this one

### Config-Driven Means
- Tournament rules live in database or config files, not code
- Updating tournament configuration does not require code review or deployment
- Contest lifecycle (SCHEDULED → LOCKED → LIVE → COMPLETE) is automated by timestamp + state rules
- No hardcoded tournament IDs, field sizes, or scoring thresholds

### Single Responsibility
- `golfEngine` service owns: configuration validation, field initialization, scoring application
- `contestService` owns: lifecycle state transitions
- `settlementService` owns: final score computation and result publication
- Clear boundaries; no service bleeds into another's responsibility

### Roster Validation Scope (Iteration 01)

Iteration 01 includes only minimal roster validation necessary for contest integrity:
- `roster_size` (required, integer, > 0): Configured roster size for the tournament
- No duplicate players within a roster: Each player appears exactly once
- Each selected player must exist in the validated tournament field: Participant must be eligible
- Submitted roster size must equal configured roster_size: Roster is complete

No other roster constraints are implemented in this iteration.

**Tier Logic Explicitly Excluded**: Tier-based player grouping, tier quotas, or tier distribution rules are NOT part of Iteration 01. Tier logic is considered a future contest-level rule extension and must not be implemented within the tournament engine, ingestion pipeline, scoring engine, or settlement logic.

---

## SOLID Enforcement

### Single Responsibility Boundaries
- **golfEngine**: Validates config, applies stroke-play cumulative scoring, computes field-based scores (no lifecycle)
- **tournamentConfig**: Immutable data model for tournament rules
- **fieldSelector**: Autonomous field selection based on config (no side effects)
- **ContestRulesValidator** (or equivalent service): Validates roster constraints (size, uniqueness, field existence) at contest entry layer, NOT in engine

No generic scoringRule abstraction. Stroke-play scoring is hardcoded. No dynamic scoring pipeline. No rule registry.

**Roster Validation Isolation**: Roster validation logic must reside in a dedicated ContestRulesValidator service. The golf engine must not depend on roster construction rules. No tier or strategic lineup mechanics may be referenced in engine services.

**Document these boundaries** in `/backend/services/golfEngine/CLAUDE.md` and `/backend/services/ContestRulesValidator/CLAUDE.md`

### Explicit Interfaces
- `golfEngine.validateConfig(config)` → `{ valid: bool, errors: string[] }`
- `golfEngine.selectField(config, participants)` → `{ primary: [], alternates: [] }`
- `golfEngine.applyStrokePlayScoring(config, leaderboard, results)` → `{ scores: {} }`
- All inputs are immutable; all outputs are deterministic
- Stroke-play cumulative logic is hardcoded; no pluggable rules

### No Hidden Coupling
- No global state (tournament ID baked into module)
- No side effects inside golfEngine (no DB writes, no cache mutations)
- All dependencies are injected or explicit in function signature
- Config object is the single source of truth

### Dependency Direction
```
routes → contestController → contestService → golfEngine
                                            → settlement
                                            → queryBuilder
```
No reverse dependencies; golfEngine does not call contestService.

### Settlement Purity Rule

Settlement computation must be pure and side-effect free.

- **Settlement logic must not call Stripe**: No payment processing, no webhook triggers, no balance updates.
- **Settlement logic must not send emails**: No participant notifications, no admin alerts. Side effects happen after settlement commit.
- **Settlement logic must not mutate contest lifecycle**: No state transitions (LOCKED → LIVE → COMPLETE). Lifecycle is orchestrated separately.
- **Settlement logic must not trigger external systems**: No third-party API calls, no provider notifications, no external webhooks.
- **Side effects occur only after settlement commit**: Once scores are computed and verified, orchestration layer handles side effects (send emails, update payment status, trigger webhooks).
- **Unit tests must verify settlement functions do not depend on external services**: Mock all external calls; assert they are not invoked during settlement. No real Stripe, no real emails, no real state transitions in settlement tests.

This protects replay safety. Settlement can be re-run from identical input data and produce identical results without duplication or side effects.

### Engine Responsibilities (Strictly Limited)

The golf engine in Iteration 01 is strictly responsible for:
- **Ingestion**: Accept and validate raw leaderboard data from provider
- **Scoring**: Apply stroke-play cumulative calculation to leaderboard
- **Settlement**: Compute final scores deterministically
- **Deterministic Replay**: Enable identical re-runs from same input data

Roster validation exists at the contest rules layer and must not contaminate engine logic.

**No roster construction, strategic lineup mechanics, tier logic, or contest-level constraints are implemented within engine services.**

---

## Data Model Impact

### Schema Changes Required
- `tournament_configs` table: stores explicit, strongly-typed configuration fields defined in Required Config Schema
- `tournament_config_versions` table: audit trail for config changes
- `field_selections` table: audit record of who was selected for what tournament
- `scoring_audit` table: every stroke-play calculation application logged

### Required Config Schema (Exact Fields - No Optionals)

Tournament config must include all of the following fields:

```
id                          (uuid, required)
contest_id                  (uuid, required, foreign key)
provider_event_id           (string, required) - unique identifier from data provider
ingestion_endpoint          (string, required) - URL to fetch leaderboard updates
event_start_date            (timestamp, required)
event_end_date              (timestamp, required)
round_count                 (int, required, default 4) - number of rounds in tournament
cut_after_round             (int, nullable) - round number after which field is cut (NULL = no cut)
leaderboard_schema_version  (int, required) - version of provider leaderboard format expected
field_source                (enum, required) - 'provider_sync' or 'static_import'
created_at                  (timestamp, required)
published_at                (timestamp, required, marks config as active)
is_active                   (bool, required)
hash                        (string, required) - SHA256 hash for immutability verification
```

No optional fields. All fields are required at config creation. Missing or NULL fields (except cut_after_round) result in validation failure.

### Critical Constraint
- Once a tournament enters LIVE state, its config is immutable
- Config changes during LIVE state are rejected at application layer
- This prevents scoring rule drift mid-tournament

---

## Contract Impact

### Breaking Changes (None Intentional)
- New endpoints may be added for config publication
- Existing score retrieval endpoints must remain unchanged
- Score schema must include stroke-play calculation source for audit

### New Contracts
- `GET /api/admin/tournaments/:id/config` → returns active config
- `POST /api/admin/tournaments/:id/config/validate` → validates without saving
- `PUT /api/admin/tournaments/:id/config` → publishes config (SCHEDULED only)

---

## Validation Rules

### Configuration Validation (Before Publish)
1. Field size matches participant count or is flexible
2. Leaderboard schema fields required for stroke-play cumulative calculation are present and valid
3. Cutline rules are mathematically sound (e.g., ties are handled)
4. No negative scores unless explicitly allowed
5. Stroke-play cumulative order is deterministic (no floating-point accumulation)

### Tournament Execution Validation
1. Only one active config per contest at a time
2. Config cannot change while contest is LOCKED or LIVE
3. All participants must be eligible per config rules
4. Stroke-play cumulative scoring must not reference undefined fields

### Silent Failures Not Allowed
- Invalid config returns explicit errors with line numbers
- Stroke-play calculation that cannot be applied returns error, not 0
- Missing participant data is logged and stops settlement

---

## Failure Modes

### Config Validation Failures
- **Unsupported leaderboard_schema_version or missing required leaderboard fields**: Return `{ valid: false, errors: ["leaderboard_schema_version: X not supported or required field Y missing"] }`
- **Ambiguous cutline**: Return `{ valid: false, errors: ["cutline_type: ties not handled for N players"] }`
- **Circular dependencies**: Return error; prevent at load time

### Execution Failures
- **Missing data for stroke-play calculation**: Log with context; stop settlement; alert ops
- **Stroke-play calculation crashes**: Wrap in try-catch; log full stack; fail the entire settlement
- **Field selection produces more than configured capacity**: Reject; alert; require manual review

### Recovery
- Config validation errors: Fix config, re-validate, re-publish (no code change needed)
- Execution errors: Review logs, fix data, re-run settlement from checkpoint
- All failures are auditable; no silent corrections

---

## Unit Test Requirements

### Service Contract Tests
- `golfEngine.validateConfig()` with valid config → passes
- `golfEngine.validateConfig()` with unsupported leaderboard_schema_version → fails with specific error
- `golfEngine.validateConfig()` with missing field → fails explicitly
- `golfEngine.selectField()` produces consistent field given same inputs
- `golfEngine.applyScoring()` produces identical results on replay

### Lifecycle State Tests
- Config cannot be changed in LOCKED state
- Config cannot be changed in LIVE state
- Config change in SCHEDULED state succeeds with audit trail
- Publishing config creates immutable version record

### Stroke-Play Scoring Tests
- Stroke-play cumulative logic is tested independently
- Cumulative totals produce expected results
- Stroke-play logic handles edge cases (ties, missing data, negative values)
- Replay: re-running stroke-play scoring on same data produces identical results

### Failure Case Tests
- Invalid config is rejected with specific error message
- Stroke-play calculation failure stops settlement and logs context
- Missing required data is detected before settlement
- Out-of-capacity field selection is rejected with alert

---

## Completion Criteria

✓ Tournament config table exists with proper schema
✓ Config validation logic is unit tested and deterministic
✓ Field selection logic is unit tested and deterministic
✓ Scoring engine applies stroke-play cumulative logic deterministically using config parameters without branching
✓ Config cannot be changed while contest is LOCKED or LIVE
✓ All validation failures are explicit with clear error messages
✓ Roster validation enforces roster_size, uniqueness, and field existence
✓ Roster validation logic resides in dedicated ContestRulesValidator service, NOT in engine
✓ No tier logic present in engine layer, ingestion pipeline, or scoring logic
✓ Engine responsibilities remain limited to ingestion, scoring, settlement, and determinism
✓ Schema snapshot is updated and committed
✓ No undocumented assumptions remain in SOLID boundaries

---

## Final Contract Snapshot (ITERATION 01 APPROVED)

### validateConfig() Guarantees

```javascript
validateConfig(config) → { valid: boolean, errors: string[] }
```

**Contract Enforcement:**
- `event_start_date` and `event_end_date` must be `instanceof Date` objects (no string parsing)
- Invalid dates rejected via `isNaN(config.field.getTime())`
- `round_count` must be: defined, number type, integer (via `Number.isInteger()`), not NaN, positive (> 0)
- `cut_after_round` (if provided) must be: integer, within range [1, round_count], not NaN
- `leaderboard_schema_version` must be: integer, not NaN, version 1 only (Iteration 01)
- All validation errors collected and returned; no silent coercion

**Backend Authority**: No string-to-Date parsing. No type coercion. Inputs must be structurally correct before engine accepts them.

### applyStrokePlayScoring() Guarantees

```javascript
applyStrokePlayScoring(config, leaderboard) → { scores: {} }
```

**Contract Enforcement:**
- `total_strokes` must be: number type, integer (via `Number.isInteger()`), not NaN, non-negative
- Float strokes **rejected** with explicit error (no silent flooring)
- Negative strokes rejected
- Missing leaderboard fields throw with player context
- Scores mapped deterministically by sorted player_id
- JSON stringified output identical across identical inputs (replay safety)

**Ranking Not Implemented**: Engine returns stroke totals only. Ranking, tie-breaking, and final positions computed by settlement layer. Separation of concerns enforced.

### selectField() Guarantees

```javascript
selectField(config, participants) → { primary: [], alternates: [] }
```

**Contract Enforcement:**
- Participants sorted deterministically by player_id (lexicographic)
- No mutation of input arrays
- Identical input → identical output guaranteed
- All output arrays sorted before return

### ContestRulesValidator Guarantees

```javascript
validateRoster(roster, config, validatedField) → { valid: boolean, errors: string[] }
```

**Contract Enforcement (Iteration 01 only):**
- Roster size must exactly equal `config.roster_size`
- No duplicate player_ids in roster
- Each player_id must exist in validatedField
- All constraint violations collected and reported

---

## Explicit Non-Goals (Iteration 01)

These are explicitly OUT of scope and will NOT be implemented:

- **No ranking**: Engine does not compute positions, placements, or rank numbers
- **No settlement logic**: Engine does not compute payouts, allocate winnings, or publish results
- **No ingestion orchestration**: Engine does not fetch from provider or handle webhook timing
- **No persistence layer**: Engine does not write to database or create audit rows directly
- **No tier logic**: Engine contains no handicap, tier grouping, tier quotas, or strategic distribution
- **No provider adapter**: Engine is not provider-agnostic; config specifies provider schema version
- **No plugin registry**: Scoring rules hardcoded for stroke play only; no dynamic rule loading
- **No multi-sport abstraction**: This is golf-specific; next sport gets its own engine

---

## Determinism Guarantees Section

### Mathematical Determinism

**Sorting Rule**: All arrays sorted by `player_id` lexicographically before return or processing.

```
a.player_id < b.player_id → return -1
a.player_id > b.player_id → return 1
a.player_id === b.player_id → return 0
```

This is the only determinism rule. No secondary sorts, no score-based ordering.

### Data Immutability

- Input objects never mutated
- Output objects created fresh each call
- No shared state between invocations
- No caching, no memoization

### Floating Point Handling

- Strokes must be integers; floats explicitly rejected
- No accumulation, no rounding, no truncation
- All numeric operations are exact (addition only, no division or modulo)

### Replay Guarantees

**Same input → Identical JSON output:**

```javascript
JSON.stringify(result1) === JSON.stringify(result2) // always true
Object.keys(result1.scores).join(',') === Object.keys(result2.scores).join(',') // always true
```

This is verifiable in audit layer. If JSON differs, something was mutated.

### Tie-Breaking (Intentionally Not Implemented)

When two players have identical strokes:
- Engine returns both with identical scores
- No position assigned (ranking layer responsibility)
- Order determined by sorted player_id for audit consistency only

---

## Test Coverage Summary (APPROVED)

### Configuration Validation
- ✅ All missing required fields rejected individually
- ✅ Date validation: String dates rejected, invalid dates rejected
- ✅ Integer validation: NaN rejected, floats rejected, negative rejected
- ✅ Schema version: Only version 1 accepted; higher versions rejected
- ✅ cut_after_round: Range validation, optional but constrained if provided
- ✅ Multiple errors collected and reported together

### Field Selection
- ✅ Determinism: Same input produces identical output across 3+ repeated calls
- ✅ Ordering: Participants sorted by player_id consistently
- ✅ Different input order: Produces identical output (order independence)
- ✅ Error handling: Invalid config throws, non-array participants throw, missing player_id throws

### Stroke Play Scoring
- ✅ Determinism: Same leaderboard produces identical scores across repeated calls
- ✅ Key ordering: Object keys in sorted player_id order for audit
- ✅ Replay safety: JSON stringified output identical across identical inputs
- ✅ No silent correction: Float strokes explicitly rejected, not floored
- ✅ No floating point: Integer strokes preserved without modification
- ✅ Error handling: Missing fields throw with context, negative scores throw, NaN rejects, Infinity rejects
- ✅ Tie handling: Tied players both returned with identical scores; no ranking applied

### Contest Rules Validator
- ✅ Roster size: Exact match required, mismatch rejected
- ✅ Duplicates: All duplicate player_ids reported together
- ✅ Field existence: Unknown players rejected with context
- ✅ Multiple constraints: All violations collected together
- ✅ Iteration 01 scope: Only three constraints; no tier logic

### Sentinel Tests (No Tier Logic)
- ✅ golfEngine services contain no reference to: handicap, tier, adjustment
- ✅ ContestRulesValidator contains no reference to: handicap, tier, adjustment
- ✅ Zero abstraction creep verified

---

## Lessons Learned (CLOSED)

### What Worked

1. **SOLID Boundaries Prevent Scope Creep**: Clear service separation (golfEngine vs ContestRulesValidator vs settlement) prevented tier logic leakage. Explicit non-goals worked.

2. **Backend Authoritative Validation is Essential**: Strict `instanceof Date` enforcement caught string parsing vulnerability. NaN detection prevented silent coercion.

3. **Determinism Must Be Testable**: JSON replay equality test proved determinism where deep equality only confirmed structure. This matters for audit.

4. **Contract Comments Must Match Implementation**: When documentation said "ranking handled elsewhere" but code had no ranking logic, tests verified the claim. Documentation-code alignment is governance.

### What Was Harder Than Expected

1. **Silent Corrections are Hidden Governance Failures**: Float flooring looked harmless but violates "fail-loud" principle. Required removal and test inversion (reject instead of correct).

2. **Date Validation Has Many Edge Cases**: `new Date('invalid')` creates object but `getTime()` returns NaN. Required dual validation: `instanceof Date` AND `isNaN(getTime())`.

3. **NaN is Subtle**: `NaN <= 0` is false, so `round_count = NaN` bypassed numeric validation. Required explicit `Number.isNaN()` check.

4. **Integer Detection Requires Both Checks**: `Number.isInteger()` rejects NaN but `typeof NaN === 'number'`. Required sequential validation, not just one check.

### Assumptions We Purged

1. **Assumption: String dates are acceptable** → Purged. Backend must enforce Date objects.
2. **Assumption: Flooring is silent correction, not data loss** → Purged. Flooring is mutation; reject floats.
3. **Assumption: Ranking logic belongs in scoring engine** → Purged. Moved to settlement layer. Engine outputs stroke totals only.
4. **Assumption: results parameter will be used** → Purged. Removed unused parameter; explicit contract now.

### Decisions For Next Iteration

1. **Ingestion must hash leaderboard payload**: Iteration 02 will enforce provider schema validation and deterministic payload hashing for audit.

2. **Audit table must store full computation context**: scoring_audit table will record config version, leaderboard hash, output scores, timestamp, and contestant count for replay verification.

3. **Idempotent re-scoring required**: Iteration 02 must support re-running applyStrokePlayScoring on same config+leaderboard and producing identical results without duplication.

4. **Settlement layer is next hardening focus**: Iteration 02 focuses on settlement purity enforcement (no Stripe, no emails, pure scoring only).

### Service-Level CLAUDE.md Files

Governance files created for explicit boundary enforcement:

- `/backend/services/golfEngine/CLAUDE.md` – Engine scope, purity rules, determinism guarantees
- `/backend/services/ContestRulesValidator/CLAUDE.md` – Validator scope, Iteration 01 constraints only

Both files are binding governance, not advisory documentation.

---

## Schema Audit (ITERATION 01)

**Schema Changes**: NONE

Iteration 01 introduced no new tables or columns. All required tables were already deployed:

- ✅ `tournament_configs` – stores config with all required fields
- ✅ `tournament_config_versions` – audit trail for config versions
- ✅ `field_selections` – field selection audit
- ✅ `scoring_audit` – scoring execution audit

**Audit Result**: Schema snapshot is current and accurate. No delta from deployed schema.

**Recorded at**: 2026-02-14 – Schema verified stable.

---

## Status: ITERATION 01 CLOSED ✅

**Governance Decision**: APPROVED FOR CLOSE

Date Closed: 2026-02-14

Locked by: Governance Review

Schema Audit: No changes required

Next Phase: Iteration 02 – Ingestion Safety & Audit
