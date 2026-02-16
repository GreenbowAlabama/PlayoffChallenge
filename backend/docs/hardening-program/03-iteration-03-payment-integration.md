# Iteration 03 – Payment Integration + Ledger Governance

## Objective

Establish deterministic payment collection, ledger tracking, and payout workflow without introducing lifecycle fragility.

The payment system must:
- Collect entry fees deterministically and idempotently
- Track all financial transactions in an immutable ledger
- Validate webhook events with cryptographic signatures
- Enable manual payout for initial revenue validation
- Support future automatic payout without breaking current design
- Never mutate contest state from payment operations
- Keep payment lifecycle explicit and independent

---

## Architectural Constraints

### Payment is Independent of Contest Scoring
- Payment processing does not affect contest lifecycle (SCHEDULED → LOCKED → LIVE → COMPLETE)
- Contest settlement does not depend on payment completion
- Contest lifecycle transitions are independent of payment state. However, only users with payment.status = SUCCEEDED are eligible for scoring and settlement inclusion.
- Payment and scoring have separate audit trails
- Contest cannot be cancelled from payment failures (explicit operator action required)

### Stripe Integration (Webhook-Based, Event-Driven)
- Stripe webhooks are the source of truth for payment status
- All Stripe events are validated with cryptographic signature verification
- Webhook events are stored immutably before processing
- Duplicate webhooks are idempotent (retry-safe)
- No silent payment failures; all events are logged

### Idempotency is Mandatory
- Payment intent creation is idempotent (same inputs → same intent ID)
- Webhook processing is idempotent (same event → no duplicate charges)
- Retry of any payment operation produces identical result
- Idempotency keys are enforced at service layer

### Manual Payout for Initial Release
- Automatic payout is NOT implemented in this iteration
- Operator manually initiates payouts (batch or individual)
- Payout workflow is documented and testable
- Payout can be triggered without code deployment
- Future iterations may add automatic payout; this foundation enables it

### No Contest State Mutation from Payment
- Payment webhooks do not change contest state
- Payment failures do not lock, cancel, or settle contests
- State transitions are explicit operator actions, not sideeffects
- Payment and contest state are orthogonal

### Payment Required for Participation
- User participation is contingent on successful payment
- Unpaid users cannot be considered active participants
- Contest lifecycle remains independent, but user eligibility requires SUCCEEDED payment status
- Only users with payment.status = SUCCEEDED can have their scores counted

---

## SOLID Enforcement

### Single Responsibility Boundaries
- **paymentService**: Payment collection, idempotency, intent creation (no webhook handling, no ledger writes)
- **webhookHandler**: Receive events, validate signatures, store raw events (no business logic)
- **paymentProcessor**: Apply validated events to ledger (no Stripe API calls)
- **ledgerRepository**: Store and retrieve ledger entries (append-only, no mutations)
- **payoutService**: Execute manual payouts, track disbursements (future iteration may automate)

**Document these boundaries** in `/backend/services/paymentService/CLAUDE.md` and `/backend/services/webhookHandler/CLAUDE.md`

### Explicit Interfaces
- `paymentService.createIntent(contestId, userId, amount)` → `{ intentId, clientSecret, status }`
- `paymentService.validateIdempotencyKey(key)` → `{ isNew: bool, existingIntentId?: string }`
- `webhookHandler.handleEvent(rawEvent)` → `{ processed: bool, error?: string }`
- `paymentProcessor.applyEvent(webhookEvent, ledgerId)` → `{ success: bool, ledgerEntry: {} }`
- `ledgerRepository.record(entry)` → stores immutable entry; no edits
- `payoutService.initiateManualPayout(ledgerIds)` → `{ payoutId, ledgerIds, status }`

### No Hidden Coupling
- Stripe API calls happen only in paymentService
- Webhook handling does not trigger payment processing (explicit orchestration)
- Ledger writes do not trigger contest state changes
- Contest settlement does not depend on payment status

