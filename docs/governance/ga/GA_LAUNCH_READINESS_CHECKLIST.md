# GA Launch Readiness Checklist

**Status:** Pre-GA Gate
**Approval Authority:** Engineering Leadership
**Last Updated:** February 28, 2026

---

## Infrastructure

### Database

- [ ] PostgreSQL 17.7+ verified in production (Railway)
- [ ] Connection pooling configured (min_pool_size, max_pool_size)
- [ ] Backup and recovery plan documented and tested
- [ ] schema.snapshot.sql applied and verified
- [ ] All migrations applied without rollback
- [ ] Foreign key constraints enforced
- [ ] Unique constraints verified for contest_participants (user_id, contest_instance_id)
- [ ] contest_state_transitions immutable (trigger prevents UPDATE)
- [ ] api_contract_snapshots immutable (trigger prevents UPDATE)
- [ ] settlement_records immutable (trigger prevents UPDATE)

### API Server

- [ ] Node.js runtime 18+ deployed
- [ ] PORT environment variable set to 3000
- [ ] NODE_ENV=production
- [ ] All required environment variables present (DATABASE_URL, ADMIN_JWT_SECRET, etc.)
- [ ] Backend health check endpoint responding (200)
- [ ] OpenAPI spec served at /openapi.yaml
- [ ] Error handling in place (no 5xx without error escalation)
- [ ] Request timeout configured (30s recommended)
- [ ] Rate limiting configured (TBD by ops)

### Stripe Integration

- [ ] STRIPE_SECRET_KEY set to live key (sk_live_...)
- [ ] STRIPE_WEBHOOK_SECRET set to live signing secret (whsec_live_...)
- [ ] Stripe account verified as LIVE
- [ ] Webhook endpoint registered: POST /api/webhooks/stripe
- [ ] Webhook events subscribed: charge.succeeded, charge.failed, charge.refunded
- [ ] API version locked in Stripe dashboard (current: TBD)

---

## Financial Integrity

### Wallet System

- [ ] wallet.balance integer column verified (no floats)
- [ ] wallet.pending_cents column verified (idempotency tracking)
- [ ] wallet.ledger_hash column verified (append-only validation)
- [ ] No application logic modifies wallet.balance optimistically
- [ ] All balance changes go through ledger (append-only)
- [ ] ledger.operation_type enum includes: DEPOSIT, ENTRY_FEE, PAYOUT, REFUND
- [ ] Negative balance check in place (SELECT * FROM wallets WHERE balance < 0 must return empty)

### Settlement Engine

- [ ] settlement_records table verified (immutable by trigger)
- [ ] settlement_snapshots table verified (contains frozen standings)
- [ ] snapshot_hash column prevents tampering
- [ ] payout_table computed per snapshot (deterministic)
- [ ] Contest LIVE→COMPLETE transition requires valid snapshot_id
- [ ] Settlement math: (entry_count * entry_fee) - rake = pool; pool / winners = payout
- [ ] Rake rate hardcoded or locked in config (no runtime modification)
- [ ] No floating-point arithmetic in settlement (all integer cents)

### Join Constraints

- [ ] Unique constraint enforced: (user_id, contest_instance_id) in contest_participants
- [ ] Max entries constraint: entry_count < max_entries (or NULL for unlimited)
- [ ] Lock time constraint: now < lock_time AND status = 'SCHEDULED' required
- [ ] Capacity check in transaction: SELECT ... FOR UPDATE before INSERT
- [ ] PG 23505 (unique violation) mapped to ALREADY_JOINED error
- [ ] Capacity check returns CONTEST_FULL when entry_count >= max_entries
- [ ] No optimistic entry counting (backend is source of truth)

### Idempotency Rules

- [ ] All financial operations require idempotency_key
- [ ] Idempotency-Key header enforced on: POST /api/custom-contests/:id/join
- [ ] Idempotency-Key stored with payment intent
- [ ] Retry with same key returns cached result (no duplicate charge)
- [ ] Stripe's idempotency enforced for payment intents (X-Idempotency-Key)
- [ ] Settlement runs once per contest (verified by settlement_records PK)
- [ ] Repeated settlement calls return existing record (no duplicate mutations)

---

## iOS Production Config

### Build Configuration

- [ ] iOS deployment target: 14.0 or higher
- [ ] Bundle identifier: com.playoffchallenge.ios (correct for App Store)
- [ ] Code signing: valid Apple Development Team certificate
- [ ] Provisioning profile: valid App Store provisioning profile
- [ ] Build configuration: Release (no debug symbols in distribution)
- [ ] Bitcode enabled (if required by App Store, check current requirement)

