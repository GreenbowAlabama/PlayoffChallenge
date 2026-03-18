# Ingestion Guarantees (FROZEN)

**Status:** FROZEN under Architecture Lock
**Version:** 1.0
**Last Updated:** March 18, 2026
**Authority:** Chief Architect

---

## Executive Summary

The ingestion pipeline provides five critical guarantees that enable deterministic scoring, audit-safe settlement, and reliable payouts.

These guarantees are **mandatory** for:
- Settlement calculation
- Withdrawal processing
- Contest completion
- Financial reporting

---

## Guarantee 1: Deterministic Event Filtering

### Rule

ESPN event IDs must be matched with exact equality. No fallback logic allowed.

### Implementation Requirement

When `fetchLeaderboard(eventId)` executes:

```
1. Fetch full ESPN scoreboard (may contain multiple events)
2. Find event where event.id === eventId (exact match)
3. Return ONLY that event (or empty array)
4. ❌ NEVER fallback to events[0]
5. ❌ NEVER guess which event to use
```

### Why This Matters

If filtering is missing or wrong:
- Fetches **wrong tournament's leaderboard**
- Creates ingestion_event with **cross-tournament data**
- Scores calculate **wrong contest standings**
- **Silent data corruption** occurs
- Settlement pays out **on wrong contest**

### Enforcement

- Code review: Explicit check for event ID matching
- Test coverage: Unit tests for exact match + empty cases
- Production: Logging of matched event ID per fetch
- Monitoring: Alert on event ID mismatch between contests

**Reference:** `backend/services/ingestion/espn/espnPgaApi.js:fetchLeaderboard()`

---

## Guarantee 2: SCORING Phase Bypasses Deduplication

### Rule

Work units with `phase: 'SCORING'` must ALWAYS execute, never skipped.

### Implementation Requirement

When processing work units:

```javascript
// All phases:
if (phase !== 'SCORING' && already_processed) {
  return { skipped: true };  // Skip to prevent duplicate work
}

// SCORING phase only:
if (phase === 'SCORING') {
  // Always execute, even if hash matches previous
  // Scores update continuously throughout tournament
}
```

### Why This Matters

- Tournament scores update every few minutes
- SCORING phase must execute every cycle
- PLAYER_POOL and FIELD_BUILD are immutable after initial run
- Without this, scores freeze after first ingestion

### Enforcement

- Code review: Check `phase` field presence in work units
- Test: Verify SCORING always executes even with identical payload
- Monitoring: Alert if SCORING events stop accumulating during LIVE contest

**Reference:** `backend/services/ingestionService.js:run()`

---

## Guarantee 3: Idempotent Scoring Writes

### Rule

Scoring writes must use idempotent upserts. Same input always produces same output.

### Implementation Requirement

All score inserts use `ON CONFLICT DO UPDATE`:

```sql
INSERT INTO golfer_event_scores (
  contest_instance_id, golfer_id, round_number, total_points
)
VALUES ($1, $2, $3, $4)
ON CONFLICT (contest_instance_id, golfer_id, round_number)
DO UPDATE SET total_points = EXCLUDED.total_points;
```

### Why This Matters

- Worker can retry without duplicating scores
- Replay always produces identical result
- Settlement can validate by re-running scoring
- No side effects from multiple ingestion runs

### Enforcement

- Code review: Confirm all score writes use UPSERT semantics
- Test: Re-run identical payload, verify row count unchanged
- Audit: Historical score replays must produce bit-identical results

**Reference:** `backend/services/ingestion/strategies/pgaEspnIngestion.js:handleScoringIngestion()`

---

## Guarantee 4: Zero-Score State Is Valid

### Rule

Empty `golfer_event_scores` with competitors present is a correct state.

### Implementation Requirement

During pre-tournament window:

