//
//  UserWalletViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for wallet state management.
//  Converts DTOs to Domain models immediately upon receipt.
//  Exposes @Published Domain properties only (never DTOs).
//

import Foundation
import Combine
import Core

/// Payment state machine for wallet funding flow.
/// ViewModel owns state transitions, View owns presentation.
enum PaymentState: Equatable {
    case idle                          // No deposit in progress
    case creatingIntent                // POST /api/wallet/fund in flight
    case ready(clientSecret: String)   // PaymentIntent created, ready to present sheet
    case processing                    // PaymentSheet active, user completing payment
    case success                       // Payment succeeded, balance pending refresh
    case failure(error: String)        // Payment failed or user cancelled

    static func == (lhs: PaymentState, rhs: PaymentState) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle): return true
        case (.creatingIntent, .creatingIntent): return true
        case (.ready(let lhsSecret), .ready(let rhsSecret)): return lhsSecret == rhsSecret
        case (.processing, .processing): return true
        case (.success, .success): return true
        case (.failure(let lhsError), .failure(let rhsError)): return lhsError == rhsError
        default: return false
        }
    }
}

/// Withdrawal state machine for withdrawal polling.
/// ViewModel owns state transitions, View owns presentation.
enum WithdrawalState: Equatable {
    case idle                              // No withdrawal in progress
    case submitted(withdrawalId: String)   // POST succeeded, polling for status
    case polling(status: String)           // Actively polling, current status
    case paid                              // Terminal state: Withdrawal completed successfully
    case failed(reason: String?)           // Terminal state: Withdrawal failed
    case pendingLongRunning(withdrawalId: String) // Polling exceeded limit, still PROCESSING/REQUESTED
    case operationFailed(error: String)    // Withdrawal operation failed

    static func == (lhs: WithdrawalState, rhs: WithdrawalState) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle): return true
        case (.submitted(let lhsId), .submitted(let rhsId)): return lhsId == rhsId
        case (.polling(let lhsStatus), .polling(let rhsStatus)): return lhsStatus == rhsStatus
        case (.paid, .paid): return true
        case (.failed(let lhsReason), .failed(let rhsReason)): return lhsReason == rhsReason
        case (.pendingLongRunning(let lhsId), .pendingLongRunning(let rhsId)): return lhsId == rhsId
        case (.operationFailed(let lhsErr), .operationFailed(let rhsErr)): return lhsErr == rhsErr
        default: return false
        }
    }
}

/// Domain model: Wallet
/// Internal representation (not DTO).
/// Converted from WalletResponseDTO in ViewModel init.
struct Wallet {
    let balanceCents: Int
    let ledgerEntries: [LedgerEntry]

    /// Format balance as USD currency string (display-only)
    var formattedBalance: String {
        let dollars = Double(balanceCents) / 100.0
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"
        return formatter.string(from: NSNumber(value: dollars)) ?? "$0.00"
    }
}

/// Domain model: WalletTransaction
/// Internal representation (not DTO).
/// Converted from WalletTransactionDTO in ViewModel.
struct WalletTransaction: Identifiable {
    let id: String
    let entryType: String
    let direction: String
    let amountCents: Int
    let referenceType: String
    let referenceId: String
    let description: String
    let createdAt: Date

    /// Format amount with sign and currency (display-only)
    var formattedAmount: String {
        let dollars = Double(amountCents) / 100.0
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"

        let sign = direction == "CREDIT" ? "+" : "−"
        let formatted = formatter.string(from: NSNumber(value: abs(dollars))) ?? "$0.00"
        return "\(sign)\(formatted)"
    }

    /// Human-readable timestamp (display-only)
    var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: createdAt)
    }

    /// Color for amount based on direction
    var amountColor: String {
        direction == "CREDIT" ? "green" : "red"
    }
}

/// Domain model: LedgerEntry
/// Internal representation (not DTO).
/// Converted from LedgerEntryDTO in ViewModel.
struct LedgerEntry: Identifiable {
    let id: UUID
    let amountCents: Int
    let direction: String // "CREDIT" or "DEBIT"
    let entryType: String
    let referenceType: String
    let referenceId: String?
    let createdAt: Date

