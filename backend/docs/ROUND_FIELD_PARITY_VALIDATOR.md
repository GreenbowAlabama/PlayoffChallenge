# Round Field Parity Validator

**Status:** HARDENED — FINAL PRODUCTION ENFORCEMENT
**Date:** 2026-03-21 (Initial) / 2026-03-21 (Hardened)
**Purpose:** CRITICAL SYSTEM INVARIANT — Prevent partial rounds from being persisted to golfer_event_scores

---

## Problem Statement

The system was allowing ESPN to send incomplete round data (partial field coverage) and ingesting it directly into golfer_event_scores. This created:

- **Scoring Drift:** Some golfers have 3 rounds, others only 2 rounds
- **Leaderboard Corruption:** Unfair totals (some entries get extra rounds)
- **Data Integrity Violation:** Baseline field size was unknown and could be corrupted

**Example of Problem:**
```
tournament_configs.round_count = 4
golfer_event_scores distribution:
  round 1 → 135 golfers ✓
  round 2 → 135 golfers ✓
  round 3 → 12 golfers  ✗ PARTIAL (not persisted with new guard)

Result: Some users have [1,2,3], others only [1,2]
```

---

## Final Behavior (Production)

**This is now a CRITICAL SYSTEM INVARIANT.**

### Core Enforcement

- **Baseline Source:** Fetched DIRECTLY from `field_selections.selection_json->'primary'` array length
- **Baseline Authority:** Immutable and authoritative — MUST NOT be inferred from incoming data
- **Validation Scope:** Per-round (each round evaluated independently)
- **Enforcement Rule:** Each round must have EXACTLY `baseline` unique golfers
- **Rejection Scope:** If a round does NOT match baseline, the ENTIRE round is rejected (all-or-nothing)
- **Write Guarantee:** No partial rounds can be persisted under any condition

### Example

**Baseline: 135 golfers**

```
Round 1 → 135 golfers → ACCEPT (entire round inserted)
Round 2 → 135 golfers → ACCEPT (entire round inserted)
Round 3 → 17 golfers  → REJECT (entire round dropped, 0 rows inserted)
Round 4 → 135 golfers → ACCEPT (entire round inserted)
```

Result: golfer_event_scores contains ONLY rounds 1, 2, 4 (no partial data from round 3)

---

## Enforcement Rules (STRICT)

These rules are non-negotiable and baked into the ingestion pipeline.

1. **Baseline Fetch:** Query `field_selections` directly in `upsertScores()` — do NOT use cached or inferred values
2. **Baseline Validation:** If baseline is null, invalid, or ≤ 0 → HARD STOP
3. **Per-Round Grouping:** Group `normalizedScores` by `round_number` and count distinct `golfer_id` per round
4. **Match Comparison:** Compare actual golfer count to baseline for each round independently
5. **Full Round Acceptance:** If `actual_count === baseline` → Accept ALL scores for that round
6. **Full Round Rejection:** If `actual_count !== baseline` → Reject ENTIRE round, insert 0 rows
7. **No Row-Level Filtering:** No partial acceptance of scores within a rejected round
8. **Idempotency:** Multiple runs with same input produce identical results

---

## Hard Stop Conditions

Ingestion STOPS (no INSERT, return cleanly) if:

| Condition | Log Message | Action |
|-----------|-------------|--------|
| field_selections missing | `[ROUND_PARITY_VALIDATOR] Baseline not ready (field_selections missing/empty)` | Return (no-op) |
| baseline is null/invalid | `[ROUND_PARITY_VALIDATOR] Invalid baseline value` | Return (no-op) |
| All rounds invalid | `[ROUND_PARITY_VALIDATOR] HARD STOP - no complete rounds` | Return (no-op) |
| validScores.length === 0 | `[ROUND_PARITY_VALIDATOR] HARD STOP - no valid rounds` | Return before INSERT |

**Rejection logs for individual invalid rounds:**
```
[ROUND_PARITY_VALIDATOR] FULL ROUND REJECTION
{ contest_instance_id, round_number, actual_count, expected_count }
```

**Pre-insert confirmation:**
```
[ROUND_PARITY_VALIDATOR] FINAL VALID ROUNDS
{ contest_instance_id, baseline, rounds: [...], total_scores }
```

---

## Data Integrity Guarantee

**Post-hardening, this system guarantees:**

✅ Every persisted round has FULL field coverage (golfer_count === baseline)
✅ No partial rounds can exist in golfer_event_scores post-fix
✅ Ingestion is deterministic and replay-safe
✅ Re-runs with identical input produce identical output
✅ One contest's scoring cannot affect another

---

## Migration / Cleanup Requirement

⚠️ **CRITICAL:** Existing data MAY contain invalid rounds from pre-fix ingestion cycles.

Historical cleanup is REQUIRED before trusting scoring outputs:

```bash
# Dry run: see what would be deleted
node backend/debug/cleanupInvalidRounds.js <contest_instance_id>

# Execute: actually delete invalid rounds
node backend/debug/cleanupInvalidRounds.js <contest_instance_id> --execute
```

