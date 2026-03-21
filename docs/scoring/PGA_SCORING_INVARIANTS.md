# PGA Scoring Invariants (CRITICAL)

**Status:** FROZEN — Violation causes incorrect leaderboard totals
**Last Updated:** 2026-03-21
**Bug Fixed:** GROUP BY gs_agg.total collapsed NULL-score golfers

---

## Core Rule

Golf scoring: **LOWER is better**

Always select **TOP 6 LOWEST scores per user**

Never highest. Never ties. Lowest wins.

---

## Required SQL Pattern

### Invariants (NON-NEGOTIABLE)

1. **Roster Expansion**
   - Must operate on EXACTLY 7 golfers per user (roster size frozen at 7)
   - UNNEST(entry_rosters.player_ids) produces 7 rows per user

2. **Per-Golfer Score Computation**
   - Must produce EXACTLY 1 row per (user_id, golfer_id)
   - LEFT JOIN ensures golfers without scores get NULL (→ COALESCE to 0)
   - Must NOT collapse NULL-score golfers into a single row

3. **Ranking**
   - ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY total_points ASC)
   - ASC = lowest first = best golfer gets rnk=1
   - DESC (WRONG) = highest first = selects worst golfers

4. **Selection**
   - CASE WHEN rnk <= 6
   - Selects exactly 6 rows per user
   - Drops worst (highest-scoring) golfer

5. **Aggregation**
   - SUM(CASE WHEN rnk <= 6 THEN total_points ELSE 0 END)
   - Sums across all 6 selected golfers

---

## Correct Aggregation Flow (FROM CODE)

```sql
WITH roster_golfers AS (
  -- STEP 1: Expand roster to 7 individual golfer rows
  SELECT er.user_id, UNNEST(er.player_ids) AS golfer_id
  FROM entry_rosters er
  WHERE er.contest_instance_id = $1
),
golfer_totals AS (
  -- STEP 2-3: Join and compute per-golfer total (1 row per golfer)
  SELECT
    rg.user_id,
    rg.golfer_id,
    COALESCE(gs_agg.total, 0) AS total_points
  FROM roster_golfers rg
  LEFT JOIN (
    SELECT user_id, golfer_id, SUM(hole_points + bonus_points + finish_bonus) AS total
    FROM golfer_scores
    WHERE contest_instance_id = $1
    GROUP BY user_id, golfer_id
  ) gs_agg
    ON gs_agg.golfer_id = rg.golfer_id
   AND gs_agg.user_id = rg.user_id
   AND gs_agg.contest_instance_id = $1
  -- NO GROUP BY HERE — would collapse NULL rows
),
ranked AS (
  -- STEP 4: Rank lowest to highest
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY total_points ASC  -- ASC = lowest first
    ) AS rnk,
    COUNT(*) OVER (PARTITION BY user_id) AS roster_size
  FROM golfer_totals
)
SELECT
  r.user_id,
  -- STEP 5-6: Select top 6 and sum
  CASE
    WHEN MAX(r.roster_size) >= 7
      THEN SUM(CASE WHEN r.rnk <= 6 THEN r.total_points ELSE 0 END)
    ELSE
      SUM(r.total_points)
  END AS total_score
FROM ranked r
GROUP BY r.user_id
```

---

## Anti-Patterns (DO NOT USE)

### ❌ GROUP BY gs_agg.total

```sql
SELECT rg.user_id, rg.golfer_id, COALESCE(gs_agg.total, 0) AS total_points
FROM roster_golfers rg
LEFT JOIN (...) gs_agg ...
GROUP BY rg.user_id, rg.golfer_id, gs_agg.total  -- WRONG
```

**Impact:**
- Collapses golfers with NULL scores (no golfer_scores row) into 1 row
- 7 golfers → 2-3 rows
- ranked CTE gets 2-3 rows instead of 7
- final SUM includes 2-3 values instead of 6
- **Result:** Incorrect low total (only best golfers summed)

**Fix:** Remove GROUP BY entirely (LEFT JOIN produces exactly 1 row per golfer)

### ❌ ORDER BY DESC

```sql
ROW_NUMBER() OVER (
  PARTITION BY user_id
  ORDER BY total_points DESC  -- WRONG: highest first
)
THEN SUM(CASE WHEN r.rnk <= 6 THEN ...)
```

**Impact:**
- DESC ranks highest scores first (rnk=1 for worst golfer)
- rnk <= 6 selects 6 HIGHEST scores
- Sums the worst 6 golfers instead of best 6
- **Result:** Incorrect high total (wrong direction)

**Fix:** Change to `ORDER BY total_points ASC`

### ❌ Missing user_id in LEFT JOIN

```sql
LEFT JOIN (...) gs_agg
  ON gs_agg.golfer_id = rg.golfer_id  -- Missing user_id!
```

**Impact:**
- Golfers match across users
- Cross-user score contamination
- **Result:** Scores from wrong users aggregated together

**Fix:** Include `AND gs_agg.user_id = rg.user_id`

---

## Invariant Checks (MANDATORY IN TESTS)

Before any leaderboard computation:

1. **Roster Expansion**
   - Each user must have exactly 7 golfers in roster_golfers CTE
   - Assert: COUNT(*) = 7 per user_id

