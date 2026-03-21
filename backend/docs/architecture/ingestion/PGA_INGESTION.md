# PGA Ingestion Architecture

## Scoring Integration (LOCKED)

### Data Flow

```
ESPN Event API
    ↓
pgaEspnIngestion.runPlayerPool()
    ↓
golfer_event_scores (WRITE)
    ↓
pgaEspnIngestion.runScoring()
    ↓
Scoring aggregation (READ)
    ↓
User standings
```

### Invariants

- **Ingestion writes ONLY to `golfer_event_scores`**
  - No writes to `golfer_scores`
  - No intermediate scoring tables

- **Scoring reads ONLY from `golfer_event_scores`**
  - No reads from `golfer_scores` in production
  - No fallback or legacy paths

- **Deterministic writes**
  - Same ingestion input → same database state
  - Re-ingestion is idempotent (updates, not duplicates)

### Why This Matters

This ensures:
- **Deterministic behavior**: Same data in → same scores out
- **Idempotent updates**: Re-running ingestion doesn't create duplicates
- **Alignment between staging and test**: Both use same data model
- **No hidden side effects**: Scoring is computed from single source only

---

## Ingestion Safety Guard (LOCKED)

When ingesting partial rounds, cleanup is gated:

```javascript
// Only clean up rounds if incoming fully covers existing
const existingRounds = new Set(existingRoundsResult.rows.map(r => r.round_number));
const allExistingCovered = Array.from(existingRounds).every(round =>
  incomingValidRounds.includes(round)
);

if (allExistingCovered) {
  // Safe to delete stale rounds
  await DELETE FROM golfer_event_scores
    WHERE round_number NOT IN (incoming rounds)
}
```

This prevents data loss when:
- Payload is partial (incomplete tournament data)
- API is temporarily returning subset of rounds
- Network error caused gap in transmission

---

## Governance Status

✅ **LOCKED** — Mar 21, 2026

Changes to ingestion/scoring coupling require review.
