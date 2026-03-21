# Scoring Enforcement Rules

## PGA Scoring (LOCKED)

### Source of Truth

- **Single source**: `golfer_event_scores` table
- **Scope**: Contest-level, no user_id
- **Aggregation grain**: (contest_instance_id, golfer_id)
- **User applied**: AFTER aggregation via roster join

### Mandatory Rules

1. **Tests must mirror production schema**
   - Insert into `golfer_event_scores` (not `golfer_scores`)
   - Insert ONCE per (contest, golfer, round)
   - NOT per-user inserts

2. **No alternate scoring paths allowed**
   - ❌ No UNION to legacy tables
   - ❌ No fallback logic
   - ❌ No conditional aggregation

3. **No dual data models allowed**
   - ❌ golfer_scores cannot be used in scoring query
   - ❌ Mixing contest-scoped and user-scoped data
   - ❌ CASE logic to choose between sources

4. **Production code must NOT bend to test data**
   - Tests adapt to production architecture
   - NOT the other way around

### Violation Response

**Violation → REJECT**

Any code that:
- Uses `golfer_scores` in scoring layer
- Includes UNION or conditional logic
- Inserts per-user test data
- Creates alternate scoring path

Will be rejected in review.

### Governance Review

Changes to this policy require:
- Chief Architect approval
- Test alignment verification
- Streaming model validation

---

## Enforcement History

**Mar 21, 2026**
- Locked PGA scoring architecture
- Eliminated UNION query
- Updated tests to use golfer_event_scores
- Validated 218 scoring tests passing
- Confirmed streaming model alignment

**Confidence Level**: 95%+ (architectural alignment complete)