### API Configuration

- [ ] AppEnvironment.baseURL points to production API (https://api.playoffchallenge.com)
- [ ] No hardcoded test/staging URLs in production build
- [ ] API timeout: 30 seconds (or verified safe duration)
- [ ] Retry logic: max 3 attempts with exponential backoff
- [ ] Error messages localized (no API error codes exposed to users)

### Financial Boundaries

- [ ] No client-side wallet balance mutation
- [ ] No client-side settlement calculation
- [ ] No client-side payout math
- [ ] Entry fee displayed only (not computed from entry_count)
- [ ] Payout displayed from payout_table only (if COMPLETE)
- [ ] No optimistic balance reduction on join
- [ ] Wallet refresh triggered after join success

### Lifecycle Safety

- [ ] Lock time enforcement: backend actions.canJoin used exclusively
- [ ] Time comparisons in AvailableContestsViewModel marked "PRESENTATION ONLY"
- [ ] COMPLETE leaderboards: refresh() blocked, snapshot immutable
- [ ] LIVE leaderboards: refresh() enabled, dynamic standings
- [ ] No LOCKED state visible to user (internal state, may be abstracted)
- [ ] Status transitions trigger backend re-fetch (no stale state assumptions)

---

## Stripe Production Safety

### Account Verification

- [ ] Stripe account status: LIVE (not TEST)
- [ ] Account has verified bank account (for payouts)
- [ ] Account has valid contact information and business details
- [ ] Dashboard 2FA enabled for production account
- [ ] API key rotation scheduled (recommended: quarterly)

### Webhook Verification

- [ ] Webhook endpoint registered at correct URL (https://api.playoffchallenge.com/api/webhooks/stripe)
- [ ] Webhook signing secret verified in environment (STRIPE_WEBHOOK_SECRET)
- [ ] Webhook handler verifies signature before processing
- [ ] Webhook timeout set (30s minimum, recommend 60s)
- [ ] Webhook retry behavior understood (Stripe retries for 3 days)
- [ ] Failed webhook logged for manual review
- [ ] Webhook events tested in Stripe dashboard (send test event, verify processing)

### Payment Intent Safety

- [ ] Payment intent creation includes Idempotency-Key header
- [ ] Payment intent amount in cents (no floating point)
- [ ] Payment intent currency hard-coded (USD)
- [ ] Confirmation method: automatic (Stripe handles 3D Secure if needed)
- [ ] Off-session payment disabled (not saved cards for recurring)
- [ ] Payment method whitelist: card only (no bank transfers)

### Error Handling

- [ ] Charge declined: user notified, join not committed
- [ ] Charge timeout: retry logic with idempotency
- [ ] Webhook delivery failure: alert to ops, manual ledger review
- [ ] Stripe API unavailable: return 503, no silent failure
- [ ] Invalid charge.id in webhook: log and alert (fraud indicator)

---

## Lifecycle Safety

### State Transition Verification

- [ ] SCHEDULED → LOCKED: time-based (lock_time reached)
- [ ] LOCKED → LIVE: time-based (tournament_start_time reached)
- [ ] LIVE → COMPLETE: after tournament_end_time AND settlement success
- [ ] → CANCELLED: provider-initiated (discovery) or admin-initiated
- [ ] Terminal states locked: COMPLETE and CANCELLED cannot transition
- [ ] Transition records immutable: contest_state_transitions append-only

### Background Reconciliation

- [ ] Lifecycle reconciler worker enabled (ENABLE_LIFECYCLE_RECONCILER=true)
- [ ] Reconciliation interval: 30 seconds (configurable, locked at start)
- [ ] Single entry point verified: reconcileLifecycle() in lifecycleReconciliationService.js
- [ ] No dual trigger paths (scheduler AND admin both calling same primitive is forbidden)
- [ ] Error recovery: settlement failures escalate to ERROR state automatically
- [ ] Transition record inserted on every state change (audit trail)

### Settlement Binding

- [ ] LIVE→COMPLETE requires snapshot_id to exist
- [ ] Settlement uses snapshot_hash for determinism (no runtime recomputation)
- [ ] Missing snapshot: contest stays LIVE, error logged (non-fatal for batch)
- [ ] Settlement errors: automatically escalated to ERROR state
- [ ] Payout immutability: settlements are append-only (no corrections without admin intervention)

---

## User Experience

### Join Flow

- [ ] Join button disabled if now >= lock_time (backend-driven)
- [ ] Join button shows "Locked" state or hidden (UX consistent)
- [ ] Join error messages match OpenAPI (ALREADY_JOINED, CONTEST_FULL, LOCKED, etc.)
- [ ] Successful join: full backend re-fetch (no stale state)
- [ ] Capacity bar reflects accurate entry_count from backend
- [ ] No silent join failures (error shown to user)

### Contest Display

- [ ] Status badges consistent (colors, text per status enum)
- [ ] Entry fee always displayed (no assumptions about free vs paid)
- [ ] Lock time displayed in user's timezone (consistent across screens)
- [ ] Payout displayed ONLY after COMPLETE (no mid-contest payout display)
- [ ] Leaderboard immutable after COMPLETE (visual frozen state)
- [ ] Empty states handled gracefully (no crashes on zero standings)

### Onboarding

- [ ] Terms of Service acceptance enforced before contest join
- [ ] Age verification (if required by gaming regulations) enforced
- [ ] Account verification (email or SMS) enforced before payment
- [ ] Wallet funding UI clear and deterministic
- [ ] Wallet balance always reflects backend truth (re-fetched on app open)

---

## Observability

### Logging

- [ ] All join attempts logged (user_id, contest_id, timestamp, result)
- [ ] All settlement operations logged (contest_id, snapshot_id, payout amounts)
- [ ] All Stripe webhook deliveries logged (event_type, timestamp, handler result)
- [ ] All financial mutations logged (wallet operation, ledger_hash, amount)
- [ ] Error stack traces captured and logged (for debugging, not user-visible)

### Monitoring

- [ ] Health check endpoint: GET /health (200 = healthy)
- [ ] Error rate: alert if >1% of requests return 5xx
- [ ] Settlement queue depth: alert if > 100 pending settlements
- [ ] Wallet ledger drift: daily consistency check (sum of ledger entries == wallets.balance)
- [ ] Stripe webhook latency: alert if > 5 seconds average
- [ ] Join endpoint latency: alert if > 2 seconds p95
- [ ] Database connection pool: alert if >80% utilization

### Dashboards (Required)

- [ ] Revenue dashboard: contests created, entries, total fees, payouts, rake
- [ ] Settlement dashboard: pending settlements, completed, failed, pending refunds
- [ ] Wallet dashboard: total user balances, pending deposits, flagged for review
- [ ] Error dashboard: error types, frequencies, time-to-resolution
- [ ] Stripe dashboard: charges, disputes, failed payments, webhook delivery status

### Alerts (Required)

- [ ] Negative user balance detected: immediate alert
- [ ] Settlement failure: immediate alert
- [ ] Stripe charge declined rate >5%: daily alert
- [ ] Webhook delivery failure after 3 retries: immediate alert
- [ ] Database connection failure: immediate alert
- [ ] Unique constraint violation on join: log and analyze (fraud/concurrency indicator)

---

## GA Approval Sign-off

### Technical Review

- [ ] Backend Lead approval: ______________________
- [ ] iOS Lead approval: ______________________
- [ ] Database Administrator approval: ______________________
- [ ] Stripe Account Owner approval: ______________________

### Operational Review

- [ ] Ops/DevOps approval (infrastructure): ______________________
- [ ] Finance approval (settlement math, rake): ______________________
- [ ] Legal approval (terms, financial terms): ______________________

### Final Approval

- [ ] Product Lead approval: ______________________
- [ ] Compliance review completed: ______________________
- [ ] Penetration testing completed: ______________________
- [ ] Load testing completed (target: 1000 concurrent users): ______________________
- [ ] 48-hour shadow mode completed (optional): ______________________

**GA Authorization Date:** _____________________

**Go/No-Go Decision:** GO / NO-GO (Circle one)

**Cutover Date:** _____________________

**Cutover Owner:** Ian Carter

---

## Pre-GA Sign-off Attestation

I certify that:

1. All infrastructure components are verified and operational.
2. All financial integrity checks pass and settlement math is deterministic.
3. iOS production configuration is secure and points to production APIs.
4. Stripe LIVE account is verified and webhooks are functional.
5. Lifecycle transitions are automated, idempotent, and audited.
6. User experience is stable across all contest states.
7. Observability and monitoring are operational.
8. All escalation procedures are documented and tested.

This system is ready for General Availability.

**Signature:** _____________________________ **Date:** ______________

