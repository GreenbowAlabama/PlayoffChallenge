# Fast Follower Roadmap

Status: Post-Launch Improvements

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