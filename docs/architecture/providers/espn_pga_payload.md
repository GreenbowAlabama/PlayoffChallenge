# ESPN PGA Leaderboard Payload Contract

**Status:** AUTHORITATIVE
**Last Updated:** 2026-03-15
**Owner:** Architecture

---

## Purpose

This document defines the exact structure of ESPN PGA leaderboard payloads stored in the Playoff Challenge platform.

Leaderboard service implementations must follow this contract exactly.

**Incorrect parsing of this payload will cause:**
- Zero stroke calculations
- Broken leaderboard joins
- Silent data loss

---

## Payload Source

**Table:** `event_data_snapshots`
**Column:** `payload` (JSONB)

Payloads are captured during the SCORING ingestion phase and are immutable.

---

## Payload Structure

```
payload
  competitors[]
    id (string)
    position (integer)
    total (optional integer)
    linescores[]
      period (integer) — round number
      linescores[]
        period (integer) — hole number
        value (integer) — strokes on hole
```

---

## Example Payload

```json
{
  "competitors": [
    {
      "id": "10030",
      "position": 1,
      "total": 280,
      "linescores": [
        {
          "period": 1,
          "linescores": [
            { "period": 1, "value": 4 },
            { "period": 2, "value": 4 },
            { "period": 3, "value": 3 },
            { "period": 4, "value": 4 }
          ]
        },
        {
          "period": 2,
          "linescores": [
            { "period": 1, "value": 3 },
            { "period": 2, "value": 5 },
            { "period": 3, "value": 4 },
            { "period": 4, "value": 3 }
          ]
        }
      ]
    }
  ]
}
```

---

## Key Fields

| Field | Type | Purpose | Required |
|-------|------|---------|----------|
| `competitors[]` | array | Array of tournament participants | YES |
| `competitor.id` | string | ESPN athlete ID (raw) | YES |
| `competitor.position` | integer | Leaderboard rank | YES |
| `competitor.total` | integer | Total strokes (optimization) | NO |
| `competitor.linescores[]` | array | Rounds played | YES |
| `linescore.period` | integer | Round number (1, 2, 3, 4...) | YES |
| `linescore.linescores[]` | array | Holes in round | YES |
| `hole.period` | integer | Hole number (1-18) | YES |
| `hole.value` | integer | Strokes on hole | YES |

---

## Stroke Calculation

### Method 1: Direct Total (If Available)

If `competitor.total` exists and is a number:

```javascript
totalStrokes = competitor.total;
```

This is an optimization provided by ESPN.

### Method 2: Sum from Linescores

If `competitor.total` is not available, compute from hole-by-hole data:

```javascript
let totalStrokes = 0;

for (const round of competitor.linescores) {
  if (!Array.isArray(round.linescores)) continue;

  for (const hole of round.linescores) {
    if (typeof hole.value === 'number') {
      totalStrokes += hole.value;
    }
  }
}
```

---

## Important Notes

### ⚠️ ESPN Does NOT Provide competitor.holes[]

Common mistake:
```javascript
❌ WRONG
for (const hole of competitor.holes) {
  totalStrokes += hole.strokes;
}
```

Correct approach:
```javascript
✅ CORRECT
for (const round of competitor.linescores) {
  for (const hole of round.linescores) {
    totalStrokes += hole.value;
  }
}
```

### ID Format

ESPN returns athlete IDs as raw numeric strings:
```
competitor.id = "10030"
```

These must be normalized to platform format before database operations:
```
golfer_id = "espn_10030"
```

See `docs/architecture/scoring/golfer_identity.md` for normalization rules.

### Payload Immutability

Payloads are stored as immutable snapshots in `event_data_snapshots`.

Once captured, they never change. This ensures:
- Deterministic replay of scoring
- Auditability of leaderboard history
- Prevention of mid-tournament corrections

---

## Known Variants

ESPN may provide additional fields not documented here. They can be safely ignored.

Only the fields listed above are guaranteed and required.

---

## Validation Rules

Before using a payload:

1. **Check competitors array exists**
   ```javascript
   if (!Array.isArray(payload.competitors)) {
     throw new Error('Missing competitors array');
   }
   ```

2. **Check linescores structure**
   ```javascript
   for (const competitor of payload.competitors) {
     if (!Array.isArray(competitor.linescores)) {
       console.warn(`Competitor ${competitor.id} has no linescores`);
       continue;
     }
   }
   ```

3. **Filter invalid holes**
   ```javascript
   for (const hole of round.linescores) {
     if (typeof hole.value !== 'number') {
       continue;  // Skip invalid holes
     }
   }
   ```

---

## Testing

All services reading this payload must include tests that verify:

1. ✅ Payload structure is correctly parsed
2. ✅ Stroke values are summed correctly
3. ✅ Missing linescores are handled gracefully
4. ✅ Golfer IDs are normalized to `espn_<id>` format
5. ✅ JOINs to `golfer_event_scores` succeed

Reference test: `backend/tests/services/pgaLeaderboardDebugService.test.js`

---

## Related Documentation

- **Golfer ID Normalization:** `docs/architecture/scoring/golfer_identity.md`
- **PGA Scoring Pipeline:** `docs/architecture/PGA_SCORING_PIPELINE.md`
- **Leaderboard Service:** `backend/services/pgaLeaderboardDebugService.js`
- **ESPN PGA Ingestion:** `docs/architecture/ESPN-PGA-Ingestion.md`

---

## Governance

**Frozen Aspects:**
- Payload structure (competitors[], linescores[] nesting)
- Stroke value location (hole.value)
- ID format for normalization (espn_<id>)

**Status:** Architecture Lock Active — changes require architect approval

Breaking changes to this contract require:
1. Update GOVERNANCE_VERSION
2. Architect approval
3. Data migration plan (if historical payloads affected)

---