    /// Format amount with sign based on direction (display-only)
    var formattedAmount: String {
        let dollars = Double(amountCents) / 100.0
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"

        let sign = direction == "CREDIT" ? "+" : "−"
        let formatted = formatter.string(from: NSNumber(value: abs(dollars))) ?? "$0.00"
        return "\(sign)\(formatted)"
    }

    /// Human-readable timestamp (display-only)
    var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: createdAt)
    }

    /// Emoji icon for entry type
    var icon: String {
        switch entryType {
        case "WALLET_DEPOSIT": return "💰"
        case "WALLET_DEBIT": return "🎯"
        case "REFERRAL_BONUS": return "🎁"
        default: return "📝"
        }
    }
}

/// ViewModel for Wallet feature.
/// Sole owner of wallet state and fetch operations.
/// All Service calls originate here.
/// Converts DTOs to Domain immediately upon receipt.
@MainActor
final class UserWalletViewModel: ObservableObject {

    // MARK: - Published State (Domain Models Only)

    /// Wallet state (contains balance and ledger entries).
    /// Nil if not yet fetched or fetch failed.
    @Published private(set) var wallet: Wallet? = nil

    /// Loading indicator for fetch operations.
    @Published private(set) var isLoading: Bool = false

    /// Error message (if fetch failed).
    @Published private(set) var errorMessage: String? = nil

    /// Loading indicator for deposit operations.
    @Published private(set) var isDepositing: Bool = false

    /// Loading indicator for withdrawal operations.
    @Published private(set) var isWithdrawing: Bool = false

    /// Stripe PaymentIntent client secret for deposit (set when fund succeeds).
    @Published private(set) var depositClientSecret: String? = nil

    /// Payment orchestration state (NEW architecture).
    @Published private(set) var paymentState: PaymentState = .idle

    /// Withdrawal state machine for polling and completion.
    @Published private(set) var withdrawalState: WithdrawalState = .idle

    /// Transaction history (fetched from backend).
    @Published private(set) var transactions: [WalletTransaction] = []

    /// Loading indicator for transaction fetch operations.
    @Published private(set) var isLoadingTransactions: Bool = false

    /// Error message for transaction fetch failures.
    @Published private(set) var transactionError: String? = nil

    /// Computed formatted balance (display-only, no math).
    var displayBalance: String {
        guard let wallet = wallet else { return "$0.00" }
        return wallet.formattedBalance
    }

    /// Computed ledger entries from domain wallet.
    var displayLedger: [LedgerEntry] {
        wallet?.ledgerEntries ?? []
    }

    /// Computed transaction history from domain transactions.
    /// Backend refactored to return transactions via separate endpoint.
    var displayTransactions: [WalletTransaction] {
        transactions
    }

    // MARK: - Dependencies

    private let walletService: WalletFetching
    private let authService: AuthService

    // MARK: - Load Guard

    private var hasLoaded = false

    // MARK: - Polling Task

    private var pollingTask: Task<Void, Never>?

    /// Track the most recent withdrawal ID for background reconciliation.
    private var lastWithdrawalId: String?

    // MARK: - Initialization

    init(walletService: WalletFetching? = nil, authService: AuthService = .shared) {
        self.authService = authService
        // If no service provided, create one with the auth service
        self.walletService = walletService ?? WalletService(authService: authService)
    }

    // MARK: - Public Actions

