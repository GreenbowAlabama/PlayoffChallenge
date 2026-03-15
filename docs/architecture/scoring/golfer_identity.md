# Golfer ID Normalization Rule

**Status:** AUTHORITATIVE
**Last Updated:** 2026-03-15
**Owner:** Architecture

---

## Purpose

This document defines how golfer identities are normalized across the Playoff Challenge platform.

External providers (ESPN) return athlete IDs in raw format. The platform uses a canonical normalized format for all database operations.

Failure to normalize will cause JOIN failures in scoring, leaderboards, and settlement.

---

## The Problem

ESPN provides raw numeric athlete IDs:

```
competitor.athlete.id = "10030"
```

But these cannot be directly used as database keys because:

1. **Provider-agnostic storage** — Multiple providers (ESPN, PGA Tour, etc.) may use different ID schemes
2. **Collision prevention** — Different providers might reuse the same numeric ID
3. **Traceability** — Need to know which provider an ID came from
4. **Auditability** — System should make provider origin explicit

---

## The Solution: Namespace Normalization

All external IDs are normalized to a **provider-prefixed format**:

```
<provider>_<athlete_id>
```

### ESPN PGA Example

```
Raw ESPN ID:        10030
Normalized ID:      espn_10030
```

---

## Normalization Rules

### Storage Location

Normalized IDs are stored in:

```
golfer_event_scores.golfer_id (text)
```

And queried by:
```sql
SELECT * FROM golfer_event_scores WHERE golfer_id = 'espn_10030'
```

### Normalization Implementation

Before any database operation, normalize the ID:

```javascript
const normalizedId = `espn_${rawEspnId}`;
```

### Supported Providers

| Provider | Prefix | Example |
|----------|--------|---------|
| ESPN | `espn_` | `espn_10030` |
| Future: PGA Tour | `pgat_` | `pgat_12345` |
| Future: Other | `{provider}_` | `{provider}_{id}` |

---

## Where Normalization Occurs

### ✅ Services That Normalize

1. **pgaEspnIngestion.js** (handleScoringIngestion, lines 830-836)
   - **PRIMARY PRODUCER** of normalized golfer IDs
   - Extracts `competitor.id` from ESPN leaderboard payload
   - Normalizes to `espn_<athleteId>` format at ingestion time
   - Writes normalized IDs directly to `golfer_event_scores`
   - **Key design:** Normalize at ingestion, not query time

2. **pgaLeaderboardDebugService.js** (getPgaLeaderboardWithScores, line 107)
   - Extracts `competitor.athlete.id` from snapshots
   - Normalizes to same `espn_<athleteId>` format
   - Queries `golfer_event_scores` with normalized IDs
   - Used for diagnostic/overlay purposes

3. **pgaRosterScoringService.js** (scoreContestRosters)
   - JOINs entry rosters to golfer event scores
   - Assumes golfer IDs are already normalized
   - Reads pre-normalized IDs from entry_rosters

### ❌ Services That Must NOT Normalize

Services should NEVER attempt to normalize IDs twice:

```javascript
❌ WRONG
const id = `espn_${`espn_10030`}`;  // espn_espn_10030

✅ CORRECT
const id = `espn_10030`;
```

---

## Testing Requirements

All services reading golfer IDs must include tests that:

1. ✅ Extract raw IDs from provider payloads
2. ✅ Normalize to canonical format
3. ✅ Query database using normalized ID
4. ✅ Return correct golfer records

Reference test: `backend/tests/services/pgaLeaderboardDebugService.test.js`

---

## Common Mistakes

### Mistake 1: Forgetting Normalization

```javascript
❌ WRONG
const golferIds = payload.competitors.map(c => c.athlete.id);
const scores = await pool.query(
  'SELECT * FROM golfer_event_scores WHERE golfer_id = ANY($1)',
  [golferIds]  // Raw IDs, no normalization!
);
// Result: No matches, empty array
```

### Mistake 2: Double Normalization

```javascript
❌ WRONG
const id = `espn_${normalizedId}`;  // Already has espn_ prefix
// Result: espn_espn_10030
```

### Mistake 3: Reading holes[] Instead of linescores[]

```javascript
❌ WRONG
// Normalization is correct, but stroke parsing is wrong
const totalStrokes = competitor.holes.map(h => h.strokes).reduce((a,b) => a+b);
// Result: undefined, because holes[] doesn't exist
```

See `docs/architecture/providers/espn_pga_payload.md` for correct stroke parsing.

---

## Architecture Implications

### Why Normalization Matters

Without normalization:
- ❌ Cannot support multiple providers
- ❌ IDs collide between providers
- ❌ No audit trail of provider origin
- ❌ Leaderboard JOINs fail silently

With normalization:
- ✅ Multi-provider support built in
- ✅ ID collision prevention
- ✅ Explicit provider traceability
- ✅ Deterministic JOINs

### Future-Proofing

When adding a new provider (PGA Tour, other leagues):

1. Choose a prefix (e.g., `pgat_`)
2. Create normalization function
3. Add tests for new provider
4. Document in this file

The platform architecture will handle the rest.

---

## Related Documentation

- **ESPN PGA Payload:** `docs/architecture/providers/espn_pga_payload.md`
- **PGA Scoring Pipeline:** `docs/architecture/PGA_SCORING_PIPELINE.md`
- **Leaderboard Service:** `backend/services/pgaLeaderboardDebugService.js`
- **Governance:** `docs/governance/LIFECYCLE_EXECUTION_MAP.md`

---

## Governance

**Frozen Aspects:**
- Normalization format: `<provider>_<id>`
- Storage location: `golfer_event_scores.golfer_id`
- ESPN prefix: `espn_`

**Status:** Architecture Lock Active — changes require architect approval

---
