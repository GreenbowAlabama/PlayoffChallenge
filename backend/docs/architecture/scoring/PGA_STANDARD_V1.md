# PGA Standard V1 Scoring Architecture

## Scoring Source of Truth (LOCKED)

The PGA scoring system uses:

- **Table**: `golfer_event_scores`
- **Scope**: contest-level (NO user_id)

This table is the single source of truth for all scoring calculations.

### Data Model

Each row represents:

- `contest_instance_id` — UUID of the contest
- `golfer_id` — ESPN golfer ID
- `round_number` — Tournament round (1, 2, 3, 4, etc.)
- `hole_points` — Score for holes in this round
- `bonus_points` — Round bonuses
- `finish_bonus` — Finish position bonus
- `total_points` — Sum of all point fields

**Constraint**:
```
UNIQUE(contest_instance_id, golfer_id, round_number)
```

### Streaming Model

- Data is ingested incrementally from ESPN
- **Partial rounds are valid** (3 of 7 golfers is OK)
- **Missing rounds are ignored** (don't block scoring)
- **Re-ingestion overwrites deterministically** (same input = same state)

**NO**:
- Round completeness checks
- Field completeness requirements
- Gating logic that blocks on partial data

---

## Scoring Aggregation Model (LOCKED)

### Step 1 — Aggregate at golfer level

```sql
SELECT
  contest_instance_id,
  golfer_id,
  SUM(hole_points + bonus_points + finish_bonus) AS total
FROM golfer_event_scores
WHERE contest_instance_id = $1
GROUP BY contest_instance_id, golfer_id;
```

**Critical**: Aggregation happens at (contest, golfer) level ONLY.
NO user_id in GROUP BY.

### Step 2 — Join to entry_rosters

- `entry_rosters` defines user ownership
- Golfer scores are applied AFTER aggregation
- Multiple users can own the same golfer
- Each user gets the SAME score for that golfer

### Step 3 — Rank per user

- Rank golfers per user (not global)
- ORDER BY total_points DESC (select BEST golfers)
- Select BEST 6 golfers (top 6 by points)

---

## Critical Invariants

1. **Same golfer = identical score for all users**
   - Enforced by aggregating BEFORE user join

2. **Aggregation MUST NOT include user_id**
   - Scoring layer groups by (contest_instance_id, golfer_id) only

3. **User ownership MUST NOT affect scoring totals**
   - User rosters only determine which golfers count

4. **No duplication across users**
   - golfer_event_scores stores one row per golfer per round

5. **No cross-contest bleed**
   - All queries filtered by contest_instance_id

---

## Anti-Patterns (FORBIDDEN)

❌ Using `golfer_scores` as scoring source
❌ Aggregating after joining to users
❌ GROUP BY user_id in scoring layer
❌ UNION between `golfer_event_scores` and `golfer_scores`
❌ Any fallback scoring logic

→ These violate streaming model and **will be rejected**.

---

## Test Alignment (MANDATORY)

Tests MUST:
1. Insert into `golfer_event_scores` (NOT `golfer_scores`)
2. Insert ONCE per (contest, golfer, round)
3. NOT insert per user
4. Reflect real streaming ingestion behavior

---

## Governance Status

✅ **LOCKED** — Mar 21, 2026