This removes all rounds where `COUNT(DISTINCT golfer_id) !== baseline`.

---

## Solution: Deterministic Baseline

### Baseline Source

**Authoritative source:** `field_selections` table
**Field:** `selection_json->'primary'` (JSONB array)
**Populated by:** FIELD_BUILD phase during discovery
**Immutable:** Never changes during ingestion

The field_selections table is created by the FIELD_BUILD phase and contains the complete, authoritative roster of golfers for each contest. This is set ONCE during discovery and used as the truth source for all scoring ingestion.

### Query

```sql
SELECT jsonb_array_length(selection_json->'primary') as golfer_count
FROM field_selections
WHERE contest_instance_id = $1
```

This query returns the baseline golfer count. If field_selections doesn't exist or is empty, ingestion is BLOCKED (not ready).

---

## Implementation (Hardened)

### Enforcement Location

**Location:** `backend/services/ingestion/strategies/pgaEspnIngestion.js`
**Function:** `upsertScores(ctx, normalizedScores)`
**Pattern:** Inline deterministic enforcement (baseline query + round validation + filtering)

> **Note:** Legacy validator module (`roundFieldParityValidator.js`) is DEPRECATED. Enforcement moved inline for clarity and directness.

### Enforcement Flow

```javascript
// Step 1: Fetch baseline DIRECTLY from field_selections
const baselineResult = await dbClient.query(
  `SELECT jsonb_array_length(selection_json->'primary') as baseline
   FROM field_selections
   WHERE contest_instance_id = $1`,
  [contestInstanceId]
);

// If baseline missing or invalid → HARD STOP
if (!baselineResult.rows[0] || baseline <= 0) {
  logger.warn('[ROUND_PARITY_VALIDATOR] Baseline not ready');
  return;  // HARD STOP
}

// Step 2: Group normalizedScores by round_number
const roundGroups = {};
normalizedScores.forEach(score => {
  const roundNum = Number(score.round_number);
  if (!roundGroups[roundNum]) {
    roundGroups[roundNum] = new Set();
  }
  roundGroups[roundNum].add(score.golfer_id);
});

// Step 3: Validate each round independently
const validScores = [];
for (const roundNum in roundGroups) {
  const actualCount = roundGroups[roundNum].size;

  if (actualCount === baseline) {
    // ACCEPT entire round
    normalizedScores
      .filter(s => Number(s.round_number) === roundNum)
      .forEach(score => validScores.push(score));
  } else {
    // REJECT entire round
    logger.warn('[ROUND_PARITY_VALIDATOR] FULL ROUND REJECTION', {
      round_number: roundNum,
      actual_count: actualCount,
      expected_count: baseline
    });
  }
}

// Step 4: HARD STOP if no complete rounds remain
if (validScores.length === 0) {
  logger.warn('[ROUND_PARITY_VALIDATOR] HARD STOP - no complete rounds');
  return;  // HARD STOP: No INSERT
}

// Step 5: Log final valid rounds
logger.info('[ROUND_PARITY_VALIDATOR] FINAL VALID ROUNDS', {
  baseline,
  rounds: [...],
  total_scores: validScores.length
});

// Step 6: INSERT only validScores
await dbClient.query(`INSERT INTO golfer_event_scores (...) VALUES ...`, values);
```

### Critical Guarantees

- **Baseline Query:** Direct from field_selections (never cached, never inferred)
- **No Row-Level Filtering:** Entire rounds accepted or rejected, never partial
- **Defensive Guards:** Multiple return points to prevent INSERT with empty validScores
- **Logging:** Every rejection logged with round_number and actual vs expected counts
- **Pre-Insert Confirmation:** FINAL VALID ROUNDS log shows exactly what will be written

---

## Validation Rules (Frozen — Non-Negotiable)

These rules are baked into the ingestion pipeline and cannot be disabled or overridden.

1. **Baseline is External:** Must be queried from field_selections.selection_json->'primary' at ingestion time
2. **Baseline is Immutable:** Once set during FIELD_BUILD, never changes; ingestion cannot modify it
3. **Exact Equality:** Every persisted round must have EXACTLY baseline golfer count
4. **All-or-Nothing per Round:** If a round doesn't match baseline, NO rows from that round are persisted
5. **No Heuristics:** No thresholds, no guesses, no inference; math must be exact
6. **HARD STOP on Zero Valid:** If all rounds fail validation, ingestion returns without INSERT
7. **No Row-Level Filtering:** Rounds are accepted/rejected as units, never partially
8. **Idempotent:** Multiple runs with identical input produce identical validScores

---

## Test Coverage

### Unit Tests (Validator Module)

**Location:** `backend/tests/ingestion/roundFieldParityValidator.test.js`

**Test Cases:**

1. ✅ No field_selections → everything blocked
2. ✅ Empty field_selections → everything blocked
3. ✅ Full round matching baseline → accepted
4. ✅ Partial round → rejected
5. ✅ Multiple rounds, some match, some don't → only valid ones accepted
6. ✅ Idempotency: re-running validator produces same result
7. ✅ Baseline never changes during ingestion
8. ✅ Empty/null incoming scores → handled gracefully
9. ✅ Gap in rounds (1,2,4 missing 3) → accepted if all match baseline
10. ✅ Partial first round cannot establish baseline
11. ✅ Baseline from field_selections is immutable source