```
✅ VALID STATE:
  - Competitors exist (PLAYER_POOL ingestion complete)
  - golfer_event_scores is empty
  - Contest in LOCKED or LIVE status
  - Duration: 1-2 hours before first scoring available
  - Do NOT alert, do NOT error

❌ ERROR STATE:
  - COMPLETE contest with zero scores
  - LIVE contest with no scores after tournament ends + 30 min
```

### Why This Matters

- Tournaments don't publish scores until start
- Contest stays locked while waiting for first scoring data
- Worker must tolerate empty scoring window
- Empty state ≠ ingestion failure

### Operational Impact

Operations teams must distinguish:
- **Pre-tournament empty:** Normal, wait for tournament start
- **Post-tournament empty:** Potential issue, investigate
- **Mid-tournament empty:** Ingestion problem, alert

**Reference:** `docs/operations/INGESTION_HEALTH_CHECKS.md`

---

## Guarantee 5: Deterministic Replay

### Rule

Scoring can always be reproduced from ingestion_events. Same events → same scores.

### Implementation Requirement

Replay procedure:

```
1. Load ingestion_event by id
2. Extract provider_data_json
3. Run adapter scoring logic with same contest_instance_id
4. Compare output golfer_event_scores to original
5. Result must be bit-identical
```

### Why This Matters

- Settlement validation requires replay capability
- Audit trails must be reproducible
- Disputes require provable scoring history
- Financial correctness depends on determinism

### Enforcement

- Test: Replay at least 3 historical contests
- Audit: All settlement disputes must include replay proof
- Production: Maintain ingestion_events in append-only form (never delete)

**Reference:** `docs/architecture/INGESTION_EXECUTION_FLOW.md § Deterministic Replay`

---

## Dependency Chain: Ingestion → Settlement → Payouts

```
Deterministic Event Filtering
        ↓
SCORING Phase Execution
        ↓
Idempotent Score Writes
        ↓
Zero-Score Valid State
        ↓
Deterministic Replay
        ↓
✅ Settlement Correctness
        ↓
✅ Payout Authorization
```

**Critical:** If ANY guarantee breaks, the entire chain fails.

---

## Governance Integration

### Frozen Primitives

These guarantees are frozen under Architecture Lock:
- INGESTION_GUARANTEES.md (this file)
- FINANCIAL_INVARIANTS.md (depends on these guarantees)
- WITHDRAWAL_ENGINE_SPEC.md (enforces these guarantees at payout time)

### Enforcement Points

1. **Code Review:** Architect reviews for event ID matching and phase field
2. **Testing:** Determinism tests must pass before merge
3. **Deployment:** No rollback of changes affecting these guarantees
4. **Monitoring:** Alerts configured per health checks document

### Modification Rules

To change any guarantee:

1. File RFC in governance/ with rationale
2. Impact analysis: How does change affect settlement?
3. Architect approval required
4. All dependent systems must be updated in lockstep
5. New tests must pass before deployment

---

## References

### Architecture
- `docs/architecture/INGESTION_EXECUTION_FLOW.md`
- `docs/architecture/ESPN-PGA-Ingestion.md`
- `docs/architecture/SCORING_PIPELINE.md`
- `docs/architecture/DATA_INGESTION_MODEL.md`

### Operations
- `docs/operations/INGESTION_HEALTH_CHECKS.md`

### Governance
- `docs/governance/FINANCIAL_INVARIANTS.md`
- `docs/governance/WITHDRAWAL_ENGINE_SPEC.md`
- `docs/governance/LEDGER_ARCHITECTURE_AND_RECONCILIATION.md`

### Implementation
- `backend/services/ingestionService.js`
- `backend/services/ingestion/espn/espnPgaApi.js`
- `backend/services/ingestion/strategies/pgaEspnIngestion.js`

---

## Sign-Off

**This document is frozen.** All ingestion work must comply with these five guarantees.

Failure to maintain any guarantee risks:
- Silent data corruption
- Incorrect settlement calculations
- Unrecoverable payout errors
- Financial loss and regulatory exposure