### Dependency Direction
```
routes → paymentController → paymentService → Stripe API
                           → ledgerRepository
       → webhookController → webhookHandler
                           → paymentProcessor → ledgerRepository
       → payoutController → payoutService → ledgerRepository
```
No circular dependencies; no service calls its caller.

### Idempotency Invariants

All state-mutating operations must be idempotent. Duplicate external events must be safe.

- **All state-mutating POST endpoints require idempotency keys**: Idempotency keys are provided by the client (or generated and stored). Same key + same request = same response, always.
  - Example: `POST /api/payments/create-intent` requires `idempotencyKey` header or request body field
  - Idempotency key is validated and stored before any state change
  - Duplicate request with same key returns cached result (no new charge, no new ledger entry)

- **All Stripe webhook event IDs must be stored before processing**: Raw webhook event is persisted in `payment_events` table with `stripe_event_id` before any processing.
  - If processing crashes mid-execution, event is already stored
  - On recovery, check if `stripe_event_id` has been processed; if yes, skip processing

- **Duplicate Stripe events must not create duplicate ledger entries**: Idempotency key on ledger prevents double-counting.
  - Same `stripe_event_id` can be processed multiple times (Stripe retries); only one ledger entry is created
  - Retry loop checks `payment_events` table for `stripe_event_id`; if found, skip processing

- **Payout triggers must verify payout not already initiated**: Before initiating a Stripe payout, check that payout has not already been requested.
  - Query `payout_records` for the ledger entry; if `status != NULL`, skip (already initiated)
  - Prevents double-payout from duplicate operator clicks or retry logic

- **Idempotency must be enforced at service layer, not controller layer**: Service methods are responsible for idempotency logic. Controllers call services; services ensure idempotency.
  - Example: `paymentService.createIntent(contestId, userId, amount, idempotencyKey)` is responsible for idempotency, not the controller

**Stripe Webhook Retry Policy**: Retry policy for Stripe webhooks follows Stripe's native retry behavior. Stripe retries failed webhooks for 3 days with exponential backoff. Our system must handle:
  - **On successful processing**: Store event, process, update status
  - **On processing failure**: Store event with error_json; do not update status to PROCESSED
  - **On retry**: Check if event_id already processed; if yes, return success (idempotent); if no, retry processing
  - **Webhook signature failures are never retried by system**: Signature validation failure is logged and escalated; no retry by our system (Stripe will retry the webhook itself)

---

## Data Model Impact

### Schema Changes Required (Conceptual; No Implementation)

#### payments table
```
id, contest_id, user_id, amount_cents, currency,
stripe_intent_id, status, idempotency_key,
created_at, updated_at
```
- `idempotency_key` ensures duplicate requests return same intent
- `status` is: PENDING, SUCCEEDED, FAILED, REQUIRES_ACTION
- Immutable after creation (no edits; only status updates)

#### payment_events table
```
id, payment_id, event_type, stripe_event_id, stripe_event_json,
signature_valid, processed_at, error_json, created_at
```
- Append-only log of all Stripe webhook events
- `signature_valid` documents whether event passed cryptographic check
- `error_json` captures any processing errors
- Idempotent processing: same stripe_event_id never processes twice

#### payout_records table
```
id, payout_request_id, ledger_entry_id, user_id, amount_cents,
stripe_payout_id, status, initiated_by (operator), initiated_at,
completed_at, error_json, created_at
```
- Manual payout workflow: operator selects ledger entries → initiates payout
- `stripe_payout_id` links to Stripe payout object
- `status` is: PENDING, IN_PROGRESS, COMPLETED, FAILED
- Future automation will populate this table from scheduled job

#### ledger_entries table
```
id, contest_id, user_id, entry_fee_cents, currency,
transaction_type, related_table, related_id,
balance_cents, status,
created_at, recorded_at
```
- Immutable financial record
- `transaction_type`: ENTRY_FEE_COLLECTED, REFUND, PAYOUT_COMPLETED, CHARGEBACK
- `related_table` + `related_id`: links to payment_id, payout_record_id, etc.
- `balance_cents`: running balance for reconciliation
- Single source of truth for financial state