    /// Fetch wallet from backend and convert DTO → Domain.
    /// CRITICAL: DTOs unmarshalled → Domain models immediately.
    /// No DTOs in @Published state.
    func fetchWallet() async {
        // Guard against duplicate initial load
        guard !hasLoaded || isLoading == false else {
            print("[UserWalletViewModel] Fetch already in progress or already loaded, skipping duplicate")
            return
        }

        hasLoaded = true

        // Set loading flag immediately to prevent race conditions
        await MainActor.run {
            self.isLoading = true
            self.errorMessage = nil
        }
        defer {
            Task { @MainActor in
                self.isLoading = false
            }
        }

        print("[UserWalletViewModel] fetchWallet() ENTERED")

        // Guard that user is authenticated
        guard let userId = authService.currentUser?.id else {
            print("[UserWalletViewModel] No authenticated user - cannot fetch wallet")
            await MainActor.run {
                self.errorMessage = "Please sign in to view your wallet"
            }
            return
        }

        print("[UserWalletViewModel] Fetching wallet for userId: \(userId.uuidString)")

        do {
            let dto = try await walletService.fetchWallet()

            // Convert DTO to Domain immediately
            let domainWallet = convertDTOToDomain(dto)

            await MainActor.run {
                print("[UserWalletViewModel] Wallet fetch succeeded: balance=\(domainWallet.balanceCents)¢")
                self.wallet = domainWallet
                self.errorMessage = nil
            }
        } catch APIError.unauthorized {
            // STAGING NOTE: Backend may return 401 if user has no wallet yet.
            // Treat as "no wallet exists" and display $0.00 while backend alignment pending.
            // In production, backend should return 404 or { balance_cents: 0 } for new users.
            await MainActor.run {
                print("[UserWalletViewModel] Fetch failed: 401 (treating as no wallet)")
                self.wallet = Wallet(balanceCents: 0, ledgerEntries: [])
                self.errorMessage = nil
            }
        } catch APIError.notFound {
            // 404 — treat as "no wallet" (display $0.00)
            await MainActor.run {
                print("[UserWalletViewModel] Fetch failed: 404 (no wallet)")
                self.wallet = Wallet(balanceCents: 0, ledgerEntries: [])
                self.errorMessage = nil
            }
        } catch {
            await MainActor.run {
                print("[UserWalletViewModel] Fetch failed: \(error)")
                self.errorMessage = error.localizedDescription
                // On error, wallet remains nil → UI shows $0.00
            }
        }
    }

    /// Refresh wallet (idempotent).
    func refreshBalance() async {
        print("[UserWalletViewModel] refreshBalance() called")
        await fetchWallet()
    }

    /// Fetch transaction history from backend.
    func fetchTransactions(limit: Int = 50, offset: Int = 0) async {
        print("[UserWalletViewModel] fetchTransactions() ENTERED")

        await MainActor.run {
            self.isLoadingTransactions = true
            self.transactionError = nil
        }
        defer {
            Task { @MainActor in
                self.isLoadingTransactions = false
            }
        }

        // Guard that user is authenticated
        guard let _ = authService.currentUser?.id else {
            print("[UserWalletViewModel] No authenticated user - cannot fetch transactions")
            await MainActor.run {
                self.transactionError = "Please sign in to view transactions"
            }
            return
        }

        do {
            let dto = try await walletService.fetchTransactions(limit: limit, offset: offset)

            // Convert DTOs to Domain immediately
            let domainTransactions = dto.transactions.map { txnDTO -> WalletTransaction in
                convertTransactionDTOToDomain(txnDTO)
            }

            await MainActor.run {
                print("[UserWalletViewModel] Transactions fetch succeeded: count=\(domainTransactions.count)")
                self.transactions = domainTransactions
                self.transactionError = nil
            }
        } catch {
            await MainActor.run {
                print("[UserWalletViewModel] Transactions fetch failed: \(error)")
                self.transactionError = error.localizedDescription
            }
        }
    }

    /// Clear error message.
    func clearError() {
        errorMessage = nil
    }

