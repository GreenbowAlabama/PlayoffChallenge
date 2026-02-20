# MVP-Beta Wallet Economy Activation

**Version:** 1.45
**Target Platform:** iOS (Swift)
**Status:** Implementation Planning
**Last Updated:** 2026-02-19

---

## Executive Summary

This document defines the iOS client-layer activation strategy for the MVP-Beta Wallet Economy (v1.45). The wallet system enables financial transaction flows for paid contests: deposit collection via Stripe, wallet debit for entry fees, payout credit upon settlement, and cancellation refunds.

Activation is scoped to iOS implementation only. Backend infrastructure (Stripe integration, ledger engine, payout automation, webhook processing) is considered complete and governed by existing backend documentation.

Three phases guide implementation:

1. **Phase 1: Wallet Funding** — Stripe deposit flow and wallet balance synchronization
2. **Phase 2: Paid Contest Wallet Flow** — Contest entry with wallet debit, settlement credit, cancellation refunds
3. **Phase 3: Withdrawal Staging Strategy** — Out-of-scope for v1.45; documented for architectural continuity

Activation emphasizes:
- Backend-authoritative state (no client inference)
- Strict API contract adherence (openapi.yaml as canonical source)
- Idempotent client behavior across network failures
- Deterministic error classification
- Core domain model validation via Swift package

---

## Version Alignment: v1.44 → v1.45

### Baseline (v1.44)

- Payment intent creation endpoint (`POST /api/payments/intents`) — operational
- Stripe webhook ingestion and payment confirmation — operational
- Ledger table structure for wallet and transaction tracking — in place
- Settlement engine with automatic payout initiation — operational
- Contest lifecycle state machine (SCHEDULED → LOCKED → LIVE → COMPLETE → CANCELLED/ERROR) — stable

### Additions (v1.45)

- **iOS Wallet Balance Fetch API** — `GET /api/wallet/balance` (new endpoint required)
- **iOS Wallet Transaction History** — `GET /api/wallet/transactions` (new endpoint required)
- **Contest Entry Fee Debit from Wallet** — Atomic debit on `POST /api/custom-contests/:id/join`
- **Payout Credit to Wallet** — Automatic credit to wallet on settlement completion
- **Cancellation Refund Flow** — Refund to wallet on contest cancellation
- **iOS Domain Models** — Wallet balance, transaction history, error states
- **Core Package Validation** — Wallet balance validation rules, transaction parsing

No breaking changes to existing v1.44 contracts or state machines.

---

## Phase 1: iOS Wallet Funding Activation

### Objective

Enable users to deposit funds into their wallet via Stripe payment flow. Wallet balance must reflect funding immediately upon payment confirmation and persist across app sessions.

### API Consumption

#### Create Payment Intent
```
POST /api/payments/intents
Headers:
  Idempotency-Key: UUID (required; must be unique per deposit attempt)
  X-User-Id: UUID (required; user making the request)
  Authorization: Bearer <token> (required; JWT token)
Body:
{
  "contest_instance_id": "00000000-0000-0000-0000-000000000001",
  "amount_cents": 5000
}

Response 200:
{
  "payment_intent_id": "00000000-0000-0000-0000-000000000001",
  "status": "requires_payment_method",
  "client_secret": "pi_1234_secret_5678",
  "amount_cents": 5000,
  "currency": "usd"
}

Response 400:
{
  "error": "Missing required fields or invalid format"
}

Response 500:
{
  "error": "Stripe API error"
}
```

**Idempotency Guarantee:** Same Idempotency-Key returns identical payment_intent_id. Client must persist the key and reuse it on network retry.

#### Fetch Wallet Balance (new endpoint)
```
GET /api/wallet/balance
Headers:
  Authorization: Bearer <token>

Response 200:
{
  "wallet_id": "UUID",
  "user_id": "UUID",
  "balance_cents": 50000,
  "currency": "usd",
  "last_updated": "2026-02-19T10:30:00Z"
}

Response 401:
{
  "error": "Unauthorized"
}
```

### iOS Implementation Requirements

#### Data Model: `WalletBalance`

```swift
// Core package: Sources/core/Wallet/WalletBalance.swift
public struct WalletBalance: Decodable {
    public let wallet_id: String
    public let user_id: String
    public let balance_cents: Int
    public let currency: String
    public let last_updated: String // ISO 8601

    public var balanceDecimal: Decimal {
        Decimal(balance_cents) / Decimal(100)
    }
}
```

**Validation Rules (core package):**
- `balance_cents` ≥ 0 (enforced at decode time)
- `currency` == "usd" (case-insensitive)
- `wallet_id` is valid UUID format
- `last_updated` parses as ISO 8601 datetime

#### Service: `WalletFundingService`

Located in main iOS target (not core):

```swift
protocol WalletFunding {
    func createPaymentIntent(
        amount: Decimal,
        contestInstanceId: String,
        idempotencyKey: String
    ) async throws -> PaymentIntentResponse

    func fetchWalletBalance() async throws -> WalletBalance
}

class WalletFundingService: WalletFunding {
    // Handles:
    // - HTTP requests to /api/payments/intents and /api/wallet/balance
    // - Idempotency key management and persistence
    // - Network error classification (transient vs. permanent)
    // - Response parsing and strict contract validation
}
```

#### ViewModel: `WalletFundingViewModel`

```swift
@MainActor
class WalletFundingViewModel: ObservableObject {
    @Published var walletBalance: WalletBalance?
    @Published var isLoading: Bool = false
    @Published var error: WalletFundingError?

    // Actions
    func loadWalletBalance() async
    func initiatePaymentIntent(amount: Decimal, contestId: String) async
}
```

#### State Refresh Logic

Wallet balance is fetched:
1. On app launch (if user authenticated)
2. After successful payment confirmation (webhook confirmation)
3. On explicit user action (pull-to-refresh)
4. Every 60 seconds while in foreground (background polling)

**Implementation Detail:** Use NotificationCenter to broadcast wallet state changes. Subscribers (contests list, balance display) react to updates without tight coupling.

#### Error Handling: `WalletFundingError`

