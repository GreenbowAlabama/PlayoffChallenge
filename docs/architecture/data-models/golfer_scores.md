# golfer_scores — Data Model

**Status:** AUTHORITATIVE
**Last Updated:** 2026-03-20

---

## Purpose

Stores hole-level scoring data ingested from external providers (ESPN). Used to compute leaderboard standings for PGA contests.

---

## Key Constraint

**Golfer scores are GLOBAL within a contest.**

Score for a golfer in a contest is the same regardless of which user rostered that golfer. The `user_id` column does NOT make scores user-specific for leaderboard purposes.

---

## **INVARIANT: Same golfer across multiple users → identical contribution**

All leaderboard queries MUST pre-aggregate by `(contest_instance_id, golfer_id)` before joining to user rosters.

---

## Schema (Current)

| Column | Type | Notes |
|---|---|---|
| contest_instance_id | uuid | FK to contest_instances |
| user_id | uuid | **Legacy column — see warning below** |
| golfer_id | text | Provider-scoped golfer identifier |
| hole_points | numeric | Points from hole scoring |
| bonus_points | numeric | Streak/bonus points |
| finish_bonus | numeric | Position-based finish bonus |

---

## WARNING: user_id Column

The `user_id` column exists because the ingestion pipeline historically wrote per-user rows. However, scoring is NOT user-scoped.

**Current state:** Multiple rows may exist per golfer per contest (one per user).

**Required query pattern:** Always pre-aggregate before joining to rosters:

```sql
SELECT contest_instance_id, golfer_id,
  SUM(hole_points + bonus_points + finish_bonus) AS total
FROM golfer_scores
WHERE contest_instance_id = $1
GROUP BY contest_instance_id, golfer_id
```

**Future migration should remove `user_id` from this table to enforce correctness at schema level.**

---

## FORBIDDEN Query Patterns

```sql
-- ❌ Direct join without aggregation
LEFT JOIN golfer_scores gs ON gs.golfer_id = rg.golfer_id

-- ❌ User-scoped join (drops golfers, creates incomplete rosters)
LEFT JOIN golfer_scores gs ON gs.golfer_id = rg.golfer_id AND gs.user_id = rg.user_id

-- ❌ GROUP BY user_id before golfer aggregation
SELECT user_id, golfer_id, SUM(...) FROM golfer_scores GROUP BY user_id, golfer_id
```

All of these cause score multiplication or incomplete roster bugs. See `docs/architecture/scoring/PGA_STANDARD_V1.md` for postmortem.
