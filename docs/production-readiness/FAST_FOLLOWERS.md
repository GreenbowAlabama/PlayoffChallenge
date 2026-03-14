# Fast Follower Roadmap

Status: Post-Launch Improvements

---

## Centralize Authentication Middleware

**Status:** Post-Launch Fast Follower

**Priority:** Architecture Improvements

**Current State:**
- `extractUserId` and `extractOptionalUserId` are implemented inline in multiple route files
- Duplication across: customContest.routes.js, wallet.routes.js, contests.routes.js, payments.js
- Test mode UUID bypass added to customContest.routes.js during stabilization

**Issue:**
Authentication logic is scattered across route files, creating:
- Code duplication (four copies of the same logic)
- Future maintenance risk (auth changes require edits to multiple locations)
- Inconsistent implementations across different routes

**Improvement:**
Centralize authentication extraction into a shared middleware module.

**Target Architecture:**
```
backend/middleware/userAuth.js
  ├── exports extractUserId()
  ├── exports extractOptionalUserId()
  └── exports isValidUUID()
```

All routes should import from the centralized module instead of defining logic inline.

**Scope of Work:**
1. Create `backend/middleware/userAuth.js` with consolidated extraction logic
2. Add test mode UUID bypass support (NODE_ENV === 'test')
3. Update route files to import from the module
4. Verify all tests pass after migration

**Impact:** Reduced code duplication, simplified future auth changes, consistent test handling across all routes

**Timeline:** Post-Launch Fast Follower (Phase 2)

**Notes:**
- This improvement does NOT affect the frozen authentication contract
- Bearer token format (JWT in production, UUID in test) remains unchanged
- Intentionally deferred during launch stabilization to minimize risk

---

## API Contract Drift Guard (CI Enforcement)

**Status:** Governance frozen, CI implementation pending

**Purpose:** Prevent deployment of OpenAPI changes without contract freezing.

**Current State:**
- ✅ Contract freeze system fully implemented (`freeze-openapi.js`)
- ✅ Snapshot idempotency verified
- ✅ Admin API contract identified (`openapi-admin.yaml`)
- ⚠️ CI guard NOT YET IMPLEMENTED
- ⚠️ Admin contract freeze command NOT YET IMPLEMENTED

**Phase 2 Implementation Required:**

1. **Add freeze:openapi:admin command to package.json**
   - Create `backend/scripts/freeze-openapi-admin.js`
   - Mirror public API freeze logic for admin contract
   - Load from `backend/contracts/openapi-admin.yaml`

2. **Implement CI guard (pre-merge check)**
   - Detect OpenAPI changes in pull requests
   - Verify corresponding snapshot freeze commit
   - Block merge if API changed without freeze
   - Pattern: Check git diff for `contracts/openapi*.yaml` changes

3. **Test Coverage**
   - Add test: `tests/contracts/openapi-admin-freeze.test.js`
   - Verify admin snapshot matches frozen contract

**Timeline:** Phase 2 (post-launch)

**Governance:** `docs/governance/ARCHITECTURE_LOCK.md` (API Contract Freeze System)

**Implementation Notes:**
- Do NOT modify schema
- Do NOT modify existing freeze-openapi.js logic
- Follows established freeze pattern: generate → hash → check → version → insert

---

## Web-Admin Observability for Player Pool & Tournament Config

**Status:** Fast Follower Phase 2

**Current State:**
- ✅ Player pool lazy-creation logic implemented in `entryRosterService`
- ⚠️ Web-Admin has no views for `field_selections` or `tournament_configs` visibility
- ⚠️ No admin dashboard for player pool snapshot status
- ⚠️ No invariant check: "All PGA contests with tournament_configs must have field_selections"

**Purpose:** Operators need visibility into:
- Whether a contest has a valid player pool snapshot
- Tournament config binding status
- Field selection state (populated vs empty)
- Lazy creation events (when triggered)

**Phase 2 Implementation Required:**

1. **Create `field_selections` Admin View**
   - Table view: contest_instance_id, tournament_config_id, primary_count, created_at
   - Filter by contest status (SCHEDULED, LOCKED, LIVE, COMPLETE)
   - Show "primary array populated" vs "empty" status