```swift
enum WalletFundingError: LocalizedError {
    case networkError(HTTPStatus)
    case invalidPaymentIntent
    case insufficientBalance
    case stripeApiFailed
    case idempotencyKeyRequired
    case walletNotFound
    case decodeError(String)
    case unknown(String)

    // Idempotency classification:
    var isRetryable: Bool {
        switch self {
        case .networkError(let status):
            return status.rawValue >= 500 || status.rawValue == 408 // 5xx, 408
        case .stripeApiFailed:
            return true // Stripe errors are transient
        default:
            return false
        }
    }
}
```

#### Idempotent Deposit Flow

1. User enters amount, taps "Add Funds"
2. Generate idempotency key: `UUID().uuidString`
3. Store in UserDefaults: `pendingDepositKey = key`
4. Call `createPaymentIntent(..., idempotencyKey: key)`
5. On network failure, retry with same key (service returns cached response)
6. On success, clear `pendingDepositKey`
7. Poll `/api/wallet/balance` until it increases (confirmation)

**No silent failures:** If idempotency key generation fails, error is surfaced to user.

---

## Phase 2: Paid Contest Wallet Flow Activation

### Objective

Integrate wallet debit into contest join flow. When user joins a paid contest, wallet is debited atomically. Upon settlement, wallet is credited with payout. Upon cancellation, wallet is refunded.

### API Contract Alignment

#### Contest Join Endpoint
```
POST /api/custom-contests/{id}/join
Headers:
  Authorization: Bearer <token>
Body:
{
  "entry_fee_cents": 5000,  // NEW: from contest.entry_fee_cents
  "use_wallet": true         // NEW: fund entry from wallet
}

Response 200:
{
  "id": "UUID",
  "contest_name": "...",
  "entry_fee_cents": 5000,
  "status": "SCHEDULED",
  "user_has_entered": true,
  "leaderboard_state": "pending",
  "actions": { ... },
  "payout_table": [ ... ],
  "roster_config": { ... }
}

Response 400:
{
  "error_code": "INSUFFICIENT_WALLET_BALANCE",
  "reason": "Wallet balance ($25.00) is less than entry fee ($50.00)"
}

Response 403:
{
  "error_code": "CONTEST_FULL",
  "reason": "Contest has reached maximum capacity"
}

Response 403:
{
  "error_code": "ALREADY_JOINED",
  "reason": "User is already a participant"
}
```

**Error Codes (deterministic classification):**
- `INSUFFICIENT_WALLET_BALANCE` — wallet < entry_fee_cents (user action required)
- `CONTEST_FULL` — capacity check at join time (retryable; entry_count may decrease)
- `ALREADY_JOINED` — duplicate join attempt (idempotent; return 200 on retry)
- `WALLET_DEBIT_FAILED` — ledger write failure (transient; retry safe)

#### Contest Detail Endpoint
```
GET /api/custom-contests/{id}

Response 200:
{
  ...,
  "user_has_entered": true,
  "entry_fee_cents": 5000,
  "status": "LOCKED",
  ...,
  "payout_table": [
    {
      "place": "first",
      "rank_min": 1,
      "rank_max": 1,
      "amount": null,  // null until settled
      "payout_percent": 70,
      "currency": "usd"
    }
  ],
  ...
}
```

**Guarantee:** `payout_table[].amount` is null until `leaderboard_state` == "computed".

#### Settlement & Payout (automatic, backend-driven)

On contest settlement (triggered by contest reaching completion time):
1. Backend computes final standings
2. Applies settlement strategy (e.g., 70/20/10 split)
3. Calculates payouts in cents
4. **Atomically** credits each winner's wallet
5. Updates `payout_table[].amount` field
6. Sets `leaderboard_state` to "computed"

**iOS client responsibility:** Poll `/api/custom-contests/{id}` until `leaderboard_state` == "computed" or `payout_table[].amount` is non-null.

#### Cancellation Refund Flow

When contest is cancelled:
1. Backend identifies all participants
2. Refunds entry fee to each participant's wallet (reversed ledger entry)
3. Updates contest `status` to "CANCELLED"
4. Sets `leaderboard_state` to "error" (standings unavailable)

**iOS client responsibility:**
- Detect status == "CANCELLED" via polling
- Show refund notification: "Entry fee ($50.00) has been refunded to your wallet"

### iOS Implementation Requirements

#### Data Model Updates

Extend `ContestDetailResponseContract` (core package):

```swift
// In core/Contracts/ContestDetailResponseContract.swift
public struct ContestDetailResponseContract: Decodable {
    // Existing fields...
    public let entry_fee_cents: Int?  // NEW: nullable for free contests
    public let user_has_entered: Bool

    // Existing: payout_table, roster_config, actions, leaderboard_state
}
```

Add wallet transaction model (core package):

```swift
// core/Wallet/WalletTransaction.swift
public struct WalletTransaction: Decodable {
    public let transaction_id: String
    public let wallet_id: String
    public let user_id: String
    public let type: String  // "deposit", "debit", "credit", "refund"
    public let amount_cents: Int
    public let contest_instance_id: String?
    public let ledger_id: String?
    public let created_at: String  // ISO 8601
    public let status: String  // "pending", "confirmed", "failed"

    public var amountDecimal: Decimal {
        Decimal(amount_cents) / Decimal(100)
    }
}

// Fetch transactions
public struct WalletTransactionHistory: Decodable {
    public let transactions: [WalletTransaction]
    public let total_count: Int
    public let page: Int
    public let limit: Int
}
```

#### Service: `PaidContestWalletService`

```swift
protocol PaidContestWalletJoining {
    func joinContestWithWallet(
        contestId: String,
        entryFeeCents: Int,
        useWallet: Bool
    ) async throws -> ContestDetailResponseContract

    func fetchWalletTransactions(
        page: Int,
        limit: Int
    ) async throws -> WalletTransactionHistory
}

class PaidContestWalletService: PaidContestWalletJoining {
    // Handles:
    // - POST /api/custom-contests/:id/join with wallet debit
    // - GET /api/wallet/transactions
    // - Error classification (INSUFFICIENT_BALANCE vs. network vs. capacity)
    // - Retry logic (idempotent joins)
}
```

#### ViewModel: `ContestJoinWithWalletViewModel`