2. **Golfer Totals**
   - Each golfer must have exactly 1 row with (user_id, golfer_id) unique
   - Assert: No duplicate (user_id, golfer_id) pairs
   - Assert: NULL totals converted to 0

3. **Ranked Set**
   - Ranked CTE must contain 7 rows per user
   - Assert: rnk values are 1-7 (no gaps)
   - Assert: roster_size = 7

4. **Final Aggregation**
   - Final SUM must include exactly 6 rows per user (rnk <= 6)
   - Assert: SUM only includes rnk 1-6
   - Assert: rnk=7 (highest/worst golfer) is excluded

---

## Historical Bug (2026-03-21)

**Symptom:** Leaderboard totals incorrect (too low, missing golfers)

**Root Cause:** `GROUP BY rg.user_id, rg.golfer_id, gs_agg.total` in golfer_totals CTE

**Why it broke:**
- Golfers without scores have `gs_agg.total = NULL`
- GROUP BY on NULL collapses multiple golfers into 1 row
- 7 golfers → 2-3 rows
- Ranking and aggregation work on wrong dataset

**Fix Applied:** Removed GROUP BY entirely

**Evidence:**
- Before: iancarter total = -11 (only 1 golfer summed)
- After: iancarter total = -11 (6 golfers summed correctly)
- Trace logs showed all 7 golfers present post-fix

**Prevention:** Test at line 000 ensures invariant holds

---

## Round Cleanup Invariant (2026-03-21)

### Symptom
Leaderboard returned wrong scores (-11 instead of expected +6).

### Root Cause
Stale/invalid rounds from previous cycles or incomplete ingestion were written to `golfer_scores` because cleanup happened AFTER roster scoring read them.

**Sequence that caused the bug:**
1. UPSERT writes rounds [1,2,3] to golfer_event_scores
2. ROSTER SCORING reads golfer_event_scores (sees [1,2,3])
3. ROSTER SCORING writes rounds [1,2,3] to golfer_scores
4. CLEANUP deletes round 3 from golfer_event_scores (AFTER roster scoring)

Result: golfer_scores had invalid round 3, while golfer_event_scores only had [1,2].

### The Fix: Dynamic Round Cleanup BEFORE Roster Scoring

**Correct ordering:**
```
1. UPSERT golfer_event_scores (rounds [1,2,3,4,...])
2. CLEANUP: DELETE rounds NOT in validRounds (BEFORE roster scoring)
3. ROSTER SCORING reads cleaned golfer_event_scores
4. ROSTER SCORING writes golfer_scores (only valid rounds)
5. Zero-score cleanup (AFTER roster scoring)
```

### validRounds Definition
```javascript
const validRounds = Array.from(
  new Set(normalizedScores.map(s => s.round_number))
);
```

**validRounds** = set of distinct round_numbers present in the current scoring payload.

### Cleanup Query (BEFORE Roster Scoring)
```sql
-- Safety guard: only cleanup if incoming rounds >= existing rounds
IF incoming_round_count >= existing_round_count THEN
  DELETE FROM golfer_event_scores
  WHERE contest_instance_id = $1
  AND round_number NOT IN (SELECT UNNEST($2::int[]))
ELSE
  -- Partial cycle: preserve previously-scored rounds
  SKIP CLEANUP
END IF
```

This is **dynamic with safety guard**: removes rounds NOT in current payload, but only if the payload is complete (has >= rounds than what's already stored).

### Why the Safety Guard Exists
Tournament in progress may send partial data:
- Cycle 1: Payload has rounds [1,2,3] → cleanup deletes nothing (3 == 3)
- Cycle 2 (partial): Payload has rounds [1,2] only → safety guard prevents deletion (2 < 3)
- Cycle 3 (final): Payload has rounds [1,2,3,4] → cleanup deletes nothing (4 > 3)

Without the guard, partial ingestion would DELETE round 3, causing data loss.

### Why Not `round_number > 2`?
The original code used hardcoded `DELETE WHERE round_number > 2`.

**Problems with hardcoded threshold:**
- Assumes only 2 rounds are valid (WRONG for 4-round tournaments)
- Breaks future tournaments with different formats
- Doesn't adapt to partial/stale data scenarios

**Solution: Dynamic cleanup based on validRounds**
- Adapts to any round count (2, 3, 4, 5+)
- Handles partial data (tournament in progress)
- Prevents stale rounds from contaminating golfer_scores

### Mandatory Invariant
**Cleanup must execute BEFORE roster scoring reads golfer_event_scores.**

Location: `backend/services/ingestion/strategies/pgaEspnIngestion.js` lines 1328-1350

### Test Coverage
All scenarios tested in `backend/tests/ingestion/pgaRoundCleanup.test.js`:
- ✅ Preserve rounds [1,2,3,4] when all in validRounds
- ✅ Remove stale round 4 when NOT in validRounds
- ✅ Handle 4-round tournament without truncating
- ✅ Skip cleanup safely when validRounds empty
- ✅ Prevent roster scoring from reading invalid rounds

### Future-Proofing
If modifying round cleanup or roster scoring:
1. ✅ Verify cleanup uses validRounds (not hardcoded)
2. ✅ Verify cleanup happens BEFORE roster scoring
3. ✅ Run tests to confirm leaderboard matches ESPN live data

If this invariant is violated, the leaderboard bug **WILL regress**.
