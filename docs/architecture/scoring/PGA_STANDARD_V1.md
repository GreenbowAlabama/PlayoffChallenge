# PGA Standard V1 — Scoring Model

**Status:** AUTHORITATIVE
**Last Updated:** 2026-03-20

---

## Scoring Model

Score is computed per `(contest_instance_id, golfer_id)` — **NOT per user**.

Golfer scores are **GLOBAL within a contest**. All users who roster the same golfer receive identical contributions from that golfer.

The scoring pipeline:

1. Ingestion writes hole-level data to `golfer_scores`
2. Leaderboard query aggregates per golfer (not per user)
3. Each user's roster expands to 7 golfer slots via `entry_rosters.player_ids`
4. Best 6 of 7 applied (drop lowest); partial rosters sum all

---

## **INVARIANT: Same golfer across multiple users → identical contribution**

Violation of this invariant indicates:

- Improper JOIN on `golfer_scores` (missing pre-aggregation)
- Missing `GROUP BY contest_instance_id, golfer_id` before roster join
- Cross-user row duplication via unscoped join

This invariant is enforced by test:
`tests/strategies/pgaStandardV1.liveStandings.test.js`

---

## Postmortem: Cross-User Score Duplication (2026-03-20)

### Root Cause

`golfer_scores` stores rows with `user_id` as a column. When the leaderboard query joined `golfer_scores` directly on `golfer_id` without pre-aggregation, it matched ALL rows for that golfer across ALL users.

Result: scores multiplied by the number of users who rostered the same golfer.

### Example

3 users pick golfer X (actual score: 10 points).

**Before fix (broken):**
```
User A joins golfer_scores → 3 rows match → SUM = 30
User B joins golfer_scores → 3 rows match → SUM = 30
```

**After fix (correct):**
```
Pre-aggregate: golfer X = 10
User A → 10
User B → 10
```

### Impact

Leaderboard showed inflated scores: `5, 4, 0, -1` instead of correct `3, -1, -5, -6`.

---

## Canonical SQL Pattern (REQUIRED)

All scoring joins MUST use pre-aggregated golfer totals:

```sql
LEFT JOIN (
  SELECT
    contest_instance_id,
    golfer_id,
    SUM(hole_points + bonus_points + finish_bonus) AS total
  FROM golfer_scores
  WHERE contest_instance_id = $1
  GROUP BY contest_instance_id, golfer_id
) gs_agg
  ON gs_agg.golfer_id = rg.golfer_id
 AND gs_agg.contest_instance_id = $1
```

This pattern produces exactly one row per golfer per contest, regardless of how many users roster that golfer.

---

## FORBIDDEN — WILL CAUSE SCORE MULTIPLICATION BUG

The following patterns are banned:

- **Direct JOIN to `golfer_scores` without aggregation** — matches N rows per golfer (one per user who has score data)
- **JOIN including `user_id` on `golfer_scores`** — creates user-scoped view of global data, drops golfers with no user-specific rows
- **`GROUP BY user_id` before aggregating golfer totals** — produces per-user subtotals instead of global golfer totals

Any query that touches `golfer_scores` for leaderboard purposes MUST pre-aggregate by `(contest_instance_id, golfer_id)` first.

---

## Data Model Note

`golfer_scores` currently includes a `user_id` column, but scoring is NOT user-scoped. The `user_id` column exists for historical reasons (ingestion pipeline wrote per-user rows).

**Future migration should remove `user_id` from `golfer_scores` to enforce correctness at schema level.** Until then, all queries must treat golfer scores as global per contest.

---

## Best 6 of 7 Logic

| Roster Size | Behavior |
|---|---|
| 7 golfers | Drop lowest scorer, sum best 6 |
| < 7 golfers | Sum all, no drop |

Implemented in SQL via conditional `CASE WHEN MAX(roster_size) >= 7`.

Roster is always sourced from `entry_rosters.player_ids` (UNNEST), never from `golfer_scores`.

---

## Test Coverage

**File:** `tests/strategies/pgaStandardV1.liveStandings.test.js`

| Test | Protects Against |
|---|---|
| `same golfer across multiple users → identical contribution` | Cross-user score duplication |
| `returns total_score as a number` | Type regression (object vs number) |
| `returns total_score as 0 when no scores` | Missing golfer handling |
| `partial roster — sums all, no drop` | Incorrect drop on incomplete rosters |
| `tied scores with shared rank` | Ranking logic regression |

---

## Implementation Reference

- Strategy: `backend/services/strategies/pgaStandardV1.js`
- Registry: `backend/services/scoringStrategyRegistry.js` (`pga_standard_v1`)
- Aggregation (legacy JS path): `backend/services/scoring/pgaEntryAggregation.js`
- Debug script: `backend/scripts/debug/pgaScoringDebug.js`