```swift
@MainActor
class ContestJoinWithWalletViewModel: ObservableObject {
    @Published var contest: ContestDetailResponseContract?
    @Published var walletBalance: WalletBalance?
    @Published var isJoining: Bool = false
    @Published var joinError: ContestJoinError?
    @Published var successfullyJoined: Bool = false

    func loadContest(id: String) async
    func joinWithWallet() async
    func checkWalletSufficiency() -> Bool
}

enum ContestJoinError: LocalizedError {
    case insufficientBalance(required: Decimal, available: Decimal)
    case contestFull
    case alreadyJoined
    case walletDebitFailed
    case networkError
    case unknown(String)
}
```

#### State Refresh: Settlement Polling

After successful join, user enters contest detail view. Client must poll for settlement:

```swift
class ContestSettlementPoller {
    private var timer: Timer?

    func startPolling(contestId: String, interval: TimeInterval = 10) {
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task {
                let contest = try await self?.service.fetchContest(id: contestId)
                if contest?.leaderboard_state == "computed" {
                    self?.stopPolling()
                    // Notify subscriber
                    NotificationCenter.default.post(name: NSNotification.Name("ContestSettled"), object: contestId)
                }
            }
        }
    }

    func stopPolling() {
        timer?.invalidate()
        timer = nil
    }
}
```

