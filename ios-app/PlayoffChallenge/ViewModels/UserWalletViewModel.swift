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

    // MARK: - Dependencies

    private let walletService: WalletFetching
    private let authService: AuthService

    // MARK: - Load Guard

    private var hasLoaded = false

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
                print("[UserWalletViewModel] Withdrawal succeeded: \(withdrawResponse.withdrawal_id), status=\(withdrawResponse.status)")
                self.isWithdrawing = false
            }

            // Refresh wallet to reflect deducted balance
            await fetchWallet()
        } catch APIError.insufficientFunds {
            await MainActor.run {
                self.errorMessage = "Insufficient wallet funds"
                self.isWithdrawing = false
            }
        } catch APIError.validationError(let message) {
            await MainActor.run {
                self.errorMessage = message
                self.isWithdrawing = false
            }
        } catch APIError.unauthorized {
            await MainActor.run {
                self.errorMessage = "Please sign in to withdraw funds"
                self.isWithdrawing = false
            }
        } catch {
            await MainActor.run {
                print("[UserWalletViewModel] Withdrawal failed: \(error)")
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