2. **Create `tournament_configs` Admin View**
   - Table view: contest_instance_id, provider_event_id, event_start_date, is_active
   - Link to related field_selections row
   - Show FK integrity status

3. **Add Player Pool Snapshot Status Dashboard**
   - Unified view combining:
     - Contest name & status
     - Tournament config linked
     - Field selections created & populated
     - Lazy creation events (if any)
   - Admin can troubleshoot player pool visibility issues

4. **Add System Invariant Check**
   - Governance rule: "All GOLF contests with tournament_configs must have field_selections"
   - Alert if invariant violated
   - Can be added to System Invariant Monitor

**Files to Create:**
- `web-admin/src/pages/PlayerPoolAdmin.tsx`
- `web-admin/src/api/playerPool.ts`

**Timeline:** Post-Launch Fast Follower (Phase 2)

**Dependencies:**
- Web-Admin API routes for field_selections and tournament_configs
- System Invariant Monitor framework (already in place)

---

## Discovery & Settlement Test Stability

Recent fixes stabilized the discovery contest creation and settlement audit pipeline.

**Changes Included:**

• SYSTEM_USER_ID bootstrap in settlement tests
• Alignment of provider_event_id ↔ provider_tournament_id in test fixtures
• Unique constraint compliance in contestOpsService tests

**Impact:**

These changes ensure deterministic behavior in the discovery pipeline and settlement audit logging. All discovery tests (144/144) and settlement isolation tests (4/4) now pass with verified constraint enforcement.

**Test Coverage:**

- Discovery template binding validation
- Settlement audit FK integrity
- Contest uniqueness constraint enforcement
- Idempotent discovery replay verification

---

## Optional Future Improvement: Unified Repair Orchestrator

### Not needed now, but recommended for Phase 2

Currently, each repair function is called independently:
- `repairOrphanWithdrawal()`
- `convertIllegalEntryFeeToRefund()`
- `rollbackNonAtomicJoin()`
- `repairIllegalRefundDebit()`
- `freezeNegativeWallet()`

### Proposed: Single Admin Repair Interface

Create a unified orchestrator that dispatches repairs by type:

```javascript
async function repairLedgerAnomaly(pool, {
  type,        // 'orphan_withdrawal' | 'illegal_entry_fee' | 'non_atomic_join' | 'illegal_refund_debit' | 'negative_wallet'
  ledgerId,    // For ledger-based repairs
  userId,      // For user-based repairs
  adminId,     // Always required
  reason       // Always required
}) {
  // Dispatch to correct repair function based on type
  // Return unified response
}
```

### Benefits

- **Single admin interface** — operators don't need to remember which function to call
- **Consistent error handling** — standardized response format
- **Audit trail** — all repairs logged through single entry point
- **Type-safe dispatch** — enum-based type selection
- **Future extensibility** — easy to add new repair types

### Timeline

- **Phase 1 (Current):** Individual repair functions ✅
- **Phase 2 (Post-Launch):** Unified orchestrator
- **Phase 3 (Optional):** Admin dashboard with repair wizard UI

---

## Implementation Notes

This improvement should be deferred until:
1. Current repair functions stabilize in production
2. Operational team provides feedback on usage patterns
3. Admin dashboard framework is in place

The ledger invariant guarantees are frozen and don't need to change.

* Enhance the discovery and contest creation to ensure that our customers always have a contest to join.  I think we're displaying pga tournament contests 7 days out so the purpose of that was to keep a fresh set of 5 contests in the menu so as the previous weeks tournament ends, the next one is up.  It doesn't need to line up chat, we can simply say display contests for customers to join that are 7 days out. 

* One Recommended Safety Improvement (Later)Once tests are green, consider adding a defensive guard in the webhook:
Before inserting the deposit:  SELECT status FROM payment_intents WHERE id = $1 and only credit wallet if: status != 'SUCCEEDED' This protects against a rare Stripe edge case: event replay after database partial failure Your idempotency key already helps, but the guard adds another layer of safety.