**Polling Frequency:** 10 seconds (balance between responsiveness and server load)
**Max Duration:** 24 hours (stop polling if settlement hasn't occurred)

#### Cancellation Detection

Monitor contest detail for `status == "CANCELLED"`:

```swift
if let walletedContest = contest,
   walletedContest.status == "CANCELLED",
   let entrFee = walletedContest.entry_fee_cents {
    showRefundNotification(amount: Decimal(entryFee) / 100)
}
```

#### Error Handling & Retry Strategy

**Insufficient Balance:**
- Error code: `INSUFFICIENT_WALLET_BALANCE`
- User action: Deposit more funds
- No automatic retry
- Show amount needed: "Need $25.00 more"

**Contest Full:**
- Error code: `CONTEST_FULL`
- Classification: Retryable (capacity may decrease if others unjoin)
- Automatic retry policy: Exponential backoff (2s, 4s, 8s, 16s), max 3 attempts
- After max retries: "Contest is full. Try again later."

**Already Joined:**
- Error code: `ALREADY_JOINED`
- Classification: Idempotent (user already in contest)
- HTTP 200 response on retry
- Handled transparently; no error UI

**Wallet Debit Failed:**
- Error code: `WALLET_DEBIT_FAILED`
- Classification: Transient (ledger write failed)
- Retry policy: Exponential backoff, max 5 attempts
- Timeout: 30 seconds per attempt

**Network Errors:**
- Classification: Transient (no internet, timeout, 5xx)
- Retry policy: Exponential backoff, max 3 attempts, 30s timeout
- Manual retry button if all retries exhausted

---

## Phase 3: Withdrawal Staging Strategy

### Objective (Out-of-Scope v1.45)

Provide users with mechanism to withdraw wallet balance to bank account. Planned for v2.0.

### Architectural Notes

**Not implemented in v1.45.** Foundation laid by:
- Wallet ledger structure (supports outbound transactions)
- Stripe Connect integration (enables ACH transfers)
- Payout job queue (can be repurposed for user withdrawals)

**Future Endpoint (v2.0):**
```
POST /api/wallet/withdrawals
Body:
{
  "amount_cents": 10000,
  "bank_account_id": "ba_xxx"  // Stripe bank account token
}

Response 202:
{
  "withdrawal_id": "UUID",
  "amount_cents": 10000,
  "status": "pending",
  "created_at": "2026-02-19T10:30:00Z"
}
```

**iOS Work (v2.0):**
- Bank account linking UI (Stripe Link integration)
- Withdrawal form with amount entry
- Withdrawal history and status tracking
- Notifications for withdrawal confirmation (ACH 1-3 business days)

---

## API Contract Alignment

### Canonical Source

**Path:** `/Users/iancarter/Documents/workspace/playoff-challenge/backend/contracts/openapi.yaml`

**v1.45 Additions Required in OpenAPI:**

#### New Endpoint: GET /api/wallet/balance

```yaml
/api/wallet/balance:
  get:
    tags:
      - Wallet
    summary: Get current wallet balance
    operationId: getWalletBalance
    responses:
      '200':
        description: Wallet balance retrieved
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/WalletBalance'
      '401':
        description: Unauthorized
      '404':
        description: Wallet not found
```

#### New Endpoint: GET /api/wallet/transactions

```yaml
/api/wallet/transactions:
  get:
    tags:
      - Wallet
    summary: Get wallet transaction history
    operationId: getWalletTransactions
    parameters:
      - name: page
        in: query
        schema:
          type: integer
          default: 1
      - name: limit
        in: query
        schema:
          type: integer
          default: 50
    responses:
      '200':
        description: Transactions retrieved
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/WalletTransactionHistory'
      '401':
        description: Unauthorized
```

#### Update: POST /api/custom-contests/:id/join

Add optional fields to request and response:

```yaml
requestBody:
  content:
    application/json:
      schema:
        type: object
        properties:
          entry_fee_cents:
            type: integer
            description: Entry fee in cents (from contest)
          use_wallet:
            type: boolean
            description: Fund entry from wallet (true) or pay separately (false)

responses:
  '400':
    description: Validation error
    content:
      application/json:
        schema:
          oneOf:
            - $ref: '#/components/schemas/InsufficientBalanceError'
            - $ref: '#/components/schemas/ContestFullError'
            - $ref: '#/components/schemas/AlreadyJoinedError'
```

#### Update: GET /api/custom-contests/:id

Extend response to include entry_fee_cents (contract already supports this).

### Schema Definitions (New)

```yaml
components:
  schemas:
    WalletBalance:
      type: object
      required:
        - wallet_id
        - user_id
        - balance_cents
        - currency
        - last_updated
      properties:
        wallet_id:
          type: string
          format: uuid
        user_id:
          type: string
          format: uuid
        balance_cents:
          type: integer
          minimum: 0
        currency:
          type: string
          enum: [usd]
        last_updated:
          type: string
          format: date-time

    WalletTransaction:
      type: object
      required:
        - transaction_id
        - wallet_id
        - user_id
        - type
        - amount_cents
        - created_at
        - status
      properties:
        transaction_id:
          type: string
          format: uuid
        wallet_id:
          type: string
          format: uuid
        user_id:
          type: string
          format: uuid
        type:
          type: string
          enum: [deposit, debit, credit, refund]
          description: Transaction type
        amount_cents:
          type: integer
        contest_instance_id:
          type: string
          format: uuid
          nullable: true
          description: Reference to contest (for debit/credit/refund)
        created_at:
          type: string
          format: date-time
        status:
          type: string
          enum: [pending, confirmed, failed]

    WalletTransactionHistory:
      type: object
      required:
        - transactions
        - total_count
        - page
        - limit
      properties:
        transactions:
          type: array
          items:
            $ref: '#/components/schemas/WalletTransaction'
        total_count:
          type: integer
        page:
          type: integer
        limit:
          type: integer

    InsufficientBalanceError:
      type: object
      required:
        - error_code
        - reason
        - required_cents
        - available_cents
      properties:
        error_code:
          type: string
          const: INSUFFICIENT_WALLET_BALANCE
        reason:
          type: string
        required_cents:
          type: integer
        available_cents:
          type: integer
```

---

## Core Model Adjustments

### Swift Package: `core`

**Location:** `/Users/iancarter/Documents/workspace/playoff-challenge/core`

#### New Files Required

1. **Sources/core/Wallet/WalletBalance.swift**
   - Decodable struct with validation
   - Ensures balance_cents ≥ 0
   - Parses currency as ISO 4217 code

2. **Sources/core/Wallet/WalletTransaction.swift**
   - Decodable struct for transaction record
   - Type enum: deposit, debit, credit, refund
   - Status enum: pending, confirmed, failed

3. **Sources/core/Wallet/WalletError.swift**
   - Enum for wallet-specific errors
   - Error classification: retryable vs. permanent
   - Machine-readable error codes

#### Update: ContestDetailResponseContract

```swift
public struct ContestDetailResponseContract: Decodable {
    // Existing fields...
    public let entry_fee_cents: Int?
    // Change from nullable to required for v1.45
    public let user_has_entered: Bool

    enum CodingKeys: String, CodingKey {
        case entry_fee_cents
        case user_has_entered
        // ... others
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        entry_fee_cents = try c.decode(Int?.self, forKey: .entry_fee_cents)
        user_has_entered = try c.decode(Bool.self, forKey: .user_has_entered)
        // ... others
    }
}
```

#### Validation Rules in Core

**WalletBalance Validation:**
```swift
public struct WalletBalanceValidator {
    static func validate(_ balance: WalletBalance) throws {
        guard balance.balance_cents >= 0 else {
            throw WalletValidationError.negativeBalance
        }
        guard balance.currency.uppercased() == "USD" else {
            throw WalletValidationError.unsupportedCurrency(balance.currency)
        }
        // ISO 8601 parsing happens at decode time
    }
}
```

**Entry Fee Sufficiency Check:**
```swift
public struct EntryFeeSufficiency {
    static func canAfford(
        walletBalance: Int,
        entryFeeInCents: Int
    ) -> Bool {
        walletBalance >= entryFeeInCents
    }
}
```

#### Compilation & Testing

**Build:**
```bash
cd /Users/iancarter/Documents/workspace/playoff-challenge/core
swift build
```

**Test:**
```bash
cd /Users/iancarter/Documents/workspace/playoff-challenge/core
swift test
```

**Requirements:**
- All tests must pass (100% green)
- No compiler warnings
- No deprecated APIs used

---

## Client Idempotency Strategy

### Idempotency Keys

**Requirement:** All write operations must include idempotency keys to guarantee idempotent retry behavior.

#### Phase 1: Wallet Funding

- **Operation:** Create payment intent
- **Header:** `Idempotency-Key`
- **Persistence:** Store in UserDefaults under `pending_deposit_${timestamp}`
- **Retry:** Automatic on transient network error (5xx, 408, timeout)
- **Max Retries:** 3 attempts with exponential backoff (2s, 4s, 8s)

#### Phase 2: Paid Contest Join

- **Operation:** Join contest with wallet debit
- **Header:** `Idempotency-Key`
- **Persistence:** Store in UserDefaults under `pending_join_${contestId}_${timestamp}`
- **Retry:** Automatic for `CONTEST_FULL` and network errors
- **No Retry:** `INSUFFICIENT_BALANCE` (user action required), `ALREADY_JOINED` (silently succeed)
- **Max Retries:** 3 attempts for `CONTEST_FULL`; 5 attempts for network

#### Idempotency Key Generation

```swift
func generateIdempotencyKey() -> String {
    UUID().uuidString
}
```

Clients must:
1. Generate key before first attempt
2. Store key persistently (UserDefaults or Keychain)
3. Reuse key for all retries
4. Clear key on success or permanent failure

#### Duplicate Request Detection

Backend detects duplicate requests via idempotency key:
- Same key + same endpoint = cached response (no mutation)
- Different key + same endpoint = new request (mutation occurs)

**Client Guarantee:** Never issue same request with different keys (except in case of user-initiated retry after manual wait).

---

## Failure Handling Matrix

### Phase 1: Wallet Funding

| Error | HTTP Code | Classification | Client Action | Retry Policy |
|-------|-----------|-----------------|---------------|--------------|
| Invalid amount | 400 | User input | Show validation error | No retry |
| Missing Idempotency-Key | 400 | Configuration | Show system error | No retry |
| Idempotency key exists with different amount | 409 | Conflict | Cancel request, show error | No retry |
| Network timeout | — | Transient | Retry with same key | Exponential (2s, 4s, 8s) |
| Stripe API error | 5xx | Transient | Retry with same key | Exponential (2s, 4s, 8s) |
| Rate limit (429) | 429 | Transient | Retry with backoff | Exponential, max 10s |
| Unauthorized (401) | 401 | Auth | Refresh token, retry | Once after refresh |
| Invalid JSON response | — | Transient | Retry | Exponential |
| Wallet not found | 404 | Permanent | Create wallet, retry | Once after creation |

### Phase 2: Paid Contest Join

| Error Code | HTTP Code | Classification | User Message | Retry Policy |
|-----------|-----------|-----------------|---------------|--------------|
| `INSUFFICIENT_WALLET_BALANCE` | 400 | Permanent | "Need $X more to join. Deposit funds first." | No retry |
| `CONTEST_FULL` | 403 | Transient | "Contest is full. Checking availability..." | Exponential (2s, 4s, 8s, 16s), max 3× |
| `ALREADY_JOINED` | 403 | Idempotent | (silent; proceed as success) | Retry once, treat as 200 |
| `WALLET_DEBIT_FAILED` | 500 | Transient | "Payment processing. Please wait..." | Exponential (2s, 4s, 8s), max 5× |
| Network timeout | — | Transient | "Connecting..." | Exponential (2s, 4s, 8s) |
| `CONTEST_NOT_FOUND` | 404 | Permanent | "Contest no longer available." | No retry |
| `CONTEST_LOCKED` | 403 | Permanent | "Entry window has closed." | No retry |
| Invalid JWT (401) | 401 | Auth | "Session expired. Please sign in again." | Refresh token, retry |

### Phase 3: Settlement & Refunds

| Scenario | Classification | Client Action | Polling Strategy |
|----------|-----------------|---------------|------------------|
| Settlement complete (`leaderboard_state == "computed"`) | Success | Stop polling, show payouts | N/A |
| Settlement pending (`leaderboard_state == "pending"`) | In progress | Continue polling | Every 10s, max 24h |
| Contest cancelled (`status == "CANCELLED"`) | Refund | Show refund notification | Stop polling on status change |
| Settlement error (`status == "ERROR"`) | Permanent | Show error, disable leaderboard | Stop polling |

---

## Testing Strategy

### Core Package Tests

**Location:** `/Users/iancarter/Documents/workspace/playoff-challenge/core/Tests/coreTests/`

#### Unit Tests Required

1. **WalletBalanceDecodingTests.swift**
   - Valid balance with all fields
   - Invalid balance: negative cents
   - Invalid balance: unsupported currency
   - Invalid balance: missing required field (decode failure)
   - Decimal conversion accuracy

2. **WalletTransactionDecodingTests.swift**
   - Valid transaction (all types: deposit, debit, credit, refund)
   - Invalid status values
   - Missing required fields
   - Optional contest_instance_id handling

3. **ContestDetailResponseContractUpdateTests.swift**
   - entry_fee_cents: null (free contest)
   - entry_fee_cents: 0 (free contest)
   - entry_fee_cents: > 0 (paid contest)
   - Ensure backward compatibility with v1.44 responses

4. **EntryFeeSufficiencyTests.swift**
   - Wallet balance exactly matches fee (can afford)
   - Wallet balance exceeds fee (can afford)
   - Wallet balance less than fee (cannot afford)
   - Zero balance vs. zero fee (can afford)

5. **WalletErrorClassificationTests.swift**
   - INSUFFICIENT_BALANCE maps to `.insufficientBalance`
   - CONTEST_FULL maps to retryable error
   - ALREADY_JOINED maps to idempotent success
   - Network error (5xx) classified as transient

#### Integration Tests (Core + Mock Services)

1. **WalletFundingFlowTests.swift**
   - Successful payment intent creation
   - Idempotent retry with same key
   - Balance fetch after payment

2. **PaidContestJoinFlowTests.swift**
   - Sufficient wallet balance → success
   - Insufficient balance → error (no retry)
   - Contest full → retryable error
   - Already joined → idempotent success

### Test Execution

**All tests must compile and pass:**

```bash
cd /Users/iancarter/Documents/workspace/playoff-challenge/core
swift test 2>&1
```

**Exit Code 0:** All tests pass
**Exit Code ≠ 0:** Failure; block deployment

---

## Go/No-Go Criteria

### Deployment Prerequisites

#### 1. API Contracts
- [ ] OpenAPI YAML updated with new endpoints (`/api/wallet/balance`, `/api/wallet/transactions`)
- [ ] POST `/api/custom-contests/:id/join` supports optional `entry_fee_cents` and `use_wallet` fields
- [ ] Error response schemas defined for `INSUFFICIENT_WALLET_BALANCE`, `CONTEST_FULL`, `ALREADY_JOINED`
- [ ] Backwards compatibility verified (v1.44 clients continue to work)

#### 2. Backend Services
- [ ] `GET /api/wallet/balance` endpoint implemented and tested
- [ ] `GET /api/wallet/transactions` endpoint implemented and tested
- [ ] POST `/api/custom-contests/:id/join` modified to accept `use_wallet` flag and debit wallet atomically
- [ ] Stripe webhook processing confirms payment and updates wallet balance
- [ ] Settlement engine credits wallet on contest completion
- [ ] Cancellation handler refunds entry fee to wallet
- [ ] Ledger audit trail confirms all debit/credit/refund operations
- [ ] Database migrations applied (wallet, ledger, transaction tables)

#### 3. Core Package (Swift)
- [ ] `WalletBalance.swift` compiles and decodes strictly
- [ ] `WalletTransaction.swift` compiles and decodes strictly
- [ ] `WalletError.swift` defines error codes and classifications
- [ ] `ContestDetailResponseContract.swift` updated to include `entry_fee_cents`
- [ ] All validation rules enforce invariants (non-negative balance, valid currency, UUID format)
- [ ] Core package builds: `swift build` returns exit code 0
- [ ] Core package tests pass: `swift test` returns exit code 0

#### 4. iOS Implementation
- [ ] `WalletFundingService` fetches balance and creates payment intents
- [ ] `WalletFundingViewModel` manages state and error handling
- [ ] `PaidContestWalletService` handles join with wallet debit
- [ ] Idempotency key management persisted and reused on retry
- [ ] Stripe integration (StripePaymentForm or equivalent) functional
- [ ] Settlement polling implemented and tested (max 24h polling)
- [ ] Refund detection and notification working
- [ ] Error messages localized and user-friendly

#### 5. Network & Error Handling
- [ ] Transient errors (5xx, timeout, network) automatically retried with exponential backoff
- [ ] Permanent errors (400, 401, 403 except CONTEST_FULL) surfaced to user without retry
- [ ] Idempotency key conflicts handled gracefully
- [ ] Rate limiting (429) respected with backoff
- [ ] Offline mode: cached balance displayed; sync on online recovery

#### 6. Testing
- [ ] Core package: 100% test pass rate (swift test)
- [ ] WalletBalance decoding tests: 8+ test cases
- [ ] WalletTransaction decoding tests: 6+ test cases
- [ ] Idempotency tests: 5+ test cases (duplicate key, different key, retry success)
- [ ] Error classification tests: 8+ test cases (transient, permanent, idempotent)
- [ ] Manual testing checklist completed (deposit flow, join with wallet, settlement polling, refund)

#### 7. Documentation
- [ ] This implementation plan complete and approved
- [ ] In-code comments explain idempotency key handling
- [ ] Service layer documentation describes retry policies
- [ ] ViewModel documentation describes state refresh logic
- [ ] Error handling guide available to frontend team

#### 8. Monitoring & Observability
- [ ] Wallet balance fetch latency monitored (target: <500ms)
- [ ] Payment intent creation success rate tracked (target: >99.5%)
- [ ] Contest join with wallet debit success rate tracked (target: >99%)
- [ ] Error code frequency monitored (track INSUFFICIENT_BALANCE, CONTEST_FULL, WALLET_DEBIT_FAILED)
- [ ] Idempotency key cache hit rate tracked (target: >95% on retry)
- [ ] Settlement polling duration tracked (target: <60s median, <5m p99)

### Rollout Strategy

**Phase 1 Rollout:**
1. Deploy backend endpoints (wallet balance, transactions, payment intent)
2. Deploy core package update
3. Deploy iOS build with WalletFundingService (feature flagged off)
4. QA testing in staging (deposit flow, balance sync)
5. Canary rollout: 5% of users, monitor error rates
6. Full rollout: Enable feature flag for 100% of users

**Phase 2 Rollout:**
1. Verify Phase 1 metrics stable for 48 hours
2. Deploy updated POST `/api/custom-contests/:id/join` with wallet debit
3. Deploy iOS build with PaidContestWalletService (feature flagged off)
4. QA testing: join paid contest, verify wallet debit
5. Canary rollout: 5% of users
6. Full rollout: Enable feature flag for 100% of users

**Phase 3 Rollout:**
- Document architectural requirements only; no implementation required for v1.45
- Implementation scheduled for v2.0

### Rollback Criteria

**Automatic rollback triggered if:**
- Error rate on `/api/wallet/balance` > 5% for 5 minutes
- Error rate on POST `/api/custom-contests/:id/join` > 2% for 5 minutes
- Payment intent creation success rate < 95%
- Settlement polling timeout > 10 minutes (p99) for more than 10% of users
- Duplicate ledger entries detected (wallet debit recorded twice)

**Manual rollback decision if:**
- Data corruption in wallet ledger
- Idempotency key collisions observed
- Rate limiting not properly respected

---

## Appendix: File Inventory

### iOS Project Structure

```
PlayoffChallenge/
├── Services/
│   ├── WalletFundingService.swift (NEW)
│   ├── PaidContestWalletService.swift (NEW)
│   └── existing services
├── ViewModels/
│   ├── WalletFundingViewModel.swift (NEW)
│   ├── ContestJoinWithWalletViewModel.swift (NEW)
│   ├── ContestSettlementPoller.swift (NEW)
│   └── existing ViewModels
├── Views/
│   ├── WalletBalanceView.swift (NEW)
│   ├── DepositFundsView.swift (NEW)
│   ├── WalletTransactionHistoryView.swift (NEW)
│   └── existing views
```

### Core Package Structure

```
core/
├── Sources/core/
│   ├── Wallet/ (NEW directory)
│   │   ├── WalletBalance.swift
│   │   ├── WalletTransaction.swift
│   │   └── WalletError.swift
│   ├── Contracts/
│   │   ├── ContestDetailResponseContract.swift (UPDATED)
│   │   └── existing contracts
│   └── existing sources
├── Tests/coreTests/
│   ├── WalletBalanceDecodingTests.swift (NEW)
│   ├── WalletTransactionDecodingTests.swift (NEW)
│   ├── EntryFeeSufficiencyTests.swift (NEW)
│   ├── ContestDetailResponseContractUpdateTests.swift (NEW)
│   ├── WalletErrorClassificationTests.swift (NEW)
│   └── existing tests
```

### Backend Documentation & Specification

```
backend/
├── contracts/
│   └── openapi.yaml (UPDATED)
├── migrations/
│   ├── 20260219_wallet_endpoints_v145.sql (NEW - if needed)
│   └── existing migrations
├── docs/
│   └── implementation/
│       └── 09-wallet-economy-activation-v1.45.md (THIS FILE)
```

---

## Backend Contract Verification Audit (Addendum)

### Classification: OPTION A + OPTION B (Hybrid)

**OPTION A — Payment Endpoints Out of Sync:**
- ✅ `POST /api/payments/intents` exists in code, missing from openapi.yaml
- ✅ `POST /api/webhooks/stripe` exists in code, missing from openapi.yaml
- Action: Update openapi.yaml with existing endpoints (Phase 0)

**OPTION B — Wallet Read APIs Do Not Exist:**
- ❌ `GET /api/wallet/balance` not implemented
- ❌ `GET /api/wallet/transactions` not implemented
- Action: Build HTTP read layer over existing ledger (Phase 1)

**Critical Distinction:**
Payment infrastructure (ledger, idempotency, Stripe integration, payouts) is production-grade and complete. What is missing is the *read visibility layer* for users to query their balance and transaction history.

This is not infrastructure redesign. This is controlled contract completion.

---

## Phase 0: Contract Synchronization (Immediate)

### Update openapi.yaml

#### Add: POST /api/payments/intents

```yaml
/api/payments/intents:
  post:
    tags:
      - Payments
    summary: Create payment intent
    operationId: createPaymentIntent
    parameters:
      - name: Idempotency-Key
        in: header
        required: true
        description: Unique key for idempotent retry (UUID or string)
        schema:
          type: string
      - name: X-User-Id
        in: header
        required: true
        description: UUID of requesting user
        schema:
          type: string
          format: uuid
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required:
              - contest_instance_id
              - amount_cents
            properties:
              contest_instance_id:
                type: string
                format: uuid
              amount_cents:
                type: integer
                minimum: 1
    responses:
      '200':
        description: Payment intent created
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PaymentIntentResponse'
      '400':
        description: Validation error
      '500':
        description: Stripe API error
```

#### Add: POST /api/webhooks/stripe

```yaml
/api/webhooks/stripe:
  post:
    tags:
      - Webhooks
    summary: Handle Stripe webhook event
    operationId: handleStripeWebhook
    parameters:
      - name: stripe-signature
        in: header
        required: true
        description: HMAC signature for Stripe event verification
        schema:
          type: string
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            description: Stripe event JSON
    responses:
      '200':
        description: Event processed
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/StripeWebhookResponse'
      '400':
        description: Invalid signature
      '409':
        description: Referenced payment intent not found
      '500':
        description: Processing error
```

#### Add: Schema Definitions

```yaml
components:
  schemas:
    PaymentIntentResponse:
      type: object
      required:
        - payment_intent_id
        - status
        - client_secret
      properties:
        payment_intent_id:
          type: string
          format: uuid
          description: Internal payment intent ID
        status:
          type: string
          enum: [REQUIRES_PAYMENT_METHOD, REQUIRES_CONFIRMATION, PROCESSING, SUCCEEDED, FAILED, CANCELED]
          description: Stripe payment intent status (uppercase)
        client_secret:
          type: string
          description: Stripe client secret for Stripe.js frontend integration

    StripeWebhookResponse:
      type: object
      required:
        - received
        - stripe_event_id
      properties:
        received:
          type: boolean
          const: true
        stripe_event_id:
          type: string
          description: Stripe event ID (ev_...)

    ErrorCode:
      type: string
      enum:
        - INSUFFICIENT_WALLET_BALANCE
        - CONTEST_FULL
        - ALREADY_JOINED
        - WALLET_DEBIT_FAILED
        - UNAUTHORIZED
        - NOT_FOUND
        - VALIDATION_ERROR
        - STRIPE_API_ERROR
```

### Validation

```bash
cd /backend
npm test -- contracts/openapi-freeze.test.js
# Must pass (exit code 0)
```

---

## Phase 1: Wallet Read APIs Implementation

### Hardened Implementation Constraints

#### 1. Balance Query: Currency Explicit

**Query:**
```sql
SELECT COALESCE(SUM(
  CASE
    WHEN direction = 'CREDIT' THEN amount_cents
    WHEN direction = 'DEBIT' THEN -amount_cents
  END
), 0) AS balance_cents
FROM ledger
WHERE user_id = $1
  AND currency = 'USD';
```

**Invariant:** Even if USD is hardcoded today, this query protects against silent breakage if multi-currency support is added later.

#### 2. Transaction Query: Approved Projection Only

**Query:**
```sql
SELECT
  id,
  contest_instance_id,
  entry_type,
  direction,
  amount_cents,
  currency,
  reference_type,
  reference_id,
  metadata_json,
  created_at
FROM ledger
WHERE user_id = $1
ORDER BY created_at DESC, id DESC
LIMIT $2 OFFSET $3;
```

**Never expose:**
- ❌ `stripe_event_id` (internal correlation)
- ❌ `idempotency_key` (internal deduplication)
- ❌ Any undocumented field

**Reason:** Wallet API is public contract. Every field is a commitment to iOS clients.

#### 3. Pagination Validation: Strict

**Enforce:**
```javascript
function validatePagination(page, limit) {
  // Type validation
  if (!Number.isInteger(page)) throw new Error('page must be integer');
  if (!Number.isInteger(limit)) throw new Error('limit must be integer');

  // Range validation
  if (page < 1) throw new Error('page must be >= 1');
  if (limit < 1) throw new Error('limit must be >= 1');
  if (limit > 100) throw new Error('limit must be <= 100');

  return { page, limit, offset: (page - 1) * limit };
}
```

**Reject:** Negative, decimal, non-numeric, out of bounds.

**HTTP 400:** All invalid pagination requests.

#### 4. Database Index: Required

**Check existence before Phase 1:**
```sql
SELECT indexname FROM pg_indexes
WHERE tablename = 'ledger'
AND indexdef ILIKE '%user_id%created_at%id%';
```

**If missing, add immediately:**
```sql
CREATE INDEX idx_ledger_user_created_at_id
ON ledger (user_id, created_at DESC, id DESC);
```

**Verification:**
```bash
EXPLAIN ANALYZE
SELECT * FROM ledger
WHERE user_id = 'some-uuid'
ORDER BY created_at DESC, id DESC
LIMIT 25;

# Expected: Index Scan using idx_ledger_user_created_at_id
# Unacceptable: Seq Scan or Sort
```

**Reason:** Without this composite index, `GET /api/wallet/transactions` will table-scan entire ledger as data grows.

#### 5. Security: User ID From Auth Context

**Correct Implementation:**
```javascript
async function getWalletBalance(req, res) {
  const userId = req.user.id; // From JWT/auth middleware
  const balance = await walletService.getBalance(userId);
  return res.json({ balance_cents: balance });
}

async function getWalletTransactions(req, res) {
  const userId = req.user.id; // From JWT/auth middleware
  const { page = 1, limit = 25 } = req.query;

  // Validate pagination
  const { offset } = validatePagination(page, limit);

  const result = await walletService.getTransactions(userId, limit, offset);
  return res.json(result);
}
```

**Enforcement:**
- Extract `user_id` from authenticated request context only (JWT subject, X-User-Id header from middleware)
- Reject cross-user queries with 403 Forbidden
- Never accept `user_id` from query parameters

#### 6. Total Count Performance Note

**Implementation:**
```javascript
async function getWalletTransactions(userId, limit, offset) {
  // Query 1: Transactions (indexed, fast)
  const transactions = await pool.query(
    `SELECT ... FROM ledger WHERE user_id = $1 ORDER BY ... LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  // Query 2: Count (linear scan, acceptable for MVP-beta)
  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM ledger WHERE user_id = $1`,
    [userId]
  );

  return {
    transactions: transactions.rows,
    total_count: countResult.rows[0].total,
    page: Math.floor(offset / limit) + 1,
    limit,
    total_pages: Math.ceil(countResult.rows[0].total / limit)
  };
}
```

**Code Comment:**
```javascript
// Total count requires separate query.
// Acceptable for MVP-beta. Scales linearly with user's transaction count.
// If this becomes a bottleneck, consider cursor-based pagination or
// materialized view of ledger summary (future optimization).
```

#### 7. Error Codes: Canonical Enum

**Define in code:**
```javascript
const ERROR_CODES = {
  INSUFFICIENT_WALLET_BALANCE: 'INSUFFICIENT_WALLET_BALANCE',
  CONTEST_FULL: 'CONTEST_FULL',
  ALREADY_JOINED: 'ALREADY_JOINED',
  WALLET_DEBIT_FAILED: 'WALLET_DEBIT_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  STRIPE_API_ERROR: 'STRIPE_API_ERROR'
};

// Always use constants
if (balance < requiredAmount) {
  throw new ApiError(
    ERROR_CODES.INSUFFICIENT_WALLET_BALANCE,
    'Wallet balance insufficient for entry fee'
  );
}
```

**Use in OpenAPI:** Define `ErrorCode` enum with all values above.

#### 8. Rate Limiting: Flagged for Future

**Not required for MVP-beta. Document for post-MVP:**

```javascript
// TODO (post-MVP): Add per-user rate limiting to wallet endpoints
// Expected implementation:
// const walletLimiter = rateLimit({
//   windowMs: 60 * 1000,
//   max: 60,                      // 60 requests per minute
//   keyGenerator: (req) => req.user.id  // Per-user throttling
// });
// app.get('/api/wallet/balance', walletLimiter, handler);
// app.get('/api/wallet/transactions', walletLimiter, handler);
// Reason: Wallet endpoints attractive for ledger scraping once public.
```

### New Endpoints

#### GET /api/wallet/balance

**File:** `/routes/wallet.routes.js` (new)

```javascript
router.get('/balance', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT COALESCE(SUM(
        CASE
          WHEN direction = 'CREDIT' THEN amount_cents
          WHEN direction = 'DEBIT' THEN -amount_cents
        END
      ), 0) AS balance_cents
       FROM ledger
       WHERE user_id = $1
         AND currency = 'USD'`,
      [userId]
    );

    return res.json({
      wallet_id: userId, // For contract compatibility
      user_id: userId,
      balance_cents: result.rows[0].balance_cents,
      currency: 'usd',
      last_updated: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch balance' });
  }
});
```

#### GET /api/wallet/transactions

**File:** `/routes/wallet.routes.js` (new)

```javascript
router.get('/transactions', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;

    // Validate pagination
    if (!Number.isInteger(page) || page < 1) {
      return res.status(400).json({ error: 'page must be integer >= 1' });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: 'limit must be integer 1-100' });
    }

    const offset = (page - 1) * limit;

    // Fetch transactions
    const transactions = await pool.query(
      `SELECT id, contest_instance_id, entry_type, direction, amount_cents,
              currency, reference_type, reference_id, metadata_json, created_at
       FROM ledger
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    // Fetch total count
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM ledger WHERE user_id = $1`,
      [userId]
    );

    const total = parseInt(countResult.rows[0].total);

    return res.json({
      transactions: transactions.rows,
      total_count: total,
      page,
      limit,
      total_pages: Math.ceil(total / limit)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});