#### reconciliation_reports table (Required)
```
id, generated_at, total_collected_cents, total_ledger_cents,
discrepancy_cents, status, stripe_dashboard_total_cents,
report_json, created_at
```
- **Scheduled reconciliation job**: Compares Stripe dashboard totals to ledger_entries
- Runs daily; flags discrepancies; writes reconciliation_report entry
- `status`: PASSED, DISCREPANCY_DETECTED, ERROR
- `report_json`: Full reconciliation details including variance explanation
- Mandatory before Iteration 04 Contract Freeze

### Critical Constraints
- All tables are append-only (no edits after creation)
- Ledger entries are immutable; corrections are new entries
- Payment and payout records are never deleted
- Stripe webhook events are stored raw before processing (audit trail)
- Idempotency keys prevent duplicate payment intents

---

## Contract Impact

### Breaking Changes (None)
- No existing routes are modified
- Payment adds new routes; no breaking changes to contest lifecycle

### New Contracts (Must Be Defined Before Freeze Iteration)
- `POST /api/payments/create-intent`
  - Request: `{ contestId, amount, idempotencyKey }`
  - Response: `{ success, intentId, clientSecret, status, error? }`

- `POST /api/payments/webhook` (Stripe → backend)
  - Request: raw Stripe event + signature header
  - Response: `{ received: true }` (synchronous acknowledgment only)

- `GET /api/payments/status/:intentId`
  - Request: authenticated user
  - Response: `{ status, amountCents, currency, createdAt, error? }`

- `GET /api/admin/ledger` (admin only)
  - Request: filters (contest, user, date range)
  - Response: `{ entries: [], totalBalance, lastReconciliation }`

- `POST /api/admin/payouts/manual-request` (admin only)
  - Request: `{ ledgerEntryIds: [], operator, note }`
  - Response: `{ payoutId, status, initiatedAt, estimatedAmount }`

- `GET /api/admin/payouts/:payoutId`
  - Request: authenticated admin
  - Response: `{ payoutId, status, amount, stripePayoutId, completedAt?, error? }`

### Documentation Requirements
- All contracts are explicit with examples
- All error codes are enumerated (PAYMENT_FAILED, DUPLICATE_INTENT, INVALID_AMOUNT, etc.)
- Webhook signature validation procedure is documented
- Idempotency key format is specified
- Stripe API version locked (no silent upgrades)

---

## Error Code Contract

### Explicit Error Codes

All payment operations map to explicit error codes. No generic 500 errors for expected failure paths.

#### STRIPE_SIGNATURE_INVALID (HTTP 400)
- Stripe webhook signature validation failed
- HMAC signature does not match calculated signature
- **User action**: None (Stripe will retry webhook)
- **Operator action**: Verify STRIPE_WEBHOOK_SECRET environment variable is correct
- **Recovery**: None needed; Stripe retries automatically

#### STRIPE_EVENT_DUPLICATE (HTTP 200 with { received: true, duplicate: true })
- Stripe event with this stripe_event_id already processed
- Webhook is being replayed (idempotent success)
- **User action**: None
- **Operator action**: None (expected behavior)
- **Recovery**: None needed; duplicate returns success

#### IDEMPOTENCY_KEY_REQUIRED (HTTP 400)
- POST /api/payments/intents missing Idempotency-Key header
- Client must provide unique key for idempotency
- **User action**: Retry with Idempotency-Key header
- **Operator action**: None
- **Recovery**: Client retries with valid header

#### PAYMENT_INTENT_NOT_FOUND (HTTP 409)
- Webhook event references payment_intent that doesn't exist in database
- Race condition: payment intent deleted or never created
- **User action**: None (operator intervention required)
- **Operator action**: Investigate webhook event vs database state
- **Recovery**: Manual reconciliation via admin console

#### PAYMENT_ALREADY_PROCESSED (HTTP 200)
- Payment status already SUCCEEDED before webhook processing
- Webhook replay after successful payment
- **User action**: None
- **Operator action**: None (expected idempotency)
- **Recovery**: None needed