    /// Initiate wallet deposit: create PaymentIntent, transition to .ready state.
    /// View listens to paymentState and presents PaymentSheet when ready.
    func depositFunds(amountCents: Int) async {
        print("[UserWalletViewModel] depositFunds(\(amountCents) cents)")

        guard let _ = authService.currentUser?.id else {
            await MainActor.run {
                self.errorMessage = "Please sign in to deposit funds"
            }
            return
        }

        await MainActor.run {
            self.paymentState = .creatingIntent
            self.errorMessage = nil
        }

        do {
            let idempotencyKey = UUID().uuidString

            let fundResponse = try await walletService.fundWallet(
                amountCents: amountCents,
                idempotencyKey: idempotencyKey
            )

            await MainActor.run {
                print("[UserWalletViewModel] PaymentIntent created: \(fundResponse.client_secret.prefix(20))...")
                self.paymentState = .ready(clientSecret: fundResponse.client_secret)
            }
        } catch APIError.validationError(let message) {
            await MainActor.run {
                self.paymentState = .failure(error: message)
                self.errorMessage = message
            }
        } catch APIError.unauthorized {
            await MainActor.run {
                self.paymentState = .failure(error: "Authentication required")
                self.errorMessage = "Please sign in to deposit funds"
            }
        } catch {
            await MainActor.run {
                let errorMsg = error.localizedDescription
                self.paymentState = .failure(error: errorMsg)
                self.errorMessage = errorMsg
                print("[UserWalletViewModel] Deposit failed: \(error)")
            }
        }
    }

    /// Called when PaymentSheet is presented.
    /// Transitions state to processing to reflect payment in flight.
    func onPaymentProcessing() {
        if case .ready = paymentState {
            paymentState = .processing
            print("[UserWalletViewModel] onPaymentProcessing()")
        }
    }

    /// Called when user successfully completes payment.
    /// Refreshes wallet balance (ledger should now include CREDIT from webhook).
    func onPaymentCompleted() async {
        print("[UserWalletViewModel] onPaymentCompleted()")
        await MainActor.run {
            self.paymentState = .success
        }
        await fetchWallet()
    }

    /// Called when user cancels payment.
    /// Returns to idle state without error.
    func onPaymentCancelled() {
        print("[UserWalletViewModel] onPaymentCancelled()")
        self.paymentState = .idle
    }

    /// Called by View when payment is cancelled or fails.
    func onPaymentFailed(error: String) {
        print("[UserWalletViewModel] onPaymentFailed(\(error))")
        self.paymentState = .failure(error: error)
        self.errorMessage = error
    }

    /// Called by View to dismiss payment sheet and reset state.
    func dismissPaymentSheet() {
        print("[UserWalletViewModel] dismissPaymentSheet()")
        self.paymentState = .idle
    }

    /// Determine polling interval based on elapsed time (adaptive polling).
    /// - 0–10s → every 2s (worker may process quickly)
    /// - 10–30s → every 5s (check regularly)
    /// - 30–90s → every 10s (worker cycle is ~30s, space out requests)
    private func pollIntervalSeconds(elapsedSeconds: Int) -> UInt64 {
        if elapsedSeconds < 10 {
            return 2
        } else if elapsedSeconds < 30 {
            return 5
        } else {
            return 10
        }
    }

