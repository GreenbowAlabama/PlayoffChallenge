//
//  WalletBalanceButtonView.swift
//  PlayoffChallenge
//
//  Reusable wallet balance button for navigation to wallet detail.
//  Displays current wallet balance and opens WalletDetailView on tap.
//

import SwiftUI

struct WalletBalanceButtonView: View {
    @ObservedObject var viewModel: UserWalletViewModel

    var body: some View {
        NavigationLink(destination: {
            WalletDetailView(viewModel: viewModel)
        }) {
            HStack(spacing: DesignTokens.Spacing.sm) {
                Image(systemName: "wallet.bifold.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.green)

                Text(viewModel.displayBalance)
                    .font(.caption.bold())
                    .foregroundColor(DesignTokens.Color.Action.primary)
            }
            .padding(.horizontal, DesignTokens.Spacing.md)
            .padding(.vertical, DesignTokens.Spacing.sm)
            .background(DesignTokens.Color.Action.primary.opacity(0.1))
            .cornerRadius(DesignTokens.Radius.md)
        }
    }
}

#Preview {
    WalletBalanceButtonView(viewModel: UserWalletViewModel())
}