#### LEDGER_DUPLICATE_ENTRY (Internal - not user-facing)
- Ledger entry with this idempotency_key already exists
- Webhook processing attempted to create duplicate ledger entry
- **User action**: None
- **Operator action**: None (expected idempotency behavior)
- **Recovery**: None needed; treated as idempotent success

#### STRIPE_API_ERROR (HTTP 500)
- Call to Stripe API failed (network, invalid request, API error)
- Examples: declined card, rate limit, network timeout
- **User action**: Retry payment or contact support
- **Operator action**: Check Stripe dashboard and system logs
- **Recovery**: Retry after resolving root cause

---

## Validation Rules

### Payment Validation (Before Creating Intent)
1. User is authenticated and not the contest organizer (organizers don't pay to join their own contest)
2. Amount matches entry fee in contest config (no discrepancies)
3. Currency is valid (USD, EUR, etc. based on config)
4. Idempotency key is unique (prevent duplicate intents)
5. User has not already paid entry fee for this contest (prevent double-charging)

### Webhook Validation (Before Processing Event)
1. Stripe signature is valid (cryptographic verification with STRIPE_WEBHOOK_SECRET)
2. Event timestamp is recent (prevent replay attacks; reject > 5 minutes old)
3. Event ID has not been processed before (idempotency check)
4. Event type is expected (charge.succeeded, charge.failed, refund.updated)
5. Amount in event matches original intent amount (no silent modifications)

### Ledger Validation
1. All financial transactions are recorded before any state changes
2. All ledger entries reference valid contest and user
3. Ledger balance can be reconciled to payment status
4. No ledger entry can be edited or deleted

### Silent Failures Not Allowed
- Stripe signature validation failures are logged and webhooks rejected
- Duplicate webhooks are idempotent (not errors, but logged for audit)
- Payment validation errors are explicit with clear reason
- Ledger reconciliation failures stop all payment operations

---

## Failure Modes

### Webhook Delivery Failures
- **Detection**: Stripe retries webhook; if rejected, retry queue grows
- **Diagnosis**: Check webhook logs; verify signature validation code
- **Recovery**: Replay webhook manually via admin console
- **Verification**: Ledger entries created; payment status matches Stripe dashboard

### Partial Payment Success
- **Detection**: Payment intent created but webhook never arrives
- **Diagnosis**: Check Stripe dashboard for payment status; review webhook logs
- **Recovery**: Manually mark intent as FAILED if webhook doesn't arrive within timeout (e.g., 24 hours)
- **Verification**: Ledger reconciliation detects orphaned intents

### Duplicate Webhook Processing
- **Detection**: Same Stripe event_id processed multiple times (logged but not error)
- **Diagnosis**: Webhook handler idempotency check prevents duplicate ledger entries
- **Recovery**: No recovery needed; idempotency guarantees identical result
- **Verification**: Only one ledger entry created per event

### Refund Required
- **Detection**: User requests refund; operator initiates via admin console
- **Diagnosis**: Verify payment was collected; verify refund reason
- **Recovery**: Record refund transaction in ledger; initiate Stripe refund
- **Verification**: Ledger shows refund entry; Stripe confirms refund; user notified

### Chargeback
- **Detection**: Stripe webhook event type: charge.dispute.created
- **Diagnosis**: Review charge details; contact user if needed
- **Recovery**: Respond to chargeback in Stripe dashboard; record in ledger
- **Verification**: Ledger reconciliation reflects chargeback; contest access revoked if applicable

### Payout Failure
- **Detection**: Manual payout initiated but Stripe rejects (insufficient funds, account issue)
- **Diagnosis**: Check Stripe payout logs; verify bank account validity
- **Recovery**: Operator addresses root cause; retries payout (manually or via scheduled job in future)
- **Verification**: Payout record shows final status; ledger shows attempted payout

---

## Unit Test Requirements

### Idempotency Tests
- Creating payment intent twice with same idempotency key returns same intent ID
- Creating payment intent with different amounts + same key rejects (conflict)
- Webhook events with same stripe_event_id produce one ledger entry (no duplicates)
- Retry of failed webhook produces identical ledger state

### Duplicate Webhook Tests
- Same webhook event processed twice creates one ledger entry (idempotent)
- Webhook received out of order still produces correct ledger state
- Webhook processing is atomic (all-or-nothing; no partial ledger entries)

### Ledger Reconciliation Tests
- Ledger balance = sum of all transactions
- All payments have corresponding ledger entries
- All refunds have corresponding ledger entries
- Ledger cannot be edited; only new entries allowed

### Payment Lifecycle Tests
- Payment intent created → payment.status = PENDING
- Webhook received (charge.succeeded) → payment.status = SUCCEEDED, ledger.balance updated
- Webhook received (charge.failed) → payment.status = FAILED, ledger entry recorded
- Refund initiated → ledger shows refund entry; balance adjusted

### Failure Path Tests
- Invalid Stripe signature rejects webhook (rejected, not processed)
- Payment amount mismatch (entry fee changed) rejects intent creation
- Duplicate payment (user already paid) rejects new intent

---

## Completion Criteria

✓ Payment service accepts requests and creates idempotent intents
✓ Webhook handler validates Stripe signature and stores raw events
✓ Webhook processor applies events to ledger without duplicates
✓ Ledger entries are immutable and can be reconciled
✓ Manual payout workflow is documented and testable
✓ All validation failures are explicit with clear error messages
✓ No payment operation mutates contest state
✓ All payment and payout records are auditable
✓ Idempotency keys prevent duplicate charges
✓ Stripe events are stored raw before processing
✓ Ledger reconciliation is automated and can detect discrepancies
✓ Payment failure modes are documented in runbook (iteration 06)
✓ Schema snapshot is updated and committed
✓ No undocumented assumptions remain

---

## Future Work (Iteration 05 Automatic Payout + Iteration 06 Runbooks)

The following items are deferred:
- **Iteration 05**: Automatic payout execution service (PayoutOrchestrationService, PayoutExecutionService, StripePayoutAdapter)
- **Iteration 06**: Operational runbooks for payment and payout failure recovery

The following items are documented for reference:

### Manual Payout Tests (Reference for Iteration 05 Automatic Payout Implementation)
- Operator selects ledger entries → payout request created
- Payout request sent to Stripe → stripe_payout_id recorded
- Stripe webhook confirms payout completion → ledger updated
- Payout failure is recorded; operator can retry

### Payout Webhook Processing (Iteration 05 Automatic Payout Implementation)
- Payout completion webhooks update payout_records.status
- Payout failure webhooks are logged with error details
- Manual reconciliation process for failed payouts

### Alerting & Observability (Iteration 06 Runbooks)
- Webhook timeout detection and operator alert system
- Payment failure rate metrics and dashboard
- Ledger reconciliation failure alerts
- Admin console for payment and payout diagnostics

---

## Lessons Learned

*To be completed upon iteration closure*

### What Worked
(Document successes)

### What Was Harder Than Expected
(Document surprises)

### Assumptions We Purged
(Document implicit behaviors we discovered and removed)

### Decisions For Next Iteration
(Document architectural choices that affect iteration 04 - Contract Freeze)

### Payment-Specific CLAUDE.md Files
(Document links to service-specific governance files)

### Manual Payout Operational Knowledge
(Document what was learned about manual payout processes for iteration 05-06)

---

## Next Steps

Once this iteration closes:
- **Iteration 04**: Backend Contract Freeze + Canonical Documentation
  - All payment endpoints are frozen with explicit contracts
  - Payment integration is deterministic and auditable
  - No further changes to payment structure without iteration plan
- **Iteration 05**: Automatic Payout Execution
  - PayoutOrchestrationService, PayoutExecutionService, StripePayoutAdapter implemented
  - Automatic payout triggered on settlement completion
  - Zero manual operator involvement required
- **Iteration 06**: Operational Runbooks + Founder Absence Simulation
  - Payment and payout failure modes documented with recovery procedures
  - Founder Absence Simulation includes 14-day test with automatic payout