    /// Poll withdrawal status with adaptive intervals until terminal state or timeout.
    /// Worker runs every ~30s, so poll for up to 90 seconds to catch the next cycle.
    /// - Parameter withdrawalId: UUID of the withdrawal to poll
    private func pollWithdrawalStatus(withdrawalId: String) async {
        print("[UserWalletViewModel] Starting polling for withdrawal \(withdrawalId)")

        // Cancel any existing polling task
        pollingTask?.cancel()

        let maxPollDurationSeconds: Int = 90  // Allow time for multiple worker cycles (~30s each)
        let startTime = Date()

        pollingTask = Task {
            var isTerminal = false

            while !Task.isCancelled && !isTerminal {
                let elapsedSeconds = Int(Date().timeIntervalSince(startTime))

                // Check if we've exceeded max polling duration
                if elapsedSeconds > maxPollDurationSeconds {
                    print("[UserWalletViewModel] Polling timeout after \(elapsedSeconds)s, switching to long-running state")
                    await MainActor.run {
                        self.withdrawalState = .pendingLongRunning(withdrawalId: withdrawalId)
                        self.errorMessage = "Withdrawal is processing. You'll be notified when complete."
                    }
                    break
                }

                do {
                    // Fetch current status
                    let statusDTO = try await walletService.fetchWithdrawalStatus(withdrawalId: withdrawalId)

                    print("[UserWalletViewModel] Withdrawal status: \(statusDTO.status), elapsed: \(elapsedSeconds)s")

                    // Check if terminal state reached before updating UI
                    let isTerminalStatus = statusDTO.status == "PAID" || statusDTO.status == "FAILED"

                    await MainActor.run {
                        // Update polling state with user-friendly status
                        let userFriendlyStatus = self.statusToUserMessage(statusDTO.status)
                        self.withdrawalState = .polling(status: userFriendlyStatus)
                    }

                    // Handle terminal states
                    if statusDTO.status == "PAID" {
                        print("[UserWalletViewModel] Withdrawal completed successfully")
                        await MainActor.run {
                            self.withdrawalState = .paid
                            self.errorMessage = nil
                        }
                        // Refresh wallet OUTSIDE MainActor.run to avoid double-hop
                        await self.fetchWallet()
                        isTerminal = true
                    } else if statusDTO.status == "FAILED" {
                        print("[UserWalletViewModel] Withdrawal failed")
                        let failureReason = statusDTO.failure_reason ?? "Complete payout setup to enable withdrawals"
                        await MainActor.run {
                            self.withdrawalState = .failed(reason: statusDTO.failure_reason)
                            self.errorMessage = failureReason
                        }
                        // Refresh wallet OUTSIDE MainActor.run to avoid double-hop
                        await self.fetchWallet()
                        isTerminal = true
                    }

                    if isTerminal {
                        break
                    }

                    // Adaptive polling interval based on elapsed time
                    let interval = pollIntervalSeconds(elapsedSeconds: elapsedSeconds)
                    print("[UserWalletViewModel] Next poll in \(interval)s")
                    try await Task.sleep(nanoseconds: interval * 1_000_000_000)
                } catch {
                    print("[UserWalletViewModel] Polling error: \(error)")
                    // Continue polling even on error, with longer backoff
                    let interval = pollIntervalSeconds(elapsedSeconds: elapsedSeconds)
                    try? await Task.sleep(nanoseconds: interval * 1_000_000_000)
                }
            }
        }
    }

    /// Convert withdrawal status to user-friendly message.
    private func statusToUserMessage(_ status: String) -> String {
        switch status {
        case "REQUESTED":
            return "Submitting withdrawal…"
        case "PROCESSING":
            return "Processing withdrawal…"
        case "PAID":
            return "Withdrawal completed"
        case "FAILED":
            return "Withdrawal failed"
        case "CANCELLED":
            return "Withdrawal cancelled"
        default:
            return status
        }
    }

    /// Cancel withdrawal polling (called when dismissing sheet prematurely).
    func cancelWithdrawalPolling() {
        print("[UserWalletViewModel] Cancelling withdrawal polling")
        pollingTask?.cancel()
        pollingTask = nil
    }

    /// Reset withdrawal state for next withdrawal attempt.
    /// Called when closing the withdrawal sheet.
    func resetWithdrawalState() {
        print("[UserWalletViewModel] Resetting withdrawal state")
        withdrawalState = .idle
        pollingTask?.cancel()
        pollingTask = nil
    }

    /// Check for pending long-running withdrawal and resume polling if needed.
    /// Called when wallet screen appears (background reconciliation).
    func reconcilePendingWithdrawal() async {
        guard let withdrawalId = lastWithdrawalId else {
            print("[UserWalletViewModel] No pending withdrawal to reconcile")
            return
        }

        // Only reconcile if we're in long-running state
        if case .pendingLongRunning = withdrawalState {
            print("[UserWalletViewModel] Resuming polling for pending withdrawal: \(withdrawalId)")
            await pollWithdrawalStatus(withdrawalId: withdrawalId)
        }
    }

