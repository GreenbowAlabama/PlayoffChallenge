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

    var body: some View {
        VStack(spacing: 0) {
            // Header: Balance
            walletBalanceHeaderView
                .padding(.vertical, DesignTokens.Spacing.xl)
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
    }

    // MARK: - Subviews

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
}
