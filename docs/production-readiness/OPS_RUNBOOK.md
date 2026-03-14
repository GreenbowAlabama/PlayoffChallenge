# Operational Runbook

**Status:** Live Operations Procedures

---

## PGA Scoring Verification Procedure

During live PGA tournaments operators should verify scoring correctness.

### Step 1: Open Web Admin

Navigate to:
```
Operations → Leaderboards → PGA Leaderboard
```

### Step 2: Verify Provider Data

Confirm leaderboard data matches official provider leaderboard.

**Check:**
- Player positions
- Total strokes
- Accuracy against ESPN/official source

### Step 3: Verify Fantasy Scoring

Confirm fantasy scoring values appear reasonable.

**Check:**
- Fantasy scores track player performance
- Leader has highest fantasy score
- No negative or zero scores for active players

### Step 4: Diagnose Discrepancies

If discrepancies exist:

**Inspect Event Data Snapshots**
```
Operations → Data Inspection → Event Snapshots
```
- Verify leaderboard payload is current
- Check for missing golfers

**Inspect Golfer Scores**
```
Operations → Data Inspection → Golfer Scores
```
- Verify scoring computation
- Check aggregation across rounds

### Resolution Path

| Issue | Action |
|-------|--------|
| Stale leaderboard data | Check ingestion status |
| Missing golfer | Verify player pool includes golfer |
| Incorrect fantasy score | Run scoring diagnostic |
| Provider mismatch | Contact provider support |

---

## Scoring Diagnostic Flow

When investigating scoring discrepancies:

1. **Fetch current leaderboard** via `/api/admin/pga/leaderboard-debug`
2. **Compare positions** with provider's official leaderboard
3. **Validate total strokes** from snapshot payload
4. **Audit fantasy score** calculation from golfer_scores aggregation
5. **Report findings** with specific golfer IDs and scores