    /// Withdraw funds from wallet.
    /// - Parameter amountCents: Amount to withdraw in cents
    func withdraw(amountCents: Int) async {
        print("[UserWalletViewModel] withdraw(\(amountCents) cents)")

        guard let userId = authService.currentUser?.id else {
            errorMessage = "Please sign in to withdraw funds"
            return
        }

        isWithdrawing = true
        errorMessage = nil

        do {
            // Generate unique idempotency key for this withdrawal request
            let idempotencyKey = UUID().uuidString

            let withdrawResponse = try await walletService.withdrawFunds(
                amountCents: amountCents,
                method: "standard",
                idempotencyKey: idempotencyKey
            )

            await MainActor.run {
                print("[UserWalletViewModel] Withdrawal submitted: \(withdrawResponse.withdrawal_id), status=\(withdrawResponse.status)")
                self.lastWithdrawalId = withdrawResponse.withdrawal_id
                self.withdrawalState = .submitted(withdrawalId: withdrawResponse.withdrawal_id)
                self.isWithdrawing = false
                self.errorMessage = nil
            }

            // Start polling for terminal status
            await pollWithdrawalStatus(withdrawalId: withdrawResponse.withdrawal_id)
        } catch APIError.stripeAccountRequired {
            await MainActor.run {
                self.withdrawalState = .operationFailed(error: "Stripe account not connected")
                self.errorMessage = "Stripe account not connected. Please complete Stripe onboarding to enable withdrawals."
                self.isWithdrawing = false
            }
        } catch APIError.stripeAccountIncomplete {
            await MainActor.run {
                self.withdrawalState = .operationFailed(error: "Stripe account setup incomplete")
                self.errorMessage = "Stripe account setup incomplete. Please complete onboarding to enable withdrawals."
                self.isWithdrawing = false
            }
        } catch APIError.insufficientFunds {
            await MainActor.run {
                self.withdrawalState = .operationFailed(error: "Insufficient funds")
                self.errorMessage = "Insufficient wallet funds"
                self.isWithdrawing = false
            }
        } catch APIError.validationError(let message) {
            await MainActor.run {
                self.withdrawalState = .operationFailed(error: message)
                self.errorMessage = message
                self.isWithdrawing = false
            }
        } catch APIError.unauthorized {
            await MainActor.run {
                self.withdrawalState = .operationFailed(error: "Unauthorized")
                self.errorMessage = "Please sign in to withdraw funds"
                self.isWithdrawing = false
            }
        } catch {
            await MainActor.run {
                print("[UserWalletViewModel] Withdrawal failed: \(error)")
                self.withdrawalState = .operationFailed(error: error.localizedDescription)
                self.errorMessage = error.localizedDescription
                self.isWithdrawing = false
            }
        }
    }

    /// Clear deposit client secret (after payment sheet completes).
    func clearDepositClientSecret() {
        depositClientSecret = nil
    }

    // MARK: - Private Helpers

    /// Convert WalletResponseDTO to Domain models.
    /// This is the ONLY place DTOs are converted to Domain.
    private func convertDTOToDomain(_ dto: WalletResponseDTO) -> Wallet {
        let ledgerEntries = (dto.ledger ?? []).map { ledgerDTO in
            convertLedgerDTOToDomain(ledgerDTO)
        }
        return Wallet(balanceCents: dto.balance_cents, ledgerEntries: ledgerEntries)
    }

    /// Convert LedgerEntryDTO to Domain LedgerEntry.
    private func convertLedgerDTOToDomain(_ dto: LedgerEntryDTO) -> LedgerEntry {
        let date = ISO8601DateFormatter().date(from: dto.created_at) ?? Date()
        return LedgerEntry(
            id: dto.id,
            amountCents: dto.amount_cents,
            direction: dto.direction,
            entryType: dto.entry_type,
            referenceType: dto.reference_type,
            referenceId: dto.reference_id,
            createdAt: date
        )
    }

    /// Convert WalletTransactionDTO to Domain WalletTransaction.
    private func convertTransactionDTOToDomain(_ dto: WalletTransactionDTO) -> WalletTransaction {
        let date = ISO8601DateFormatter().date(from: dto.created_at) ?? Date()
        return WalletTransaction(
            id: dto.id,
            entryType: dto.entry_type,
            direction: dto.direction,
            amountCents: dto.amount_cents,
            referenceType: dto.reference_type,
            referenceId: dto.reference_id,
            description: dto.description,
            createdAt: date
        )
    }
}

// MARK: - WalletRefreshing Conformance

extension UserWalletViewModel: WalletRefreshing {
    func refreshWallet() async {
        await refreshBalance()
    }
}
