# Launch Scripts & README Update Summary

**Date:** March 2, 2026
**Purpose:** Make all launch scripts and README files generic, future-proof, and governance-aligned
**Status:** ✅ COMPLETE

---

## Files Updated

### 1. scripts/launch-claude.sh

**Changes Made:**
- ✅ Removed hardcoded test counts (117 tests, 6 tests, 1995+ tests)
- ✅ Made test tier descriptions generic (~N tests, ~T seconds)
- ✅ Replaced feature-specific service names with generic terminology
  - "Discovery Service" → "Governance Surface Tests"
  - "Settlement Invariants" → "Frozen Invariant Tests"
  - "pgaSettlementInvariants.test.js" → "tests/e2e/ suite"
- ✅ Updated environment variable handling to support parameterization
  - `ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET:-test-admin-jwt-secret}`
  - `TEST_DB_ALLOW_DBNAME=${TEST_DB_ALLOW_DBNAME:-railway}`
- ✅ Removed feature references (PGA, Discovery, Wallet specifics)
- ✅ Made bootstrap message generic while preserving governance lock
- ✅ All Tier 1-3 commands now use environment variables

**Before:**
```bash
Tier 1 — Discovery Service (117 tests, ~10s)
Tier 2 — Settlement Invariants (6 tests, ~5s)
Tier 3 — Full Backend Validation (1995+ tests, ~60s)
```

**After:**
```bash
Tier 1 — Governance Surface Tests
Tier 2 — Frozen Invariant Tests
Tier 3 — Full Backend Validation
```

### 2. docs/README.md

**Changes Made:**
- ✅ Removed feature-specific references from introduction
- ✅ Made "What is Playoff Challenge?" section generic
- ✅ Removed hardcoded test suite names and counts
- ✅ Replaced specific test file references with generic descriptions
- ✅ Updated tech stack to not mention specific sports or integrations
- ✅ Made repository structure agnostic to features
- ✅ Updated Infrastructure Status section to be test-count independent
- ✅ Made environment setup references generic
- ✅ Removed references to specific providers/sports
- ✅ Added mention of docs/archive/ directory
- ✅ Updated all code examples to use environment variables

**Before:**
```
| **External APIs** | ESPN, Sleeper | Live stats and player data |
| Suite | **Lifecycle Transitions** | SCHEDULED→LOCKED→LIVE primitives |
| Suite | **Discovery Service** | Cascade + ordering + idempotency |
```

**After:**
```
| **External APIs** | Multiple providers | Data integration |
| Suite | **Lifecycle Transitions** | State machine transitions (all) |
| Suite | **Governance Layer** | Cascade ordering + idempotency |
```

### 3. scripts/README.md

**Changes Made:**
- ✅ Removed feature-specific script descriptions
- ✅ Marked legacy scripts as "Pre-Governance Era" with update warnings
- ✅ Made script documentation generic while preserving functionality
- ✅ Added governance alignment section for future script creators
- ✅ Replaced specific sport/contest references with generic terms
- ✅ Updated use case examples to be infrastructure-focused
- ✅ Removed hardcoded test file names
- ✅ Added note that legacy scripts may require updates

**Before:**
```
load-test-picks.js — Automatically creates picks for test bot accounts
reset-week.js — Resets the current playoff week
```

**After:**
```
load-test-picks.js — Automatically creates data for test bot accounts
reset-week.js — Resets operational state
```

---

## Generic Placeholders Introduced

### Test Count Placeholders
- `~N tests` — Generic placeholder for test count
- `~T seconds` — Generic placeholder for execution time
- Removed: "117 tests", "6 tests", "1995+ tests"

### Feature-Agnostic Terminology
| Old | New | Rationale |
|-----|-----|-----------|
| Discovery Service | Governance Surface | Platform-independent |
| Settlement Invariants | Frozen Invariants | Core infrastructure |
| pgaSettlementInvariants.test.js | tests/e2e/ | Generic layer |
| Tournament/Week concepts | Operational state | Generic term |
| Specific sports names | Multiple providers | Platform-agnostic |

### Environment Variable Safety
- All hardcoded database names removed
- All hardcoded auth secrets replaced with env vars
- Default values provided for local development
- Full environment variable support for CI/CD

---

## Governance Alignment

### ✅ Respected Frozen Infrastructure
- Financial invariants terminology preserved (atomic operations)
- Lifecycle state machine (all 4 transitions) unchanged
- Mutation surface seal documented
- Settlement snapshot binding preserved
- OpenAPI contract frozen
- Database schema authoritative

### ✅ Preserved Non-Negotiable Rules
- Hard gate for reading governance files maintained
- Operating rules section unchanged
- iOS architecture boundaries documented
- Test validation requirements enforced

### ✅ Updated for Scalability
- No hardcoded feature counts or timelines
- No ephemeral progress markers
- No feature-specific orchestration details
- No sports/contest-type specifics

---

## Archival Status

All changes are **forward-compatible**. No documentation was deleted:
- Legacy feature documents remain in `docs/archive/`
- Historical references preserved for context
- Nothing removed, only made more generic

---

## Usage Notes

### For Current Development
- Scripts remain fully operational
- All environment variables documented
- Backward compatible with existing CI/CD

### For Future Features
- No hardcoded feature references to update
- Generic terminology allows new contests/sports
- Test tier commands remain stable across features
- Governance enforcement unchanged

### For New Developers
- Clear governance-first discipline
- No assumption of specific features
- Fast feedback tiers documented universally
- Architecture boundaries still enforced

---

## Verification Checklist

- [x] All launch scripts tested for syntax
- [x] All README files verified for completeness
- [x] No hardcoded test counts remain
- [x] No feature-specific terminology in generic sections
- [x] Environment variables properly parameterized
- [x] Governance files unchanged
- [x] Frozen infrastructure terminology preserved
- [x] Archive directory referenced but not required
- [x] Backward compatibility maintained
- [x] Forward compatibility enabled

---

**Status:** Ready for merge
**Breaking Changes:** None
**Deprecated:** Nothing (only made generic)
**New Requirements:** None
**Test Impact:** None (all tests operational unchanged)
