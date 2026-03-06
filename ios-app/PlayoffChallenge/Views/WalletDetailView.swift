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
    @Environment(\.dismiss) var dismiss

    @State private var showDepositSheet = false
    @State private var showWithdrawSheet = false
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
            if viewModel.displayLedger.isEmpty {
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
        }
        .sheet(isPresented: $showDepositSheet) {
            depositSheet
        }
        .sheet(isPresented: $showWithdrawSheet) {
            withdrawSheet
        }
        .task {
            print("[WalletDetailView] View appeared, loading wallet data")
            await viewModel.fetchWallet()
        }
    }

    // MARK: - Subviews

    @ViewBuilder
    private var walletActionButtonsView: some View {
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
            .disabled(viewModel.isDepositing || viewModel.isWithdrawing)

            // Withdraw button
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

    @ViewBuilder
    private var depositSheet: some View {
        NavigationStack {
            VStack(spacing: DesignTokens.Spacing.lg) {
                Text("Add Funds to Wallet")
                    .font(.headline)
                    .padding(.top, DesignTokens.Spacing.lg)

                VStack(spacing: DesignTokens.Spacing.md) {
                    ForEach(["5.00", "10.00", "25.00", "50.00"], id: \.self) { amount in
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
                Text("Withdraw from Wallet")
                    .font(.headline)
                    .padding(.top, DesignTokens.Spacing.lg)

                // Display current balance
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

                // Amount input
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

                Spacer()

                // Action button
                if viewModel.isWithdrawing {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(DesignTokens.Spacing.lg)
                } else {
                    Button(action: {
                        let cents = Int((Double(withdrawAmount) ?? 0) * 100)
                        Task {
                            await viewModel.withdraw(amountCents: cents)
                            if viewModel.errorMessage == nil {
                                showWithdrawSheet = false
                            }
                        }
                    }) {
                        Text("Withdraw")
                            .frame(maxWidth: .infinity)
                            .padding(DesignTokens.Spacing.md)
                            .background(Color.orange)
                            .foregroundColor(.white)
                            .cornerRadius(DesignTokens.Radius.md)
                    }
                }

                // Error message
                if let error = viewModel.errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }
            .padding(DesignTokens.Spacing.lg)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Close") { showWithdrawSheet = false }
                }
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
                ForEach(viewModel.displayLedger) { entry in
                    ledgerRowView(entry)
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