**Run tests:**
```bash
npm test -- backend/tests/ingestion/roundFieldParityValidator.test.js
```

### Integration Tests (Production Pipeline)

The hardened enforcement in `pgaEspnIngestion.js` is validated by:
- Existing PGA scoring pipeline tests
- Manual verification with production data
- Cleanup script validation (see Migration section)

---

## Behavioral Guarantees

### Before Hardening (Initial Fix)

```
Round 1 (135 golfers) → inserted ✓
Round 2 (135 golfers) → inserted ✓
Round 3 (12 golfers)  → rejected ✗ (but validator not preventing all write paths)
                         Some rows still persisted
                         Write path wasn't fully guarded
```

### After Hardening (Final Production)

```
field_selections baseline = 135 golfers

Round 1 (135 golfers) → ACCEPT (100% inserted)
Round 2 (135 golfers) → ACCEPT (100% inserted)
Round 3 (12 golfers)  → REJECT (0 rows inserted)
                         Entire round dropped
                         Logged: FULL ROUND REJECTION
                         Awaits complete round 3 in next cycle
Round 4 (135 golfers) → ACCEPT (100% inserted)

GUARANTEE: No partial data persists. All rounds in DB match baseline exactly.
```

---

## Idempotency

Re-running the validator with the same input produces:
- Identical validScores
- Identical rejectedRounds
- No state mutations

This ensures safe replay and re-ingestion without data corruption.

---

## Logging Output

Every ingestion generates structured logs at key points:

### Hard Stop Conditions

```
[ROUND_PARITY_VALIDATOR] Baseline not ready (field_selections missing/empty)
[ROUND_PARITY_VALIDATOR] Invalid baseline value

[ROUND_PARITY_VALIDATOR] HARD STOP - no complete rounds
  rounds_scanned: 3
  rejected_rounds: 3
  total_incoming_scores: 100
```

### Per-Round Rejections

```
[ROUND_PARITY_VALIDATOR] FULL ROUND REJECTION
  contest_instance_id: f6d203fc-...
  round_number: 3
  actual_count: 12
  expected_count: 135
  reason: Incomplete field coverage
```

### Pre-Insert Confirmation

```
[ROUND_PARITY_VALIDATOR] FINAL VALID ROUNDS
  contest_instance_id: f6d203fc-...
  baseline: 135
  rounds: [1, 2, 4]
  total_scores: 405
```

### Successful Insert

```
[SCORING] Score insert complete
  contest_instance_id: f6d203fc-...
  inserted_scores: 405
```

---

## Schema References

### field_selections Table

```sql
CREATE TABLE public.field_selections (
  id uuid PRIMARY KEY,
  contest_instance_id uuid NOT NULL,
  tournament_config_id uuid NOT NULL,
  selection_json jsonb NOT NULL,  -- Contains { primary: [player1, player2, ...] }
  created_at timestamp NOT NULL,
  UNIQUE (contest_instance_id)
);
```

### golfer_event_scores Table

```sql
CREATE TABLE public.golfer_event_scores (
  id uuid PRIMARY KEY,
  contest_instance_id uuid NOT NULL,
  golfer_id text NOT NULL,
  round_number integer NOT NULL,
  hole_points integer NOT NULL,
  bonus_points integer NOT NULL,
  finish_bonus integer NOT NULL,
  total_points integer NOT NULL,
  created_at timestamp NOT NULL,
  UNIQUE (contest_instance_id, golfer_id, round_number)
);
```

---

## Future Enhancements (Phase 2)

- **Metrics:** Track rejection rate by contest
- **Alerting:** Notify on high rejection rates
- **ESPN Integration:** Request field_size in ESPN metadata to validate baseline
- **Recovery:** Auto-request missing rounds from ESPN if partial detected

---

## References

### Production Code
- **Hardened Enforcement:** `backend/services/ingestion/strategies/pgaEspnIngestion.js:upsertScores()` (lines ~1268-1417)
- **Legacy Validator:** `backend/services/ingestion/validators/roundFieldParityValidator.js` (deprecated, kept for reference)

### Testing & Cleanup
- **Unit Tests:** `backend/tests/ingestion/roundFieldParityValidator.test.js`
- **Cleanup Script:** `backend/debug/cleanupInvalidRounds.js` (one-time migration for historical data)
- **Validation Script:** `backend/debug/validateRoundParitySnapshot.js` (verify baseline vs stored data)
- **Inspection Script:** `backend/debug/inspectRound3Writes.js` (analyze write patterns)

### Governance
- **Lifecycle:** `docs/governance/LIFECYCLE_EXECUTION_MAP.md`, `DISCOVERY_LIFECYCLE_BOUNDARY.md`
- **Ingestion:** `docs/governance/INGESTION_GUARANTEES.md`
- **Scoring Pipeline:** `docs/architecture/PGA_SCORING_PIPELINE.md`, `SCORING_PIPELINE.md`
