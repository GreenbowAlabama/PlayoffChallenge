//
//  WalletDetailView.swift
//  PlayoffChallenge
//
//  Detail view for wallet balance and transaction history.
//  Displays balance at top and list of ledger entries.
//  Supports pull-to-refresh for updating balance.
//

import SwiftUI
import Core

struct WalletDetailView: View {
    @ObservedObject var viewModel: UserWalletViewModel
    @EnvironmentObject var stripeConnectVM: StripeConnectViewModel
    @Environment(\.dismiss) var dismiss

    @State private var showDepositSheet = false
    @State private var showWithdrawSheet = false
    @State private var showOnboardingSheet = false
    @State private var depositAmount: String = "10.00"
    @State private var withdrawAmount: String = ""

    var body: some View {
        VStack(spacing: 0) {
            // Header: Balance
            walletBalanceHeaderView
                .padding(.vertical, DesignTokens.Spacing.xl)
                .padding(.horizontal, DesignTokens.Spacing.lg)

            // Action buttons
            walletActionButtonsView
                .padding(.vertical, DesignTokens.Spacing.md)
                .padding(.horizontal, DesignTokens.Spacing.lg)
                .background(Color(.systemGray6))

            // Ledger: Transaction list
            if viewModel.displayTransactions.isEmpty {
                emptyLedgerView
            } else {
                ledgerListView
            }

            // Error banner
            if let errorMessage = viewModel.errorMessage {
                VStack {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundColor(.red)
                        .padding(DesignTokens.Spacing.md)
                }
                .frame(maxWidth: .infinity)
                .background(Color(.systemRed).opacity(0.1))
            }
        }
        .navigationTitle("Wallet")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                refreshButton
            }
        }
        .refreshable {
            print("[WalletDetailView] Pull-to-refresh triggered")
            await viewModel.refreshBalance()
            // Also refresh transactions when pulling to refresh
            await viewModel.fetchTransactions()
        }
        .sheet(isPresented: $showDepositSheet) {
            depositSheet
        }
        .sheet(isPresented: $showWithdrawSheet) {
            withdrawSheet
        }
        .onChange(of: stripeConnectVM.onboardingURL) { _, newURL in
            if newURL != nil {
                showOnboardingSheet = true
            }
        }
        .sheet(isPresented: $showOnboardingSheet) {
            if let urlString = stripeConnectVM.onboardingURL,
               let url = URL(string: urlString) {

                SafariViewController(url: url) {
                    Task {
                        await stripeConnectVM.refreshStatus()
                    }
                }
                .ignoresSafeArea()

            } else {
                VStack {
                    ProgressView()
                    Text("Loading Stripe setup...")
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task {
            print("[WalletDetailView] View appeared, loading wallet data")
            await viewModel.fetchWallet()
            // Fetch transactions after balance loads
            await viewModel.fetchTransactions()
            // Check Stripe Connect status
            await stripeConnectVM.checkStatus()
            // Background reconciliation: Resume polling if there's a pending long-running withdrawal
            await viewModel.reconcilePendingWithdrawal()
        }
    }

    // MARK: - Subviews

    @ViewBuilder
    private var walletActionButtonsView: some View {
        VStack(spacing: DesignTokens.Spacing.md) {
            HStack(spacing: DesignTokens.Spacing.md) {
                // Add Funds button
                Button(action: {
                    print("[WalletDetailView] Add Funds button tapped")
                    showDepositSheet = true
                }) {
                    HStack {
                        Image(systemName: "plus.circle.fill")
                        Text("Add Funds")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(DesignTokens.Spacing.md)
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(DesignTokens.Radius.md)
                }
                .disabled(viewModel.isDepositing || viewModel.isWithdrawing || stripeConnectVM.isLoading)

                // Withdraw or Connect button (depends on Stripe status)
                if stripeConnectVM.shouldShowConnectButton {
                    Button(action: {
                        print("[WalletDetailView] Connect Bank Account button tapped")
                        Task {
                            await stripeConnectVM.initiateOnboarding()
                        }
                    }) {
                        HStack {
                            Image(systemName: "link.badge.plus")
                            Text("Connect Bank")
                        }
                        .frame(maxWidth: .infinity)
                        .padding(DesignTokens.Spacing.md)
                        .background(Color.green)
                        .foregroundColor(.white)
                        .cornerRadius(DesignTokens.Radius.md)
                    }
                    .disabled(stripeConnectVM.isLoading)
                } else if stripeConnectVM.isReadyForWithdrawal {
                    Button(action: {
                        print("[WalletDetailView] Withdraw button tapped")
                        showWithdrawSheet = true
                    }) {
                        HStack {
                            Image(systemName: "arrow.up.circle.fill")
                            Text("Withdraw")
                        }
                        .frame(maxWidth: .infinity)
                        .padding(DesignTokens.Spacing.md)
                        .background(Color.orange)
                        .foregroundColor(.white)
                        .cornerRadius(DesignTokens.Radius.md)
                    }
                    .disabled(viewModel.isWithdrawing || viewModel.isDepositing)
                }
            }

            // Show incomplete banner if account setup incomplete
            if stripeConnectVM.shouldShowIncompleteBanner {
                VStack(spacing: DesignTokens.Spacing.sm) {
                    Text("Complete your Stripe setup to enable withdrawals")
                        .font(.subheadline)
                        .foregroundColor(.orange)

                    Button(action: {
                        print("[WalletDetailView] Continue Setup button tapped")
                        Task {
                            await stripeConnectVM.initiateOnboarding()
                        }
                    }) {
                        Text("Continue Setup")
                            .frame(maxWidth: .infinity)
                            .padding(DesignTokens.Spacing.sm)
                            .background(Color.orange)
                            .foregroundColor(.white)
                            .cornerRadius(DesignTokens.Radius.sm)
                    }
                }
                .padding(DesignTokens.Spacing.md)
                .background(Color.orange.opacity(0.1))
                .cornerRadius(DesignTokens.Radius.md)
            }
        }
    }

    @ViewBuilder
    private var depositSheet: some View {
        NavigationStack {
            VStack(spacing: DesignTokens.Spacing.lg) {
                Text("Add Funds to Wallet")
                    .font(.headline)
                    .padding(.top, DesignTokens.Spacing.lg)

                VStack(spacing: DesignTokens.Spacing.md) {
                    ForEach(["5.00", "10.00", "25.00", "50.00", "100.00", "500.00"], id: \.self) { amount in
                        Button {
                            depositAmount = amount
                        } label: {
                            Text("$\(amount)")
                                .frame(maxWidth: .infinity)
                                .padding(DesignTokens.Spacing.md)
                                .background(depositAmount == amount ? Color.blue : Color(.systemGray5))
                                .foregroundColor(depositAmount == amount ? .white : .primary)
                                .cornerRadius(DesignTokens.Radius.md)
                        }
                    }
                }

                Spacer()

                switch viewModel.paymentState {
                case .creatingIntent:
                    VStack(spacing: DesignTokens.Spacing.sm) {
                        ProgressView()
                        Text("Creating payment...")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.bottom, DesignTokens.Spacing.lg)

                case .ready:
                    VStack(spacing: DesignTokens.Spacing.sm) {
                        ProgressView()
                        Text("Opening payment sheet...")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.bottom, DesignTokens.Spacing.lg)

                case .processing:
                    VStack(spacing: DesignTokens.Spacing.sm) {
                        ProgressView()
                        Text("Processing payment...")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.bottom, DesignTokens.Spacing.lg)

                default:
                    EmptyView()
                }

                Button {
                    let cents = Int((Double(depositAmount) ?? 0) * 100)
                    Task { await viewModel.depositFunds(amountCents: cents) }
                } label: {
                    Text("Proceed to Payment")
                        .frame(maxWidth: .infinity)
                        .padding(DesignTokens.Spacing.md)
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(DesignTokens.Radius.md)
                }
                .disabled({
                    switch viewModel.paymentState {
                    case .creatingIntent, .ready, .processing:
                        return true
                    default:
                        return false
                    }
                }())

                if let error = viewModel.errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                        .padding(.top, DesignTokens.Spacing.sm)
                }
            }
            .padding(DesignTokens.Spacing.lg)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Close") {
                        showDepositSheet = false
                        viewModel.dismissPaymentSheet()
                    }
                }
            }
            .onChange(of: viewModel.paymentState) { _, newState in
                if case .success = newState {
                    print("[WalletDetailView] Payment successful, closing deposit sheet")
                    showDepositSheet = false
                    viewModel.dismissPaymentSheet()
                }
            }
        }
        .withPaymentSheet(viewModel: viewModel)
    }

    @ViewBuilder
    private var withdrawSheet: some View {
        NavigationStack {
            VStack(spacing: DesignTokens.Spacing.lg) {
                // Title and result rendering
                switch viewModel.withdrawalState {
                case .idle, .submitted, .polling:
                    Text("Withdraw from Wallet")
                        .font(.headline)
                        .padding(.top, DesignTokens.Spacing.lg)

                case .paid:
                    VStack(spacing: DesignTokens.Spacing.md) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 48))
                            .foregroundColor(.green)
                        Text("Withdrawal Completed")
                            .font(.headline)
                            .foregroundColor(.green)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, DesignTokens.Spacing.lg)

                case .failed(let reason):
                    VStack(spacing: DesignTokens.Spacing.sm) {
                        Image(systemName: "exclamation.circle.fill")
                            .font(.system(size: 48))
                            .foregroundColor(.red)
                        Text("Withdrawal Failed")
                            .font(.headline)
                            .foregroundColor(.red)

                        // Show failure reason directly
                        Text(reason ?? "Complete payout setup to enable withdrawals")
                            .font(.caption)
                            .foregroundColor(.red)
                            .lineLimit(nil)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, DesignTokens.Spacing.lg)

                case .pendingLongRunning:
                    Text("Processing Withdrawal")
                        .font(.headline)
                        .foregroundColor(.blue)
                        .padding(.top, DesignTokens.Spacing.lg)

                case .operationFailed:
                    Text("Withdrawal Failed")
                        .font(.headline)
                        .foregroundColor(.red)
                        .padding(.top, DesignTokens.Spacing.lg)
                }

                // Display current balance
                if case .idle = viewModel.withdrawalState {
                    VStack(spacing: DesignTokens.Spacing.xs) {
                        Text("Available Balance")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text(viewModel.displayBalance)
                            .font(.title2)
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(DesignTokens.Spacing.md)
                    .background(Color(.systemGray6))
                    .cornerRadius(DesignTokens.Radius.md)
                }

                // Amount input (only during idle state)
                if case .idle = viewModel.withdrawalState {
                    VStack(spacing: DesignTokens.Spacing.sm) {
                        Text("Withdrawal Amount")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        HStack {
                            Text("$")
                                .font(.body)
                            TextField("0.00", text: $withdrawAmount)
                                .keyboardType(.decimalPad)
                                .font(.body)
                        }
                        .padding(DesignTokens.Spacing.md)
                        .background(Color(.systemGray6))
                        .cornerRadius(DesignTokens.Radius.md)
                    }
                }

                Spacer()

                // Status indicator during polling
                if case .submitted = viewModel.withdrawalState {
                    VStack(spacing: DesignTokens.Spacing.sm) {
                        ProgressView()
                        Text("Submitting withdrawal…")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                } else if case .polling(let status) = viewModel.withdrawalState {
                    VStack(spacing: DesignTokens.Spacing.sm) {
                        ProgressView()
                        Text(status)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                } else if case .pendingLongRunning = viewModel.withdrawalState {
                    VStack(spacing: DesignTokens.Spacing.sm) {
                        ProgressView()
                        Text("Withdrawal is processing…")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text("(may take a few minutes)")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }

                // Action button
                switch viewModel.withdrawalState {
                case .idle:
                    Button(action: {
                        let cents = Int((Double(withdrawAmount) ?? 0) * 100)
                        Task {
                            await viewModel.withdraw(amountCents: cents)
                        }
                    }) {
                        Text("Withdraw")
                            .frame(maxWidth: .infinity)
                            .padding(DesignTokens.Spacing.md)
                            .background(Color.orange)
                            .foregroundColor(.white)
                            .cornerRadius(DesignTokens.Radius.md)
                    }
                    .disabled(viewModel.isWithdrawing)

                case .submitted, .polling, .pendingLongRunning:
                    // No action button during processing
                    EmptyView()

                case .paid, .failed, .operationFailed:
                    Button(action: { showWithdrawSheet = false }) {
                        Text("Done")
                            .frame(maxWidth: .infinity)
                            .padding(DesignTokens.Spacing.md)
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(DesignTokens.Radius.md)
                    }
                }

                // Error/Status message
                if let message = viewModel.errorMessage {
                    VStack(spacing: DesignTokens.Spacing.xs) {
                        Text(message)
                            .font(.caption)
                            .foregroundColor(messageColor(for: viewModel.withdrawalState))
                            .lineLimit(nil)
                            .multilineTextAlignment(.center)
                    }
                }
            }
            .padding(DesignTokens.Spacing.lg)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Close") {
                        viewModel.resetWithdrawalState()
                        showWithdrawSheet = false
                    }
                }
            }
            .onChange(of: viewModel.withdrawalState) { _, newState in
                // Auto-close on success after a short delay
                if case .paid = newState {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                        showWithdrawSheet = false
                    }
                }
                // Don't auto-close on failure, long-running, or operation failed
                // Let user read the message and dismiss manually
            }
        }
    }

    @ViewBuilder
    private var walletBalanceHeaderView: some View {
        VStack(spacing: DesignTokens.Spacing.md) {
            Text("Wallet Balance")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Text(viewModel.displayBalance)
                .font(.system(size: 42, weight: .bold, design: .default))
                .foregroundColor(.primary)

            if viewModel.isLoading {
                ProgressView()
                    .scaleEffect(0.9)
            }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var refreshButton: some View {
        Button(action: {
            print("[WalletDetailView] Refresh button tapped")
            Task {
                await viewModel.refreshBalance()
            }
        }) {
            if viewModel.isLoading {
                ProgressView()
                    .scaleEffect(0.8)
            } else {
                Image(systemName: "arrow.clockwise")
                    .foregroundColor(.blue)
            }
        }
    }

    @ViewBuilder
    private var emptyLedgerView: some View {
        VStack(spacing: DesignTokens.Spacing.md) {
            Image(systemName: "list.bullet.below.rectangle")
                .font(.system(size: 40))
                .foregroundColor(.gray)

            Text("No Transactions Yet")
                .font(.headline)
                .foregroundColor(.primary)

            Text("Your wallet transactions will appear here.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(DesignTokens.Spacing.xl)
    }

    @ViewBuilder
    private var ledgerListView: some View {
        List {
            Section(header: Text("Transactions")) {
                ForEach(viewModel.displayTransactions) { transaction in
                    transactionRowView(transaction)
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    @ViewBuilder
    private func ledgerRowView(_ entry: LedgerEntry) -> some View {
        HStack(spacing: DesignTokens.Spacing.md) {
            // Icon
            Text(entry.icon)
                .font(.title3)

            // Description & date
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                Text(entry.entryType)
                    .font(.body)
                    .fontWeight(.medium)

                Text(entry.formattedDate)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // Amount (sign-formatted, color-coded)
            Text(entry.formattedAmount)
                .font(.body)
                .fontWeight(.semibold)
                .foregroundColor(entry.direction == "CREDIT" ? .green : .red)
        }
        .padding(.vertical, DesignTokens.Spacing.xs)
    }

    private func messageColor(for state: WithdrawalState) -> Color {
        switch state {
        case .paid:
            return .green
        case .failed, .operationFailed:
            return .red
        default:
            return .primary
        }
    }

    @ViewBuilder
    private func transactionRowView(_ transaction: WalletTransaction) -> some View {
        HStack(spacing: DesignTokens.Spacing.md) {
            // Icon based on direction
            Text(transaction.direction == "CREDIT" ? "💰" : "🎯")
                .font(.title3)

            // Description & date
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                Text(transaction.description)
                    .font(.body)
                    .fontWeight(.medium)

                Text(transaction.formattedDate)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // Amount (sign-formatted, color-coded)
            Text(transaction.formattedAmount)
                .font(.body)
                .fontWeight(.semibold)
                .foregroundColor(transaction.direction == "CREDIT" ? .green : .red)
        }
        .padding(.vertical, DesignTokens.Spacing.xs)
    }
}

// MARK: - Preview

#Preview("Wallet Detail - Loading") {
    NavigationStack {
        WalletDetailView(viewModel: UserWalletViewModel(walletService: MockWalletService()))
    }
}

// MARK: - Mock Service for Previews

class MockWalletService: WalletFetching {
    func fetchWallet() async throws -> WalletResponseDTO {
        return WalletResponseDTO(balance_cents: 50000, ledger: nil)
    }

    func fundWallet(amountCents: Int, idempotencyKey: String) async throws -> WalletFundResponseDTO {
        return WalletFundResponseDTO(client_secret: "pi_mock_\(UUID().uuidString)", amount_cents: amountCents)
    }

    func withdrawFunds(amountCents: Int, method: String, idempotencyKey: String) async throws -> WalletWithdrawResponseDTO {
        return WalletWithdrawResponseDTO(withdrawal_id: UUID().uuidString, status: "PROCESSING", amount_cents: amountCents)
    }

    func fetchWithdrawalStatus(withdrawalId: String) async throws -> WithdrawalStatusDTO {
        // Simulate polling: return PROCESSING first time, PAID on second check
        let isPaid = Bool.random()
        return WithdrawalStatusDTO(
            id: withdrawalId,
            amount_cents: 50000,
            instant_fee_cents: 250,
            method: "standard",
            status: isPaid ? "PAID" : "PROCESSING",
            failure_reason: nil,
            processed_at: isPaid ? ISO8601DateFormatter().string(from: Date()) : nil,
            requested_at: ISO8601DateFormatter().string(from: Date())
        )
    }

    func fetchTransactions(limit: Int, offset: Int) async throws -> WalletTransactionsResponseDTO {
        let mockTransactions = [
            WalletTransactionDTO(
                id: UUID().uuidString,
                entry_type: "CONTEST_DEBIT",
                direction: "DEBIT",
                amount_cents: 2500,
                reference_type: "CONTEST",
                reference_id: UUID().uuidString,
                description: "Entry fee - PGA Tournament",
                created_at: ISO8601DateFormatter().string(from: Date())
            )
        ]
        return WalletTransactionsResponseDTO(transactions: mockTransactions, total_count: 1)
    }
}