```

### Mount in app.js

```javascript
const walletRoutes = require('./routes/wallet.routes');
app.use('/api/wallet', walletRoutes);
```

---

## Final Execution Checklist

| Item | Required | Timing | Enforced By |
|------|----------|--------|------------|
| Currency explicit in balance query | ✅ | Phase 1 | Code review |
| Only approved fields in transaction projection | ✅ | Phase 1 | OpenAPI schema |
| Pagination validation (integer, bounds) | ✅ | Phase 1 | Input validator |
| Composite index `idx_ledger_user_created_at_id` exists | ✅ | Before Phase 1 | Database check |
| User ID from auth context, never query param | ✅ | Phase 1 | Auth middleware |
| Total count performance documented | ✅ | Phase 1 | Code comment |
| Error codes canonicalized in OpenAPI | ✅ | Phase 0 | Contract definition |
| Rate limiting flagged (not implemented) | ✅ | Phase 1 | TODO comment |
| Idempotency-Key header documented in payments endpoint | ✅ | Phase 0 | OpenAPI spec |
| stripe-signature header documented in webhook endpoint | ✅ | Phase 0 | OpenAPI spec |

---

## Conclusion

Wallet Economy v1.45 provides the foundational iOS-layer activation for financial transaction flows. Implementation is strictly scoped to iOS client-side code, API consumption, and domain validation in the Swift core package.

Backend infrastructure (Stripe integration, ledger, settlement automation, webhook processing) is production-grade and complete. This plan adds the missing *read visibility layer* for users to query wallet state.

**Three execution phases:**

1. **Phase 0: Contract Synchronization** — Update openapi.yaml to document existing payment endpoints (POST /api/payments/intents, POST /api/webhooks/stripe). No code changes.

2. **Phase 1: Wallet Read APIs** — Implement GET /api/wallet/balance and GET /api/wallet/transactions with hardened constraints (currency explicit, approved projection, pagination validated, index guaranteed, security enforced).

3. **Phase 2: Paid Contest Wallet Flow** — iOS integration with wallet debit on join, settlement polling, refund detection. No new backend endpoints required.

**Architectural Integrity:**
- Ledger is canonical source of truth
- Balance is derived from ledger, not stored
- No wallet table required
- No premature caching
- No redundant data

**Deployment Safety:**
- Idempotency guarantees on all write operations
- Error classification deterministic and enumerated
- Pagination bounded and validated
- Database index verified before Phase 1
- User isolation enforced via authentication context
- Performance tradeoffs documented

This is not infrastructure redesign. This is controlled, disciplined completion of a financial platform surface.
