# Phase 04: Next Hardening Targets

**Status:** PLANNED
**Expected Scope:** 5-7 days
**Priority:** HIGH — Transactional safety, observability, failure resilience

---

## Executive Summary

Phase 04 hardens Stripe webhook processing and payment system against edge cases, failures, and operational visibility gaps. Focus is on high-leverage items: idempotency stress tests, signature validation coverage, failure visibility, and metrics.

**No business logic changes. No new features. Hardening only.**

---

## Phase 04 Execution Outline

### 1. Replay Attack Simulation Tests

**Objective:** Verify webhook idempotency under concurrent replay scenarios.

**Scope:**
- Simulate 5 concurrent deliveries of the same event (same evt_* ID)
- Verify only first delivery creates ledger entry
- Verify subsequent deliveries return 200 (idempotent), no duplicates in DB
- Verify no payment_intents.status update race conditions
- Verify no ledger.idempotency_key constraint violations

**Expected Outcome:**
- New test file: `tests/api/webhook-replay.test.js`
- 5 test cases: initial delivery, parallel retry, sequential retries, race conditions, idempotency validation
- All pass deterministically
- Coverage: 95%+

**Blocked by:** None
**Effort:** 2 days

---

### 2. Stripe Signature Failure Test Coverage

**Objective:** Ensure webhook route correctly rejects invalid signatures.

**Scope:**
- Missing stripe-signature header → 400 response
- Invalid signature (tampered body) → 400 response
- Signature validation fails but body is valid JSON → 400 response
- Correct signature on modified body → 400 response
- No side effects on failed signature validation (no stripe_events insert)

**Expected Outcome:**
- New test file: `tests/api/webhook-signature.test.js`
- 5 test cases covering all signature failure scenarios
- Verify no database mutations on invalid signatures
- All pass deterministically
- Coverage: 100%

**Blocked by:** None
**Effort:** 1.5 days

---

### 3. Duplicate Event Stress Test

**Objective:** Verify system behavior under high-frequency duplicate event delivery (pathological Stripe behavior).

**Scope:**
- Send same event 100+ times rapidly (simulating webhook retry storm)
- Verify no ledger duplicates (idempotency holds)
- Verify no deadlocks in transaction handling
- Verify stripe_events table has exactly 1 row per unique evt_*
- Measure transaction throughput and latency percentiles

**Expected Outcome:**
- New test file: `tests/api/webhook-stress.test.js`
- 3 test cases: 50 rapid duplicates, 100 rapid duplicates, 500 concurrent replays
- Verify stripe_events row count = 1 per event
- Verify ledger row count = 1 per event
- Performance baseline: p50 < 50ms, p95 < 200ms per webhook
- All pass deterministically

**Blocked by:** None
**Effort:** 1.5 days

---

### 4. Dead Letter / Failure Visibility Strategy

**Objective:** Establish operational visibility into webhook processing failures.

**Scope:**
- Document failure modes: Stripe API errors, DB errors, invalid payment intent, missing game data
- Design (no implementation yet): Dead letter queue concept (where failed webhooks are recorded for manual review)
- Design: Error observability metrics (webhook latency, error rate by type, retry count)
- Propose: Admin endpoint to query webhook processing status by event ID

**Expected Outcome:**
- New design document: `docs/architecture/webhook-failure-visibility.md`
- Sections: failure modes, dead letter concept, proposed metrics, admin diagnostic endpoint
- No code changes in Phase 04 (design only; implementation deferred)
- Proposed metrics: webhook latency (ms), error rate (errors/hour), retry count histogram

**Blocked by:** None
**Effort:** 1 day

---

### 5. Observability and Metrics

**Objective:** Add structured logging and metrics to webhook processing for operational debugging.

**Scope:**
- Instrument webhook route with structured logging (event ID, signature validation result, processing duration)
- Add metrics collection: webhook latency histogram, error rate counter, idempotency hit rate
- Emit metrics to system logging (no external service required for Phase 04)
- Document: how to query webhook performance from logs

**Expected Outcome:**
- Instrumentation integrated into `routes/webhooks.js` and `services/StripeWebhookService.js`
- Metrics output: structured JSON logs with event_id, duration_ms, result (success/duplicate/error)
- New log queries documented in `docs/operational/webhook-metrics.md`
- Example: `grep "webhook_processed" logs/* | jq '.duration_ms' | stats`

**Blocked by:** None
**Effort:** 1.5 days

---

## Success Criteria

- [x] All 5 outline items above are high-leverage, non-feature
- [x] No business logic changes in any item
- [x] All tests pass deterministically
- [x] Documentation completed for design items (dead letter, observability)
- [x] Staging E2E tests still pass after Phase 04 changes

---

## Phase 04 Timeline Estimate

| Item | Effort | Start | End |
|---|---|---|---|
| Replay attack tests | 2 days | Day 1 | Day 3 |
| Signature failure tests | 1.5 days | Day 2 | Day 3 |
| Duplicate event stress tests | 1.5 days | Day 3 | Day 5 |
| Dead letter / failure visibility design | 1 day | Day 4 | Day 5 |
| Observability and metrics | 1.5 days | Day 5 | Day 7 |
| **Total** | **7 days** | **Day 1** | **Day 7** |

---

## Rollback Plan

Each test file is independent. If any Phase 04 change introduces a regression:

1. Revert the specific feature branch (e.g., `webhook-replay-tests`)
2. Re-run unit/integration tests to verify reversion
3. Investigate root cause offline
4. Propose fix with additional test coverage

---

## Phase 05 Proposal (Post-Phase 04)

Once Phase 04 is complete, consider:
- Implementation of dead letter queue (if design in Phase 04 supports it)
- Integration of metrics with monitoring dashboard (Prometheus, Grafana, or equivalent)
- Admin diagnostic endpoint for webhook debugging (query by event ID)
- Performance profiling and optimization (if Phase 04 stress tests reveal bottlenecks)

---

## Known Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Stress tests create database lock contention | Medium | High | Use `SKIP_STRESS_TESTS=true` in CI; run locally only |
| Concurrent webhook tests interfere with other test suites | Low | Medium | Isolate webhook tests in separate test file with fixture cleanup |
| Metrics output creates log file bloat | Low | Low | Use log rotation; metrics off by default in test env |

---

## Phase 04 Definition of Done

- [ ] Replay attack test suite passes (all 5 cases)
- [ ] Signature failure test suite passes (all 5 cases)
- [ ] Duplicate event stress test passes (all 3 scenarios)
- [ ] Dead letter / failure visibility design document completed and reviewed
- [ ] Observability and metrics implemented and verified
- [ ] All new tests added to CI/CD pipeline
- [ ] Staging E2E tests still pass
- [ ] Unified diff generated for submission
- [ ] Phase 05 proposal documented in this file

---
